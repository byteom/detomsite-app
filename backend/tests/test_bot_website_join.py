"""
Website ↔ payment-bot join, end to end.

The bug this file pins down: the student portal's QR checkout never asks the
student to type a UTR, so every order landed with an *empty* ``utr_number``. The
bot's ``/sms/match`` only accepted a credit it could tie to a saved UTR claim,
so it answered ``409 no unique saved UTR match`` to every real bank credit and
**no order was ever auto-completed** — the "payment bot doesn't work" report.

``_sms_match_core`` now matches in two tiers (a saved UTR first, then a unique
recent same-amount unpaid order at the same shop). These tests lock in BOTH
halves of that change: the happy paths settle an order and reflect it in the
student and admin portals, and every fail-closed guarantee still holds — an
ambiguous, stale, replayed or foreign-shop credit must never move an order.
"""
import uuid

import pytest
from fastapi import HTTPException

from app.core.store import store as db
from app.api.v1.local import LocalSmsMatch, _sms_match_core

_RUN = uuid.uuid4().hex[:6]


def _quiet(monkeypatch):
    """Silence the notification/WhatsApp side effects — these tests are about
    settlement, not delivery. ``_push_admin`` is synchronous (it fires a
    best-effort web push) while the other two are coroutines, so each needs the
    matching shape or Python warns about an un-awaited coroutine."""
    import app.api.v1.local as local_mod

    async def _async_noop(*a, **k):
        return None

    def _sync_noop(*a, **k):
        return None

    for name in ("_notify_shop_via_whatsapp", "_log_sms_inbound"):
        if hasattr(local_mod, name):
            monkeypatch.setattr(local_mod, name, _async_noop, raising=False)
    monkeypatch.setattr(local_mod, "_push_admin", _sync_noop, raising=False)


async def _student(client):
    """A registered student + their auth headers."""
    username = f"botjoin_{_RUN}_{uuid.uuid4().hex[:4]}"
    reg = await client.post("/api/v1/local/auth/register", json={
        "username": username, "password": "password123", "name": "Bot Join Student",
        "role": "student", "email": f"{username}@example.com", "phone": "+919000000123",
    })
    assert reg.status_code in (200, 201), reg.text
    login = await client.post("/api/v1/local/auth/login", json={
        "username": username, "password": "password123",
    })
    assert login.status_code == 200, login.text
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}, token


def _shop(phone: str):
    """An approved, open shop with a UPI ID — the target of the credit SMS."""
    shop = db.create_shop({
        "name": f"Bot Join Kitchen {_RUN}",
        "category": "Food",
        "description": "bank-match test shop",
        "shopkeeper_email": f"botjoin_{_RUN}_{uuid.uuid4().hex[:4]}@example.com",
        "shopkeeper_name": "Bot Join Vendor",
        "phone": phone,
        "upi_id": f"shop{_RUN}@upi",
        "upi_enabled": 1,
        "cod_enabled": 1,
    })
    db.update_shop(shop["id"], {"approval_status": "Approved", "present": True, "status": "Open"})
    return db.get_shop(shop["id"])


def _uporder(shop, price: int, method: str = "UPI"):
    """A product + an unpaid order for it — the shape checkout produces."""
    product = db.create_product({
        "shop_id": shop["id"], "name": f"Item {uuid.uuid4().hex[:6]}", "price": price,
        "category": "Food", "description": "t", "inventory": 50, "prep_time": 5, "available": True,
    })
    order = db.create_order({
        "shop_id": shop["id"],
        "items": [{"product_id": product["id"], "quantity": 1}],
        "student_name": "Bot Join Student", "student_phone": "+919000000123",
        "delivery_location": "VIT-AP Main Gate", "delivery_slot": "Evening",
        "payment_method": method,
    })
    assert order, "order must be created"
    return order


def _bind_owner(order_id: str, user_id):
    with db._connect() as connection:
        connection.execute("UPDATE orders SET owner_user_id = ? WHERE id = ?", (user_id, order_id))


