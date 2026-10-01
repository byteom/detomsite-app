"""
Phone-bot endpoints: the WhatsApp auto-send agent polls ``/whatsapp/pending``
with the SMS forward key, gets only messages that are READY to deliver (COD and
paid-verified UPI), and confirms delivery via ``/whatsapp/{id}/mark-sent``.
"""
import uuid

import pytest

from app.core.store import store
from app.services.sms_service import compose_order_wa


@pytest.fixture(autouse=True)
def _clean_wa_logs():
    yield
    with store._connect() as connection:
        connection.execute("DELETE FROM whatsapp_logs")


_RUN = uuid.uuid4().hex[:6]


def _u(base: str) -> str:
    """A collision-proof unique suffix, so repeated runs never reuse a shop."""
    return f"{base}_{_RUN}{uuid.uuid4().hex[:4]}"


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


# ─── COD: placed on submit, messaged once, nothing to confirm ───
async def test_cod_is_accepted_at_every_hour(client, monkeypatch):
    """The placement hour must not decide whether a COD order is "placed".

    Sweeping the whole day guards the actual rule — COD is placed on submit —
    rather than one convenient hour, which is how the old window-conditional
    behaviour was able to hide.
    """
    from test_order_cancel import (
        _approved_shop_with_product,
        _freeze_time,
        _place_order,
        _register_and_login,
    )

    for hour in (9, 14, 20, 23):
        _freeze_time(monkeypatch, hour, 0)
        shop, product = _approved_shop_with_product(
            f"{_u(f'codhr{hour}')}@example.com", f"COD Hour {hour}"
        )
        tok = await _register_and_login(
            client, _u(f"codtok{hour}"), "password123", f"COD {hour}", "student"
        )
        order = await _place_order(
            client, shop["id"], product["id"], f"COD {hour}", method="COD", token=tok
        )
        assert order["status"] == "Accepted", f"COD at {hour}:00 was not marked placed"


def test_cod_whatsapp_says_placed_not_confirm():
    """A COD message must not ask the shop to confirm anything.

    COD is placed the moment the student submits and the cash is collected on
    handover, so there is nothing left for the shopkeeper to confirm. Telling
    them to "confirm this order in the app" asked for a tap that is no longer
    part of the flow, and a shop that ignored it looked like a dropped order.

    Prepaid orders genuinely DO await payment, so they keep the instruction.
    """
    cod = compose_order_wa(
        {"id": "o1", "token": 1, "items": "2x Dosa", "student_name": "Asha",
         "delivery_location": "VIT-AP Main Gate", "delivery_slot": "Evening",
         "total": 120, "payment_method": "COD"},
        paid=False,
    )
    assert "confirm this order" not in cod.lower(), (
        "a COD message still asks the shop for a confirmation that is not required"
    )
    assert "already placed" in cod.lower()
    assert "Cash on Delivery" in cod

    upi = compose_order_wa(
        {"id": "o2", "token": 2, "items": "1x Dosa", "student_name": "Asha",
         "delivery_location": "VIT-AP Main Gate", "delivery_slot": "Evening",
         "total": 60, "payment_method": "UPI"},
        paid=False,
    )
    assert "confirm this order" in upi.lower()
    assert "awaiting payment" in upi.lower()


async def test_a_cod_order_queues_exactly_one_shop_whatsapp(client):
    """COD messages the shop on placement — and only once.

    The queued row is what the bot actually sends, so the "one message per
    order" guarantee has to hold on the COD path too, not just paid UPI.
    """
    from app.core import local_demo_db as store
    from test_order_cancel import (
        _approved_shop_with_product,
        _place_order,
        _register_and_login,
    )

    shop, product = _approved_shop_with_product(_u("codmsg_v") + "@example.com", "COD Msg Vendor")
    tok = await _register_and_login(client, _u("codmsg_t"), "password123", "COD Msg", "student")
    order = await _place_order(client, shop["id"], product["id"], "COD Msg", method="COD", token=tok)

    rows = [r for r in store.list_whatsapp_logs(50) if str(r.get("sub_order_id")) == order["id"]]
    assert len(rows) == 1, f"expected one shop message for the order, got {len(rows)}"
    assert "confirm this order" not in str(rows[0].get("message") or "").lower()


