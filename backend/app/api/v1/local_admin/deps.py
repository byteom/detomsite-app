import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from fastapi import Header, HTTPException

from app.core.config import settings
from app.core.db_executor import run_db
from app.core.security import decode_token
from app.core.store import store as db

logger = logging.getLogger(__name__)

# Asia/Kolkata fixed offset (works even without the tzdata package)
_KOLKATA_TZ = timezone(timedelta(hours=5, minutes=30))

ADMIN_USERNAME = settings.DEFAULT_SUPER_ADMIN_EMAIL.split("@")[0] if settings.DEFAULT_SUPER_ADMIN_EMAIL else "admin"
ADMIN_PASSWORD = settings.DEFAULT_SUPER_ADMIN_PASSWORD

CONFIRMABLE_ORDER_STATUSES = (
    "Pending",
    "Placed",
    "Pending Payment",
    "Pending Acceptance",
    "Accepted",
)

CONFIRM_ORDER_ACTION = "confirm_order"


async def _db(fn, *args, **kwargs):
    """Run a blocking store call in a worker thread to avoid stalling the event loop."""
    return await run_db(fn, *args, **kwargs)


def _ist_date(value: Any) -> str:
    """Normalize a DB timestamp (Supabase stores UTC) to an IST date string."""
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


async def verify_admin(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header required")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Invalid authorization scheme")
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    role = payload.get("role")
    if role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    if not settings.DEBUG:
        try:
            user_id = int(payload.get("sub"))
        except (TypeError, ValueError):
            raise HTTPException(status_code=403, detail="Admin access required")
        user = await _db(db.get_user_by_id, user_id)
        if not user or user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Admin access required")
    return payload


def _sub_order_shape(sub: dict) -> dict:
    """Render a multi-shop sub-order as an order-shaped dict for admin views."""
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


async def _rebuild_wa_link(log: dict, sub_id: str) -> str:
    """Rebuild the ``wa.me`` deep-link for a persisted WhatsApp log when the
    store's table does not keep the url column (Supabase)."""
    from urllib.parse import quote
    number = str(log.get("phone") or "").strip()
    if not number:
        return ""
    digits = "".join(ch for ch in number if ch.isdigit())
    if len(digits) == 10:
        digits = "91" + digits
    text = str(log.get("message") or "").strip()
    if not text:
        order = await _db(db.get_order, sub_id) if sub_id else None
        if order:
            from app.services.sms_service import compose_order_wa
            text = compose_order_wa(order)
    if not text:
        return ""
    return f"https://wa.me/{digits}?text={quote(text)}"


def _sms_log_fn(sub_order_id: str, phone: str, message: str, status: str) -> dict | None:
    """Bound to the active store's sync ``log_sms`` (runs in a worker thread)."""
    return db.log_sms(
        sub_order_id=sub_order_id,
        phone=phone,
        message=message,
        status=status,
        direction="out",
    )


def _confirmable_shape(order: dict, shop: dict | None, notification: dict | None) -> dict:
    """The payload the admin Approvals queue renders per pending order."""
    shop = shop or {}
    return {
        "notification_id": (notification or {}).get("id", ""),
        "order_id": order.get("id", ""),
        "token": order.get("token"),
        "shop_id": order.get("shop_id", ""),
        "shop_name": order.get("shop_name") or shop.get("name", ""),
        "student_name": order.get("student_name", ""),
        "student_phone": order.get("student_phone", ""),
        "items": order.get("items", ""),
        "total": order.get("total", 0),
        "payment_method": order.get("payment_method", "UPI"),
        "delivery_location": order.get("delivery_location", ""),
        "status": order.get("status", ""),
        "created_at": order.get("created_at", ""),
        "title": (notification or {}).get("title", ""),
        "message": (notification or {}).get("message", ""),
        "action": (notification or {}).get("action", ""),
        "action_state": (notification or {}).get("action_state", ""),
    }


async def _notify_shop_whatsapp_verified(order: dict, shop: dict, phone: str) -> None:
    """Fire-and-forget: build the wa.me link for a payment-verified order and
    log it as a Pending WhatsApp notification for the admin centre."""
    try:
        from urllib.parse import quote
        from app.services.sms_service import compose_order_wa
        digits = "".join(ch for ch in phone if ch.isdigit())
        if len(digits) == 10:
            digits = "91" + digits
        url = f"https://wa.me/{digits}?text={quote(compose_order_wa(order))}"
        await _db(
            db.log_whatsapp,
            sub_order_id=order["id"],
            phone=phone,
            message=compose_order_wa(order),
            url=url,
            status="Pending",
        )
    except Exception as e:
        logger.warning(f"Admin verify — WhatsApp build error for {order.get('id')}: {e}")
