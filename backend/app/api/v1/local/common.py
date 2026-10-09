import asyncio
import logging
import re
import secrets
import sys
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import Header, HTTPException, Request

from app.core import read_cache
from app.core.config import settings
from app.core.db_executor import db_executor, run_db
from app.core.order_slots import (
    CANCELLABLE_STATUSES,
    KOLKATA_TZ,
    in_delivery_window,
    now_kolkata,
    slot_cutoff_for,
)
from app.core.rate_limit import allow as _core_rate_allow, client_ip as _core_rate_ip, reset as _core_rate_reset
from app.core.security import decode_token
from app.core.store import store as db
from app.services import push_service

def rate_allow(*args, **kwargs):
    mod = sys.modules.get("app.api.v1.local")
    if mod and hasattr(mod, "rate_allow") and mod.rate_allow is not rate_allow:
        return mod.rate_allow(*args, **kwargs)
    return _core_rate_allow(*args, **kwargs)

def rate_ip(*args, **kwargs):
    mod = sys.modules.get("app.api.v1.local")
    if mod and hasattr(mod, "rate_ip") and mod.rate_ip is not rate_ip:
        return mod.rate_ip(*args, **kwargs)
    return _core_rate_ip(*args, **kwargs)

def rate_reset(*args, **kwargs):
    mod = sys.modules.get("app.api.v1.local")
    if mod and hasattr(mod, "rate_reset") and mod.rate_reset is not rate_reset:
        return mod.rate_reset(*args, **kwargs)
    return _core_rate_reset(*args, **kwargs)

logger = logging.getLogger(__name__)

# Highest number of units of a single dish a student may put on one order line.
MAX_LINE_QUANTITY = 99

# Order states in which a payment record / UTR reference may still be attached.
_AWAITING_PAYMENT_STATUSES = ("Pending", "Pending Payment", "Pending Acceptance")

# How recent an UNPAID UPI order must be to be settled by a bank credit that carries no matching UTR claim.
BANK_MATCH_WINDOW_MINUTES = 90

# Orders whose status can be settled by verified bank evidence.
BANK_SETTLEABLE_STATUSES = ("Pending Payment", "Pending", "Pending Acceptance")

# Delivery is a single fixed drop point: the VIT-AP main gate.
VITAP_MAIN_GATE = "VIT-AP Main Gate"

_PUBLIC_SHOP_FIELDS = frozenset({
    "id", "name", "category", "description", "rating",
    "opening_time", "closing_time", "present", "status",
    "approval_status", "phone", "shop_image", "prep_time",
    "upi_id", "upi_enabled", "cod_enabled", "is_featured",
    "ordering_position", "current_token", "shopkeeper_name",
})

_last_auto_confirm_run = 0.0


def _clean_payment_method(value: str, allowed: tuple[str, ...]) -> str:
    """Normalise a client-supplied payment method and reject unknown ones."""
    method = (value or "").strip().upper()
    if method not in allowed:
        raise ValueError(f"payment_method must be one of {', '.join(allowed)}")
    return method


async def _db(fn, *args, **kwargs):
    """Run a blocking store call in a worker thread."""
    return await run_db(fn, *args, **kwargs)


def _push_admin(title: str, message: str, tag: str = "admin-alert") -> None:
    """Fire a web push to the admin's phone (fire-and-forget, never raises)."""
    try:
        push_service.notify_admin_async(title, message, {"url": "/admin-dashboard", "tag": tag})
    except Exception as e:
        logger.warning(f"Admin push '{title}' failed: {e}")


async def _cached_read(ttl: float, key: str, loader, *args, **kwargs):
    """Serve ``loader()`` from the layered read cache (memory → Redis → Postgres)."""
    return await read_cache.cached_read(ttl, key, loader, *args, **kwargs)


def _process_due_auto_confirm():
    """Fire-and-forget 30-min auto-confirm sweep, throttled to once a minute."""
    import time
    global _last_auto_confirm_run
    if time.monotonic() - _last_auto_confirm_run < 60:
        return
    _last_auto_confirm_run = time.monotonic()
    try:
        def _run():
            return db.auto_complete_expired_deliveries()
        asyncio.get_running_loop().run_in_executor(db_executor(), _run)
    except Exception:
        pass


def _normalize_phone(phone: str) -> str:
    """Coerce an Indian mobile number to E.164 (+91 + 10 digits)."""
    digits = "".join(ch for ch in (phone or "") if ch.isdigit())
    if len(digits) == 10:
        return f"+91{digits}"
    if len(digits) == 12 and digits.startswith("91"):
        return f"+91{digits[2:]}"
    return phone or ""


def _order_age_minutes(order: dict) -> float | None:
    """Minutes since ``order['created_at']``; ``None`` when it can't be read."""
    raw = str((order or {}).get("created_at") or "").strip()
    if not raw:
        return None
    iso = raw
    if re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}", raw):
        iso = raw.replace(" ", "T") + "+05:30"
    try:
        placed = datetime.fromisoformat(iso)
    except ValueError:
        return None
    if placed.tzinfo is None:
        placed = placed.replace(tzinfo=KOLKATA_TZ)
    return (datetime.now(timezone.utc) - placed).total_seconds() / 60