async def _user_id(client, headers) -> int:
    me = await client.get("/api/v1/local/auth/me", headers=headers)
    assert me.status_code == 200, me.text
    return me.json()["id"]


async def _admin_orders(client):
    """Log in as a real admin and read the list the admin portal polls."""
    from app.core.security import hash_password

    username = f"botjoin_admin_{_RUN}_{uuid.uuid4().hex[:4]}"
    db.register_user(
        username=username, password_hash=hash_password("admin_pass_123"),
        name="Bot Join Admin", role="admin", email="", phone="",
    )
    login = await client.post("/api/v1/admin/login", json={"username": username, "password": "admin_pass_123"})
    assert login.status_code == 200, login.text
    res = await client.get("/api/v1/local/orders", headers={"Authorization": f"Bearer {login.json()['access_token']}"})
    assert res.status_code == 200, res.text
    return res.json()


# ─── Tier 2: the case that used to always fail ──────────────────────────────


async def test_bank_credit_completes_a_qr_order_with_no_utr(monkeypatch):
    """THE regression. A plain QR checkout — where the student never types a
    reference, so the payment row's ``utr_number`` is empty — plus a bank credit
    SMS must settle the order, exactly as the shopkeeper expects."""
    _quiet(monkeypatch)

    shop = _shop("9000000011")
    order = _uporder(shop, 77)
    payment = db.create_payment(order["id"], 77, "Manual UTR", "")
    assert db.get_order(order["id"])["status"] == "Pending Payment"

    result = await _sms_match_core(LocalSmsMatch(phone=shop["phone"], utr="412233445566", amount=77))

    assert result["matched"] is True
    assert result["order_id"] == order["id"]
    assert result["order_status"] == "Completed"
    assert result["matched_by"] == "bank_credit"
    assert db.get_order(order["id"])["status"] == "Completed"
    assert db.get_payment_by_id(payment["id"])["status"] == "Success"
    # The credit is burned: the UTR is stamped on the row, so the same SMS can
    # never settle a second order later.
    assert db.get_payment_by_id(payment["id"])["utr_number"] == "412233445566"


async def test_claimed_utr_is_preferred_over_the_amount(monkeypatch):
    """Tier 1 outranks tier 2: two same-amount orders, one with a claimed UTR →
    the UTR decides, never the amount."""
    _quiet(monkeypatch)

    shop = _shop("9000000013")
    older = _uporder(shop, 80)
    newer = _uporder(shop, 80)
    db.create_payment(older["id"], 80, "Manual UTR", "123456789012")

    result = await _sms_match_core(LocalSmsMatch(phone=shop["phone"], utr="123456789012", amount=80))
    assert result["order_id"] == older["id"]
    assert result["matched_by"] == "utr_claim"
    assert db.get_order(older["id"])["status"] == "Completed"
    assert db.get_order(newer["id"])["status"] == "Pending Payment"


async def test_completed_order_reflects_in_student_and_admin_portals(client, monkeypatch):
    """The whole point of the join: once the bot settles it, BOTH portals show
    the order as paid, with no manual admin step in between."""
    _quiet(monkeypatch)

    headers, _ = await _student(client)
    shop = _shop("9000000012")
    order = _uporder(shop, 120)
    db.create_payment(order["id"], 120, "Manual UTR", "")
    _bind_owner(order["id"], await _user_id(client, headers))

    before = await client.get(f"/api/v1/local/orders/{order['id']}", headers=headers)
    assert before.status_code == 200 and before.json()["status"] == "Pending Payment"

    await _sms_match_core(LocalSmsMatch(phone=shop["phone"], utr="412233445577", amount=120))

    # Student portal: the order page and the payment-portal endpoint both flip.
    after = await client.get(f"/api/v1/local/orders/{order['id']}", headers=headers)
    assert after.status_code == 200
    assert after.json()["status"] == "Completed"

    view = await client.get(f"/api/v1/local/orders/{order['id']}/payment", headers=headers)
    assert view.status_code == 200, view.text
    body = view.json()
    assert body["order_status"] == "Completed"
    assert body["payment_status"] == "Success"
    assert body["amount"] == 120
    # The UTR itself is never echoed back to the browser — only its presence.
    assert "utr_number" not in body
    assert body["utr_saved"] is True

    listed = await client.get("/api/v1/local/orders", headers=headers)
    assert any(o["id"] == order["id"] and o["status"] == "Completed" for o in listed.json())

    admin_view = await _admin_orders(client)
    assert any(o["id"] == order["id"] and o["status"] == "Completed" for o in admin_view)


