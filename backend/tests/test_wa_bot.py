"""
Phone-bot endpoints: the WhatsApp auto-send agent polls ``/whatsapp/pending``
with the SMS forward key, gets only messages that are READY to deliver (COD and
paid-verified UPI), and confirms delivery via ``/whatsapp/{id}/mark-sent``.
"""
import pytest

from app.core.store import store


@pytest.fixture(autouse=True)
def _clean_wa_logs():
    yield
    with store._connect() as connection:
        connection.execute("DELETE FROM whatsapp_logs")


def _ready_row(order_id: str, status: str = "Pending") -> dict:
    """A message that is READY to deliver (COD or paid-verified UPI)."""
    return store.log_whatsapp(
        sub_order_id=order_id, phone="9876543210",
        message=f"Hello! New DETOMSITE order #{order_id}\n• Payment: Cash on Delivery ₹150",
        url="https://wa.me/919876543210", status=status,
    )


async def test_a_message_is_offered_to_the_bot_exactly_once(client):
    """The whole point: the shop is messaged ONCE, however often the bot polls.

    The bot de-duplicates in memory only, so its guard dies with the service.
    If the bot delivered a message but its mark-sent POST failed, the row stayed
    Pending and the next poll handed the SAME order back — which is how a
    shopkeeper ended up receiving one order over and over.

    The server now claims a row before handing it over, so a re-poll returns
    nothing until the claim goes stale.
    """
    row = _ready_row("o-once")

    first = await client.get("/api/v1/local/whatsapp/pending")
    assert first.status_code == 200
    assert [x["id"] for x in first.json()] == [row["id"]]

    # The bot sends it, then fails to confirm (network blip / process death).
    second = await client.get("/api/v1/local/whatsapp/pending")
    assert second.status_code == 200
    assert second.json() == [], "the same order was offered to the bot a second time"


async def test_confirming_delivery_keeps_it_out_of_the_feed(client, monkeypatch):
    """The normal path — send then confirm — also never re-offers the message."""
    from app.api.v1 import local as local_mod

    monkeypatch.setattr(local_mod.settings, "SMS_FORWARD_KEY", "topsecret")
    hdr = {"X-Agent-Key": "topsecret"}
    row = _ready_row("o-confirmed")

    first = await client.get("/api/v1/local/whatsapp/pending", headers=hdr)
    assert [x["id"] for x in first.json()] == [row["id"]]

    marked = await client.post(
        f"/api/v1/local/whatsapp/{row['id']}/mark-sent", headers=hdr
    )
    assert marked.status_code == 200

    after = await client.get("/api/v1/local/whatsapp/pending", headers=hdr)
    assert after.json() == []


async def test_a_stuck_claim_eventually_becomes_deliverable_again(client):
    """A bot killed mid-send must not swallow the order forever.

    Exactly-once has to mean "once per successful attempt", not "once ever" —
    otherwise a crash between claiming and sending would silently lose a real
    paid order. The claim goes stale after the window and the row is offered
    again.
    """
    row = _ready_row("o-stuck")

    first = await client.get("/api/v1/local/whatsapp/pending")
    assert [x["id"] for x in first.json()] == [row["id"]]

    # Pretend the claim was made long ago (bot died before sending).
    with store._connect() as connection:
        connection.execute(
            "UPDATE whatsapp_logs SET claimed_at = datetime('now', '-1 hour') WHERE id = ?",
            (row["id"],),
        )

    recovered = await client.get("/api/v1/local/whatsapp/pending")
    assert [x["id"] for x in recovered.json()] == [row["id"]], (
        "an abandoned claim swallowed a real order — it can never be retried"
    )


