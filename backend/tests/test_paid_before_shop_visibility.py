"""The "only PAID orders reach the shop" rule.

A prepaid (UPI) order is withheld from the shop until its payment is confirmed,
so the kitchen never starts work that nobody has paid for. Cash on Delivery is
the deliberate exception: cash is collected ON DELIVERY, so gating COD on payment
would mean the shop never learns the order exists and the student waits forever.

These tests pin both halves plus the release path, because the failure mode is
silent in production — a paid order simply never appears and nobody is told.
"""
import pytest

from app.api.v1.vendor import _visible_to_shop


def _order(method, payment_status=None):
    o = {"id": "o1", "payment_method": method}
    if payment_status is not None:
        o["payment"] = {"status": payment_status}
    return o


# ─── COD stays visible: payment happens after the shop has cooked ───
def test_cod_is_always_visible_to_the_shop():
    assert _visible_to_shop(_order("COD")) is True
    assert _visible_to_shop(_order("cod")) is True


# ─── Prepaid is withheld until paid ───
def test_unpaid_prepaid_order_is_hidden_from_the_shop():
    assert _visible_to_shop(_order("UPI", "Pending")) is False
    assert _visible_to_shop(_order("UPI", None)) is False


def test_paid_prepaid_order_is_released_to_the_shop():
    assert _visible_to_shop(_order("UPI", "Success")) is True
    assert _visible_to_shop(_order("UPI", "success")) is True


def test_failed_or_cancelled_payment_keeps_the_order_hidden():
    """A declined payment must not hand the shop unpaid work."""
    for status in ("Failed", "Cancelled", "Rejected", ""):
        assert _visible_to_shop(_order("UPI", status)) is False, status


def test_manual_utr_orders_follow_the_same_rule():
    """The UTR path is prepaid too — same gate, no special case."""
    assert _visible_to_shop(_order("MANUAL UTR", "Pending")) is False
    assert _visible_to_shop(_order("MANUAL UTR", "Success")) is True