# ─── Fail-closed: tier 2 must never guess ───────────────────────────────────


async def test_two_same_amount_orders_are_never_guessed(monkeypatch):
    """The safety-critical case. Two unpaid ₹50 orders at one shop and a single
    ₹50 credit: which student paid? Refuse, change nothing, notify nobody."""
    import app.api.v1.local as local_mod
    _quiet(monkeypatch)
    sent = []
    monkeypatch.setattr(local_mod, "_notify_shop_via_whatsapp",
                        lambda *a, **k: sent.append(a), raising=False)

    shop = _shop("9000000014")
    first = _uporder(shop, 50)
    second = _uporder(shop, 50)
    db.create_payment(first["id"], 50, "Manual UTR", "")
    db.create_payment(second["id"], 50, "Manual UTR", "")

    with pytest.raises(HTTPException) as exc:
        await _sms_match_core(LocalSmsMatch(phone=shop["phone"], utr="412233445588", amount=50))
    assert exc.value.status_code == 409
    assert db.get_order(first["id"])["status"] == "Pending Payment"
    assert db.get_order(second["id"])["status"] == "Pending Payment"
    assert not sent


async def test_a_credit_never_touches_another_shop(monkeypatch):
    """A credit is scoped to the shop whose phone the agent reported: the shop is
    resolved from that number, and only THAT shop's unpaid orders are candidates."""
    _quiet(monkeypatch)
    mine = _shop("9000000015")
    other = _shop("9000000016")
    order = _uporder(other, 90)
    db.create_payment(order["id"], 90, "Manual UTR", "")

    with pytest.raises(HTTPException) as exc:
        # The agent on MY phone forwards a credit — it must not settle OTHER's
        # order even though the amount matches exactly.
        await _sms_match_core(LocalSmsMatch(phone=mine["phone"], utr="412233445599", amount=90))
    assert exc.value.status_code == 409
    assert "no unpaid order at this shop" in exc.value.detail
    assert db.get_order(order["id"])["status"] == "Pending Payment"

    # And the real owner's agent phone DOES settle it — proving the scoping is
    # what did the work, not a blanket rejection.
    ok = await _sms_match_core(LocalSmsMatch(phone=other["phone"], utr="412233445600", amount=90))
    assert ok["order_id"] == order["id"]
    assert db.get_order(order["id"])["status"] == "Completed"


async def test_a_stale_order_is_not_settled_by_todays_credit(monkeypatch):
    """An unpaid order from yesterday must not be closed out by a same-amount
    credit arriving now — that is how a stranger's order gets marked paid."""
    _quiet(monkeypatch)
    shop = _shop("9000000017")
    order = _uporder(shop, 60)
    db.create_payment(order["id"], 60, "Manual UTR", "")

    with db._connect() as connection:
        connection.execute(
            "UPDATE orders SET created_at = datetime('now', '-1 day') WHERE id = ?",
            (order["id"],),
        )

    with pytest.raises(HTTPException) as exc:
        await _sms_match_core(LocalSmsMatch(phone=shop["phone"], utr="412233445500", amount=60))
    assert exc.value.status_code == 409
    assert db.get_order(order["id"])["status"] == "Pending Payment"


