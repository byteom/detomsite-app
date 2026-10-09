"""The retried-checkout deadlock: a PAID order whose button never unlocks.

THE BUG THIS PINS
-----------------
The payment page POSTs the order, and retries when the serverless host is slow.
A retry used to INSERT a *second* order for the same basket. Two unpaid
same-amount orders at one shop is exactly the ambiguity tier-2 bank matching
refuses to guess at, so when the student paid, the credit matched NEITHER:

    HTTP 409 "more than one unpaid order matches this credit"

The student had paid, "Place Order" stayed locked forever, and the page showed
no error they could act on — precisely the screenshot that prompted this work.

THREE FIXES, THREE GROUPS OF TESTS
----------------------------------
1. ``client_ref`` makes the retry idempotent — the same basket replays onto the
   SAME order instead of forking a new one.
2. Duplicates that ALREADY exist are collapsed by tier-2 matching when they all
   belong to ONE account — while two DIFFERENT customers are still refused.
3. The student can submit their UTR, so a missing bank SMS is no longer a
   dead end.
"""
import uuid

import pytest
from fastapi import HTTPException

from app.api.v1 import local
from app.core.store import store as db
from test_order_cancel import _approved_shop_with_product, _register_and_login

_RUN = uuid.uuid4().hex[:6]


def _u(base: str) -> str:
    return f"{base}_{_RUN}{uuid.uuid4().hex[:4]}"


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _student(client, tag: str, name: str = "Dup Student") -> str:
    return await _register_and_login(
        client, _u(tag), "password123", name, "student",
        phone=f"+919{uuid.uuid4().int % 10**8:08d}",
    )


def _body(shop: dict, product: dict, ref: str = "") -> dict:
    payload = {
        "shop_id": shop["id"],
        "items": [{"product_id": product["id"], "quantity": 1}],
        "student_name": "Dup Student",
        "student_phone": "+919000000123",
        "delivery_location": "VIT-AP Main Gate",
        "delivery_slot": "Evening",
        "payment_method": "UPI",
    }
    if ref:
        payload["client_ref"] = ref
    return payload


def _quiet(monkeypatch):
    """Silence the notification fan-out so these tests assert on matching only."""
    from unittest.mock import AsyncMock

    monkeypatch.setattr(local, "_notify_order_via_sms", AsyncMock())
    monkeypatch.setattr(local, "_notify_shop_via_whatsapp", AsyncMock())
    monkeypatch.setattr(local.push_service, "notify_shop_new_order_async", AsyncMock())
    monkeypatch.setattr(local, "_push_admin", lambda *a, **k: None)
    monkeypatch.setattr(local, "_log_sms_inbound", AsyncMock())


def _bot_shop(phone: str, tag: str) -> dict:
    """An approved, open shop with a UPI ID — the target of a bank credit."""
    shop = db.create_shop({
        "name": f"{tag} Kitchen {_RUN}", "category": "Food", "description": "d",
        "shopkeeper_email": f"{tag}_{uuid.uuid4().hex[:6]}@example.com",
        "shopkeeper_name": f"{tag} Vendor", "phone": phone,
        "upi_id": f"{tag}{_RUN}@upi", "upi_enabled": 1, "cod_enabled": 1,
    })
    db.update_shop(shop["id"], {"approval_status": "Approved", "present": True, "status": "Open"})
    return db.get_shop(shop["id"])


def _unpaid_order(shop, price, owner_user_id):
    """An order + its open payment row, bound to an owner — the checkout shape."""
    product = db.create_product({
        "shop_id": shop["id"], "name": f"Item {uuid.uuid4().hex[:6]}", "price": price,
        "category": "Food", "description": "t", "inventory": 50, "prep_time": 5,
        "available": True,
    })
    order = db.create_order({
        "shop_id": shop["id"],
        "items": [{"product_id": product["id"], "quantity": 1}],
        "owner_user_id": owner_user_id,
        "student_name": "Bot Join Student", "student_phone": "+919000000123",
        "delivery_location": "VIT-AP Main Gate", "delivery_slot": "Evening",
        "payment_method": "UPI",
    })
    assert order, "order must be created"
    db.create_payment(order["id"], price, "Manual UTR", "")
    return order


