"""Payment proof routing must never guess a customer from an amount."""
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from app.api.v1 import local


@pytest.fixture
def matching(monkeypatch):
    shop = {"id": "shop-a", "phone": "9876543210", "whatsapp_number": "9876543210"}
    orders = [
        {"id": "older", "shop_id": "shop-a", "status": "Pending Payment", "total": 80,
         "payment_method": "UPI", "created_at": "2026-09-17T10:00:00"},
        {"id": "newer", "shop_id": "shop-a", "status": "Pending Payment", "total": 80,
         "payment_method": "UPI", "created_at": "2026-09-17T10:01:00"},
    ]
    payments = [{"id": "p1", "order_id": "older", "utr_number": "123456789012", "amount": 80, "status": "Pending"}]
    writes = []

    async def fake_db(fn, *args, **kwargs):
        name = fn.__name__
        if name == "get_shop_by_phone": return shop
        if name == "list_orders_by_shop": return orders
        if name == "list_payments": return payments
        if name == "get_payment_by_order_id":
            return next((p for p in payments if p["order_id"] == args[0]), None)
        if name in ("create_payment", "set_payment_utr", "update_payment_status", "update_order_status"):
            writes.append((name, args, kwargs))
        return {"id": "result"}

    monkeypatch.setattr(local, "_db", fake_db)
    monkeypatch.setattr(local, "_push_admin", lambda *a, **k: None)
    monkeypatch.setattr(local, "_notify_shop_via_whatsapp", AsyncMock())
    monkeypatch.setattr(local.settings, "SMS_FORWARD_KEY", "test-key")
    return orders, payments, writes


async def test_saved_utr_selects_older_order_not_newest_amount(matching):
    """CUT OFF — the route answers 410 after the agent gate instead of
    matching: no bank message may settle an order anymore (manual admin
    verification is the only settlement path)."""
    with pytest.raises(HTTPException) as exc:
        await local.sms_match(local.LocalSmsMatch(phone="9876543210", utr="123456789012", amount=80), None, x_agent_key="test-key")
    assert exc.value.status_code == 410


@pytest.mark.parametrize("case", ["missing", "duplicate", "other_shop", "wrong_amount", "already_paid", "cod"])
async def test_uncertain_proof_never_changes_order_or_sends(matching, case):
    orders, payments, writes = matching
    if case == "missing": payments.clear()
    if case == "duplicate": payments.append(dict(payments[0], id="p2", order_id="newer"))
    if case == "other_shop": payments[0]["order_id"] = "another-shop-order"
    if case == "wrong_amount": payments[0]["amount"] = 90
    if case == "already_paid": payments[0]["status"] = "Success"
    if case == "cod": orders[0]["payment_method"] = "COD"
    with pytest.raises(HTTPException):
        await local.sms_match(local.LocalSmsMatch(phone="9876543210", utr="123456789012", amount=80), None, x_agent_key="test-key")
    assert not writes
    local._notify_shop_via_whatsapp.assert_not_awaited()


@pytest.mark.parametrize("text", [
    "A/c credited Rs 80. Avl bal Rs 5000. Account 123456789012",
    "Debited Rs 80 UTR:123456789012",
    "OTP 123456 for UPI txn Ref:123456789012",
])
def test_non_credit_or_unlabelled_reference_is_not_proof(text):
    assert local._extract_utr(text) == ""


async def test_qr_credit_with_no_utr_settles_the_order(matching):
    """CUT OFF — tier-2 amount matching no longer settles QR orders: the same
    credit now gets an explicit 410 and writes nothing."""
    from datetime import datetime, timezone
    orders, payments, writes = matching
    now = datetime.now(timezone.utc).isoformat()
    for o in orders:
        o["created_at"] = now
    payments[0]["utr_number"] = ""
    with pytest.raises(HTTPException) as exc:
        await local.sms_match(
            local.LocalSmsMatch(phone="9876543210", utr="", amount=80), None, x_agent_key="test-key"
        )
    assert exc.value.status_code == 410
    assert not writes


async def test_empty_utr_never_claims_another_customers_order(matching):
    """An absent UTR must not equal the empty utr_number that every QR order
    carries, or the first order in the list would be settled as if the student
    had claimed it — settling an arbitrary customer's order."""
    from datetime import datetime, timezone
    orders, payments, writes = matching
    for o in orders:
        o["created_at"] = datetime.now(timezone.utc).isoformat()
    for o in orders:
        payments.append({"id": f"p-{o['id']}", "order_id": o["id"], "utr_number": "",
                         "amount": 80, "status": "Pending"})
    # Two open same-amount orders and no reference to disambiguate them.
    with pytest.raises(HTTPException):
        await local.sms_match(
            local.LocalSmsMatch(phone="9876543210", utr="", amount=80), None, x_agent_key="test-key"
        )
    assert not any(w[0] == "update_order_status" for w in writes)


async def test_a_replayed_no_utr_credit_cannot_settle_twice(matching):
    """CUT OFF — with no settlement path left, replaying a credit is a 410
    that writes nothing (the burn-marker machinery is retired with the bot)."""
    from datetime import datetime, timezone
    orders, payments, writes = matching
    for o in orders:
        o["created_at"] = datetime.now(timezone.utc).isoformat()
    payments[0]["utr_number"] = ""
    with pytest.raises(HTTPException) as exc:
        await local.sms_match(
            local.LocalSmsMatch(phone="9876543210", utr="", amount=80), None, x_agent_key="test-key"
        )
    assert exc.value.status_code == 410
    assert not writes


async def test_malformed_utr_is_still_refused(matching):
    """Making the field optional must not weaken the reference validation."""
    with pytest.raises(HTTPException):
        await local.sms_match(
            local.LocalSmsMatch(phone="9876543210", utr="ab", amount=80), None, x_agent_key="test-key"
        )


def test_balance_is_not_payment_amount():
    assert local._extract_amount("Avl bal Rs 5000. Credited Rs 80 UTR:123456789012") == 80
    assert local._extract_amount("Credit received. Available balance Rs 5000") is None


def test_order_age_reads_both_timestamp_shapes():
    """Supabase stores UTC ISO, SQLite stores IST wall-clock. Tier 2 refuses any
    row whose age it cannot read, so BOTH shapes must parse — and an unreadable
    one must be reported as unknown rather than silently treated as "recent"."""
    from datetime import datetime, timedelta, timezone
    from app.api.v1.local import _order_age_minutes

    now = datetime.now(timezone.utc)
    fresh_utc = (now - timedelta(minutes=5)).isoformat()
    fresh_ist = (now - timedelta(minutes=5)).astimezone(timezone(timedelta(hours=5, minutes=30)))
    assert _order_age_minutes({"created_at": fresh_utc}) < 10
    assert _order_age_minutes({"created_at": fresh_ist.strftime("%Y-%m-%d %H:%M:%S")}) < 10
    assert _order_age_minutes({"created_at": "not-a-date"}) is None
    assert _order_age_minutes({}) is None
