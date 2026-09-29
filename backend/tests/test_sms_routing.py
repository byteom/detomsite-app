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
    # Direct (non-HTTP) call: request=None skips the per-IP failure throttle
    # (which only exists to slow brute-force over the network).
    result = await local.sms_match(local.LocalSmsMatch(phone="9876543210", utr="123456789012", amount=80), None, x_agent_key="test-key")
    assert result["order_id"] == "older"
    assert result["matched_by"] == "utr_claim"
    assert local._notify_shop_via_whatsapp.await_args.args[0]["id"] == "older"


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
    """The QR-checkout flow: the student scans and pays, so there is NO reference
    to claim. A credit SMS with no UTR must still settle the order via tier 2 —
    this is the case the bot used to drop on the floor with `?: return`."""
    from datetime import datetime, timedelta, timezone
    orders, payments, writes = matching
    # Tier 2 only settles a RECENT order (BANK_MATCH_WINDOW_MINUTES), so the
    # shared fixture's fixed 2026-09-17 timestamps are aged to "now" here.
    now = datetime.now(timezone.utc).isoformat()
    for o in orders:
        o["created_at"] = now
    # QR checkout records an empty utr_number on the payment row.
    payments[0]["utr_number"] = ""
    result = await local.sms_match(
        local.LocalSmsMatch(phone="9876543210", utr="", amount=80), None, x_agent_key="test-key"
    )
    assert result["order_status"] == "Completed"
    assert result["matched_by"] == "bank_credit"
    # The order is actually marked paid, not just reported as matched.
    assert ("update_order_status", ("older", "Completed"), {}) in writes
    # The fake db's set_payment_utr returns {"id": "result"}, so the settled
    # payment id is the stamped one — assert the status write happened, not its id.
    assert any(w[0] == "update_payment_status" and w[1][1] == "Success" for w in writes)


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
    """Without a UTR there is no unique index to burn the credit, so the synthetic
    burn marker must stop the same SMS settling a second order."""
    from datetime import datetime, timezone
    orders, payments, writes = matching
    for o in orders:
        o["created_at"] = datetime.now(timezone.utc).isoformat()
    payments[0]["utr_number"] = ""
    await local.sms_match(
        local.LocalSmsMatch(phone="9876543210", utr="", amount=80), None, x_agent_key="test-key"
    )
    # The burn marker was stamped so the settled row is traceable.
    stamped = [w for w in writes if w[0] == "set_payment_utr"]
    assert stamped and stamped[0][1][1].startswith("SMS-")
    # Replaying the same credit now finds the payment already Success → refused.
    payments[0]["status"] = "Success"
    writes.clear()
    with pytest.raises(HTTPException):
        await local.sms_match(
            local.LocalSmsMatch(phone="9876543210", utr="", amount=80), None, x_agent_key="test-key"
        )
    assert not any(w[0] == "update_order_status" for w in writes)


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