# ─── 1. The retry is idempotent ───
@pytest.mark.anyio
async def test_replayed_checkout_returns_the_same_order(client):
    """A retried POST must not fork a second order for the same basket.

    This is the direct cause of the deadlock: two same-amount unpaid orders make
    the bank credit ambiguous, so a student who had paid could never unlock the
    button.
    """
    token = await _student(client, "idem")
    headers = _headers(token)
    shop, product = _approved_shop_with_product(f"{_u('idem_v')}@example.com", "Idem Vendor")
    ref = "co-" + _u("r")

    first = await client.post("/api/v1/local/orders", json=_body(shop, product, ref), headers=headers)
    assert first.status_code == 200, first.text
    first_id = first.json()["id"]

    # The retry a slow server provokes.
    second = await client.post("/api/v1/local/orders", json=_body(shop, product, ref), headers=headers)
    assert second.status_code == 200, second.text
    assert second.json()["id"] == first_id, (
        "the retry created a SECOND order — two same-amount unpaid orders make "
        "the bank credit ambiguous and lock a paid student out forever"
    )


@pytest.mark.anyio
async def test_a_different_basket_still_creates_a_new_order(client):
    """Idempotency must not swallow a genuinely new order.

    Treated as a permanent lockout, a student who changed their cart could
    never order again.
    """
    token = await _student(client, "newbasket")
    headers = _headers(token)
    shop, product = _approved_shop_with_product(f"{_u('nb_v')}@example.com", "NB Vendor")

    a = await client.post("/api/v1/local/orders", json=_body(shop, product, "co-" + _u("a")), headers=headers)
    b = await client.post("/api/v1/local/orders", json=_body(shop, product, "co-" + _u("b")), headers=headers)
    assert a.status_code == 200 and b.status_code == 200, (a.text, b.text)
    assert a.json()["id"] != b.json()["id"]


@pytest.mark.anyio
async def test_client_ref_is_scoped_to_the_owning_account(client):
    """A student must never receive another student's order by guessing a ref.

    The ref is client-chosen, so an unscoped lookup would hand student B
    student A's order id — and let them attach a payment to it.
    """
    token_a = await _student(client, "owna", "Alice")
    token_b = await _student(client, "ownb", "Bob")
    shop, product = _approved_shop_with_product(f"{_u('own_v')}@example.com", "Own Vendor")
    ref = "co-" + _u("shared")

    a = await client.post("/api/v1/local/orders", json=_body(shop, product, ref), headers=_headers(token_a))
    assert a.status_code == 200, a.text
    b = await client.post("/api/v1/local/orders", json=_body(shop, product, ref), headers=_headers(token_b))
    assert b.status_code == 200, b.text
    assert b.json()["id"] != a.json()["id"], "another student's ref returned someone else's order"


# ─── 2. Pre-existing duplicates no longer deadlock the matcher ───
@pytest.mark.anyio
async def test_own_duplicate_drafts_do_not_block_the_match(client, monkeypatch):
    """Same-owner duplicates collapse to the live order; the credit settles.

    The self-heal for duplicates that already exist in the database — created
    before the idempotency fix, or by a client that sends no ref at all.
    """
    phone = f"9{uuid.uuid4().int % 10**9:09d}"
    shop = _bot_shop(phone, "dup")
    owner = str(uuid.uuid4().int)
    older = _unpaid_order(shop, 2, owner)
    newer = _unpaid_order(shop, 2, owner)

    _quiet(monkeypatch)
    result = await local._sms_match_core(local.LocalSmsMatch(phone=phone, utr="", amount=2))

    assert result["matched"] is True, (
        "a student's own duplicated drafts still made their own payment "
        "unmatchable — they paid and could never unlock Place Order"
    )
    # The newest draft is the live one; the older twin is closed.
    assert result["order_id"] == newer["id"]
    assert db.get_order(older["id"])["status"] == "Cancelled", (
        "the superseded draft stays live and can be picked up by a later credit"
    )


