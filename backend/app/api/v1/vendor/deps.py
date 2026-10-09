import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from fastapi import HTTPException, Header

from app.core import ttl_cache
from app.core.security import decode_token
from app.core.store import store as db

logger = logging.getLogger(__name__)

# Asia/Kolkata offset for correct per-day grouping (no tzdata dependency)
_KOLKATA_TZ = timezone(timedelta(hours=5, minutes=30))


def _ist_date(value: Any) -> str:
    """Normalize an order's created_at to an Asia/Kolkata date string (YYYY-MM-DD)."""
    try:
        text = str(value or "")
        if not text:
            return ""
        text = text.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(text)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=_KOLKATA_TZ)
        return parsed.astimezone(_KOLKATA_TZ).strftime("%Y-%m-%d")
    except Exception:
        return str(value or "")[:10]


def get_current_vendor(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header required")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Invalid authorization scheme")
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    user = db.get_user_by_id(int(user_id))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user["role"] != "shopkeeper":
        raise HTTPException(status_code=403, detail="This endpoint is for shopkeepers only")
    return user


def _find_shop(current_vendor: dict) -> dict | None:
    """The vendor's shop, or ``None``. Cached in memory for 60s per vendor."""
    cache_k = f"vendor:shop:{current_vendor.get('id')}"
    cached = ttl_cache.get(cache_k)
    if cached is not None:
        return cached

    for vendor_email in (current_vendor.get("email") or "", f"{current_vendor['username']}@campus.local"):
        if not vendor_email:
            continue
        shop = db.get_shop_by_shopkeeper_email(vendor_email)
        if shop:
            ttl_cache.set(cache_k, shop, ttl=60.0)
            return shop
    return None


def _my_shop(current_vendor: dict) -> dict:
    """The vendor's shop — 404 when the account has no shop attached."""
    shop = _find_shop(current_vendor)
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    return shop


def _sub_order_shape(sub: dict) -> dict:
    """Render a multi-shop sub-order as an order-shaped dict so the vendor
    dashboard/flows treat single and multi orders the same way."""
    items = sub.get("items") or []
    parent = sub.get("parent") or {}
    return {
        "id": sub.get("id", ""),
        "token": sub.get("token"),
        "student_name": parent.get("student_name", ""),
        "student_phone": parent.get("student_phone", ""),
        "shop_id": sub.get("shop_id", ""),
        "shop_name": sub.get("shop_name", ""),
        "items": ", ".join(f"{int(i['quantity'])}x {i['product_name']}" for i in items),
        "total": int(sub.get("subtotal", 0)),
        "delivery_location": parent.get("delivery_location", ""),
        "delivery_slot": sub.get("batch_type") or parent.get("delivery_slot", ""),
        "status": sub.get("status", "Pending"),
        "payment_method": parent.get("payment_method", ""),
        "created_at": sub.get("created_at", ""),
        "parent_order_id": sub.get("parent_order_id", ""),
        "is_sub_order": True,
    }


def _shop_orders_merged(shop_id: str, limit: int | None = None) -> list[dict]:
    """Single orders + multi-shop sub-orders for ONE shop, newest first.
    Multi orders live in ``shop_sub_orders`` (not ``orders``) — without this
    merge the vendor never saw them, so multi-basket orders were invisible."""
    single = db.list_orders_by_shop(shop_id)
    subs = db.get_shop_sub_orders(shop_id)
    merged = list(single) + [_sub_order_shape(s) for s in subs]
    merged.sort(key=lambda o: str(o.get("created_at") or ""), reverse=True)
    if limit:
        return merged[:limit]
    return merged


def _visible_to_shop(order: dict) -> bool:
    """Should this order appear in the shop's list at all?

    True when the order is Cash on Delivery (paid later, on handover), or when a
    payment has been recorded as successful. A prepaid order with no successful
    payment is withheld — that is the "only paid orders reach the shop" rule.
    """
    method = str(
        order.get("payment_method")
        or (order.get("payment") or {}).get("method")
        or ""
    ).upper()
    if method == "COD":
        return True
    payment = order.get("payment") or {}
    return str(payment.get("status") or "").upper() == "SUCCESS"


def _visible_to_shop_with_payment(order: dict) -> bool:
    """``_visible_to_shop`` for a raw row that has no ``payment`` block yet."""
    if order.get("payment") is None:
        pay_key = order.get("parent_order_id") if order.get("is_sub_order") else order.get("id")
        payment = db.get_payment_by_order_id(pay_key) if pay_key else None
        if payment:
            order["payment"] = {
                "id": payment.get("id"),
                "method": payment.get("method"),
                "status": payment.get("status"),
                "utr_number": payment.get("utr_number"),
                "amount": payment.get("amount"),
            }
    return _visible_to_shop(order)
