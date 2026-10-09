import logging
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.store import store as db

from .deps import (
    _KOLKATA_TZ,
    _find_shop,
    _ist_date,
    _shop_orders_merged,
    _visible_to_shop,
    get_current_vendor,
)
from .schemas import VendorOrderStatusUpdate

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/orders")
def get_orders(current_vendor: dict = Depends(get_current_vendor)):
    """Get all orders for this vendor's shop (single + multi-shop sub-orders).

    UNPAID PREPAID ORDERS ARE HIDDEN. A UPI order is withheld from the shop
    until its payment is confirmed, so a shop must not see it here either — the
    whole point of the rule is that the kitchen only takes work it has been paid
    for. COD orders are always visible: cash is collected on delivery, so waiting
    for payment would mean the shop never learns the order exists.
    """
    my_shop = _find_shop(current_vendor)
    if not my_shop:
        return []
    orders = _shop_orders_merged(my_shop["id"])
    # Batch resolve payments in ONE query instead of N queries in a loop
    pay_keys = [o.get("parent_order_id") if o.get("is_sub_order") else o.get("id") for o in orders]
    pay_keys = [k for k in pay_keys if k]
    payments_map = db.get_payments_map_by_order_ids(pay_keys) if hasattr(db, "get_payments_map_by_order_ids") else {}
    for o in orders:
        pay_key = o.get("parent_order_id") if o.get("is_sub_order") else o.get("id")
        payment = payments_map.get(pay_key) if payments_map else (db.get_payment_by_order_id(pay_key) if pay_key else None)
        if payment:
            o["payment"] = {
                "id": payment.get("id"),
                "method": payment.get("method"),
                "status": payment.get("status"),
                "utr_number": payment.get("utr_number"),
                "amount": payment.get("amount"),
            }
    return [o for o in orders if _visible_to_shop(o)]