@pytest.mark.anyio
async def test_two_different_customers_are_still_refused(client, monkeypatch):
    """The fix must NOT weaken the between-customers ambiguity guard.

    Two DIFFERENT people with open same-amount bills is exactly the case where
    the amount alone cannot say who paid. That must still go to manual review.
    """
    phone = f"8{uuid.uuid4().int % 10**9:09d}"
    shop = _bot_shop(phone, "twoc")
    _unpaid_order(shop, 2, str(uuid.uuid4().int))
    _unpaid_order(shop, 2, str(uuid.uuid4().int))

    _quiet(monkeypatch)
    with pytest.raises(HTTPException) as exc:
        await local._sms_match_core(local.LocalSmsMatch(phone=phone, utr="", amount=2))
    assert exc.value.status_code == 409, "the matcher guessed which of two customers paid"


# ─── 3. The student is never permanently locked out ───
@pytest.mark.anyio
async def test_student_can_submit_a_utr_to_unblock_themselves(client, monkeypatch):
    """CUT OFF — the old claim-confirm path answers 410. The replacement that
    unblocks a student with no working SMS agent is the manual proof flow:
    submit UTR + screenshot, which queues the order for admin verification
    instead of depending on any bank message."""
    from app.services import cloudinary_service

    monkeypatch.setattr(cloudinary_service, "is_configured", lambda: True)
    monkeypatch.setattr(
        cloudinary_service, "upload_image",
        lambda data, *, folder, public_id: {
            "secure_url": f"https://res.cloudinary.test/{folder}/{public_id}.png",
            "public_id": f"{folder}/{public_id}", "format": "png", "bytes": len(data),
        },
    )
    token = await _student(client, "utr")
    headers = _headers(token)
    shop, product = _approved_shop_with_product(f"{_u('utr_v')}@example.com", "Utr Vendor")
    created = await client.post("/api/v1/local/orders", json=_body(shop, product, "co-" + _u("u")), headers=headers)
    order_id = created.json()["id"]
    db.create_payment(order_id, 100, "Manual UTR", "")

    gone = await client.post(
        f"/api/v1/local/orders/{order_id}/confirm-payment",
        json={"utr_number": "412233445500"},
        headers=headers,
    )
    assert gone.status_code == 410, gone.text

    import io
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), (0, 128, 0)).save(buf, format="PNG")
    res = await client.post(
        "/api/v1/local/payments/proof",
        data={"order_id": order_id, "utr_number": "412233445500"},
        files={"screenshot": ("proof.png", buf.getvalue(), "image/png")},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    assert res.json()["proof_status"] == "PAYMENT_PROOF_SUBMITTED"

    # Proof on file, order still awaits the admin (never auto-settled).
    assert db.get_payment_by_order_id(order_id)["utr_number"] == "412233445500"


@pytest.mark.anyio
async def test_placing_an_order_opens_its_payment_intent(client):
    """POST /orders opens the payment row ITSELF — no second request needed.

    The browser used to follow every order with POST /local/payments. Measured
    in production that second call took 12-27 s on its own (a second cold start
    for one INSERT), so the client hit its 20 s ceiling and reported "the server
    is taking too long" for an order that had already been created.

    The intent must exist on the SAME response, because tier-2 bank matching
    only settles an order that has an open payment row — without it the QR
    amount is real but nothing can ever match the credit.
    """
    token = await _student(client, "intent")
    headers = _headers(token)
    shop, product = _approved_shop_with_product(f"{_u('in_v')}@example.com", "Intent Vendor")
    created = await client.post("/api/v1/local/orders", json=_body(shop, product, "co-" + _u("i")), headers=headers)
    order_id = created.json()["id"]

    payment = db.get_payment_by_order_id(order_id)
    assert payment is not None, (
        "the order was created without a payment intent — the bank credit can "
        "never match it, so Place Order would stay locked after a real payment"
    )
    assert payment["status"] == "Pending"
    assert payment["amount"] == created.json()["total"]


@pytest.mark.anyio
async def test_re_posting_payment_does_not_stack_a_second_row(client):
    """A repeat POST /payments reuses the open intent rather than duplicating it.

    Two open payment rows on one order make tier-2 matching read the wrong row
    and double-count the order in the admin's settlement views.
    """
    token = await _student(client, "norow")
    headers = _headers(token)
    shop, product = _approved_shop_with_product(f"{_u('nr2_v')}@example.com", "NoRow Vendor")
    # This shop needs a UPI target, or POST /payments correctly refuses before
    # it ever reaches the dedupe branch we are testing.
    db.update_shop(shop["id"], {"upi_id": f"norow{_RUN}@upi", "upi_enabled": 1})
    created = await client.post("/api/v1/local/orders", json=_body(shop, product, "co-" + _u("r")), headers=headers)
    order_id = created.json()["id"]
    first_id = db.get_payment_by_order_id(order_id)["id"]

    again = await client.post(
        "/api/v1/local/payments",
        json={"order_id": order_id, "amount": 100, "method": "Manual UTR", "utr_number": ""},
        headers=headers,
    )
    assert again.status_code == 200, again.text
    assert again.json()["id"] == first_id, "a second payment row was stacked on the order"
    assert len([p for p in db.list_payments() if p["order_id"] == order_id]) == 1


@pytest.mark.anyio
async def test_cod_order_opens_a_settled_payment_row(client):
    """COD is paid on delivery, so its intent is opened as already-successful.

    COD orders are visible to the shop immediately and are never payment-gated,
    so the row must not sit open — that would make the admin's settlement views
    count cash that was never collected.
    """
    token = await _student(client, "codrow")
    headers = _headers(token)
    shop, product = _approved_shop_with_product(f"{_u('cod_v')}@example.com", "Cod Vendor")
    body = _body(shop, product, "co-" + _u("c"))
    body["payment_method"] = "COD"
    created = await client.post("/api/v1/local/orders", json=body, headers=headers)
    order_id = created.json()["id"]
    payment = db.get_payment_by_order_id(order_id)
    assert payment is not None and payment["status"] == "Success"


@pytest.mark.anyio
async def test_utr_confirmation_cannot_touch_someone_elses_order(client):
    """CUT OFF — the claim-confirm path answers 410 for any authenticated
    caller (auth still runs first, so anonymous callers get 401). Ownership of
    the replacement proof flow is pinned in test_payment_pentest.py."""
    token_a = await _student(client, "victim", "Victim")
    token_b = await _student(client, "attacker", "Attacker")
    shop, product = _approved_shop_with_product(f"{_u('vic_v')}@example.com", "Vic Vendor")
    created = await client.post("/api/v1/local/orders", json=_body(shop, product, "co-" + _u("v")), headers=_headers(token_a))
    order_id = created.json()["id"]

    res = await client.post(
        f"/api/v1/local/orders/{order_id}/confirm-payment",
        json={"utr_number": "412233445511"},
        headers=_headers(token_b),
    )
    assert res.status_code == 410, res.text


@pytest.mark.anyio
async def test_utr_confirmation_rejects_junk(client):
    """CUT OFF — junk to the claim-confirm path gets the same explicit 410
    (payload shape is still validated first: an oversized UTR is 422)."""
    token = await _student(client, "junk")
    headers = _headers(token)
    shop, product = _approved_shop_with_product(f"{_u('junk_v')}@example.com", "Junk Vendor")
    created = await client.post("/api/v1/local/orders", json=_body(shop, product, "co-" + _u("j")), headers=headers)

    res = await client.post(
        f"/api/v1/local/orders/{created.json()['id']}/confirm-payment",
        json={"utr_number": "'; DROP TABLE orders; --"},
        headers=headers,
    )
    assert res.status_code == 410, res.text


@pytest.mark.anyio
async def test_utr_confirmation_does_not_pay_the_order_by_itself(client):
    """Submitting a reference records PROOF — it must never settle the order.

    If this endpoint marked orders paid, any student could claim their own
    basket was paid with a made-up reference.
    """
    token = await _student(client, "norealse")
    headers = _headers(token)
    shop, product = _approved_shop_with_product(f"{_u('nr_v')}@example.com", "NoReal Vendor")
    created = await client.post("/api/v1/local/orders", json=_body(shop, product, "co-" + _u("n")), headers=headers)
    order_id = created.json()["id"]
    db.create_payment(order_id, 100, "Manual UTR", "")

    await client.post(
        f"/api/v1/local/orders/{order_id}/confirm-payment",
        json={"utr_number": "412233445522"},
        headers=headers,
    )
    assert db.get_payment_by_order_id(order_id)["status"] == "Pending", (
        "a student-supplied reference marked the order paid without bank evidence"
    )


# ─── Abuse: one account must not be able to flood the platform ───
@pytest.mark.anyio
async def test_a_student_cannot_flood_the_platform_with_orders(client, monkeypatch):
    """POST /orders must be bounded per ACCOUNT.

    The endpoint had no per-account limit, so any authenticated student could
    loop it and create an unbounded number of real orders. Each one decrements
    product stock AND queues a WhatsApp message to a real shopkeeper — so the
    abuse is not merely database rows, it is a way to burn a shop's stock and
    flood the campus's shops with junk notifications from a single account.
    """
    from app.api.v1 import local as local_mod

    token = await _student(client, "flood")
    shop, product = _approved_shop_with_product(f"{_u('fl_v')}@example.com", "Flood Vendor")

    # The limiter reports this account is out of budget.
    monkeypatch.setattr(local_mod, "rate_allow", lambda *a, **k: False)
    res = await client.post(
        "/api/v1/local/orders", json=_body(shop, product, "co-" + _u("f")),
        headers=_headers(token),
    )
    assert res.status_code == 429, "an unthrottled student can place unlimited orders"


@pytest.mark.anyio
async def test_the_order_limit_does_not_lock_out_other_students(client, monkeypatch):
    """The limit is per student — never global, and never per-IP.

    A campus sits behind a single NAT address, so an IP-based limit would lock
    out every honest student the moment one person misbehaved.
    """
    from app.api.v1 import local as local_mod

    token = await _student(client, "iso1")
    shop, product = _approved_shop_with_product(f"{_u('iso1_v')}@example.com", "Iso Vendor 1")

    monkeypatch.setattr(local_mod, "rate_allow", lambda *a, **k: False)
    blocked = await client.post(
        "/api/v1/local/orders", json=_body(shop, product, "co-" + _u("a")),
        headers=_headers(token),
    )
    assert blocked.status_code == 429

    monkeypatch.undo()
    other = await _student(client, "iso2")
    shop2, product2 = _approved_shop_with_product(f"{_u('iso2_v')}@example.com", "Iso Vendor 2")
    ok = await client.post(
        "/api/v1/local/orders", json=_body(shop2, product2, "co-" + _u("b")),
        headers=_headers(other),
    )
    assert ok.status_code == 200, ok.text


@pytest.mark.anyio
async def test_an_idempotent_retry_does_not_burn_the_order_budget(client, monkeypatch):
    """The order limit must sit AFTER the idempotency check.

    The portal retries a slow checkout on purpose, because the serverless host
    is slow on a cold start. If a retry consumed the student's order budget, a
    flaky connection could lock them out mid-checkout — the exact failure the
    retry exists to prevent. Replaying the same client_ref is therefore free.
    """
    from app.api.v1 import local as local_mod

    token = await _student(client, "budget")
    headers = _headers(token)
    shop, product = _approved_shop_with_product(f"{_u('bg_v')}@example.com", "Budget Vendor")
    ref = "co-" + _u("bg")

    first = await client.post("/api/v1/local/orders", json=_body(shop, product, ref), headers=headers)
    assert first.status_code == 200, first.text
    first_id = first.json()["id"]

    # The limiter now refuses everything — but a replay of the SAME basket is
    # served by the idempotency check, which runs before the limiter is asked.
    monkeypatch.setattr(local_mod, "rate_allow", lambda *a, **k: False)
    replay = await client.post("/api/v1/local/orders", json=_body(shop, product, ref), headers=headers)
    assert replay.status_code == 200, (
        "a legitimate retry was blocked by the order rate limit — a slow "
        "checkout could now lock a student out of paying"
    )
    assert replay.json()["id"] == first_id