async def test_an_unpaid_draft_is_never_claimed(client):
    """A UPI draft must stay claimable once the payment lands.

    Claiming happens only for messages that are ready, so a draft is left
    untouched and the paid version can still be delivered.
    """
    draft = store.log_whatsapp(
        sub_order_id="o-draft", phone="9876543210",
        message="New order #o-draft\n• Payment: UPI ₹200 — awaiting payment",
        url="https://wa.me/919876543210", status="Pending",
    )
    first = await client.get("/api/v1/local/whatsapp/pending")
    assert draft["id"] not in [x["id"] for x in first.json()]

    # Payment verified → the row is refreshed to the paid version.
    store.update_whatsapp_message(
        draft["id"],
        "New order #o-draft\n• Payment: UPI paid ₹200 ✓",
        "https://wa.me/919876543210",
    )
    second = await client.get("/api/v1/local/whatsapp/pending")
    assert [x["id"] for x in second.json()] == [draft["id"]]


async def test_pending_filters_drafts_and_sent(client):
    # Draft → still awaiting payment: the bot must NOT send it yet.
    store.log_whatsapp(
        sub_order_id="o1", phone="9876543210",
        message="Hello! New DETOMSITE order #1\n• Payment: UPI ₹200 — awaiting payment",
        url="https://wa.me/919876543210", status="Pending",
    )
    # COD → ready now (nothing to verify).
    store.log_whatsapp(
        sub_order_id="o2", phone="9876543210",
        message="Hello! New DETOMSITE order #2\n• Payment: Cash on Delivery ₹150",
        url="https://wa.me/919876543210", status="Pending",
    )
    # Paid-verified UPI → ready now.
    store.log_whatsapp(
        sub_order_id="o3", phone="9876543210",
        message="Hello! New DETOMSITE order #3\n• Payment: UPI paid ₹80 ✓",
        url="https://wa.me/919876543210", status="Pending",
    )
    # Already delivered → never returned.
    store.log_whatsapp(
        sub_order_id="o4", phone="9876543210",
        message="Hello! New DETOMSITE order #4\n• Payment: UPI paid ₹90 ✓",
        url="https://wa.me/919876543210", status="Sent",
    )

    resp = await client.get("/api/v1/local/whatsapp/pending")
    assert resp.status_code == 200
    body = resp.json()
    assert sorted(x["sub_order_id"] for x in body) == ["o2", "o3"]
    assert all("awaiting payment" not in x["message"] for x in body)


async def test_mark_sent_roundtrip(client, monkeypatch):
    # Mutate the settings object the router holds (a sibling test reloads
    # app.core.config, replacing `settings`, so the endpoint instance is the
    # authoritative one here).
    from app.api.v1 import local as local_mod

    monkeypatch.setattr(local_mod.settings, "SMS_FORWARD_KEY", "topsecret")
    row = store.log_whatsapp(
        sub_order_id="o-marker", phone="9876543210",
        message="paid", url="https://wa.me/919876543210", status="Pending",
    )
    wa_id = row["id"]

    bad = await client.post(
        f"/api/v1/local/whatsapp/{wa_id}/mark-sent", headers={"X-Agent-Key": "nope"}
    )
    assert bad.status_code == 401

    good = await client.post(
        f"/api/v1/local/whatsapp/{wa_id}/mark-sent", headers={"X-Agent-Key": "topsecret"}
    )
    assert good.status_code == 200
    assert good.json()["status"] == "Sent"

    # A second mark is idempotent (still exists → 200). A missing row → 404.
    again = await client.post(
        f"/api/v1/local/whatsapp/{wa_id}/mark-sent", headers={"X-Agent-Key": "topsecret"}
    )
    assert again.status_code == 200
    missing = await client.post(
        "/api/v1/local/whatsapp/w-does-not-exist/mark-sent", headers={"X-Agent-Key": "topsecret"}
    )
    assert missing.status_code == 404


async def test_pending_requires_key(client, monkeypatch):
    from app.api.v1 import local as local_mod

    monkeypatch.setattr(local_mod.settings, "SMS_FORWARD_KEY", "sekret")
    resp = await client.get("/api/v1/local/whatsapp/pending")
    assert resp.status_code == 401
    resp = await client.get(
        "/api/v1/local/whatsapp/pending", headers={"X-Agent-Key": "sekret"}
    )
    assert resp.status_code == 200