def _require_vitap_location(value: str) -> str:
    """Delivery is the VIT-AP main gate only — normalise everything to it."""
    if value is None or not str(value).strip():
        raise ValueError("delivery_location is required")
    loc = VITAP_MAIN_GATE
    incoming = str(value).strip()
    if re.search(r"vit[\s-]*ap", incoming, re.I) and re.search(r"main[\s-]*gate", incoming, re.I):
        return loc
    if re.search(r"vit[\s-]*ap", incoming, re.I):
        raise ValueError(f"Delivery is {VITAP_MAIN_GATE} only — please choose the main gate.")
    raise ValueError("Delivery is VIT-AP main gate only — please choose the main gate.")


def _public_shop(shop: dict) -> dict:
    """Strip internal/vendor-private fields from a shop row for public callers."""
    return {k: v for k, v in shop.items() if k in _PUBLIC_SHOP_FIELDS}


def _optional_user(authorization: Optional[str] = Header(None)) -> Optional[dict]:
    """Best-effort identity for endpoints that are public but richer when logged in."""
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    try:
        return decode_token(token)
    except Exception:
        return None


def _is_staff(user: Optional[dict]) -> bool:
    return bool(user) and user.get("role") in ("admin", "shopkeeper", "vendor")


def _same_student(user: dict, order: dict) -> bool:
    """Only the server-assigned account ID proves ownership."""
    owner = str(order.get("owner_user_id") or "").strip()
    return bool(owner) and owner == str(user.get("id") or "")


def _require_agent_key(x_agent_key: Optional[str], request: Optional[Request] = None) -> None:
    """Gate the bank-SMS endpoints on the Android agent's shared key."""
    configured = (settings.SMS_FORWARD_KEY or "").strip()
    if not configured:
        if settings.DEBUG:
            return
        raise HTTPException(
            status_code=503,
            detail="Bank-SMS ingest is not configured on this server (SMS_FORWARD_KEY is unset).",
        )
    if not secrets.compare_digest((x_agent_key or "").encode("utf-8"), configured.encode("utf-8")):
        if request is not None and not rate_allow(
            "agent_key_fail", rate_ip(request), max_attempts=20, window_sec=900
        ):
            raise HTTPException(
                status_code=429,
                detail="Too many invalid agent key attempts — please wait a few minutes and try again.",
            )
        raise HTTPException(status_code=401, detail="Invalid agent key")


async def _resolve_owned_order(order_id: str, user: dict) -> tuple[dict, bool]:
    """Resolve an order id and require that the caller owns it."""
    order = await _db(db.get_order, order_id)
    is_parent = False
    if not order:
        order = await _db(db.get_parent_order, order_id)
        is_parent = bool(order)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if user.get("role") != "admin" and not _same_student(user, order):
        raise HTTPException(status_code=403, detail="You can only pay for your own orders")
    return order, is_parent


async def get_current_local_user(authorization: Optional[str] = Header(None)) -> dict:
    """Get current user from JWT token in Authorization header."""
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
    user = await _db(db.get_user_by_id, int(user_id))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


async def _require_admin(authorization: Optional[str] = Header(None)) -> dict:
    """Require a valid token whose role is ``admin``."""
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header required")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Invalid authorization scheme")
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    if payload.get("role") != "admin":
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


def _sms_log_fn(sub_order_id: str, phone: str, message: str, status: str) -> dict | None:
    """Bounds to the active store's sync log_sms (runs in a worker thread)."""
    return db.log_sms(
        sub_order_id=sub_order_id,
        phone=phone,
        message=message,
        status=status,
        direction="out",
    )


async def _log_sms_inbound(order_id: str, phone: str, text: str, status: str) -> None:
    """Log an inbound SMS reply against the active store."""
    try:
        await _db(db.log_sms, order_id, phone, text, status=status, direction="in")
    except Exception as e:
        logger.warning(f"SMS inbound log error: {e}")


def _extract_utr(text: str) -> str:
    """Pull a UPI transaction reference number out of a bank credit SMS."""
    from app.services import bank_sms_parser
    return bank_sms_parser.extract_utr(text)


def _extract_amount(text: str) -> float | None:
    """Parse the payment amount out of a bank credit SMS."""
    from app.services import bank_sms_parser
    return bank_sms_parser.extract_amount(text)


def _is_valid_utr(utr: str) -> bool:
    """True only for a plausible ASCII UPI reference."""
    if not 6 <= len(utr) <= 40:
        return False
    return all(c in "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ" for c in utr)


def _dialable_whatsapp_number(raw: Any) -> str:
    """Can this shop number actually be dialled as an Indian mobile?"""
    digits = "".join(ch for ch in str(raw or "") if ch.isdigit())
    if len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    if len(digits) == 10:
        return "91" + digits
    if len(digits) == 12 and digits.startswith("91"):
        return digits
    return ""
