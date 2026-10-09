import logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException

from app.core import ttl_cache
from app.core.store import store as db

from .deps import (
    _KOLKATA_TZ,
    _find_shop,
    _ist_date,
    _my_shop,
    _shop_orders_merged,
    _visible_to_shop,
    get_current_vendor,
)
from .schemas import AdminDuesPayment, ShopStatusUpdate

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/dashboard")
def dashboard(current_vendor: dict = Depends(get_current_vendor)):
    """Get vendor dashboard with shop details, orders, and admin dues (₹10 per order)."""
    my_shop = _find_shop(current_vendor)

    if not my_shop:
        return {
            "user": current_vendor,
            "shop": None,
            "orders": [],
            "stats": {"message": "No shop found. Contact admin."},
        }

    # Full order history feeds the stats below; the LIVE feed shipped to the
    # app is capped to the most recent orders so the 30s auto-refresh never
    # drags the shop's entire history across the network (the payload grew
    # with every order and made the vendor app feel slow). Multi-shop
    # sub-orders are merged in so they appear too. One DB read, sliced twice.
    shop_orders = _shop_orders_merged(my_shop["id"])
    # Batch load payments in ONE DB query to avoid the N+1 per-order lookup loop
    pay_keys = [o.get("parent_order_id") if o.get("is_sub_order") else o.get("id") for o in shop_orders]
    pay_keys = [k for k in pay_keys if k]
    payments_map = db.get_payments_map_by_order_ids(pay_keys) if hasattr(db, "get_payments_map_by_order_ids") else {}
    for o in shop_orders:
        if o.get("payment") is None:
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
    shop_orders = [o for o in shop_orders if _visible_to_shop(o)]
    feed_orders = shop_orders[:250]
    pending = [o for o in shop_orders if o["status"] in ("Pending Payment", "Pending Acceptance")]
    active = [o for o in shop_orders if o["status"] in ("Confirmed", "Preparing", "Ready")]
    accepted = [o for o in shop_orders if o["status"] == "Accepted"]
    completed = [o for o in shop_orders if o["status"] == "Completed"]

    # Earnings count only real (paid/fulfilled) orders — exclude cancelled/failed
    earned_orders = [o for o in shop_orders if o["status"] not in ("Cancelled", "Failed")]
    revenue = sum(o["total"] for o in earned_orders)

    # 'Today' and the monthly share cycle are always Asia/Kolkata here — the
    # admin share monitor uses the same IST dates, so the vendor and admin
    # views can never disagree on which day/month a payment belongs to.
    today_key = datetime.now(_KOLKATA_TZ).strftime("%Y-%m-%d")
    today_orders = [o for o in earned_orders if _ist_date(o.get("created_at")) == today_key]
    today_revenue = sum(o["total"] for o in today_orders)

    # ─── Admin share: flat ₹10 per order ───
    # The share cycle is one calendar month (IST): on the 1st of each month
    # the counters reset automatically because they are computed from order
    # timestamps. The student is never charged a service fee; instead the
    # vendor pays the admin ₹10 for each order they earned this month.
    month_key = datetime.now(_KOLKATA_TZ).strftime("%Y-%m")
    month_orders = [o for o in earned_orders if _ist_date(o.get("created_at"))[:7] == month_key]
    month_revenue = sum(o["total"] for o in month_orders)
    platform_fee_due = len(month_orders) * 10
    net_earnings = max(0, revenue - platform_fee_due)
    today_fee_due = len(today_orders) * 10

    # Admin's UPI ID — the vendor's "Pay" button opens this to settle the share.
    payment_settings = {}
    try:
        payment_settings = db.get_payment_settings()
    except Exception as e:
        logger.warning(f"Could not load payment settings for vendor dashboard: {e}")
    admin_upi_id = (payment_settings.get("upi_id") or "").strip()
    admin_receiver_name = (payment_settings.get("receiver_name") or "DETOMSITE Admin").strip()

    # Share payment status for this month (does the admin already have the money?)
    share_paid_month = False
    latest_share_payment = None
    try:
        my_share_payments = db.list_share_payments_by_shop(my_shop["id"])
        for p in my_share_payments:
            # Normalize to the same Asia/Kolkata month the rest of the app uses
            # (Supabase stores created_at in UTC).
            created_month = _ist_date(p.get("created_at"))[:7]
            paid_month = _ist_date(p.get("paid_at"))[:7]
            if p.get("status") == "Completed" and (created_month == month_key or paid_month == month_key):
                share_paid_month = True
            if latest_share_payment is None:
                latest_share_payment = p
    except Exception as e:
        logger.warning(f"Could not load share payment status: {e}")

    return {
        "user": current_vendor,
        "shop": my_shop,
        "orders": feed_orders,
        "stats": {
            "total_orders": len(shop_orders),
            "pending_orders": len(pending),
            "active_orders": len(active),
            "accepted_orders": len(accepted),
            "completed_orders": len(completed),
            "revenue": revenue,
            "platform_fee_due": platform_fee_due,
            "net_earnings": net_earnings,
            "month_orders": len(month_orders),
            "month_revenue": month_revenue,
            "month_fee_due": platform_fee_due,
            "share_paid_month": share_paid_month,
            "today_orders": len(today_orders),
            "today_revenue": today_revenue,
            "today_fee_due": today_fee_due,
            # Backward-compatible alias so older vendor apps keep working.
            "share_paid_today": share_paid_month,
            "latest_share_payment": latest_share_payment,
            "admin_upi_id": admin_upi_id,
            "admin_receiver_name": admin_receiver_name,
            "approval_status": my_shop["approval_status"],
        },
    }