async def test_one_credit_cannot_settle_two_orders(monkeypatch):
    """Replay guard: the UTR is burned on the first match, so re-sending the very
    same bank SMS (operators do re-deliver these) settles nothing further.

    Note the shape: the first match must be UNAMBIGUOUS, otherwise the
    ambiguity guard — not the replay guard — is what rejects the second call.
    """
    _quiet(monkeypatch)
    shop = _shop("9000000018")
    first = _uporder(shop, 130)
    db.create_payment(first["id"], 130, "Manual UTR", "")

    settled = await _sms_match_core(LocalSmsMatch(phone=shop["phone"], utr="412233445511", amount=130))
    assert settled["order_id"] == first["id"]

    # The same amount is ordered again AFTER the credit — the replay must not
    # quietly pay for it.
    second = _uporder(shop, 130)
    db.create_payment(second["id"], 130, "Manual UTR", "")

    with pytest.raises(HTTPException) as exc:
        await _sms_match_core(LocalSmsMatch(phone=shop["phone"], utr="412233445511", amount=130))
    assert exc.value.status_code == 409
    assert db.get_order(second["id"])["status"] == "Pending Payment"


async def test_cod_orders_are_never_settled_by_a_credit(monkeypatch):
    """Cash on Delivery has no bank evidence at all."""
    _quiet(monkeypatch)
    shop = _shop("9000000019")
    order = _uporder(shop, 45, method="COD")
    db.create_payment(order["id"], 45, "COD", "")

    with pytest.raises(HTTPException):
        await _sms_match_core(LocalSmsMatch(phone=shop["phone"], utr="412233445522", amount=45))
    assert db.get_order(order["id"])["status"] == "Pending Acceptance"


async def test_an_order_without_a_payment_row_is_never_settled(monkeypatch):
    """The order must actually have been presented for payment — a stale unpaid
    row with no payment record must not be closable by a same-amount credit."""
    _quiet(monkeypatch)
    shop = _shop("9000000022")
    order = _uporder(shop, 35)
    # deliberately NO create_payment here
    with pytest.raises(HTTPException) as exc:
        await _sms_match_core(LocalSmsMatch(phone=shop["phone"], utr="412233445544", amount=35))
    assert exc.value.status_code == 409
    assert db.get_order(order["id"])["status"] == "Pending Payment"


async def test_tier2_judges_the_order_on_its_NEWEST_payment_row(monkeypatch):
    """Found by scripts/demo_payment_bot.py.

    ``list_payments()`` returns rows newest-first, so indexing them with a plain
    dict comprehension kept the OLDEST row for an order. That silently disagreed
    with ``get_payment_by_order_id`` (newest wins) and made the bot judge an
    order on a dead payment intent.

    Reachable shape: a payment row is written at checkout, the student cancels
    (marking it Cancelled) and then re-pays, producing a second row. Judged on
    the stale row the bot either refuses a legitimate payment, or settles one
    that had already been closed.
    """
    _quiet(monkeypatch)
    shop = _shop("9000000030")
    order = _uporder(shop, 95)
    # Oldest row: a cancelled intent from a previous attempt.
    old = db.create_payment(order["id"], 95, "Manual UTR", "")
    db.update_payment_status(old["id"], "Cancelled")
    # Newest row: the live intent the student actually paid against.
    new = db.create_payment(order["id"], 95, "Manual UTR", "")

    ordered = [p["id"] for p in db.list_payments()]
    assert ordered.index(new["id"]) < ordered.index(old["id"]), \
        "this test assumes list_payments() is newest-first (both stores sort DESC)"

    result = await _sms_match_core(LocalSmsMatch(phone=shop["phone"], utr="412233445599", amount=95))

    # Settled — and settled against the NEW row, not the cancelled one.
    assert result["order_id"] == order["id"]
    assert db.get_payment_by_id(new["id"])["status"] == "Success"
    assert db.get_payment_by_id(old["id"])["status"] == "Cancelled", \
        "the stale cancelled row must not be touched"
    assert db.get_order(order["id"])["status"] == "Completed"