async def test_every_shop_in_a_multi_shop_order_gets_its_message(client, monkeypatch):
    """One student, several shops: EVERY shop is messaged, each with its own items.

    This is the queue-walk guarantee. The bot opens exactly one WhatsApp chat
    per poll cycle because its outbox is a single slot, so the feed must hand
    over exactly one message per request. When it used to claim a whole batch
    and return it, every shop after the first was marked in-flight but never
    opened — so a combo order left all but one shop waiting out the staleness
    window before their order was even deliverable.
    """
    from test_multi_shop_whatsapp import _shop_with_whatsapp
    from test_order_cancel import _register_and_login
    from unittest.mock import AsyncMock
    from app.api.v1 import local as local_api

    monkeypatch.setattr(local_api.push_service, "notify_shop_new_order_async", AsyncMock())
    token = await _register_and_login(client, _u("walk"), "password123", "Walk Student", "student")
    shop_a, prod_a = _shop_with_whatsapp(f"{_u('wa')}@example.com", "Walk Shop A", "9600000001", "Biryani A")
    shop_b, prod_b = _shop_with_whatsapp(f"{_u('wb')}@example.com", "Walk Shop B", "9600000002", "Dosa B")
    shop_c, prod_c = _shop_with_whatsapp(f"{_u('wc')}@example.com", "Walk Shop C", "9600000003", "Idli C")

    res = await client.post(
        "/api/v1/local/orders/multi",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "shops": [
                {"shop_id": shop_a["id"], "items": [{"product_id": prod_a["id"], "quantity": 1}]},
                {"shop_id": shop_b["id"], "items": [{"product_id": prod_b["id"], "quantity": 1}]},
                {"shop_id": shop_c["id"], "items": [{"product_id": prod_c["id"], "quantity": 1}]},
            ],
            "student_name": "Walk Student", "student_phone": "+919876543210",
            "delivery_location": "VIT-AP Main Gate", "payment_method": "COD",
        },
    )
    assert res.status_code == 200, res.text
    subs = {s["id"] for s in res.json()["sub_orders"]}
    assert len(subs) == 3

    # Walk the queue exactly as the bot does: one message, confirm it, repeat.
    delivered = {}
    for _ in range(6):
        body = (await client.get("/api/v1/local/whatsapp/pending")).json()
        if not body:
            break
        assert len(body) == 1, "the bot was handed several messages but opens one chat at a time"
        item = body[0]
        delivered[item["sub_order_id"]] = item["phone"]
        await client.post(f"/api/v1/local/whatsapp/{item['id']}/mark-sent")

    assert set(delivered) == subs, (
        f"only {len(delivered)} of {len(subs)} shops were messaged — the rest were "
        "claimed but never sent"
    )
    # Each shop was reached on its OWN number, never someone else's.
    for sub in res.json()["sub_orders"]:
        assert delivered[sub["id"]] == sub["shop_whatsapp"]


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

    # The feed hands over ONE message per request (the bot sends one per cycle),
    # so drain it the way the bot does. Across the walk it must offer exactly
    # the two READY messages — never the unpaid draft, never the sent one.
    seen = []
    for _ in range(4):
        body = (await client.get("/api/v1/local/whatsapp/pending")).json()
        if not body:
            break
        assert len(body) == 1, f"the bot is sent {len(body)} messages but opens one chat at a time"
        seen.extend(x["sub_order_id"] for x in body)
        # The bot confirms each delivery before polling again.
        await client.post(f"/api/v1/local/whatsapp/{body[0]['id']}/mark-sent")

    assert sorted(seen) == ["o2", "o3"]
    assert all("awaiting payment" not in s.lower() for s in seen)


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