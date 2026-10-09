import asyncio
import logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.store import store as db

from .deps import (
    _KOLKATA_TZ,
    _db,
    _ist_date,
    _notify_shop_whatsapp_verified,
    _sub_order_shape,
    verify_admin,
)
from .schemas import PaymentVerifyRequest, SharePaymentStatusUpdate

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/payments")
async def list_all_payments(admin: dict = Depends(verify_admin)):
    """List all payments — single orders from the payments table plus multi-shop
    parent orders (their ONE-bill payment lives on the parent_orders row)."""
    single, parent = await asyncio.gather(
        _db(db.list_payments),
        _db(db.list_parent_payments),
    )
    return single + parent


@router.get("/payments/date")
async def list_payments_by_date(admin: dict = Depends(verify_admin), date: str = Query(..., description="YYYY-MM-DD")):
    """Get payments for a specific date."""
    return await _db(db.get_payments_by_date, date)


@router.get("/shares")
async def share_status(admin: dict = Depends(verify_admin)):
    """Live vendor-share monitoring — MONTHLY cycle."""
    shops = await _db(db.list_shops)
    orders = await _db(db.list_orders)
    try:
        share_payments = await _db(db.list_share_payments)
    except Exception as e:
        logger.warning(f"Could not list share payments: {e}")
        share_payments = []

    now = datetime.now(_KOLKATA_TZ)
    month_key = now.strftime("%Y-%m")
    month_label = now.strftime("%B %Y")

    def _month_of(value) -> str:
        return _ist_date(value)[:7]

    vendors = []
    for shop in shops:
        if shop["approval_status"] != "Approved":
            continue
        shop_orders = [o for o in orders if o["shop_id"] == shop["id"] and o["status"] not in ("Cancelled", "Failed")]
        month_orders = [o for o in shop_orders if _month_of(o.get("created_at")) == month_key]
        month_revenue = sum(o["total"] for o in month_orders)
        month_fee = len(month_orders) * 10

        my_payments = [p for p in share_payments if p.get("shop_id") == shop["id"]]
        paid_month = any(
            p.get("status") == "Completed"
            and (_month_of(p.get("created_at")) == month_key or _month_of(p.get("paid_at")) == month_key)
            for p in my_payments
        )
        last_paid_at = ""
        for p in my_payments:
            if p.get("status") == "Completed":
                last_paid_at = str(p.get("paid_at", "") or p.get("created_at", ""))

        vendors.append({
            "shop_id": shop["id"],
            "shop_name": shop["name"],
            "shopkeeper_name": shop.get("shopkeeper_name", ""),
            "upi_id": shop.get("upi_id", ""),
            "month_orders": len(month_orders),
            "month_revenue": month_revenue,
            "month_fee": month_fee,
            "paid_month": paid_month,
            "last_paid_at": last_paid_at,
        })

    collected_month = sum(
        p["amount"]
        for p in share_payments
        if p.get("status") == "Completed"
        and (_month_of(p.get("created_at")) == month_key or _month_of(p.get("paid_at")) == month_key)
    )
    expected_month = sum(v["month_fee"] for v in vendors)
    month_pending_payments = [p for p in share_payments if p.get("status") == "Pending" and _month_of(p.get("created_at")) == month_key]
    collected_total = sum(p["amount"] for p in share_payments if p.get("status") == "Completed")
    pending_total = sum(p["amount"] for p in share_payments if p.get("status") == "Pending")
    return {
        "vendors": vendors,
        "payments": share_payments,
        "month": month_key,
        "month_label": month_label,
        "summary": {
            "month": month_key,
            "month_label": month_label,
            "expected_month": expected_month,
            "collected_month": collected_month,
            "pending_month": max(0, expected_month - collected_month),
            "pending_month_count": len(month_pending_payments),
            "collected_total": collected_total,
            "pending_total": pending_total,
            "vendors_count": len(vendors),
            "paid_month_count": sum(1 for v in vendors if v["paid_month"]),
        },
    }


@router.patch("/shares/{payment_id}")
async def update_share_payment(payment_id: str, data: SharePaymentStatusUpdate, admin: dict = Depends(verify_admin)):
    """Mark a vendor share payment as received (Completed) or Rejected."""
    status = data.status
    payment = await _db(db.update_share_payment_status, payment_id, status)
    if not payment:
        raise HTTPException(status_code=404, detail="Share payment not found")
    return {"message": f"Share payment marked {status}", "payment": payment}


@router.patch("/payments/{payment_id}/verify")
async def verify_payment(payment_id: str, data: PaymentVerifyRequest, admin: dict = Depends(verify_admin)):
    """Verify or reject a manual payment."""
    status = data.status
    approved = str(status).lower() in ("success", "verified", "received")
    admin_name = str(admin.get("username") or admin.get("email") or admin.get("sub") or "admin")[:100]
    payment = await _db(db.get_payment_by_id, payment_id)
    if not payment:
        parent = await _db(db.get_parent_order, payment_id)
        if not parent:
            raise HTTPException(status_code=404, detail="Payment not found")
        payment = await _db(db.verify_parent_payment_proof, payment_id, approved, admin_name, "")
        if not payment:
            raise HTTPException(status_code=404, detail="Payment not found")
        if approved:
            try:
                parent = await _db(db.get_parent_order, payment_id)
                if parent and parent.get("sub_orders"):
                    for sub in parent["sub_orders"]:
                        shop = await _db(db.get_shop, sub.get("shop_id") or "")
                        wa_number = str((shop or {}).get("whatsapp_number") or "").strip() or str((shop or {}).get("phone") or "").strip()
                        if shop and wa_number:
                            await _notify_shop_whatsapp_verified(_sub_order_shape(sub), shop, wa_number)
            except Exception as e:
                logger.warning(f"Admin verify parent payment — WhatsApp notify error: {e}")
        return {"message": f"Payment {status.lower()}", "payment": payment}
    payment = await _db(db.verify_single_payment_proof, payment_id, approved, admin_name, "")
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    payment = await _db(db.update_payment_status, payment_id, status)
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    if str(status).lower() in ("success", "verified", "received"):
        try:
            parent = await _db(db.get_parent_order, payment.get("order_id") or "")
            if parent and parent.get("sub_orders"):
                for sub in parent["sub_orders"]:
                    shop = await _db(db.get_shop, sub.get("shop_id") or "")
                    wa_number = str((shop or {}).get("whatsapp_number") or "").strip() or str((shop or {}).get("phone") or "").strip()
                    if shop and wa_number:
                        await _notify_shop_whatsapp_verified(_sub_order_shape(sub), shop, wa_number)
            else:
                order = await _db(db.get_order, payment.get("order_id") or "")
                if order:
                    shop = await _db(db.get_shop, order.get("shop_id") or "")
                    wa_number = str((shop or {}).get("whatsapp_number") or "").strip() or str((shop or {}).get("phone") or "").strip()
                    if shop and wa_number:
                        await _notify_shop_whatsapp_verified(order, shop, wa_number)
        except Exception as e:
            logger.warning(f"Admin verify payment — WhatsApp notify error: {e}")
    return {"message": f"Payment {status.lower()}", "payment": payment}