@router.get("/orders/lookup")
def lookup_order_by_code(code: str = Query(..., min_length=1, max_length=200), current_vendor: dict = Depends(get_current_vendor)):
    """Resolve an order from a scanned QR code or a manually typed order ID.

    The student app renders a QR whose payload is ``DETOMSITE-ORDER:<order id>``.
    Scanning it (or typing the code / order id manually in the scanner's manual
    fallback) returns the order — but only if it belongs to THIS vendor's shop,
    so scanning someone else's code never leaks data."""
    raw = code.strip()
    order_id = raw
    prefix = "DETOMSITE-ORDER:"
    if raw.upper().startswith(prefix):
        order_id = raw[len(prefix):].strip()

    order = db.get_order(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found. Check the code and try again.")

    my_shop = _find_shop(current_vendor)
    if not my_shop or order["shop_id"] != my_shop["id"]:
        raise HTTPException(status_code=403, detail="This order belongs to another shop.")

    return order


@router.get("/history")
def vendor_history(
    current_vendor: dict = Depends(get_current_vendor),
    from_date: str = Query("", alias="from"),
    to_date: str = Query("", alias="to"),
    range: str = Query("", description="today | yesterday | week — resolved in IST server-side"),
):
    """Orders + earnings for this vendor, filtered by date range.

    ``range=today|yesterday|week`` is resolved in Asia/Kolkata on the server
    so the filter always matches the dashboard's "today" (which also uses
    IST) — a phone/browser in a different timezone can no longer shift the
    day. ``from`` / ``to`` (YYYY-MM-DD, inclusive) are still supported for
    custom ranges. Also returns a per-day breakdown."""
    # Named ranges are authoritative — they override any client-computed dates.
    if range == "today":
        from_date = to_date = datetime.now(_KOLKATA_TZ).strftime("%Y-%m-%d")
    elif range == "yesterday":
        day = datetime.now(_KOLKATA_TZ) - timedelta(days=1)
        from_date = to_date = day.strftime("%Y-%m-%d")
    elif range == "week":
        to_date = datetime.now(_KOLKATA_TZ).strftime("%Y-%m-%d")
        from_date = (datetime.now(_KOLKATA_TZ) - timedelta(days=6)).strftime("%Y-%m-%d")

    my_shop = _find_shop(current_vendor)
    if not my_shop:
        return {"orders": [], "daily": [], "revenue": 0, "count": 0}

    shop_id = my_shop["id"]
    all_orders = db.list_orders_by_shop(shop_id)

    filtered = []
    for order in all_orders:
        day = _ist_date(order.get("created_at", ""))
        if from_date and day < from_date:
            continue
        if to_date and day > to_date:
            continue
        filtered.append({**order, "_day": day})

    # Per-day breakdown (earned orders exclude cancelled/failed)
    daily: dict[str, dict] = {}
    for order in filtered:
        if order["status"] in ("Cancelled", "Failed"):
            continue
        day = order["_day"]
        entry = daily.setdefault(day, {"date": day, "count": 0, "revenue": 0})
        entry["count"] += 1
        entry["revenue"] += int(order["total"])

    return {
        "orders": filtered,
        "daily": sorted(daily.values(), key=lambda d: d["date"], reverse=True),
        "revenue": sum(o["total"] for o in filtered if o["status"] not in ("Cancelled", "Failed")),
        "count": len([o for o in filtered if o["status"] not in ("Cancelled", "Failed")]),
        "from_date": from_date,
        "to_date": to_date,
    }


@router.patch("/orders/{order_id}/status")
def update_order_status(order_id: str, data: VendorOrderStatusUpdate, current_vendor: dict = Depends(get_current_vendor)):
    """Update order status (accept, prepare, complete, cancel). Works for single
    orders AND multi-shop sub-orders."""
    new_status = data.status

    order = db.get_order(order_id)
    is_sub = False
    if not order:
        order = db.get_sub_order(order_id)
        is_sub = bool(order)

    my_shop = _find_shop(current_vendor)
    if not order or not my_shop or order["shop_id"] != my_shop["id"]:
        raise HTTPException(status_code=403, detail="You don't own this order")

    if is_sub:
        order = db.update_sub_order_status(order_id, new_status)
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")
        # Keep the parent status in step with its last sub-order so the
        # student's OrderResult reflects the newest state.
        try:
            sub = db.get_sub_order(order_id)
            parent_id = (sub or {}).get("parent_order_id")
            if parent_id:
                db.update_parent_order_status(parent_id, new_status)
        except Exception as e:
            logger.warning(f"vendor update — parent status sync error: {e}")
        return order

    order = db.update_order_status(order_id, new_status)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


@router.post("/orders/{order_id}/payment-received")
def confirm_payment_received(order_id: str, current_vendor: dict = Depends(get_current_vendor)):
    """DEPRECATED for payment settlement — admin/bot only.

    This used to let a shopkeeper mark their OWN order paid ("the money landed
    in my UPI account, so I'll confirm it"). That is a payment-confirmation hole:
    a vendor who wanted free food simply called this on a pending order and the
    payment flipped to Success with the order Completed, with no bank evidence
    at all — the vendor is the party being paid, so they are not a trustworthy
    witness to their own payment.

    Settlement now happens only through the platform:
      * the admin's SMS/WhatsApp bot matching a saved UTR against a bank credit
        SMS (``/sms/match``, agent-key gated), or
      * an admin pressing Verify in the admin portal.

    The route is kept (not deleted) so the shopkeeper app keeps a clear message
    instead of a bare 404, and so a deployment that still calls it fails loudly
    rather than silently marking orders paid.
    """
    order = db.get_order(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    my_shop = _find_shop(current_vendor)
    if not my_shop or order["shop_id"] != my_shop["id"]:
        raise HTTPException(status_code=403, detail="You don't own this order")

    raise HTTPException(
        status_code=403,
        detail=(
            "Only the admin can confirm a payment now — it is verified against the "
            "bank SMS/UTR, not by the shop. Ask the admin to verify it in the admin page."
        ),
    )


def _notify_shop_whatsapp_verified(order: dict | None) -> None:
    """Fire-and-forget (daemon thread): build the wa.me link for a
    payment-verified order and log it as a Pending WhatsApp notification for
    the admin centre. Sync on purpose — the vendor API is thread-pool based."""
    if not order:
        return
    try:
        from urllib.parse import quote
        from app.services.sms_service import compose_order_wa
        shop = db.get_shop(order.get("shop_id") or "")
        number = str((shop or {}).get("whatsapp_number") or "").strip() or str((shop or {}).get("phone") or "").strip()
        if not (shop and number):
            return
        digits = "".join(ch for ch in number if ch.isdigit())
        if len(digits) == 10:
            digits = "91" + digits
        url = f"https://wa.me/{digits}?text={quote(compose_order_wa(order))}"
        db.log_whatsapp(
            sub_order_id=order["id"], phone=number,
            message=compose_order_wa(order), url=url, status="Pending",
        )
    except Exception as e:
        logger.warning(f"WhatsApp verified-notify error for {order.get('id')}: {e}")