# ─── The payment-portal endpoint: access control + the student's UTR step ───


async def test_payment_status_endpoint_is_owner_only(client):
    """The new endpoint must be exactly as locked down as GET /orders/{id}."""
    shop = _shop("9000000020")
    order = _uporder(shop, 42)
    db.create_payment(order["id"], 42, "Manual UTR", "")

    owner_headers, _ = await _student(client)
    _bind_owner(order["id"], await _user_id(client, owner_headers))

    ok = await client.get(f"/api/v1/local/orders/{order['id']}/payment", headers=owner_headers)
    assert ok.status_code == 200, ok.text
    body = ok.json()
    assert body["order_status"] == "Pending Payment"
    assert body["payment_status"] == "Pending"
    assert body["amount"] == 42
    assert body["utr_saved"] is False

    anon = await client.get(f"/api/v1/local/orders/{order['id']}/payment")
    assert anon.status_code == 401

    # A different, unrelated student must not be able to read it.
    other_headers, _ = await _student(client)
    denied = await client.get(f"/api/v1/local/orders/{order['id']}/payment", headers=other_headers)
    assert denied.status_code == 403

    missing = await client.get("/api/v1/local/orders/o-does-not-exist/payment", headers=owner_headers)
    assert missing.status_code == 404


async def test_saving_a_reference_is_reflected_in_the_payment_portal(client):
    """CUT OFF — the UTR-only endpoint answers 410; the portal's proof status
    is what now reflects a saved proof, and it must never hand the reference
    itself back to the browser."""
    shop = _shop("9000000021")
    order = _uporder(shop, 64)
    db.create_payment(order["id"], 64, "Manual UTR", "")

    headers, _ = await _student(client)
    _bind_owner(order["id"], await _user_id(client, headers))

    before = (await client.get(f"/api/v1/local/orders/{order['id']}/payment", headers=headers)).json()
    assert before["utr_saved"] is False
    assert before["proof_status"] == "PENDING_PAYMENT"

    saved = await client.post("/api/v1/local/payments/utr", headers=headers,
                              json={"order_id": order["id"], "utr_number": "998877665544"})
    assert saved.status_code == 410, saved.text

    after = (await client.get(f"/api/v1/local/orders/{order['id']}/payment", headers=headers)).json()
    assert after["utr_saved"] is False
    assert "998877665544" not in str(after)

    # Nothing settled the order — it is still awaiting payment.
    assert after["payment_status"] != "Success"
    assert db.get_order(order["id"])["status"] == "Pending Payment"


async def test_agent_key_still_gates_the_match_route(client, monkeypatch):
    """CUT OFF — the agent gate still runs first (401s preserved); a valid key
    now gets the explicit 410 instead of a matching attempt."""
    from app.api.v1 import local as local_mod

    monkeypatch.setattr(local_mod.settings, "SMS_FORWARD_KEY", "sekret")
    body = {"phone": "9000000099", "utr": "412233445533", "amount": 10}

    anon = await client.post("/api/v1/local/sms/match", json=body)
    assert anon.status_code == 401

    wrong = await client.post("/api/v1/local/sms/match", json=body, headers={"X-Agent-Key": "nope"})
    assert wrong.status_code == 401

    good = await client.post("/api/v1/local/sms/match", json=body, headers={"X-Agent-Key": "sekret"})
    assert good.status_code == 410, good.text


async def test_private_api_responses_are_not_cacheable(client):
    """Student PII must not linger in a shared proxy / browser cache after logout."""
    headers, _ = await _student(client)
    res = await client.get("/api/v1/local/orders", headers=headers)
    assert res.status_code == 200
    assert "no-store" in res.headers.get("cache-control", "")
    # Public, non-personal reads stay cacheable.
    health = await client.get("/health")
    assert "no-store" not in health.headers.get("cache-control", "")