@router.patch("/shop")
def update_shop(data: ShopStatusUpdate, current_vendor: dict = Depends(get_current_vendor)):
    """Update shop status (present, open/closed, hours)."""
    my_shop = _my_shop(current_vendor)

    shop_id = my_shop["id"]
    updates = data.model_dump(exclude_unset=True)

    if my_shop["approval_status"] != "Approved" and "present" in updates:
        raise HTTPException(status_code=403, detail="Shop not approved yet. Cannot toggle availability.")

    updated = db.update_shop(shop_id, updates)
    if not updated:
        raise HTTPException(status_code=404, detail="Shop not found")
    ttl_cache.pop(f"vendor:shop:{current_vendor.get('id')}")
    ttl_cache.pop(f"shop:id:{shop_id}")
    if current_vendor.get("email"):
        ttl_cache.pop(f"shop:email:{current_vendor['email'].lower()}")
    return updated


@router.post("/dues/pay")
def pay_admin_dues(data: AdminDuesPayment, current_vendor: dict = Depends(get_current_vendor)):
    """Vendor pays their flat ₹10-per-order share to the admin.

    Opens a UPI payment to the admin (handled in the app UI). This endpoint
    records a Pending share payment that the admin marks as Received once the
    money lands in their bank account."""
    my_shop = _my_shop(current_vendor)
    shop_id = my_shop["id"]

    # Default to this month's ₹10-per-order share when no amount is supplied
    amount = data.amount
    if amount is None:
        shop_orders = [o for o in db.list_orders_by_shop(shop_id) if o["status"] not in ("Cancelled", "Failed")]
        # IST month, matching the vendor dashboard and the admin share monitor.
        month_key = datetime.now(_KOLKATA_TZ).strftime("%Y-%m")
        month_orders = [o for o in shop_orders if _ist_date(o.get("created_at"))[:7] == month_key]
        amount = len(month_orders) * 10

    payment = db.record_share_payment(shop_id, amount)
    if not payment:
        raise HTTPException(status_code=404, detail="Shop not found")
    return {
        "message": f"Share payment of ₹{amount} recorded — the admin will mark it received.",
        "payment": payment,
    }
