"""
API routes backed by Supabase Postgres (the only database).
"""
from fastapi import APIRouter, HTTPException, Depends, Header, Query, Request
from pydantic import BaseModel, EmailStr, Field, field_validator
from datetime import datetime, timezone
import asyncio
import re
import secrets

from app.core.config import settings
from app.core import read_cache
from app.core.rate_limit import allow as rate_allow, reset as rate_reset, client_ip as rate_ip
from app.core.store import store as db
from app.core.user_store import persist_user_profile
from app.core.order_slots import (
    CANCELLABLE_STATUSES,
    KOLKATA_TZ,
    in_delivery_window,
    now_kolkata,
    slot_cutoff_for,
)
from app.core.security import hash_password, verify_password, create_access_token, create_refresh_token, decode_token
from app.services import push_service
from app.services import sms_service
from typing import Any, Literal, Optional
import logging

from app.core.status_values import (
    ComplaintStatus,
    MenuChangeStatus,
    OrderStatus,
    PaymentStatus,
    RefundStatus,
    ShopApprovalStatus,
    ShopStatus,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# Highest number of units of a single dish a student may put on one order line.
# The cart UI caps itself well below this; the server-side bound exists so a
# hand-crafted request can't inflate a bill/stock row to an absurd value.
MAX_LINE_QUANTITY = 99

# Order states in which a payment record / UTR reference may still be attached.
# "Pending" is the multi-shop parent's initial state (parent_orders.status),
# "Pending Payment" the single-shop UPI/Razorpay state, and "Pending Acceptance"
# the COD state — everything else (Confirmed, Delivered, Cancelled, ...) is past
# the point where a new payment proof means anything. Admins may bypass this
# (the admin tools annotate any order).
_AWAITING_PAYMENT_STATUSES = ("Pending", "Pending Payment", "Pending Acceptance")

# How recent an UNPAID UPI order must be to be settled by a bank credit that
# carries no matching UTR claim (tier 2 of ``/sms/match`` — see
# ``_sms_match_core``). A lunch-rush payment lands within a couple of minutes;
# anything older is a stale row that a same-amount credit could otherwise pick
# up, so it is forced into manual review instead.
BANK_MATCH_WINDOW_MINUTES = 90

# Orders whose status can be settled by verified bank evidence. Anything outside
# this set is already terminal (Delivered / Cancelled / Completed …) and must
# never be moved by a replayed or mis-routed credit SMS.
BANK_SETTLEABLE_STATUSES = ("Pending Payment", "Pending", "Pending Acceptance")


def _order_age_minutes(order: dict) -> float | None:
    """Minutes since ``order['created_at']``; ``None`` when it can't be read.

    SQLite stores IST wall-clock ("2026-09-17 10:00:00") while Supabase stores
    UTC ISO-8601, so both shapes are normalised here — the same two formats the
    portal's ``toDate`` understands. An unparseable timestamp is deliberately
    reported as ``None`` so the caller refuses to guess and sends the credit to
    manual review.
    """
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

# Payment verification is UTR-ONLY: the student pastes the UPI transaction
# reference (a string stored in the database) and the shop's bank credit SMS
# carrying the same UTR auto-confirms the order. The old screenshot-upload
# system was removed — files written to a serverless /tmp directory vanished
# between invocations (which is why payments "didn't save"), and a UTR is the
# stronger proof anyway.



def _clean_payment_method(value: str, allowed: tuple[str, ...]) -> str:
    """Normalise a client-supplied payment method and reject unknown ones.

    The method decides the order's *initial status* (paid vs awaiting payment),
    so it must not be a free-form string: an unrecognised/forged value could
    otherwise steer the order into a status the caller didn't pay for.
    """
    method = (value or "").strip().upper()
    if method not in allowed:
        raise ValueError(f"payment_method must be one of {', '.join(allowed)}")
    return method


async def _db(fn, *args, **kwargs):
    """Run a blocking store call in a worker thread.

    The SQLite/Supabase stores are synchronous (psycopg2/sqlite3). Calling them
    directly inside an ``async def`` handler stalls FastAPI's event loop and
    serializes every concurrent request — which is exactly the latency users
    feel in production. Running the call in a thread keeps the loop free.
    """
    return await asyncio.to_thread(fn, *args, **kwargs)


def _push_admin(title: str, message: str, tag: str = "admin-alert") -> None:
    """Fire a web push to the admin's phone (fire-and-forget, never raises).

    Used at every spot that creates a `target_role="admin"` notification so
    the Admin Centre rings the admin's phone instead of only filling the bell.
    """
    try:
        push_service.notify_admin_async(title, message, {"url": "/admin-dashboard", "tag": tag})
    except Exception as e:
        logger.warning(f"Admin push '{title}' failed: {e}")


async def _cached_read(ttl: float, key: str, loader, *args, **kwargs):
    """Serve ``loader()`` from the layered read cache (memory → Redis → Postgres).

    Thin wrapper over :func:`app.core.read_cache.cached_read` so every endpoint
    in this module keeps the same call shape; ``key`` must vary per query params
    (that happens automatically — the arguments are folded into the cache key) so
    filtered results never cross wires. Every layer is invalidated after a write
    by the app-level middleware.
    """
    return await read_cache.cached_read(ttl, key, loader, *args, **kwargs)


_last_auto_confirm_run = 0.0


def _process_due_auto_confirm():
    """Fire-and-forget 30-min auto-confirm sweep, throttled to once a minute.

    On hosts with a background loop (Render/local) this is redundant — the
    loop already runs it. On serverless hosts (Vercel) there is no background
    loop, so the lazy sweep triggered on the most-polled endpoint keeps the
    spec's auto-complete behaviour working. Never raises.
    """
    import time
    global _last_auto_confirm_run
    if time.monotonic() - _last_auto_confirm_run < 60:
        return
    _last_auto_confirm_run = time.monotonic()
    try:
        def _run():
            return db.auto_complete_expired_deliveries()
        asyncio.get_event_loop().run_in_executor(None, _run)
    except Exception:
        pass


def _normalize_phone(phone: str) -> str:
    """Coerce an Indian mobile number to E.164 (+91 + 10 digits).

    Handles every form a (possibly stale) frontend build can send: plain 10
    digits ("9876543210"), the E.164 form ("+919876543210"), or 12 digits with
    the country code ("919876543210"). Anything else is returned unchanged.
    """
    digits = "".join(ch for ch in (phone or "") if ch.isdigit())
    if len(digits) == 10:
        return f"+91{digits}"
    if len(digits) == 12 and digits.startswith("91"):
        return f"+91{digits[2:]}"
    return phone or ""


@router.get("/status")
async def database_status():
    return {
        "connected": True,
        "mode": "supabase",
        "database": "Supabase Postgres",
        "persistent": True,
        "message": "Supabase Postgres is active. Business data is stored in a persistent cloud database.",
    }


class LocalSessionCreate(BaseModel):
    email: EmailStr
    name: str = Field(..., max_length=100)
    role: str = Field(..., max_length=20)


class LocalShopUpdate(BaseModel):
    # PENTEST FIX (finding 15): every string bounded; status/approval_status
    # constrained to their real vocabularies so an admin/shopkeeper PATCH can't
    # park garbage in the fields every portal filters on.
    name: str | None = Field(default=None, max_length=100)
    category: str | None = Field(default=None, max_length=50)
    description: str | None = Field(default=None, max_length=1000)
    opening_time: str | None = Field(default=None, max_length=20)
    closing_time: str | None = Field(default=None, max_length=20)
    present: bool | None = None
    status: ShopStatus | None = None
    approval_status: ShopApprovalStatus | None = None
    shopkeeper_email: str | None = Field(default=None, max_length=200)
    shopkeeper_name: str | None = Field(default=None, max_length=100)
    phone: str | None = Field(default=None, max_length=30)
    whatsapp_number: str | None = Field(default=None, max_length=30)
    upi_id: str | None = Field(default=None, max_length=100)


class LocalShopCreate(BaseModel):
    # PENTEST FIX (finding 15): bounded so a crafted admin request can't store
    # unbounded blobs that every student's shop list then downloads.
    name: str = Field(..., max_length=100)
    category: str = Field(..., max_length=50)
    description: str = Field(default="", max_length=1000)
    shopkeeper_email: EmailStr
    shopkeeper_name: str = Field(..., max_length=100)
    phone: str = Field(..., max_length=30)
    opening_time: str = Field(default="09:00 AM", max_length=20)
    closing_time: str = Field(default="09:00 PM", max_length=20)
    upi_id: str = Field(default="", max_length=100)


class LocalProductCreate(BaseModel):
    # PENTEST FIX (finding 15): bounded free-text fields.
    shop_id: str = Field(..., max_length=100)
    name: str = Field(..., max_length=100)
    description: str = Field(default="", max_length=1000)
    price: int
    category: str = Field(..., max_length=50)
    inventory: int = 0
    prep_time: int = 10
    available: bool = True
    # Combo: ONE price for MANY items (Biryani + Fast Food + drink). When
    # is_combo is true the category is forced to "Combo" and combo_items holds
    # the item list text (one per line or comma-separated).
    is_combo: bool = False
    combo_items: str = Field(default="", max_length=500)


class LocalProductUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    description: str | None = Field(default=None, max_length=1000)
    price: int | None = None
    pending_price: int | None = None
    category: str | None = Field(default=None, max_length=50)
    inventory: int | None = None
    prep_time: int | None = None
    available: bool | None = None
    is_combo: bool | None = None
    combo_items: str | None = Field(default=None, max_length=500)


# Delivery is a single fixed drop point: the VIT-AP main gate. Kept in one
# constant because the UI, the order validators and the tests must all agree —
# a second location is a door the campus does not actually hand food over at.
VITAP_MAIN_GATE = "VIT-AP Main Gate"


def _require_vitap_location(value: str) -> str:
    """Delivery is the VIT-AP main gate only — normalise everything to it.

    The GPS "use my location" button and free-text/off-campus inputs were
    removed from the UI, but a hand-crafted request could still send "Guntur"
    or any other address. This is the server-side guard every order/payment path
    goes through: whatever the client sent is replaced by the one allowed drop
    point, so the stored order can never name a place the shop won't deliver
    to (and can never be used to smuggle free text into an order row).
    """
    if value is None or not str(value).strip():
        raise ValueError("delivery_location is required")
    # Accept a spelled-out variant from an older client, but store the canonical
    # spelling so group-by-location in the portals stays consistent.
    loc = VITAP_MAIN_GATE
    incoming = str(value).strip()
    if re.search(r"vit[\s-]*ap", incoming, re.I) and re.search(r"main[\s-]*gate", incoming, re.I):
        return loc
    # Anything that is not the VIT-AP main gate (other VIT-AP blocks, "Guntur",
    # free text) is rejected loudly rather than silently redirected, so a stale
    # client shows a real error instead of an order that quietly moved pickup.
    if re.search(r"vit[\s-]*ap", incoming, re.I):
        raise ValueError(f"Delivery is {VITAP_MAIN_GATE} only — please choose the main gate.")
    raise ValueError("Delivery is VIT-AP main gate only — please choose the main gate.")


class LocalOrderStatusUpdate(BaseModel):
    # PENTEST FIX (finding 12): was a free-form `status: str` — any string
    # (including megabyte payloads) was written straight to the orders table.
    status: OrderStatus


class LocalOrderItem(BaseModel):
    # PENTEST FIX (finding 15): the product id is server-minted — bounded.
    product_id: str = Field(..., max_length=100)
    # The cart UI lets a student pick a quantity per line; older clients omit it
    # (default 1). Declaring it here matters: Pydantic silently DROPS unknown
    # fields, so without this the server billed every line as a single unit no
    # matter how many the student actually chose.
    quantity: int = Field(1, ge=1, le=MAX_LINE_QUANTITY)


class LocalOrderCreate(BaseModel):
    # PENTEST FIX (finding 15): identity/delivery strings bounded.
    shop_id: str = Field(..., max_length=100)
    items: list[LocalOrderItem]
    student_name: str = Field(default="Student", max_length=100)
    student_phone: str = Field(default="", max_length=30)
    delivery_location: str = Field(..., max_length=300)
    delivery_slot: str = Field(..., max_length=50)
    pending_payment: bool = False
    payment_method: str = "UPI"  # 'UPI' | 'COD' | 'Razorpay'
    # Client-chosen idempotency key for this checkout attempt. The payment page
    # retries this POST when the serverless host is slow, and a retry that
    # forked a second order left two same-amount UNPAID orders at one shop —
    # which tier-2 bank matching deliberately refuses to disambiguate, so the
    # retry locked out a student who had already paid. Replaying the same ref
    # returns the original order instead.
    client_ref: str = Field(default="", max_length=64, pattern=r"^[A-Za-z0-9_-]{1,64}$")

    @field_validator("delivery_location")
    @classmethod
    def _validate_location(cls, value: str) -> str:
        return _require_vitap_location(value)

    @field_validator("payment_method")
    @classmethod
    def _validate_payment_method(cls, value: str) -> str:
        return _clean_payment_method(value, ("UPI", "COD", "RAZORPAY"))



class LocalMultiShopOrder(BaseModel):
    """Multi-shop checkout payload: one list of shops, each with items."""
    # PENTEST FIX (finding 15): free-form shop list — identity strings bounded
    # (per-line quantity is validated in the handler below).
    shops: list[dict]
    student_name: str = Field(default="Student", max_length=100)
    student_phone: str = Field(default="", max_length=30)
    student_email: str = Field(default="", max_length=200)
    delivery_location: str = Field(..., max_length=300)
    delivery_slot: str = Field(default="", max_length=50)
    payment_method: str = "UTR"  # 'UTR' | 'COD'

    @field_validator("delivery_location")
    @classmethod
    def _validate_location(cls, value: str) -> str:
        return _require_vitap_location(value)

    @field_validator("payment_method")
    @classmethod
    def _validate_payment_method(cls, value: str) -> str:
        # Multi-shop has no per-shop gateway hook, so Razorpay is deliberately
        # not accepted here — a multi-shop bill is only settled by UPI/UTR proof
        # or cash on delivery.
        return _clean_payment_method(value, ("UTR", "COD", "UPI", "MANUAL UTR"))



class LocalSubOrderStatusUpdate(BaseModel):
    # PENTEST FIX (finding 12/15): closed vocabulary + bounded notes.
    status: OrderStatus
    notes: str = Field(default="", max_length=2000)


class LocalComplaintCreate(BaseModel):
    # PENTEST FIX: every field is length-bounded — an unbounded subject/message
    # is a memory + DB-bloat write primitive on an authenticated-but-open route.
    parent_order_id: str = Field(..., max_length=100)
    student_name: str = Field(default="", max_length=100)
    student_phone: str = Field(default="", max_length=30)
    shop_id: str = Field(default="", max_length=100)
    shop_name: str = Field(default="", max_length=200)
    subject: str = Field(..., max_length=300)
    message: str = Field(..., max_length=5000)
    proof_url: str = Field(default="", max_length=500)


class LocalRefundCreate(BaseModel):
    # PENTEST FIX (finding 15): bounded — admin tooling still fits comfortably.
    parent_order_id: str = Field(..., max_length=100)
    sub_order_id: str = Field(default="", max_length=100)
    student_name: str = Field(default="", max_length=100)
    shop_name: str = Field(default="", max_length=200)
    original_amount: int = 0
    refund_amount: int = 0
    refund_type: str = Field(default="Full", max_length=50)


class LocalAnnouncementCreate(BaseModel):
    # PENTEST FIX (finding 15): the message is broadcast to every student —
    # bounded so one admin paste can't blow up every student's app payload.
    shop_id: str = Field(..., max_length=100)
    message: str = Field(..., max_length=1000)


class LocalAnnouncementToggle(BaseModel):
    is_active: int = 1


class LocalStudentNoticeUpdate(BaseModel):
    """Site-wide info block on the student home page (admin editor)."""

    enabled: bool | None = None
    text: str | None = Field(default=None, max_length=500)


class LocalMenuChangeCreate(BaseModel):
    # PENTEST FIX (finding 15): bounded free-text fields.
    shop_id: str = Field(..., max_length=100)
    product_id: str = Field(default="", max_length=100)
    change_type: str = Field(..., max_length=100)
    old_value: str = Field(default="", max_length=500)
    new_value: str = Field(default="", max_length=500)


class LocalComplaintStatusUpdate(BaseModel):
    # PENTEST FIX (finding 12): closed vocabulary + bounded notes.
    status: ComplaintStatus
    admin_notes: str = Field(default="", max_length=2000)


class LocalRefundUpdate(BaseModel):
    # PENTEST FIX (finding 12): closed vocabulary + bounded UTR/notes.
    status: RefundStatus
    refund_utr: str = Field(default="", max_length=40)
    admin_notes: str = Field(default="", max_length=2000)


class LocalMenuChangeApprove(BaseModel):
    # PENTEST FIX (finding 12): closed vocabulary + bounded notes.
    status: MenuChangeStatus
    admin_notes: str = Field(default="", max_length=2000)


class LocalPaymentCreate(BaseModel):
    # PENTEST FIX: order ids are server-minted ("oYYYYMMDD-N" / "pYYYYMMDD-N")
    # and UTRs are short alphanumeric references — both are bounded so a hand-
    # crafted request can't push megabyte strings into queries and rows.
    order_id: str = Field(..., max_length=100)
    amount: int = Field(..., ge=1, le=1_000_000)
    method: str
    utr_number: str | None = Field(default=None, max_length=40)

    @field_validator("method")
    @classmethod
    def _validate_method(cls, value: str) -> str:
        # Keep the caller's spelling (views display it) but refuse anything
        # outside the methods the platform can actually settle.
        if (value or "").strip().lower() not in {"manual utr", "upi", "cod", "razorpay"}:
            raise ValueError("Unsupported payment method")
        return value


class LocalPaymentStatusUpdate(BaseModel):
    # PENTEST FIX (finding 12): was a free-form `status: str` — any string was
    # written to the payments table the settlement views read.
    status: PaymentStatus


class LocalPaymentSettings(BaseModel):
    # PENTEST FIX (finding 15): bounded — these strings are rendered on every
    # checkout page.
    manual_enabled: bool | None = None
    upi_id: str | None = Field(default=None, max_length=100)
    receiver_name: str | None = Field(default=None, max_length=100)
    instructions: str | None = Field(default=None, max_length=1000)
    razorpay_enabled: bool | None = None


class LocalTicketCreate(BaseModel):
    # PENTEST FIX (finding 15): bounded so a support ticket can't be an
    # unbounded authenticated write primitive.
    name: str = Field(..., max_length=100)
    email: EmailStr
    phone_number: str = Field(..., max_length=30)
    category: str = Field(..., max_length=50)
    title: str = Field(..., max_length=200)
    description: str = Field(..., max_length=3000)


class LocalFeedbackCreate(BaseModel):
    """A student's bug report / improvement contribution while testing the site."""
    category: str = Field(..., pattern="^(Bug|Improvement|Suggestion|Other)$")
    subject: str = Field(..., min_length=3, max_length=150)
    message: str = Field(..., min_length=5, max_length=2000)
    page: str = Field(default="", max_length=200)
    # Where the contribution came from: 'User' (student portal, default) or
    # 'ATS' (automated test suite). The admin Feedback page filters on this so
    # real user reports and test-generated ones are easy to tell apart.
    source: str = Field(default="User", pattern="^(User|ATS)$")
    # Fallback identity for quick/session logins that have no JWT (kept in sync
    # with the server-side user record whenever a token IS present).
    name: str = Field(default="", max_length=100)
    email: str = Field(default="", max_length=200)


# ─── Auth schemas ───


class LocalAuthRegister(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=4, max_length=128)
    name: str = Field(..., min_length=1, max_length=100)
    role: str = Field(..., pattern="^(student|shopkeeper|admin)$")
    email: str = Field(default="", max_length=200)
    phone: str = Field(default="", max_length=30)


class LocalAuthLogin(BaseModel):
    # PENTEST FIX (finding 15): bounded to match the register schema — an
    # unbounded password body is free work for the bcrypt path.
    username: str = Field(..., max_length=100)
    password: str = Field(..., max_length=128)


class LocalPhoneOnboarding(BaseModel):
    """Students joining from the student portal phone gate — name + mobile.
    A real account (and its JWT) is created behind the scenes so the rest of
    the order/payment flow works exactly like a password-login account.

    ``password`` is required to SIGN BACK IN to an account that already exists
    (see the endpoint). It is ignored when creating a brand-new account, where
    the server generates one and returns it once.
    """
    name: str = Field(..., min_length=1, max_length=100)
    phone: str = Field(..., min_length=7, max_length=20)
    campus: str = Field(default="", max_length=100)
    default_delivery_location: str = Field(default="", max_length=300)
    password: str = Field(default="", max_length=128)


class LocalAuthUser(BaseModel):
    id: int
    username: str
    name: str
    role: str
    email: str = ""
    phone: str = ""
    created_at: datetime


class LocalAuthResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: LocalAuthUser
    # Returned ONLY on the call that CREATES a phone account, and only once:
    # it is the account's password, which the student must save to sign back in.
    # Never populated for an account that already existed — that would hand a
    # fresh password to anyone who knows a phone number.
    generated_password: Optional[str] = None


# ─── Helper to extract current user from JWT ───


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
    """Require a valid token whose role is ``admin`` (mirrors local_admin.verify_admin)."""
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
    # A signed token is not proof of *current* privilege — re-check the account
    # in the database so a removed or downgraded admin cannot keep using an
    # unexpired token. The DEBUG-only dev fallback admin ("sub": "0") has no row
    # and is exempt, as is any non-numeric subject.
    if not settings.DEBUG:
        try:
            user_id = int(payload.get("sub"))
        except (TypeError, ValueError):
            raise HTTPException(status_code=403, detail="Admin access required")
        user = await _db(db.get_user_by_id, user_id)
        if not user or user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Admin access required")
    return payload


def _same_student(user: dict, order: dict) -> bool:
    """Only the server-assigned account ID proves ownership.

    Legacy names, contact phones and client-supplied student_id are not proof.
    Unassigned historical orders remain available to admins for review.
    """
    owner = str(order.get("owner_user_id") or "").strip()
    return bool(owner) and owner == str(user.get("id") or "")


def _require_agent_key(x_agent_key: Optional[str], request: Optional[Request] = None) -> None:
    """Gate the bank-SMS endpoints on the Android agent's shared key.

    ``/sms/match`` and ``/sms/incoming`` can both move an order to **Confirmed**
    (i.e. mark it paid), so the check must fail CLOSED. Previously an unset
    ``SMS_FORWARD_KEY`` silently skipped the comparison, so on any deployment
    without the key one anonymous request carrying a plausible UTR + amount was
    enough to settle a pending UPI order. DEBUG deployments stay permissive so
    local flows and tests can drive the endpoints by hand.

    PENTEST FIX: the comparison is constant-time (``secrets.compare_digest``)
    so the shared secret can't be probed byte-by-byte, and FAILED guesses are
    throttled per client IP (20 per 15 minutes) — an attacker can no longer
    brute-force the key at network speed. Only mismatches consume that budget,
    so the real agent (which holds the correct key) is never throttled, and the
    correct key still works even after somebody else's failed guesses from the
    same IP.
    """
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
    """Resolve an order id (single order OR multi-shop parent) and require that
    the caller owns it — admins may act on any order.

    Every money-moving endpoint must go through this: taking the ``order_id``
    from the request body without checking ownership lets one account attach a
    payment/verification to somebody else's order.
    """
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


# ─── Auth endpoints ───


@router.post("/auth/register", status_code=201)
async def local_register(data: LocalAuthRegister, request: Request):
    """Register a new user in the local database."""
    # A whole campus shares one public IP behind the college NAT, so a tight
    # per-IP cap would lock out every student after the first handful of
    # sign-ups. 40/hour still throttles mass bot registration while letting a
    # real onboarding rush through.
    if not rate_allow("register", rate_ip(request), max_attempts=40, window_sec=3600):
        raise HTTPException(status_code=429, detail="Too many sign-up attempts from this network — try again later.")

    # PENTEST FIX (critical): public registration must never mint an admin.
    # Previously role="admin" here created a real admin row + JWT, handing the
    # whole platform to anyone who could POST this endpoint. Admin accounts are
    # created server-side only (ensure_admin_user from env credentials).
    if data.role == "admin":
        raise HTTPException(status_code=403, detail="Admin accounts cannot be created through public registration.")

    password_hash_value = await asyncio.to_thread(hash_password, data.password)
    user, conflict = await _db(
        db.register_user,
        username=data.username,
        password_hash=password_hash_value,
        name=data.name,
        role=data.role,
        email=data.email,
        phone=data.phone,
    )
    if conflict == "username" or not user:
        raise HTTPException(status_code=409, detail="Username already taken")
    if conflict == "email":
        # One email = one account across the whole platform, no matter the role.
        raise HTTPException(status_code=409, detail="This email is already registered. Try signing in instead.")

    # If registering as shopkeeper, auto-create a pending shop
    if data.role == "shopkeeper":
        try:
            await _db(db.create_shop, {
                "name": f"{data.name}'s Shop",
                "category": "Campus Food",
                "description": "New shop awaiting admin approval.",
                "shopkeeper_email": data.email or f"{data.username}@campus.local",
                "shopkeeper_name": data.name,
                "phone": data.phone or "9999999999",
                "opening_time": "09:00 AM",
                "closing_time": "09:00 PM",
            })
            logger.info(f"Shop auto-created for shopkeeper: {data.username}")
        except Exception as e:
            logger.warning(f"Could not auto-create shop for {data.username}: {e}")

    return {"message": "User registered successfully", "user": user}


@router.post("/auth/login")
async def local_login(data: LocalAuthLogin, request: Request):
    """Authenticate user and return JWT tokens."""
    ip = rate_ip(request)
    if not rate_allow("login", f"{data.username}:{ip}", max_attempts=40, window_sec=300):
        raise HTTPException(status_code=429, detail="Too many sign-in attempts — please wait a few minutes and try again.")

    user = await _db(db.get_user_by_username, data.username)
    # PENTEST FIX: identical message for "no such user" and "wrong password" —
    # distinct messages let an attacker enumerate which usernames exist. The
    # dummy hash runs bcrypt even for an unknown username, so both branches
    # take the same TIME as well as the same message.
    bad_credentials = "Invalid username or password."
    if not await asyncio.to_thread(
        verify_password, data.password,
        (user or {}).get("password_hash") or await asyncio.to_thread(hash_password, "x" * 16),
    ):
        raise HTTPException(status_code=401, detail=bad_credentials)
    if not user:
        raise HTTPException(status_code=401, detail=bad_credentials)

    rate_reset("login", f"{data.username}:{ip}")

    # Generate JWT tokens
    token_data = {
        "sub": str(user["id"]),
        "username": user["username"],
        "name": user["name"],
        "role": user["role"],
    }
    access_token = create_access_token(token_data)
    refresh_token = create_refresh_token(token_data)

    return LocalAuthResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        user=LocalAuthUser(
            id=user["id"],
            username=user["username"],
            name=user["name"],
            role=user["role"],
            created_at=user["created_at"],
        ),
    )


@router.post("/auth/phone")
async def local_phone_onboarding(data: LocalPhoneOnboarding, request: Request):
    """Phone-first student onboarding (the student portal RoleGate).

    Creates a ``student`` account keyed by phone and returns a real JWT, so
    payments/order APIs that need an authenticated user keep working.

    SECURITY FIX (account takeover). This used to hand a valid access token to
    ANYONE who posted a phone number — a brand-new account when the number was
    unknown, and **the victim's own account** when it was not. A phone number is
    not a secret: campus numbers are often sequential, visible, or simply known
    by a classmate, so "know the number" was equivalent to "log in as them" and
    handed over their orders, delivery address and payment state. Proven live
    (see tests/test_phone_auth_takeover.py).

    Creating an account stays frictionless, but the generated password is now
    RETURNED ONCE so the student can save it, and signing back in REQUIRES it.
    The password was always generated and hashed here; it was simply thrown
    away, so returning it costs nothing and breaks nobody.
    """
    ip = rate_ip(request)
    # Throttled per PHONE *and* per IP as two INDEPENDENT buckets. The old
    # single bucket was keyed on (phone, ip), so an attacker guessing passwords
    # could rotate source addresses and try indefinitely; neither limit can now
    # be side-stepped by changing the other.
    if not rate_allow("phone_onboard_ip", ip, max_attempts=20, window_sec=300):
        raise HTTPException(status_code=429, detail="Too many attempts from this device — please wait a few minutes.")
    if not rate_allow("phone_onboard_no", data.phone, max_attempts=10, window_sec=300):
        raise HTTPException(status_code=429, detail="Too many attempts for this number — please wait a few minutes.")

    phone = _normalize_phone(data.phone.strip())
    digits = "".join(ch for ch in phone if ch.isdigit())
    if len(digits) < 10:
        raise HTTPException(status_code=400, detail="Please enter a valid 10-digit mobile number")

    username = f"stu_{digits[-10:]}"
    name = (data.name or "").strip() or "Student"
    # One wording for "no password" and "wrong password" alike, so the response
    # never reveals whether a number is registered.
    _signed_in_msg = (
        "This number is already registered. Enter the password you were given when "
        'you joined, or use "Forgot password" to reset it.'
    )

    user = await _db(db.get_user_by_username, username)
    generated_password: str | None = None

    if user:
        # RETURNING student — this is a LOGIN, so it needs proof of possession of
        # the account. Without it we would be the vulnerability described above.
        if not data.password:
            raise HTTPException(status_code=401, detail=_signed_in_msg)
        stored_hash = user.get("password_hash") or ""
        ok = await asyncio.to_thread(verify_password, data.password, stored_hash)
        if not ok:
            raise HTTPException(status_code=401, detail=_signed_in_msg)
        logger.info(f"Phone sign-in for {username}")
    else:
        pick_name = name or phone
        random_pw = secrets.token_urlsafe(9)
        password_hash_value = await asyncio.to_thread(hash_password, random_pw)
        new_user, conflict = await _db(
            db.register_user,
            username=username,
            password_hash=password_hash_value,
            name=pick_name,
            role="student",
            email="",
            phone=phone,
        )
        if conflict or not new_user:
            raise HTTPException(status_code=409, detail="Could not create your student account — please try again.")
        user = new_user
        # Shown to the student exactly once, so they can sign back in.
        generated_password = random_pw
        logger.info(f"Phone-onboarding created student account {username}")

    token_data = {
        "sub": str(user["id"]),
        "username": user["username"],
        "name": user["name"],
        "role": "student",
    }
    access_token = create_access_token(token_data)
    refresh_token = create_refresh_token(token_data)

    return LocalAuthResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        user=LocalAuthUser(
            id=user["id"],
            username=user["username"],
            name=user["name"],
            role="student",
            created_at=user["created_at"],
        ),
        # Non-null ONLY on the call that created the account — the one moment
        # the student can be shown their password. Every later sign-in returns
        # null, so this can never be used to reset someone's password.
        generated_password=generated_password,
    )


@router.get("/auth/me")
async def local_me(current_user: dict = Depends(get_current_local_user)):
    """Get the current authenticated user's profile."""
    return current_user


class LocalProfileUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    email: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=30)
    password: str | None = Field(default=None, min_length=4, max_length=128)


@router.patch("/auth/me")
async def local_update_me(data: LocalProfileUpdate, current_user: dict = Depends(get_current_local_user)):
    """Update the current student's profile — name, phone, email, and/or password.
    Auth is locked to the JWT subject, so a student can only ever edit their
    own row. Returns the updated profile and a fresh token so the client session
    reflects the new identity."""
    if current_user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    user_id = current_user["id"]

    name = data.name.strip() if data.name is not None else None
    email = (data.email or "").strip() if data.email is not None else None
    phone = data.phone.strip() if data.phone is not None else None

    if name is not None and not name:
        raise HTTPException(status_code=422, detail="Name cannot be empty")

    # Email unique across the whole platform — one email = one account.
    if email is not None and email:
        existing = await _db(db.get_user_by_email, email)
        if existing and existing["id"] != user_id:
            raise HTTPException(status_code=409, detail="This email is already registered to another account")
    elif email is not None:
        email = ""

    if data.password:
        new_hash = await asyncio.to_thread(hash_password, data.password)
        # Update password via the dedicated helper (no password in the profile row).
        await _db(db.update_user_password, current_user["username"], new_hash)

    updated = await _db(db.update_user_profile, user_id, name=name, email=email, phone=phone)
    if not updated:
        raise HTTPException(status_code=404, detail="User not found")

    # Issue a fresh token so the name in the JWT/session matches immediately.
    token_data = {
        "sub": str(updated["id"]),
        "username": updated["username"],
        "name": updated["name"],
        "role": updated["role"],
    }
    access_token = create_access_token(token_data)
    refresh_token = create_refresh_token(token_data)

    return LocalAuthResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        user=LocalAuthUser(
            id=updated["id"],
            username=updated["username"],
            name=updated["name"],
            role=updated["role"],
            email=updated.get("email", "") or "",
            phone=updated.get("phone", "") or "",
            created_at=updated["created_at"],
        ),
    )


@router.get("/summary")
async def summary(_admin: dict = Depends(_require_admin)):
    """Platform-wide business aggregates (shops, products, ACTIVE ORDERS, REVENUE).

    PENTEST FIX: this was gated on ``get_current_local_user`` — ANY signed-in
    account — so a student could read the platform's total revenue and live order
    count. No portal calls it (it is an admin stat), and the sibling /dashboard
    and /stats routes already use an admin gate, so this now does too.
    """
    return await _cached_read(15, "summary", db.get_summary)


@router.post("/sessions")
async def create_session(data: LocalSessionCreate, request: Request, _user: dict = Depends(get_current_local_user)):
    # PENTEST FIX: every call upserts a row keyed by the client-supplied email —
    # bound it per student+IP so an authenticated caller can't grow the sessions
    # table without limit. 15 per 5 minutes covers every real role-switch.
    if not rate_allow("session", f"{_user.get('id')}:{rate_ip(request)}", max_attempts=15, window_sec=300):
        raise HTTPException(status_code=429, detail="Too many session updates — please wait a few minutes and try again.")
    return await _db(persist_user_profile, data.email, data.name, data.role)


# Fields a shop row carries that must NEVER reach an unauthenticated caller.
#
# PENTEST FIX (data exposure). ``GET /shops`` and ``GET /shops/{id}`` are
# deliberately public — a student has to browse menus before logging in — but
# they were returning the RAW store row, which also carried:
#
#   admin_dues_balance / admin_dues_last_paid_at — the platform's private ledger
#       of what each vendor owes. Purely internal money data.
#   revenue_today / orders_today — a vendor's live business metrics. Leaking
#       these to any anonymous visitor is competitive intelligence.
#   shopkeeper_email / whatsapp_number — the vendor's private contact details.
#       ``phone`` is already public by design (students tap to call the shop),
#       but the vendor's login email and personal WhatsApp are not.
#
# None of these are read by any student-facing screen: they are only used by the
# admin dashboard and the shopkeeper's own dashboard, both of which are behind
# ``_require_admin`` / an authenticated vendor session. So dropping them from the
# public projection breaks nothing and closes the leak.
_PUBLIC_SHOP_FIELDS = frozenset({
    "id", "name", "category", "description", "rating",
    "opening_time", "closing_time", "present", "status",
    "approval_status", "phone", "shop_image", "prep_time",
    "upi_id", "upi_enabled", "cod_enabled", "is_featured",
    "ordering_position", "current_token", "shopkeeper_name",
})


def _public_shop(shop: dict) -> dict:
    """Strip internal/vendor-private fields from a shop row for public callers."""
    return {k: v for k, v in shop.items() if k in _PUBLIC_SHOP_FIELDS}


def _optional_user(authorization: Optional[str] = Header(None)) -> Optional[dict]:
    """Best-effort identity for endpoints that are public but richer when logged in.

    Returns None instead of raising, so a public endpoint stays public — it just
    serves the full row to a staff member and the redacted one to everyone else.
    """
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    try:
        return decode_token(token)
    except Exception:  # noqa: BLE001 - a bad token is simply "not logged in"
        return None


def _is_staff(user: Optional[dict]) -> bool:
    return bool(user) and user.get("role") in ("admin", "shopkeeper", "vendor")


@router.get("/shops")
async def shops(public_only: bool = False, user: Optional[dict] = Depends(_optional_user)):
    """List shops.

    ``public_only`` keeps the browser-facing menu list to APPROVED, non-removed
    shops. The response is redacted unless the caller is staff, because this
    endpoint is reachable without a token.
    """
    rows = await _cached_read(10, "shops", db.list_shops, public_only=public_only)
    if _is_staff(user):
        return rows
    return [_public_shop(s) for s in rows]


@router.post("/shops")
async def create_shop(data: LocalShopCreate, _admin: dict = Depends(_require_admin)):
    return await _db(db.create_shop, data.model_dump())


@router.patch("/shops/{shop_id}")
async def patch_shop(shop_id: str, data: LocalShopUpdate, _admin: dict = Depends(_require_admin)):
    shop = await _db(db.update_shop, shop_id, data.model_dump(exclude_unset=True))
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    return shop


@router.get("/shops/{shop_id}")
async def shop(shop_id: str, user: Optional[dict] = Depends(_optional_user)):
    result = await _db(db.get_shop, shop_id)
    if not result:
        raise HTTPException(status_code=404, detail="Shop not found")
    # Same redaction as the list endpoint: this one is public too (the student
    # app resolves the shop to read its UPI id for the payment QR).
    if _is_staff(user):
        return result
    return _public_shop(result)


@router.get("/products")
async def products(shop_id: str | None = None):
    if shop_id:
        return await _cached_read(10, "products", db.list_products, shop_id)
    return await _cached_read(10, "products", db.list_products)


@router.post("/products")
async def add_product(data: LocalProductCreate, _admin: dict = Depends(_require_admin)):
    return await _db(db.create_product, data.model_dump())


@router.patch("/products/{product_id}")
async def patch_product(product_id: str, data: LocalProductUpdate, _admin: dict = Depends(_require_admin)):
    product = await _db(db.update_product, product_id, data.model_dump(exclude_unset=True))
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


async def _list_orders_sliced(current_user: dict, limit: int = 100, offset: int = 0) -> list[dict]:
    """Return orders for the current user — filtered in SQL, never in Python.

    Students read only their own rows via ``list_orders_by_user_id`` (indexed);
    admins get a bounded newest-first slice. ``limit``/``offset`` keep every
    poll payload small no matter how large the tables grow.
    """
    limit = max(1, min(int(limit or 100), 200))
    offset = max(0, int(offset or 0))
    if current_user.get("role") == "admin":
        return await _db(db.list_orders, limit=limit + offset)
    uid = str(current_user.get("id") or "")
    name = str(current_user.get("name") or current_user.get("username") or "")
    rows = await _db(db.list_orders_by_user_id, uid, name, limit + offset)
    return rows[offset:offset + limit]


@router.get("/orders")
async def orders(
    current_user: dict = Depends(get_current_local_user),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """List orders. Students only ever see their own orders (matched by the
    server-assigned account id); admins may list everything. A valid token is
    always required so an account holder can't enumerate other students'
    names, phones and delivery locations.

    Server-side TTL cache (10 s) so dashboard polling rarely re-hits the DB —
    the cache key includes the user digest plus ``limit``/``offset`` so
    filtered results never cross wires.
    """
    cache_key = "orders"
    return await _cached_read(10, cache_key, _list_orders_sliced, current_user, limit, offset)


@router.get("/orders/parent")
async def parent_orders_list(
    status: str | None = None,
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(get_current_local_user),
):
    """List parent (multi-shop) orders. Logged-in students only ever receive
    THEIR OWN parent orders (filtered in SQL by the server-assigned account
    id); admins may list everything. Bounded + paginated so the response never
    ships the platform's full history on a poll.
    Declared before ``/orders/{order_id}`` so it can't be shadowed by the
    dynamic route (GET /orders/parent previously fell through to the dynamic
    segment with ``order_id="parent"`` and 404'd)."""
    limit = max(1, min(int(limit or 100), 200))
    offset = max(0, int(offset or 0))
    if current_user.get("role") == "admin":
        rows = await _db(db.list_parent_orders, limit + offset, status)
        return rows[offset:offset + limit]
    uid = str(current_user.get("id") or "")
    rows = await _db(db.list_parent_orders, limit + offset, status, uid)
    # Legacy rows with no owner stay admin-visible only — never leak them to a
    # student whose id merely sorts nearby.
    mine = [o for o in rows if _same_student(current_user, o)]
    return mine[offset:offset + limit]


@router.get("/orders/parent/{parent_order_id}")
async def parent_order_detail(parent_order_id: str, current_user: dict = Depends(get_current_local_user)):
    result = await _db(db.get_parent_order, parent_order_id)
    if not result:
        raise HTTPException(status_code=404, detail="Order not found")
    if current_user.get("role") != "admin" and not _same_student(current_user, result):
        raise HTTPException(status_code=403, detail="You can only view your own orders")
    return result


@router.get("/orders/{order_id}")
async def order(order_id: str, current_user: dict = Depends(get_current_local_user)):
    result = await _db(db.get_order, order_id)
    if not result:
        raise HTTPException(status_code=404, detail="Order not found")
    if current_user.get("role") != "admin" and not _same_student(current_user, result):
        raise HTTPException(status_code=403, detail="You can only view your own orders")
    return result


@router.get("/orders/{order_id}/payment")
async def order_payment_status(order_id: str, current_user: dict = Depends(get_current_local_user)):
    """Everything the student's payment portal needs about one order's payment.

    The portal polls this while a payment is in flight so the page can switch
    from "waiting for the bank" to "payment verified ✓" the moment the phone
    bot confirms the credit — no page reload and no guessing from the order
    status alone. The UTR itself is never returned (it is a bank reference, not
    the student's to re-read); only whether one is on file.

    Ownership is enforced exactly like ``GET /orders/{order_id}``: a valid token
    is required and only the owning student (or an admin) may read it.
    """
    result = await _db(db.get_order, order_id)
    is_parent = False
    if not result:
        result = await _db(db.get_parent_order, order_id)
        is_parent = bool(result)
    if not result:
        raise HTTPException(status_code=404, detail="Order not found")
    if current_user.get("role") != "admin" and not _same_student(current_user, result):
        raise HTTPException(status_code=403, detail="You can only view your own orders")

    payment = None
    try:
        payment = await _db(db.get_payment_by_order_id, order_id)
    except Exception as e:
        logger.warning(f"payment status lookup failed for {order_id}: {e}")

    return {
        "order_id": order_id,
        "order_status": result.get("status"),
        "payment_method": result.get("payment_method"),
        "amount": result.get("total"),
        "is_parent": is_parent,
        "payment_status": (payment or {}).get("status"),
        "payment_method_recorded": (payment or {}).get("method"),
        # A UTR is stored as proof for the admin/bot, but it is never echoed
        # back — only the fact that one is on file.
        "utr_saved": bool(str((payment or {}).get("utr_number") or "").strip()),
    }


@router.post("/orders")
async def add_order(data: LocalOrderCreate, current_user: dict = Depends(get_current_local_user)):
    payload = data.model_dump()
    payload["owner_user_id"] = str(current_user["id"])

    # ── Idempotent checkout ──
    # The payment page retries this POST when the serverless host is slow to
    # answer. A retry used to INSERT a brand-new order, which left the shop with
    # two UNPAID orders for the same amount — exactly the ambiguity tier-2 bank
    # matching refuses to guess at, so a student who had already paid could
    # still never unlock "Place Order". Replaying the same client_ref returns
    # the order the first attempt created.
    #
    # Only orders still AWAITING PAYMENT are reused. If that original order was
    # already paid (or cancelled) the ref is spent, and a fresh basket must get
    # a fresh order rather than silently reopening settled money.
    if payload.get("client_ref"):
        try:
            existing = await _db(
                db.find_order_by_client_ref, payload["client_ref"], payload["owner_user_id"]
            )
        except Exception as e:
            # A missing client_ref column must not block checkout — the
            # auto-migration will add it, and the worst case is the old
            # duplicate-order behaviour for this one request.
            logger.warning(f"client_ref lookup failed: {e}")
            existing = None
        if existing and str(existing.get("status") or "") in _AWAITING_PAYMENT_STATUSES:
            return existing

    # PENTEST FIX — bound how fast one ACCOUNT can place orders.
    #
    # This endpoint had no per-account limit, so any authenticated student
    # could loop it and create an unbounded number of real orders. Each one
    # decrements product stock AND queues a WhatsApp message to a real
    # shopkeeper, so the blast radius is not just database rows: it is a way to
    # burn a shop's stock and flood every shop on campus with junk
    # notifications, while looking like ordinary usage from one account.
    #
    # Keyed per student rather than per IP: a campus is behind one NAT, so an
    # IP limit would lock out every honest student the moment one person
    # misbehaved.
    #
    # Deliberately placed AFTER the idempotency check, so a legitimate retry of
    # a slow checkout is free and a student can never be locked out by the
    # very retry logic that protects them from duplicate orders.
    if not rate_allow(
        "place_order", str(current_user.get("id")), max_attempts=20, window_sec=300
    ):
        raise HTTPException(
            status_code=429,
            detail="You are placing orders too quickly — please wait a minute and try again.",
        )

    # The student's mobile is always stored as E.164 (+91 + 10 digits) so the
    # shopkeeper/order views never see a bare 10-digit number.
    payload["student_phone"] = _normalize_phone(payload.get("student_phone", ""))
    # Give the student a precise, human-readable reason instead of the old
    # cryptic "not approved, present, open, or orderable" message — the
    # usual cause is the vendor having NOT pressed Start yet, even though
    # the admin has approved the shop.
    shop = await _db(db.get_shop, payload["shop_id"])
    if not shop:
        raise HTTPException(status_code=400, detail="We couldn't find that shop — it may have been removed by the admin.")
    if shop.get("approval_status") != "Approved":
        if str(shop.get("approval_status") or "").lower() in ("removed", "suspended"):
            raise HTTPException(status_code=400, detail="This shop is no longer available — it was removed by the admin.")
        raise HTTPException(status_code=400, detail="This shop is not approved yet — wait until an admin approves it, then try again.")
    if not shop.get("present") or shop.get("status") != "Open":
        raise HTTPException(status_code=400, detail="This shop is currently closed — the vendor hasn't started accepting orders right now. Please try again a little later.")
    # The vendor controls which payment methods the shop accepts (UPI / COD
    # toggles in their Settings) — reject orders using a disabled method.
    method = str(payload.get("payment_method") or "").strip()
    if method == "UPI" and not shop.get("upi_enabled", 1):
        raise HTTPException(status_code=400, detail="This shop has turned off UPI payments — please choose Cash on Delivery instead.")
    if method == "COD" and not shop.get("cod_enabled", 1):
        raise HTTPException(status_code=400, detail="This shop has turned off Cash on Delivery — please pay via UPI instead.")
    order = await _db(db.create_order, payload)
    if not order:
        # The store can still reject if every cart item was deleted or the shop
        # toggled closed between the check above and the insert.
        raise HTTPException(status_code=400, detail="Could not place your order — the shop stopped accepting orders or an item in your cart was removed. Please check and try again.")

    # COD IS PLACED IMMEDIATELY — NO CONFIRMATION STEP.
    #
    # This used to auto-accept only inside a delivery window, so an order placed
    # outside one sat in "Pending Acceptance" waiting for the shop to tap
    # Accept. For cash on delivery that wait bought nothing: the money is
    # collected on handover either way, and the student was shown a pending
    # state for an order the shop had already been told about.
    #
    # A COD order therefore moves straight to "Accepted" (the shop has it, no tap
    # needed) and the shopkeeper is messaged on WhatsApp at once. "Accepted" is
    # the same state the in-window path already used, so the vendor dashboard,
    # the student's order list and the cancellation window all keep working
    # unchanged — this only removes the wait.
    #
    # The shop's own Start/Stop toggle is still the gate on whether an order can
    # be placed at all, so a stopped shop still refuses orders as before.
    try:
        if str(order.get("payment_method") or "").upper() == "COD" and order.get("status") == "Pending Acceptance":
            accepted = await _db(db.update_order_status, order["id"], "Accepted")
            if accepted:
                order = accepted
    except Exception as e:
        logger.warning(f"Could not mark order {order.get('id')} as placed: {e}")

    # ── Open the payment intent in the SAME request ──
    # This used to be a second call from the browser (POST /local/payments).
    # Measured in production that call takes 12-27 s on its own — the serverless
    # host pays a cold start per request, and a second request paid it AGAIN.
    # The client gave up at 20 s and reported "the server is taking too long"
    # for an order that had in fact been created, which is the worst possible
    # outcome: the student is told it failed, and retries.
    #
    # The payment row is what tier-2 bank matching needs to recognise the credit
    # (it only settles an order that has an OPEN payment), so it must exist
    # before the student can pay. Creating it here costs one extra statement on
    # a connection we already hold, instead of a whole extra request.
    try:
        if str(order.get("payment_method") or "").upper() == "COD":
            await _db(db.create_payment, order["id"], int(round(float(order.get("total") or 0))), "COD", None)
        else:
            await _db(
                db.create_payment,
                order["id"],
                int(round(float(order.get("total") or 0))),
                "Manual UTR",
                None,
            )
    except Exception as e:
        # Never fail the order over its payment intent: the student's "Already
        # paid? Confirm it here" box creates this row on demand, and the admin
        # can too. A missing row is recoverable; a lost order is not.
        logger.warning(f"Could not open the payment intent for {order.get('id')}: {e}")

    # Fire the vendor's phone notification without blocking the student's
    # response — the web push runs in a worker thread (fire-and-forget).
    #
    # PREPAID ORDERS ARE HELD BACK UNTIL PAID. A UPI order must not reach the
    # shop before the money is in: an unpaid order that the kitchen starts
    # preparing is a lost meal and a wasted prep slot. The notification is
    # therefore sent from the payment-confirmed path instead (see
    # _notify_shop_of_paid_order), so a shop only ever sees work it will be paid
    # for.
    #
    # COD IS THE EXCEPTION AND MUST STAY IMMEDIATE. Cash is collected ON
    # DELIVERY, so payment can only ever be confirmed after the shop has already
    # cooked and handed the order over. Gating COD on payment would mean the shop
    # never learns about the order and the student waits forever.
    is_cash_on_delivery = str(order.get("payment_method") or "").upper() == "COD"
    if is_cash_on_delivery:
        try:
            asyncio.get_running_loop().create_task(
                push_service.notify_shop_new_order_async(order)
            )
        except Exception as e:
            logger.warning(f"Could not schedule order push notification: {e}")

    # SMS the shopkeeper (and a copy to the admin) + queue the shopkeeper's
    # WhatsApp. This MUST be awaited, not fired-and-forgotten: on the serverless
    # platform the request's background tasks are killed the moment the response
    # returns, so a create_task here would silently drop the order's WhatsApp
    # notification (which the phone bot then never receives). Awaiting keeps
    # the ordering latency at ~SMS-log cost and guarantees the notification.
    if is_cash_on_delivery:
        try:
            await _notify_order_via_sms(order)
        except Exception as e:
            logger.warning(f"Could not send order notifications: {e}")
    else:
        logger.info(
            f"Order {order.get('id')} ({order.get('token')}) is prepaid — holding it back "
            f"from the shop until payment is confirmed."
        )

    # The admin's confirmation queue. Awaited for the same serverless reason as
    # the WhatsApp above — a fire-and-forget notification here is exactly how an
    # order ends up placed but never confirmed.
    #
    # The admin still sees UNPAID prepaid orders on purpose: they are the safety
    # net. If a bank credit is never matched (SMS agent not installed, key
    # wrong, no SMS), the shop deliberately never hears about the order, so the
    # admin is the only person who can see it and release it by hand. Without
    # this a stranded payment would be invisible and simply lost.
    try:
        await _notify_admin_of_new_order(order)
    except Exception as e:
        logger.warning(f"Could not queue the admin confirmation for {order.get('id')}: {e}")

    return order


async def _notify_shop_of_paid_order(order: dict) -> None:
    """Tell the shop an order is theirs — called when a prepaid order is PAID.

    This is the release point for held-back orders. It is deliberately
    fire-and-forget-safe: every channel is wrapped so a delivery failure can
    never break the payment confirmation that already succeeded. A shop that
    misses the WhatsApp still has the order in its portal, because the order
    itself is only visible to the shop once it is paid.
    """
    if not order or not order.get("id"):
        return
    try:
        asyncio.get_running_loop().create_task(
            push_service.notify_shop_new_order_async(order)
        )
    except Exception as e:
        logger.warning(f"Could not schedule paid-order push for {order.get('id')}: {e}")
    try:
        await _notify_order_via_sms(order)
    except Exception as e:
        logger.warning(f"Could not send paid-order notifications for {order.get('id')}: {e}")


async def _notify_admin_of_new_order(order: dict) -> None:
    """Put a freshly placed order in the ADMIN's confirmation queue.

    Writes one ``target_role="admin"`` notification carrying an inline
    ``action="confirm_order"``, which is what puts a Confirm button directly in
    the admin's notification bell (and on the Approvals page). Once the admin
    confirms, the student can download their payment QR and pay from their own
    UPI app.

    The admin's phone is also pinged (web push) so the queue is noticed even when
    the portal sits on another tab. Never raises.
    """
    if not order or not order.get("id"):
        return
    token = order.get("token")
    student = str(order.get("student_name") or "").strip() or "A student"
    shop = str(order.get("shop_name") or "").strip() or "a shop"
    total = order.get("total") or 0
    method = str(order.get("payment_method") or "UPI").upper()
    method_label = "Cash on Delivery" if method == "COD" else method
    message = (
        f"{student} ordered {order.get('items') or 'food'} from {shop} — "
        f"{method_label} ₹{total}. Tap Confirm to approve the order."
    )
    try:
        await _db(
            db.create_notification,
            title=f"New order #{token} — confirm",
            message=message,
            order_id=order["id"],
            status=order.get("status"),
            target_role="admin",
            action="confirm_order",
            action_state="pending",
        )
    except Exception as e:
        logger.warning(f"Admin order notification error for {order.get('id')}: {e}")
        return
    _push_admin(
        f"New order #{token} — confirm",
        message,
        tag=f"order-confirm-{order['id']}",
    )


@router.patch("/orders/{order_id}/status")
async def patch_order_status(order_id: str, data: LocalOrderStatusUpdate, _admin: dict = Depends(_require_admin)):
    order = await _db(db.update_order_status, order_id, data.status)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


@router.patch("/orders/{order_id}/cancel")
@router.post("/orders/{order_id}/cancel")
async def cancel_own_order(order_id: str, current_user: dict = Depends(get_current_local_user)):
    """Let a student cancel their own order within its delivery window.

    Accepts both POST (native app) and PATCH (student portal) so old and new
    clients both work. Orders placed inside a delivery window (morning →
    12:30 PM, afternoon → 6:00 PM) are auto-accepted; the student can cancel
    them until the window closes. Once the window closes or the order is
    completed, cancellation is locked.
    """
    order = await _db(db.get_order, order_id)
    is_parent = False
    if not order:
        # Multi-shop parent order — cancel every still-open sub-order + parent.
        order = await _db(db.get_parent_order, order_id)
        is_parent = bool(order)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if not _same_student(current_user, order):
        raise HTTPException(status_code=403, detail="You can only cancel your own orders")

    # The day is split into two delivery windows (morning → 12:30 PM,
    # afternoon → 6:00 PM). Orders placed inside a window are auto-accepted;
    # the student can still cancel them until that window closes. Orders
    # outside the windows (after 6:00 PM) and terminal orders are locked.
    # "Pending" (fresh UTR/UPI order before payment is verified) is cancellable
    # too — most placed orders are in this state, not just Accepted.
    if order["status"] not in CANCELLABLE_STATUSES and order["status"] != "Pending":
        raise HTTPException(
            status_code=400,
            detail="This order can no longer be cancelled.",
        )
    cutoff = slot_cutoff_for(order.get("created_at"))
    if cutoff is None:
        raise HTTPException(
            status_code=400,
            detail="This order was placed outside the delivery windows and can no longer be cancelled.",
        )
    if now_kolkata().time() >= cutoff:
        raise HTTPException(
            status_code=400,
            detail="The cancellation window for this order has closed.",
        )

    elif is_parent:
        updated = await _db(db.cancel_parent_order, order_id)
    else:
        updated = await _db(db.update_order_status, order_id, "Cancelled")

    # Close out any open payment intent (UPI orders create a 'Pending' payment
    # record at checkout) so the admin's payments table never shows a live
    # payment on a cancelled order. Status 'Cancelled' has no side effects on
    # the order itself (unlike 'Failed').
    try:
        payment = await _db(db.get_payment_by_order_id, order_id)
        if payment and payment.get("status") == "Pending":
            await _db(db.update_payment_status, payment["id"], "Cancelled")
    except Exception as e:
        logger.warning(f"Could not mark payment cancelled for order {order_id}: {e}")

    return {
        "message": "Order cancelled — you can place a new order anytime.",
        "order": updated or await _db(db.get_order, order_id),
    }


async def _notify_order_via_sms(order: dict) -> None:
    """Send the new-order SMS to the shopkeeper's phone and a copy to the admin.

    The message ends with "REPLY: YES <token> = CONFIRM | NO <token> = REJECT".
    A real gateway replaces the ``log_sms`` calls in ``send_sms_async``; the
    rest of the flow (webhook → Confirmed) is gateway-independent.

    WhatsApp for UPI orders is NOT fired here — it flips to "paid ✓" only
    once the payment is proven (the ``paid=True`` call on the bank-SMS match
    path below). COD orders have nothing to verify, so their WhatsApp
    notification goes out now.
    """
    try:
        if not order or not order.get("id"):
            return
        message = sms_service.compose_order_sms(order)
        shop = None
        shop = await _db(db.get_shop, order["shop_id"])
        shop_phone = str((shop or {}).get("phone") or "").strip()
        # Admin copy — the first registered admin's phone.
        admins = await _db(db.list_users_by_role, "admin")
        admin_phone = ""
        for a in admins or []:
            p = str((a or {}).get("phone") or "").strip()
            if p:
                admin_phone = p
                break
        if shop_phone:
            await sms_service.send_sms_async(
                shop_phone, message, _sms_log_fn, sub_order_id=order["id"]
            )
        if admin_phone:
            await sms_service.send_sms_async(
                admin_phone,
                f"DETOMSITE: {message.splitlines()[0]} — order is waiting for confirmation.",
                _sms_log_fn,
                sub_order_id=order["id"],
            )
        # WhatsApp the shopkeeper for EVERY new order. UPI is labelled
        # "awaiting payment" here (it flips to "paid ✓" via the bank-SMS /
        # UTR / screenshot verification paths — which dedupe against this row).
        if shop:
            whatsapp_phone = str((shop or {}).get("whatsapp_number") or "").strip() or str((shop or {}).get("phone") or "").strip()
            if whatsapp_phone:
                await _notify_shop_via_whatsapp(order, shop, whatsapp_phone, paid=False)
    except Exception as e:
        logger.warning(f"SMS notify error for order {order.get('id')}: {e}")


async def _whatsapp_link_for_order(order: dict, shop: dict, paid: bool | None = None) -> str:
    """Build the free ``wa.me`` deep-link that sends the order message from the
    admin's number to the shop's WhatsApp. No gateway, no cost — the admin taps
    it and WhatsApp opens with the order pre-filled."""
    from urllib.parse import quote
    from app.services.sms_service import compose_order_wa

    number = str(shop.get("whatsapp_number") or "").strip() or str(shop.get("phone") or "").strip()
    if not number:
        return ""
    digits = "".join(ch for ch in number if ch.isdigit())
    if len(digits) == 10:
        digits = "91" + digits
    text = compose_order_wa(order, paid=paid)
    return f"https://wa.me/{digits}?text={quote(text)}"


async def _notify_shop_via_whatsapp(order: dict, shop: dict, phone: str, paid: bool | None = None) -> None:
    """Notify the shopkeeper of an order on WhatsApp.

    EVERY order is notified at placement (UPI labelled "awaiting payment"). The
    payment-verification paths re-call this with ``paid=True``, which refreshes
    that same row to "paid ✓" — the shopkeeper sees one clean message and the
    money status is never stale.

    Delivery: when a WhatsApp provider is configured (``WA_PROVIDER``), the
    message is sent **automatically** right away — UPI immediately after the
    payment is verified, COD at placement — and the row flips to ``Sent``.
    With no provider it stays a ``Pending`` wa.me link for the admin to tap
    from their own number (zero-cost fallback). Either way the send path is
    best-effort and never raises.
    """
    try:
        from app.services.sms_service import compose_order_wa
        from app.services import whatsapp_service

        message = compose_order_wa(order, paid=paid)
        url = await _whatsapp_link_for_order(order, shop, paid=paid)
        if not url:
            return

        # UPI → auto-send once the payment is proven. COD → nothing to verify,
        # so auto-send at placement.
        auto = (paid is True) or str(order.get("payment_method") or order.get("pay_method") or "").upper() == "COD"
        row_id = None

        # Dedupe: this order must never produce a SECOND WhatsApp message. We
        # match ANY existing row for the order — not just a "Pending" one —
        # because a row that was already auto-sent is "Sent", and looking only
        # for "Pending" meant the later paid-refresh created a fresh row and
        # the shopkeeper got the same order twice. Refreshing the existing row
        # keeps it to exactly one message, with the money status up to date.
        existing = await _db(db.list_whatsapp_logs, 200)
        already_sent = False
        for row in existing or []:
            ref = str(row.get("sub_order_id") or row.get("order_id") or "")
            if ref == str(order["id"]):
                row_id = row.get("id")
                already_sent = str(row.get("status") or "") == "Sent"
                if paid is True:
                    await _db(db.update_whatsapp_message, row["id"], message, url)
                break

        if row_id is None:
            created = await _db(
                db.log_whatsapp,
                sub_order_id=order["id"],
                phone=phone,
                message=message,
                url=url,
                status="Pending",
            )
            row_id = (created or {}).get("id") or row_id

        # Automatic delivery when a gateway is configured — but NEVER re-send to
        # a row that already went out. A second send here is exactly the
        # duplicate "bot message" the shopkeeper kept receiving for one order.
        if auto and row_id and not already_sent and whatsapp_service.provider_configured():
            ok = await asyncio.to_thread(
                whatsapp_service.send_whatsapp, phone, message, None, order["id"]
            )
            if ok:
                await _db(db.mark_whatsapp_sent, row_id)
    except Exception as e:
        logger.warning(f"WhatsApp notify error for order {order.get('id')}: {e}")


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


class LocalIncomingSms(BaseModel):
    """An SMS received on a phone — normally from the shopkeeper/admin replying
    ``YES <token>`` or ``NO <token>`` to confirm/reject an order."""
    # PENTEST FIX: bounded — an SMS is a short message; unbounded text is a
    # memory/DB-bloat write primitive (even behind the agent key).
    phone: str = Field(default="", max_length=30)
    text: str = Field(default="", max_length=2000)


def _extract_utr(text: str) -> str:
    """Pull a UPI transaction reference number out of a bank credit SMS.

    Returns the raw code (uppercased) or ``""`` when nothing is unambiguous —
    an ambiguous extraction must fall through to manual review, never guess.
    """
    from app.services import bank_sms_parser

    return bank_sms_parser.extract_utr(text)


def _extract_amount(text: str) -> float | None:
    """Parse the payment amount out of a bank credit SMS.

    Balance lines are ignored, and when more than one candidate amount is
    present (or none is) ``None`` is returned so the message is treated as
    needing manual review instead of being matched against the wrong order.
    """
    from app.services import bank_sms_parser

    return bank_sms_parser.extract_amount(text)


async def _get_payment_by_utr(utr: str):
    return await _db(db.get_payment_by_utr, utr)


async def _get_order(order_id: str):
    return await _db(db.get_order, order_id)


async def _bank_sms_seen(utr: str) -> bool:
    """Did a bank credit SMS containing this UTR already arrive? """
    return bool(await _db(db.bank_sms_seen, utr))


# NOTE: the UTR verification method — the bank-SMS credit check + same-amount
# matching that lived in ``_confirm_order_via_utr`` — was removed from the
# portal payment flow. Payments recorded here are settled manually by the
# admin (Admin Center → Payments); only the agent-gated ``/sms/match`` route
# below can still auto-confirm, and it is covered by its own tests.


class LocalPaymentUtr(BaseModel):
    order_id: str = Field(..., max_length=100)
    utr_number: str = Field(..., min_length=6, max_length=40)


def _is_valid_utr(utr: str) -> bool:
    """True only for a plausible ASCII UPI reference.

    PENTEST FIX: the original check was ``utr.isalnum()``, which is Unicode-aware
    and therefore accepts Cyrillic look-alikes ("АВСDЕF"), circled digits
    ("①②③④⑤⑥") and precomposed accented letters. Each of those renders
    identically to the ASCII reference a student actually paid with but compares
    as a DIFFERENT string, so one real bank UTR could be filed twice under two
    spellings — defeating the "one UTR = one payment" replay guard and letting
    the same payment settle two orders.

    A UPI UTR is plain ASCII (12 digits for the reference format), so the
    character class is ASCII digits and ASCII letters only. Whitespace is
    already stripped by the caller before upper-casing.
    """
    if not 6 <= len(utr) <= 40:
        return False
    return all(c in "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ" for c in utr)


class LocalPaymentClaimConfirm(BaseModel):
    """Student-side "I have paid" confirmation for a QR checkout.

    The automatic path is the shop's SMS agent matching the bank credit. When
    that agent is not installed, misconfigured, or its SMS never arrives, the
    student had no way forward at all: the button stayed locked on a payment
    they had genuinely made. This gives them one — they type the UTR their UPI
    app shows, which turns the unverifiable tier-2 amount match into an exact
    tier-1 UTR claim.
    """

    utr_number: str = Field(..., max_length=40)


@router.post("/orders/{order_id}/confirm-payment")
async def confirm_own_payment(
    order_id: str,
    data: LocalPaymentClaimConfirm,
    current_user: dict = Depends(get_current_local_user),
):
    """Attach the student's UTR to their own pending order and re-arm matching.

    This does NOT mark the order paid — that still requires bank evidence
    (``/sms/match``). What it does is give the matcher something exact to
    match: once a UTR is on file, an incoming credit carrying that same
    reference settles the order through tier 1 instead of the amount-only tier
    2, so the student is no longer dependent on being the only person at that
    shop with an open bill of the same value.
    """
    if not rate_allow(
        "claim_payment", f"{current_user.get('id')}:{order_id}", max_attempts=10, window_sec=600
    ):
        raise HTTPException(
            status_code=429, detail="Too many attempts — please wait a few minutes and try again."
        )

    order, _is_parent = await _resolve_owned_order(order_id, current_user)

    utr = (data.utr_number or "").strip().upper()
    if not _is_valid_utr(utr):
        raise HTTPException(
            status_code=422,
            detail="That doesn't look like a UTR — it is usually a 12-digit number with no spaces or symbols.",
        )

    if str(order.get("payment_method") or "").upper() not in ("UPI", "MANUAL UTR"):
        raise HTTPException(
            status_code=400, detail="This is not a prepaid order — nothing to confirm."
        )
    if str(order.get("status") or "") not in _AWAITING_PAYMENT_STATUSES:
        raise HTTPException(
            status_code=409, detail="This order is no longer awaiting payment."
        )

    server_total = int(round(float(order.get("total") or 0)))

    # One UTR = one payment. A reference already filed against a DIFFERENT
    # order is refused, so a student cannot park the same UTR on two baskets.
    existing = await _db(db.get_payment_by_utr, utr)
    if existing and str(existing.get("order_id") or "") != str(order_id):
        raise HTTPException(
            status_code=409,
            detail="This UTR is already saved on another order — please double-check the number.",
        )

    payment = await _db(db.set_payment_utr, order_id, utr)
    if not payment:
        payment = await _db(db.create_payment, order_id, server_total, "Manual UTR", utr)
    if not payment:
        raise HTTPException(
            status_code=400, detail="Could not save the reference — please try again."
        )

    _push_admin(
        "Payment reference submitted",
        f"Order #{order.get('token')} — the student submitted UTR {utr} for ₹{server_total}.",
        tag="payment-verify",
    )
    return {
        "message": (
            "Reference saved. Your order unlocks as soon as the shop's payment "
            "confirmation reaches us — this usually takes a few seconds."
        ),
        "order_id": order_id,
        "utr_saved": True,
    }


@router.post("/payments/utr")
async def submit_payment_utr(data: LocalPaymentUtr, request: Request, current_user: dict = Depends(get_current_local_user)):
    """Optional: the student may paste the UPI transaction UTR after paying.

    The UTR verification method (bank-SMS credit check + same-amount
    matching) was removed: this endpoint only STORES the reference against
    the order's payment record so the admin can review it in Admin Center →
    Payments. If the checkout failed to create the payment row (the old
    "record didn't save" bug), this endpoint creates it on the spot from the
    SERVER-side order total — a UTR paste always saves.
    """
    # PENTEST FIX: bound UTR submissions per student+IP — every call writes to
    # (or probes) the payment record, so it must not be an unthrottled write
    # primitive. 12 per 5 minutes is far beyond any real retry pattern.
    if not rate_allow("utr", f"{current_user.get('id')}:{rate_ip(request)}", max_attempts=12, window_sec=300):
        raise HTTPException(status_code=429, detail="Too many UTR attempts — please wait a few minutes and try again.")

    # PENTEST FIX: a UTR is an alphanumeric reference (UPI UTRs are 12 digits).
    # Reject anything else BEFORE touching the order so junk/symbol-laden input
    # never reaches a query, and the student gets a message they can act on.
    #
    # PENTEST FIX 2: ``str.isalnum()`` is Unicode-aware, so it happily accepts
    # Cyrillic look-alikes ("АВСDЕF"), circled digits ("①②③") and precomposed
    # accented letters. Those are visually identical to the ASCII UTR a student
    # actually paid with, yet compare as a DIFFERENT string — so the same real
    # bank reference could be filed twice under two spellings and defeat the
    # "one UTR = one payment" replay guard. A UTR is ASCII, so require that.
    utr = (data.utr_number or "").strip().upper()
    if not _is_valid_utr(utr):
        raise HTTPException(
            status_code=422,
            detail="That doesn't look like a UTR — it is usually a 12-digit number with no spaces or symbols.",
        )

    # Resolve across single orders AND multi-shop parent orders — the multi
    # checkout pays one bill whose payment row lives on the parent, so the old
    # orders-only lookup made every parent UTR save 404 ("Order not found").
    order, is_parent = await _resolve_owned_order(data.order_id, current_user)

    # PENTEST FIX: a reference is only meaningful while the order still awaits
    # payment — pasting a UTR onto a cancelled / delivered / settled order just
    # pollutes the admin's verify queue with proof for food never owed. Admins
    # (the tools manager) may still annotate any order.
    if current_user.get("role") != "admin" and str(order.get("status") or "") not in _AWAITING_PAYMENT_STATUSES:
        raise HTTPException(status_code=409, detail="This order is no longer awaiting payment — nothing left to verify.")

    server_total = int(round(float(order.get("total") or 0)))

    # One UTR = one payment: both databases enforce a unique index on
    # payments.utr_number. Pre-check so a re-used reference gets a FRIENDLY
    # 409 instead of the raw 500 crash students saw as "it didn't save".
    existing = await _db(db.get_payment_by_utr, utr)
    if existing and str(existing.get("order_id") or "") != str(data.order_id):
        raise HTTPException(
            status_code=409,
            detail="This UTR is already saved on another order — double-check the number, or contact support with your token.",
        )

    payment = await _db(db.set_payment_utr, data.order_id, utr)
    if not payment:
        if is_parent:
            payment = await _db(
                db.record_parent_payment, data.order_id, server_total, "Manual UTR", utr
            )
        else:
            payment = await _db(
                db.create_payment, data.order_id, server_total, "Manual UTR", utr
            )
    if not payment:
        raise HTTPException(status_code=400, detail="Could not save the UTR for this order — please try again.")

    # UTR verification (bank-SMS credit check + same-amount matching) was
    # removed from the portal flow: a saved UTR is only a reference for the
    # admin to review in Admin Center → Payments.
    return {
        "message": "UTR saved — the admin will verify your payment shortly.",
        "payment": payment,
        "order": None,
    }


@router.post("/sms/incoming")
async def sms_incoming(data: LocalIncomingSms, request: Request, x_agent_key: Optional[str] = Header(None)):
    """Receive an inbound SMS reply and act on it.

    Two flows are supported, and they settle DIFFERENT things on purpose:

    1. **Payment settle (bank SMS):** when the SMS contains a UTR that matches a
       student-entered UTR on a pending payment, the order is marked
       **Completed** automatically — the money is provably in the shop's bank
       and the student has paid, so there is nothing left to prepare.
    2. **Shop acceptance (plain phone):** ``YES <token>`` / ``NO <token>``
       (case-insensitive) sets the order to **Confirmed** or **Cancelled**.
       Tokens are printed in the order SMS, so the shopkeeper can accept from
       their plain phone. This is an *acceptance*, not a payment: a shopkeeper
       accepting an unpaid order must not mark it paid, which is why it stays
       ``Confirmed`` and why a "Pending Payment" order is refused here.
    """
    # Agent auth: fail closed (see ``_require_agent_key``). With no key
    # configured the endpoint refuses to run instead of letting any anonymous
    # caller inject "YES <token>" / a fake bank UTR and confirm an order.
    #
    # PENTEST FIX (auth ordering). This check used to sit BELOW the "no SMS text"
    # validation, so an anonymous caller reached handler code before the key was
    # ever examined and got a 400 describing the endpoint's behaviour instead of
    # a 401. No state changed — but authentication must be the FIRST thing a
    # handler does, so that an unauthenticated caller learns nothing at all and
    # cannot spend the handler's work before being rejected. It also keeps the
    # brute-force budget meaningful: every unauthenticated attempt is a key
    # attempt, not a free probe.
    _require_agent_key(x_agent_key, request)

    text = (data.text or "").strip()
    phone = (data.phone or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="No SMS text provided")

    report = {"received": True, "phone": phone, "text": text, "order": None}

    # All bank proofs use the same strict UTR + shop + amount match.
    utr = _extract_utr(text)
    amount = _extract_amount(text)
    if utr and amount is not None:
        # Already past the agent gate above — go straight to the matching core
        # instead of re-entering the HTTP-level key check.
        result = await _sms_match_core(LocalSmsMatch(phone=phone, utr=utr, amount=amount))
        report["order"] = await _get_order(result["order_id"])
        report["matched"] = result
        return report
    # Bank text must not fall through to YES/NO commands (e.g. "Ref No").
    if not re.fullmatch(r"(?i)(?:yes|y|confirm|accept|ok|no|n|reject|decline|cancel)\s+#?\d+", text):
        raise HTTPException(status_code=400, detail="Unrecognised or ambiguous SMS; manual review required")

    # Flow 2 — "YES 123" / "NO 123" — token may carry a leading #.
    lowered = text.lower().replace("#", " ")
    words = lowered.split()
    action = None
    token = ""
    for i, w in enumerate(words):
        if w in ("yes", "y", "confirm", "accept", "ok"):
            action = "Confirmed"
            if i + 1 < len(words):
                token = words[i + 1]
            break
        if w in ("no", "n", "reject", "decline", "cancel"):
            action = "Cancelled"
            if i + 1 < len(words):
                token = words[i + 1]
            break
    if not action:
        await _log_sms_inbound("", phone, "", "Unknown")
        raise HTTPException(status_code=400, detail="Unrecognised SMS — send a UTR to auto-confirm, or reply YES <token> / NO <token>.")

    # Tokens repeat across shops: scope to one unambiguous sender/shop.
    shop = await _db(db.get_shop_by_phone, phone)
    orders = await _db(db.list_orders_by_shop, shop["id"]) if shop else []
    candidates = [o for o in orders if str(o.get("token")) == token
                  and o.get("status") in ("Pending", "Placed", "Pending Payment")]
    order = candidates[0] if len(candidates) == 1 else None
    if not order:
        await _log_sms_inbound("", phone, f"token:{token or '?'}", "No Match")
        raise HTTPException(status_code=404, detail=f"No order with token #{token} found.")

    if action == "Confirmed" and order.get("status") == "Pending Payment":
        raise HTTPException(status_code=409, detail="Payment must be verified before confirmation")
    if action == "Confirmed":
        updated = await _db(db.update_order_status, order["id"], "Confirmed")
        # The admin watches the pipeline too — bell them when a shop
        # confirms an order over SMS (shop + admin both have the app).
        try:
            await _db(
                db.create_notification,
                title="Order confirmed via SMS",
                message=f"Token #{token} confirmed — {order.get('shop_name', 'a shop')} accepted the order.",
                order_id=order["id"],
                status="Confirmed",
                target_role="admin",
            )
        except Exception as e:
            logger.warning(f"Admin SMS-confirm notification error: {e}")
        _push_admin(
            "Order confirmed via SMS",
            f"Token #{token} confirmed — {order.get('shop_name', 'a shop')} accepted the order.",
            tag="order-confirm",
        )
        if not updated:
            raise HTTPException(status_code=400, detail="Could not confirm the order.")
    else:
        updated = await _db(db.update_order_status, order["id"], "Cancelled")
        if not updated:
            raise HTTPException(status_code=400, detail="Could not cancel the order.")

    # Log the inbound reply and the confirmation SMS to the student.
    await _log_sms_inbound(order["id"], phone, f"{action} #{token}", "Processed")
    try:
        student_phone = str(order.get("student_phone") or "").strip()
        if student_phone and action == "Confirmed":
            await sms_service.send_sms_async(
                student_phone,
                sms_service.compose_confirmation_sms(order),
                _sms_log_fn,
                sub_order_id=order["id"],
            )
    except Exception as e:
        logger.warning(f"SMS confirmation log error: {e}")

    report["order"] = updated or order
    return report


class LocalSmsMatch(BaseModel):
    """Privacy-first payment proof: only the UTR + amount extracted on-device.

    The raw bank SMS text never touches this server. The Android agent reads the
    SMS on the shopkeeper's phone, pulls out the UTR and credited amount locally,
    and sends only these two fields plus the receiving phone number.

    ``utr`` is OPTIONAL. The QR checkout deliberately never asks the student to
    type a reference — they scan and pay — so the agent has nothing to claim for
    the majority of orders, and most bank credit SMS carry no reference either
    ("Rs 80 credited to your a/c ending 1234"). Tier 2 below exists to settle
    exactly those orders on amount + shop + recency. Requiring a UTR here made
    that tier unreachable and silently dropped every QR payment, so the field is
    now genuinely optional: empty means "no claim, match on the credit itself".
    """
    phone: str = Field(default="", max_length=30)
    # Empty is allowed (QR / no-claim case). When present it must still look
    # like a real reference — the ASCII check in _sms_match_core is the guard
    # that stops a look-alike UTR from defeating the one-UTR-one-payment rule.
    utr: str = Field(default="", max_length=30, pattern=r"^[A-Za-z0-9]*$")
    amount: float = Field(..., gt=0, allow_inf_nan=False)


@router.post("/sms/match")
async def sms_match(data: LocalSmsMatch, request: Request, x_agent_key: Optional[str] = Header(None)):
    """Privacy-first auto-confirm: the shop's Android agent extracts the UTR
    and amount **on-device** and sends only the minimal proof here — the raw
    bank SMS text never leaves the phone.

    This is the website↔bot join: an order placed in the student portal is
    settled here the moment the shop's bank credits the money, and the result
    is reflected in both the student and the admin portal (see
    ``_sms_match_core`` for the two matching tiers and the fail-closed rules).
    """
    # Agent auth: fail closed. Only the Android agent (which holds the shared
    # key) may submit bank SMS — an unset key must NOT mean "everyone is the
    # agent", because this endpoint can mark an order paid.
    _require_agent_key(x_agent_key, request)
    # Bound how many orders ONE agent key may settle in an hour. The shared key
    # lives in a phone's SharedPreferences and is pasted into every shop's
    # device, so a leaked copy would otherwise be an unlimited "mark any order
    # paid" primitive. A real shop never settles 60 orders an hour, and the
    # budget is per shop, so a busy campus does not lock itself out.
    if not rate_allow(
        "bank_match", str(data.phone or "")[-10:], max_attempts=60, window_sec=3600
    ):
        raise HTTPException(
            status_code=429,
            detail="Too many payment matches from this shop — please try again in a little while.",
        )
    return await _sms_match_core(data)


async def _sms_match_core(data: LocalSmsMatch) -> dict:
    """Shared matching logic behind ``/sms/match``.

    This is the bridge between the website and the phone bot: an order is
    created on the portal, the student pays the UPI QR, the shop's bank credits
    the money, the Android agent forwards the credit — and the order flips to
    **Completed** here so the student and admin portals both see it paid.

    It matches in two tiers, strongest evidence first, and fails closed
    whenever the evidence is ambiguous:

    **Tier 1 — the UTR claim.** Exactly one payment row carries this UTR, it
    belongs to an order at *this* shop, and both the order total and the
    payment amount equal the credited amount. Strongest proof: the student told
    us the reference and the bank confirmed the same reference.

    **Tier 2 — the credit itself.** No UTR was claimed (the checkout QR flow
    never asks the student to type one, so most orders land here). The credit
    is matched against this shop's *unpaid* UPI orders by amount, and accepted
    only when exactly ONE such order exists, it is recent
    (``BANK_MATCH_WINDOW_MINUTES``) and its payment row is still open. The bank
    UTR is then stamped onto that row, so the same credit can never settle a
    second order.

    Anything else — no match, two possible orders, a COD order, another shop,
    an already-settled payment, a stale order — is refused with 409 and left
    for the admin. Amount alone never picks a customer out of a crowd.
    """
    utr = (data.utr or "").strip().upper()
    # An empty UTR is now LEGAL and means "no claim" — the QR-checkout case the
    # student pays by scanning, where there is no reference to claim. Tier 2
    # below settles those on amount + shop + recency. Only a UTR that is present
    # but malformed is refused.
    #
    # PENTEST FIX: the bank agent must send a plain ASCII reference. Without this
    # a Unicode look-alike UTR could reach the replay comparison below and match
    # — or fail to match — a stored reference purely on look-alike characters,
    # which is exactly the confusion the replay guard exists to prevent.
    if utr and not _is_valid_utr(utr):
        raise HTTPException(status_code=422, detail="UTR is not a valid reference")
    amount = data.amount
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be > 0")

    try:
        shop = None
        shop = await _db(db.get_shop_by_phone, data.phone)
        if not shop:
            raise HTTPException(status_code=404, detail="No shop found matching this phone number")

        orders = await _db(db.list_orders_by_shop, shop["id"])
        payments = await _db(db.list_payments) or []
        # One pass builds the order→payment index tier 2 needs, so a same-amount
        # credit never costs N extra round-trips to the database.
        #
        # BUG FIX: ``list_payments()`` returns rows NEWEST-FIRST (both stores
        # order by created_at DESC / rowid DESC). A plain dict comprehension lets
        # the LAST assignment win, which silently kept the OLDEST payment row for
        # an order — disagreeing with ``get_payment_by_order_id``, which takes the
        # newest. An order carrying two payment rows (a retried checkout, or one
        # that was cancelled and re-recorded) was therefore judged on a dead
        # payment intent: a stale "Cancelled" row made the bot refuse a
        # legitimate payment, and a stale "Pending" row could let it settle one
        # that was already closed. ``setdefault`` keeps the FIRST row seen — the
        # newest — matching the rest of the codebase.
        payment_by_order: dict[str, dict] = {}
        for p in payments:
            row_order_id = str(p.get("order_id") or "")
            if row_order_id:
                payment_by_order.setdefault(row_order_id, p)
        # A claim only exists when the agent actually sent a reference. Without
        # this guard an empty ``utr`` would equal the empty ``utr_number`` of
        # every QR order (checkout records ``utr_number: ""``), so ``claims``
        # would collect ALL of them and the first one would be settled as if the
        # student had claimed it — settling an arbitrary customer's order. An
        # absent reference must fall through to tier 2, never impersonate a claim.
        claims = [
            p for p in payments
            if utr and str(p.get("utr_number") or "").strip().upper() == utr
        ]

        payment = None
        order = None
        if len(claims) == 1:
            # ── Tier 1: a student-claimed UTR ──
            payment = claims[0]
            order = next((o for o in orders if o["id"] == payment.get("order_id")), None)
            if payment.get("status") == "Success":
                raise HTTPException(
                    status_code=409,
                    detail="This payment is already settled — nothing left to verify.",
                )
            if (not order or order.get("status") != "Pending Payment"
                    or str(order.get("payment_method") or "").upper() not in ("UPI", "MANUAL UTR")
                    or abs(float(order.get("total") or 0) - amount) >= 0.01
                    or abs(float(payment.get("amount") or 0) - amount) >= 0.01):
                raise HTTPException(status_code=409, detail="Payment proof does not match this shop's pending UPI order")
        elif len(claims) > 1:
            # The same reference was claimed on more than one order — exactly the
            # "which customer paid?" case we must never guess at.
            raise HTTPException(
                status_code=409,
                detail="Payment needs review: this UTR is claimed on more than one order",
            )
        else:
            # ── Tier 2: match the credit against this shop's open UPI orders ──
            candidates = []
            for candidate in orders:
                if str(candidate.get("status") or "") not in BANK_SETTLEABLE_STATUSES:
                    continue
                if str(candidate.get("payment_method") or "").upper() not in ("UPI", "MANUAL UTR"):
                    continue
                if abs(float(candidate.get("total") or 0) - amount) >= 0.01:
                    continue
                row = payment_by_order.get(str(candidate.get("id") or ""))
                # The order must actually have been presented for payment…
                if not row:
                    continue
                # …and that payment must still be open (a settled or dead
                # payment means the order is already handled or cancelled).
                if str(row.get("status") or "") in ("Success", "Cancelled", "Failed", "Rejected"):
                    continue
                if abs(float(row.get("amount") or 0) - amount) >= 0.01:
                    continue
                # Only a *recent* order may be settled this way, so a stale
                # same-amount row can't be picked up by today's credit.
                age = _order_age_minutes(candidate)
                if age is None or age > BANK_MATCH_WINDOW_MINUTES or age < -5:
                    continue
                candidates.append((candidate, row))

            if not candidates:
                raise HTTPException(
                    status_code=409,
                    detail="Payment needs review: no unpaid order at this shop matches the credited amount",
                )
            if len(candidates) > 1:
                # Several same-amount orders can only be an ambiguity BETWEEN
                # CUSTOMERS if they belong to different people — and that must
                # still go to manual review, because amount alone can never pick
                # out one customer's order from a crowd.
                #
                # But when every candidate belongs to the SAME account, picking
                # the wrong one cannot hurt anyone else: it is one student's own
                # duplicated draft for one basket, and settling any of them pays
                # the student for exactly what they paid. This is the case the
                # retried checkout POST used to create — a timed-out order
                # request replayed into a second identical order, after which the
                # bank credit matched NEITHER and the student, having paid, was
                # locked out of "Place Order" forever. Collapse to the newest
                # (the live one) and close the superseded duplicates.
                owners = {str((c[0].get("owner_user_id") or "")).strip() for c in candidates}
                if len(owners) == 1 and "" not in owners:
                    # Newest wins. ``created_at`` alone is NOT enough: two drafts
                    # replayed seconds apart share the same timestamp string, so
                    # the sort was a no-op and the tie was broken by whatever
                    # order the shop query happened to return — which settled
                    # the STALE draft and left the live one pending. The daily
                    # token is monotonic, so it is the reliable tiebreak.
                    def _age_key(pair):
                        row = pair[0]
                        try:
                            token = int(row.get("token") or 0)
                        except (TypeError, ValueError):
                            token = 0
                        return (str(row.get("created_at") or ""), token)

                    candidates.sort(key=_age_key)
                    keeper, keeper_row = candidates[-1]
                    for stale, stale_row in candidates[:-1]:
                        # Mark the superseded draft dead so it can never be
                        # picked up by a LATER credit at this shop either.
                        try:
                            if str(stale_row.get("status") or "") not in ("Success", "Cancelled", "Failed", "Rejected"):
                                await _db(db.update_payment_status, stale_row["id"], "Cancelled")
                            if str(stale.get("status") or "") in BANK_SETTLEABLE_STATUSES:
                                await _db(db.update_order_status, stale["id"], "Cancelled")
                        except Exception as e:
                            logger.warning(f"Could not close superseded draft {stale.get('id')}: {e}")
                    logger.info(
                        f"sms/match: collapsed {len(candidates)} same-owner drafts at shop "
                        f"{shop.get('id')} to the live order {keeper.get('id')}"
                    )
                    candidates = [(keeper, keeper_row)]
            if len(candidates) > 1:
                raise HTTPException(
                    status_code=409,
                    detail="Payment needs review: more than one unpaid order matches this credit — settle it manually",
                )
            order, payment = candidates[0]
            # Burn the credit so the SAME SMS can never settle a second order.
            #
            # With a UTR this stamps it on the row, and the unique index on
            # payments.utr_number makes a re-match 409. With NO UTR there is
            # nothing to stamp, so uniqueness has to come from somewhere else:
            # we mint a synthetic, obviously-fake marker recording THAT this
            # amount was already consumed at this shop. A replayed credit SMS
            # then finds the order already settled and stops at the tier-2
            # status check, instead of paying out a second time. Without this a
            # student could re-scan the same bank SMS and drain the queue.
            burn_ref = utr or f"SMS-{shop['id']}-{order['id']}"
            stamped = await _db(db.set_payment_utr, order["id"], burn_ref)
            if stamped:
                payment = stamped

        await _db(db.update_payment_status, payment["id"], "Success")

        # RELEASE POINT: a prepaid order was held back from the shop at creation
        # time, so the bank credit matching here is the moment the shop finally
        # hears about it. Without this the student would have paid for an order
        # the kitchen never knew existed.
        await _notify_shop_of_paid_order(order)

        # The order is settled the moment the bank evidence matches, so it goes
        # straight to Completed — the student has paid and the platform has
        # confirmed it, so there is no prep/ready state left to walk through.
        await _db(db.update_order_status, order["id"], "Completed")

        # The audit line and the notifications read "no reference" instead of an
        # empty "UTR:" when the credit carried none, so the shopkeeper's log and
        # the student's message don't look like a broken record.
        proof_label = f"UTR {utr}" if utr else "QR payment (no reference)"
        await _log_sms_inbound(
            order["id"],
            data.phone,
            f"{proof_label} Amt:{int(order.get('total', 0))} -> Completed (bank SMS match)",
            "Auto-Confirmed",
        )

        # Student + admin notifications. The order is COMPLETED (paid + settled),
        # so the notification says so — a student told "Confirmed" on a finished
        # order has no idea whether to wait or collect.
        try:
            await _db(
                db.create_notification,
                title="Payment verified — order confirmed",
                message=f"{proof_label} — ₹{order.get('total')} credit confirmed. Order #{order.get('token')} is complete.",
                order_id=order["id"],
                status="Completed",
                target_role="student",
            )
            await _db(
                db.create_notification,
                title="Payment verified — order confirmed",
                message=f"{proof_label} — ₹{order.get('total')} credit confirmed. Order #{order.get('token')} is complete.",
                order_id=order["id"],
                status="Completed",
                target_role="admin",
            )
        except Exception as e:
            logger.warning(f"sms/match notification error: {e}")
        _push_admin(
            "Order paid & confirmed via bank UTR" if utr else "Order paid & confirmed via QR payment",
            f"{proof_label} — ₹{order.get('total')} credit confirmed. Token #{order.get('token')} completed.",
            tag="order-confirm",
        )

        # WhatsApp fire.
        try:
            wa_phone = str((shop.get("whatsapp_number") or "")).strip() or str((shop.get("phone") or "")).strip()
            if wa_phone:
                await _notify_shop_via_whatsapp(order, shop, wa_phone, paid=True)
        except Exception as e:
            logger.warning(f"sms/match WhatsApp error for {order.get('id')}: {e}")

        return {
            "matched": True,
            "utr": utr,
            "amount": int(amount),
            "shop": shop.get("id"),
            "order_id": order["id"],
            "order_status": "Completed",
            # Which tier settled it — shown in the agent log so a shopkeeper can
            # see whether the student typed the UTR or the credit was matched.
            "matched_by": "utr_claim" if len(claims) == 1 else "bank_credit",
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"sms/match error: {e}")
        raise HTTPException(status_code=500, detail="Internal error")


def _dialable_whatsapp_number(raw: Any) -> str:
    """Can this shop number actually be dialled as an Indian mobile?

    Mirrors the normalisation the on-phone bot performs before it opens
    WhatsApp, so the two agree on what is deliverable. Without this the server
    would happily claim a row the bot then refuses to open — marking a real
    order message in-flight forever.

    Returns the dialled form (country code + number) or "" when unusable.
    """
    digits = "".join(ch for ch in str(raw or "") if ch.isdigit())
    if len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]          # domestic trunk prefix
    if len(digits) == 10:
        return "91" + digits
    if len(digits) == 12 and digits.startswith("91"):
        return digits
    return ""


@router.get("/whatsapp/pending")
async def whatsapp_pending_agent(request: Request, x_agent_key: Optional[str] = Header(None)):
    """Pending WhatsApp notifications for the on-phone auto-send bot (same
    ``X-Agent-Key`` as the SMS agent).

    Returns rows that are already **ready to deliver** — COD messages and
    paid-verified UPI messages. Drafts still labelled "awaiting payment" are
    skipped so the bot waits for the payment verification to refresh them to
    "paid ✓" and then sends exactly ONE clean message (never a stale
    "awaiting payment" followed by a final one).

    Exactly ONE message is returned per request, and only that one is claimed.
    The bot sends a single message per poll cycle because the outbox it fills
    is one slot; handing it a batch would claim messages it never opens. One
    per request means a multi-shop order walks shop by shop and nothing is
    marked in-flight unless it is really being sent.
    """
    # Agent auth: fail closed — this feed carries customer phone numbers and
    # order messages, so an anonymous caller must never be able to read it.
    _require_agent_key(x_agent_key, request)

    # PENTEST FIX — THIS ENDPOINT NOW WRITES, SO IT MUST BE THROTTLED.
    #
    # Claiming a message is a STATE CHANGE (it marks the row 'Sending'), which
    # makes this the only agent route that mutates the queue. That matters: the
    # agent key is a single shared secret pasted into EVERY shop's phone, so one
    # leaked copy — or one buggy/replayed client — could otherwise poll this in a
    # loop, claim every queued order message, and never send any of them. Each
    # claim then blocks its message for the staleness window, so the real bot
    # would find the queue empty and every shop on campus would silently stop
    # hearing about new orders. A cheap, permanent denial of the whole
    # notification system.
    #
    # The genuine bot polls once every 20 s (3/min), so 30/min per client leaves
    # an order of magnitude of headroom for retries while making queue-draining
    # pointless.
    if not rate_allow(
        "wa_pending", rate_ip(request), max_attempts=30, window_sec=60
    ):
        raise HTTPException(
            status_code=429,
            detail="Too many queue polls — slow down.",
        )

    logs = await _db(db.list_whatsapp_logs, 100)
    # Two filters, both about not messaging the shop more than necessary:
    #   * "Sent" is already delivered.
    #   * "awaiting payment" is a UPI draft — the bot waits for the verified
    #     "paid ✓" version rather than sending a message it would have to
    #     correct. The claim below therefore never touches these rows, so they
    #     stay claimable once the payment lands.
    candidates = []
    for log in logs or []:
        if str(log.get("status") or "").lower() == "sent":
            continue
        message = str(log.get("message") or "").strip()
        if "awaiting payment" in message.lower():
            continue
        # Skip rows the bot physically cannot deliver, BEFORE they can become the
        # claimed target. The bot filters these out itself (it needs a normalisable
        # number), so claiming one here would mark it in-flight, send nothing, and
        # leave it rotating through the staleness window forever — a poison row
        # that can never be cleared and keeps re-entering the queue.
        if not _dialable_whatsapp_number(log.get("phone")):
            logger.warning(
                "Skipping WhatsApp row %s: no usable number (%r)",
                log.get("id"), log.get("phone"),
            )
            continue
        candidates.append(log)

    # CLAIM BEFORE HANDING THEM OVER. This is what makes "one message per
    # order" durable.
    #
    # The bot's own duplicate guard is in-memory, so it is lost whenever the
    # service restarts. If it delivered a message but its mark-sent POST failed
    # (a network blip, or the process died first), the row stayed Pending and
    # was handed straight back on the next poll — the shopkeeper got the same
    # order again and again. Claiming flips each row to 'Sending' with a
    # timestamp, so a re-poll skips it.
    #
    # A row stuck in 'Sending' becomes eligible again after the staleness
    # window, so a bot killed mid-send still results in delivery — it just can
    # never be re-sent instantly.
    # HAND OVER EXACTLY ONE DELIVERABLE MESSAGE, AND CLAIM ONLY THAT ONE.
    #
    # The on-phone bot deliberately sends ONE message per poll cycle: the outbox
    # it fills is a single slot, so opening several WhatsApp chats back to back
    # meant only the last one ever reached the screen.
    #
    # So the queue is claimed ONE AT A TIME — claiming a batch marks rows the bot
    # never opens, and they then sit out the staleness window. `claim_next`
    # picks the newest row that is genuinely CLAIMABLE inside the SQL, so a row
    # already in flight can never block the deliverable messages behind it.
    if not candidates:
        return []
    row = await _db(
        db.claim_next_whatsapp_log, [c.get("id") for c in candidates if c.get("id")], 5
    )
    if not row:
        # Nothing claimable this cycle (a concurrent poller won the race).
        # The bot simply tries again shortly.
        return []
    return [
        {
            "id": row.get("id"),
            "sub_order_id": row.get("sub_order_id") or row.get("order_id") or "",
            "phone": str(row.get("phone") or "").strip(),
            "message": str(row.get("message") or "").strip(),
        }
    ]


@router.post("/whatsapp/{whatsapp_id}/mark-sent")
async def whatsapp_mark_sent_agent(whatsapp_id: str, request: Request, x_agent_key: Optional[str] = Header(None)):
    """Mark a WhatsApp notification as sent once the phone bot delivered it."""
    _require_agent_key(x_agent_key, request)
    doc = await _db(db.mark_whatsapp_sent, whatsapp_id)
    if not doc:
        raise HTTPException(status_code=404, detail="WhatsApp notification not found")
    return doc


@router.get("/sms-logs")
async def sms_logs(limit: int = 100, _admin: dict = Depends(_require_admin)):
    """Admin view of all SMS messages (out-bound orders + inbound replies)."""
    return await _db(db.list_sms_logs, limit)


@router.get("/payments")
async def payments(_admin: dict = Depends(_require_admin)):
    """Payment records (with bank UTRs) are admin-only — students never read them."""
    return await _cached_read(10, "payments", db.list_payments)


@router.post("/payments")
async def add_payment(data: LocalPaymentCreate, request: Request, current_user: dict = Depends(get_current_local_user)):
    # PENTEST FIX: bound payment submissions per student+IP — every call writes
    # a row AND rings the admin's phone (push at the bottom of this handler), so
    # an unthrottled loop is both a DB-spam and an admin push-flood primitive.
    # 20 per 5 minutes is far beyond any real checkout (one call per shop).
    if not rate_allow("payment", f"{current_user.get('id')}:{rate_ip(request)}", max_attempts=20, window_sec=300):
        raise HTTPException(status_code=429, detail="Too many payment submissions — please wait a few minutes and try again.")

    # PENTEST FIX: same UTR hygiene as /payments/utr — a UTR is an alphanumeric
    # reference (UPI UTRs are 12 digits); reject junk BEFORE touching the order
    # so symbol-laden input never reaches a query or a stored row. ASCII-only
    # (see _is_valid_utr) so Unicode look-alikes cannot file one bank
    # reference twice under two spellings.
    utr_claim = (data.utr_number or "").strip().upper()
    if utr_claim and not _is_valid_utr(utr_claim):
        raise HTTPException(
            status_code=422,
            detail="That doesn't look like a UTR — it is usually a 12-digit number with no spaces or symbols.",
        )

    # Resolve the target across single orders AND multi-shop parent orders — a
    # multi order's id lives in `parent_orders`, not `orders`, so the old
    # orders-only lookup made every UPI/UTR payment for the student's multi
    # cart 404 ("Order not found").
    order, is_parent = await _resolve_owned_order(data.order_id, current_user)

    # ─── Server-authoritative amount ───
    # The amount is recorded from the STORED order total, never from the request
    # body: a student could otherwise declare ₹1 against a ₹500 order, and every
    # downstream "does the bank credit match?" check would compare against that
    # ₹1. A price change between add-to-cart and checkout only means the
    # recorded amount (and therefore the amount the bank SMS must match) follows
    # the real bill.
    server_total = int(round(float(order.get("total") or 0)))
    if server_total > 0 and int(data.amount) != server_total:
        logger.warning(
            "Payment amount override for order %s: client=%s server=%s (user=%s)",
            data.order_id, data.amount, server_total, current_user.get("id"),
        )
        data.amount = server_total
    # A student may only record payment for an order they own.
    if current_user.get("role") != "admin" and not _same_student(current_user, order):
        raise HTTPException(status_code=403, detail="You can only pay for your own orders")
    if data.method == "Manual UTR":
        if is_parent:
            # Multi-shop: the student pays ONE bill to the platform UPI id
            # (the one shown at checkout). No per-shop UTR token exists yet.
            payment_settings = await _db(db.get_payment_settings)
            if not payment_settings["manual_enabled"] or not payment_settings["upi_id"]:
                raise HTTPException(status_code=400, detail="No UPI payment configured for this order")
        else:
            # Resolve the UPI target: the shop's own UPI ID first, then the
            # global (admin) UPI ID as a fallback. Money goes to the shop.
            order = await _db(db.get_order, data.order_id)
            shop = await _db(db.get_shop, order["shop_id"]) if order else None
            shop_upi = (shop or {}).get("upi_id", "") or ""
            payment_settings = await _db(db.get_payment_settings)
            # Shop's own UPI is the primary target; the global (admin) UPI is
            # only a fallback for shops that haven't added one yet.
            if not shop_upi and (not payment_settings["manual_enabled"] or not payment_settings["upi_id"]):
                raise HTTPException(status_code=400, detail="No UPI payment configured for this shop")
            # Respect the vendor's UPI toggle — a shop that turned UPI off must
            # not receive manual UTR payments either.
            if shop is not None and not shop.get("upi_enabled", 1):
                raise HTTPException(status_code=400, detail="This shop has turned off UPI payments.")
        # Razorpay method is validated in the create-razorpay-order endpoint

    # PENTEST FIX: a payment proof only makes sense while the order is still
    # awaiting payment — attaching rows to a cancelled / delivered / already
    # settled order only pollutes the admin's verify queue with proof for food
    # that is never owed.
    if current_user.get("role") != "admin" and str(order.get("status") or "") not in _AWAITING_PAYMENT_STATUSES:
        raise HTTPException(status_code=409, detail="This order is no longer awaiting payment — no new payment can be recorded against it.")

    # PENTEST FIX: an order that already settled must not collect a second
    # payment row (double-counting in the admin's verify/settlement views).
    settled = await _db(db.get_payment_by_order_id, data.order_id)
    if settled and str(settled.get("status") or "") == "Success":
        raise HTTPException(status_code=409, detail="This order has already been paid.")

    # `POST /orders` now opens the payment intent itself (one request instead of
    # two, because the second call measured 12-27 s on a cold instance). An
    # older client — or the admin re-recording proof — can still reach this
    # endpoint, and it must NOT stack a second row on the order: two open
    # payment rows make tier-2 matching read the wrong one and double-count the
    # order in the admin's settlement views.
    if settled and str(settled.get("status") or "") == "Pending" and not utr_claim:
        return settled

    # One UTR = one payment (unique index on payments.utr_number in both DBs).
    # A re-used reference must fail with a FRIENDLY 409 at checkout too — never
    # the raw 500 students saw as "it didn't save".
    if utr_claim:
        existing = await _db(db.get_payment_by_utr, utr_claim)
        if existing and str(existing.get("order_id") or "") != str(data.order_id):
            raise HTTPException(
                status_code=409,
                detail="This UTR is already saved on another order — double-check the number, or leave it empty and submit it on the order page.",
            )

    if not is_parent:
        payment = await _db(
            db.create_payment,
            data.order_id,
            data.amount,
            data.method,
            data.utr_number,
        )
    else:
        payment = await _db(
            db.record_parent_payment,
            data.order_id,
            data.amount,
            data.method,
            data.utr_number,
        )
    if not payment:
        raise HTTPException(status_code=400, detail="Unable to create payment")

    # The UTR verification method (bank-SMS credit check + same-amount
    # matching inside _confirm_order_via_utr) was removed: a recorded payment
    # is settled by the admin. Ring the admin's phone (web push, best-effort)
    # so they review it in Admin Center → Payments.
    if str(data.method or "").upper() != "COD":
        _push_admin(
            "New payment to verify",
            f"{current_user.get('name') or current_user.get('username')} submitted {'a multi-shop' if is_parent else 'a'} payment proof "
            f"(₹{data.amount}) — verify in Admin Center → Payments.",
            tag="payment-verify",
        )
    return payment



# ─── Razorpay endpoints ───


class LocalRazorpayOrderCreate(BaseModel):
    amount: int = Field(..., ge=1, le=100_000_000)  # in paise (₹1 = 100 paise)
    currency: str = Field(default="INR", max_length=8)
    order_id: str = Field(..., max_length=100)  # Local order ID to associate payment with

    @field_validator("currency")
    @classmethod
    def _validate_currency(cls, value: str) -> str:
        # PENTEST FIX: the gateway amount is bound to the ₹ order total, so the
        # currency must be the same unit that binding assumes. The platform
        # settles in INR only — normalise case and REFUSE anything else rather
        # than forwarding a caller-declared currency to the gateway.
        norm = (value or "").strip().upper()
        if norm != "INR":
            raise ValueError("Only INR payments are supported")
        return norm


class LocalRazorpayVerify(BaseModel):
    # PENTEST FIX: every gateway field is bounded — these are fixed-width
    # references from Razorpay, never arbitrary-length strings.
    razorpay_order_id: str = Field(..., max_length=64)
    razorpay_payment_id: str = Field(..., max_length=64)
    razorpay_signature: str = Field(..., max_length=256)
    order_id: str = Field(..., max_length=100)  # Local order ID


@router.post("/payments/create-razorpay-order")
async def create_razorpay_order(
    data: LocalRazorpayOrderCreate,
    current_user: dict = Depends(get_current_local_user),
):
    """Create a Razorpay order for payment.

    Authenticated AND amount-bound: the payable amount is derived from the
    STORED order total, never from the request body. Previously the caller's
    ``amount`` was forwarded to the gateway as-is and no token was required, so
    anyone could open a ₹1 gateway order against a ₹500 local order.
    """
    order, is_parent = await _resolve_owned_order(data.order_id, current_user)

    payment_settings = await _db(db.get_payment_settings)
    if not payment_settings.get("razorpay_enabled"):
        raise HTTPException(status_code=400, detail="Razorpay is not enabled by admin")

    key_id = settings.RAZORPAY_KEY_ID
    key_secret = settings.RAZORPAY_KEY_SECRET
    if not key_id or not key_secret:
        raise HTTPException(status_code=500, detail="Razorpay API keys not configured on server")

    if str(order.get("status") or "") != "Pending Payment":
        raise HTTPException(status_code=400, detail="This order is not awaiting an online payment.")

    expected_paise = int(round(float(order.get("total") or 0) * 100))
    if expected_paise <= 0:
        raise HTTPException(status_code=400, detail="This order has nothing left to pay.")
    if int(data.amount) != expected_paise:
        raise HTTPException(
            status_code=400,
            detail=f"Payment amount must be ₹{expected_paise // 100} for this order.",
        )

    try:
        import razorpay
        client = razorpay.Client(auth=(key_id, key_secret))

        # Create Razorpay order (network call — off the event loop)
        razorpay_order = await asyncio.to_thread(
            client.order.create,
            {
                "amount": expected_paise,
                "currency": data.currency,
                "receipt": data.order_id,
                "payment_capture": 1,  # Auto-capture
            },
        )

        return {
            "razorpay_order_id": razorpay_order["id"],
            "amount": razorpay_order["amount"],
            "currency": razorpay_order["currency"],
            "key_id": key_id,
            "order_id": data.order_id,
        }
    except Exception as e:
        logger.error(f"Error creating Razorpay order: {e}")
        raise HTTPException(status_code=400, detail=f"Could not create payment: {str(e)}")


@router.post("/payments/verify-razorpay")
async def verify_razorpay_payment(
    data: LocalRazorpayVerify,
    current_user: dict = Depends(get_current_local_user),
):
    """Verify a Razorpay payment signature and mark the order paid.

    Three independent checks are enforced before the order is marked paid:
    the caller must own the order, the captured amount must equal the stored
    order total, and the gateway payment id must not already be recorded
    against another order (replay). Without them a single ₹1 payment could be
    presented as settling an arbitrary order.
    """
    order, is_parent = await _resolve_owned_order(data.order_id, current_user)

    if str(order.get("status") or "") != "Pending Payment":
        raise HTTPException(status_code=400, detail="This order is not awaiting an online payment.")

    key_secret = settings.RAZORPAY_KEY_SECRET
    if not key_secret:
        raise HTTPException(status_code=500, detail="Razorpay secret not configured")

    try:
        import razorpay
        client = razorpay.Client(auth=(settings.RAZORPAY_KEY_ID, key_secret))

        # Verify signature
        params_dict = {
            "razorpay_order_id": data.razorpay_order_id,
            "razorpay_payment_id": data.razorpay_payment_id,
            "razorpay_signature": data.razorpay_signature,
        }
        await asyncio.to_thread(client.utility.verify_payment_signature, params_dict)

        # Fetch payment details to get amount (network call — off the event loop)
        payment_info = await asyncio.to_thread(client.payment.fetch, data.razorpay_payment_id)
        amount_paise = payment_info.get("amount", 0)
        amount_rupees = amount_paise // 100

        # ─── Amount binding: the gateway amount must match the order total ───
        expected_rupees = float(order.get("total") or 0)
        if abs(amount_rupees - expected_rupees) >= 0.01:
            raise HTTPException(
                status_code=400,
                detail=f"The amount paid (₹{amount_rupees}) does not match this order's total (₹{int(expected_rupees)}).",
            )

        # ─── Replay guard: one gateway payment settles exactly one order ───
        existing_payments = await _db(db.list_payments)
        if any(
            str(p.get("utr_number") or "").strip() == data.razorpay_payment_id
            for p in existing_payments
        ):
            raise HTTPException(status_code=409, detail="This payment has already been applied to an order.")
        if any(
            str(p.get("order_id") or "") == data.order_id and str(p.get("status") or "") == "Success"
            for p in existing_payments
        ):
            raise HTTPException(status_code=409, detail="This order has already been paid.")

        # Create payment record in local DB
        if is_parent:
            payment = await _db(
                db.record_parent_payment,
                data.order_id,
                amount_rupees,
                "Razorpay",
                data.razorpay_payment_id,
                None,
            )
        else:
            payment = await _db(
                db.create_payment,
                order_id=data.order_id,
                amount=amount_rupees,
                method="Razorpay",
                utr_number=data.razorpay_payment_id,
            )
        if not payment:
            raise HTTPException(status_code=400, detail="Could not save payment record")

        # Payment verified → the order is now genuinely paid and can move on to
        # the shop's acceptance queue. Parent (multi-shop) orders keep their
        # status on parent_orders.
        if is_parent:
            await _db(db.update_parent_order_status, data.order_id, "Pending Acceptance")
        else:
            await _db(db.update_order_status, data.order_id, "Pending Acceptance")

        return {
            "message": "Payment verified successfully",
            "payment": payment,
        }
    except HTTPException:
        # Ownership/amount/replay rejections must reach the client as-is instead
        # of being flattened into the generic "verification failed" 400 below.
        raise
    except Exception as e:
        logger.error(f"Error verifying Razorpay payment: {e}")
        raise HTTPException(status_code=400, detail=f"Payment verification failed: {str(e)}")


@router.get("/payment-settings")
async def payment_settings():
    return await _cached_read(30, "payment-settings", db.get_payment_settings)


@router.patch("/payment-settings")
async def patch_payment_settings(data: LocalPaymentSettings, _admin: dict = Depends(_require_admin)):
    """Update payment settings. Only an authenticated admin may change them.

    PENTEST FIX: this used to decode the JWT and trust its ``role`` claim
    alone — unlike every other admin route — so a removed or downgraded admin
    kept write access to payment details until the token expired. It now goes
    through ``_require_admin``, which re-checks the account in the database.
    """
    return await _db(db.update_payment_settings, data.model_dump(exclude_unset=True))


@router.get("/student-notice")
async def student_notice():
    """Public info block shown at the top of the student home page.

    Returns ``{"enabled": bool, "text": str}`` — the student app only renders a
    green banner when ``enabled`` is true AND the text is non-empty, so the
    admin can switch it off (or clear the text) and students immediately stop
    seeing it. Cached 30 s; any admin write clears the read cache.
    """
    return await _cached_read(30, "student-notice", db.get_student_notice)


@router.patch("/student-notice")
async def patch_student_notice(data: LocalStudentNoticeUpdate, _admin: dict = Depends(_require_admin)):
    """Set the student info block text / on-off switch. Admin-only — the same
    DB-backed audit as every other admin write (``_require_admin`` re-checks the
    account instead of trusting the token's ``role`` claim)."""
    return await _db(db.update_student_notice, data.model_dump(exclude_unset=True))


@router.patch("/payments/{payment_id}/status")
async def patch_payment_status(payment_id: str, data: LocalPaymentStatusUpdate, _admin: dict = Depends(_require_admin)):
    payment = await _db(db.update_payment_status, payment_id, data.status)
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    # RELEASE POINT (manual path). This is also the safety net for a stranded
    # payment: if the bank SMS never matched (agent not installed, key wrong), the
    # admin can mark the payment paid by hand and the shop is notified here. A
    # held-back order must never be a dead end with no way out.
    if str(data.status or "").upper() == "SUCCESS":
        order_id = str(payment.get("order_id") or "")
        if order_id:
            order = await _db(db.get_order, order_id)
            if order:
                await _notify_shop_of_paid_order(order)

    return payment


@router.get("/tickets")
async def tickets(current_user: dict = Depends(get_current_local_user)):
    """Support tickets — role-aware.

    Admins see every ticket. Students (and shopkeepers) only ever receive
    THEIR OWN tickets, matched by the authenticated account's email. Name-only
    matching is used solely for legacy phone-onboarded accounts that have no
    email address; it is never an OR fallback for email accounts (common names
    like "Student" would otherwise leak tickets across users)."""
    all_tickets = await _db(db.list_tickets)
    if current_user.get("role") == "admin":
        return all_tickets
    email = str(current_user.get("email") or "").strip().lower()
    if email:
        # Email accounts: strict email match only. Never fall back to name —
        # two different students can share the same display name.
        return [
            t for t in all_tickets
            if str(t.get("email") or "").strip().lower() == email
        ]
    name = str(current_user.get("name") or "").strip().lower()
    if not name:
        return []
    # No-email (phone-onboarded) legacy accounts: match on name AND phone so two
    # accounts sharing the generic "Student" display name never see each
    # other's tickets. (Email accounts never reach here — strict email match.)
    phone = "".join(ch for ch in str(current_user.get("phone") or "") if ch.isdigit())
    out = []
    for t in all_tickets:
        if str(t.get("name") or "").strip().lower() != name:
            continue
        if phone:
            t_phone = "".join(ch for ch in str(t.get("phone_number") or "") if ch.isdigit())
            # Compare last-10 digits so +91/0 formatting never hides own ticket.
            if t_phone[-10:] != phone[-10:]:
                continue
        out.append(t)
    return out


@router.post("/tickets")
async def add_ticket(data: LocalTicketCreate, current_user: dict = Depends(get_current_local_user)):
    # Stamp ownership from the authenticated JWT, not the client-supplied form
    # fields. Otherwise any student could file a ticket with someone else's
    # email/name (or omit them on purpose) and either impersonate them or make
    # their own ticket invisible to the role-aware GET above.
    payload = data.model_dump()
    if current_user.get("role") != "admin":
        server_email = str(current_user.get("email") or "").strip()
        server_name = str(current_user.get("name") or "").strip()
        server_phone = str(current_user.get("phone") or "").strip()
        if server_email:
            payload["email"] = server_email
        elif not payload.get("email"):
            # Phone-onboarded accounts have no email: keep the ticket readable
            # by stamping a stable per-account placeholder (username-based), so
            # the row still satisfies the NOT NULL email column.
            payload["email"] = f"{current_user.get('username', 'student')}@phone.local"
        if server_name:
            payload["name"] = server_name
        if server_phone:
            payload["phone_number"] = server_phone
    return await _db(db.create_ticket, payload)


@router.get("/notifications")
async def notifications(role: str | None = None, current_user: dict = Depends(get_current_local_user)):
    """Return only notifications the authenticated account may read."""
    if current_user.get("role") == "admin":
        return await _db(db.list_notifications, role=role)
    if current_user.get("role") != "student":
        return []
    rows = await _db(db.list_notifications, role="student")
    visible = []
    for row in rows:
        order_id = row.get("order_id")
        if not order_id:
            continue  # Unaddressed legacy events cannot safely identify a recipient.
        order = await _db(db.get_order, order_id)
        if not order:
            order = await _db(db.get_parent_order, order_id)
        if not order:
            sub = await _db(db.get_sub_order, order_id)
            if sub and sub.get("parent_order_id"):
                order = await _db(db.get_parent_order, sub["parent_order_id"])
        if order and _same_student(current_user, order):
            visible.append(row)
    return visible


# ─── Site feedback / bug reports (students → admin Feedback page) ───


def _resolve_feedback_user(authorization: Optional[str]):
    """Resolve the current user from the JWT when present (student portal
    logins issue a token; quick RoleGate sessions may not). Returns the user
    dict or None — feedback is never blocked for a missing identity."""
    payload = None
    if authorization and authorization.lower().startswith("bearer "):
        payload = decode_token(authorization.split(" ", 1)[1].strip())
    if not payload or not payload.get("sub"):
        return None
    user = db.get_user_by_id(int(payload["sub"]))
    return user


@router.post("/feedback")
async def add_feedback(data: LocalFeedbackCreate, request: Request, authorization: Optional[str] = Header(None)):
    """Submit a bug report / improvement contribution while testing the site.
    Lands on the admin Feedback page (and in the admin notification bell).
    Identity is taken from the JWT when available, else from the client session."""
    # PENTEST FIX: this route is deliberately reachable WITHOUT a token (guest
    # reports) and every submission rings the admin's phone — so it must be
    # throttled per IP, otherwise an anonymous caller could flood the admin's
    # push channel and fill the feedback table. 20 per 10 minutes is well
    # beyond any human (or CI) reporting pattern.
    if not rate_allow("feedback", rate_ip(request), max_attempts=20, window_sec=600):
        raise HTTPException(status_code=429, detail="Too many feedback submissions — please wait a few minutes and try again.")
    values = data.model_dump()
    user = await _db(_resolve_feedback_user, authorization)
    if user:
        values["user_id"] = user["id"]
        values["username"] = user["username"]
        values["name"] = user["name"] or values.get("name", "")
        values["email"] = user["email"] or values.get("email", "")
    feedback = await _db(db.create_site_feedback, values)
    if not feedback:
        raise HTTPException(status_code=400, detail="Could not submit feedback. Please try again.")
    logger.info(f"Site feedback submitted by {values.get('name') or values.get('email') or 'guest'}: {values.get('subject')}")
    _push_admin(
        "New feedback",
        f"[{feedback.get('category') or 'Bug'}] {feedback.get('subject') or feedback.get('message', '')[:80]} — by {values.get('name') or values.get('username') or 'guest'}",
        tag="feedback",
    )
    return feedback


@router.get("/feedback/mine")
async def my_feedback(authorization: Optional[str] = Header(None)):
    """A logged-in student's own contributions (status shown on their page)."""
    user = await _db(_resolve_feedback_user, authorization)
    if not user:
        return []
    return await _db(db.list_site_feedback_by_user, user["id"])


# ──────────────────────────────────────────────────────────────────
#  Multi-shop ordering (combo offer)
#  One parent order → per-shop sub-orders → ONE payment, ONE token.
# ──────────────────────────────────────────────────────────────────


def _load_current_batch() -> dict:
    """Live batch window + token info.

    The 30-minute auto-confirm sweep rides along with this read (it is the most
    polled endpoint) — and only on a cache miss, exactly as before.
    """
    _process_due_auto_confirm()
    batch_type = db.get_current_batch()
    return {
        "batch_type": batch_type,
        "token_starts_at": 18,
        "next_token": db.get_next_token(),
        "date_key": db._day_key(),
        "accepted_until": "12:30" if batch_type == "Afternoon" else "18:00",
        "delivery_window": "13:00-13:30" if batch_type == "Afternoon" else "19:30-19:45",
    }


@router.get("/batch")
async def current_batch():
    """Which delivery batch is accepting orders right now + stock info."""
    return await _cached_read(30, "batch", _load_current_batch)


def _load_home_feed() -> dict:
    """Storefront home feed in ONE worker hop: shops + products + announcements.

    The Home page used to fire 5 separate HTTP calls (shops, products,
    announcements, student-notice, batch), each paying its own pool checkout
    and cache chain. One aggregated, cached payload removes 4 round trips.
    """
    shops = db.list_shops(public_only=True)
    products = db.list_products()
    announcements = db.list_shop_announcements(None, True)
    notice = db.get_student_notice()
    batch_type = db.get_current_batch()
    return {
        "shops": [_public_shop(s) for s in shops],
        "products": products,
        "announcements": announcements,
        "notice": notice,
        "batch": {
            "batch_type": batch_type,
            "next_token": db.get_next_token(),
            "date_key": db._day_key(),
            "accepted_until": "12:30" if batch_type == "Afternoon" else "18:00",
            "delivery_window": "13:00-13:30" if batch_type == "Afternoon" else "19:30-19:45",
        },
    }


@router.get("/home-feed")
async def home_feed():
    """Aggregated storefront payload for the Home page (1 request, not 5)."""
    return await _cached_read(30, "home-feed", _load_home_feed)


def _load_products_with_stock() -> list[dict]:
    """Every product annotated with the remaining stock for the live batch.

    One worker-thread hop for all three store reads (they used to be awaited one
    after another on the event loop).
    """
    batch_type = db.get_current_batch()
    products = db.list_products()
    date_key = db._day_key()
    stocks = db.get_product_stocks(batch_type, date_key)
    for p in products:
        p["batch_type"] = batch_type
        p["stock_left"] = stocks.get(p["id"], 0)
    return products


@router.get("/checkout-data")
async def checkout_data(shop_ids: str = Query("", max_length=600)):
    """Everything the checkout and payment pages need, in ONE cached request.

    The pay page used to fire ``/payment-settings`` plus ``/products`` and
    ``/shops/{id}`` for EVERY shop in the cart. That is 1 + 2N separate HTTP
    calls, and on a serverless host each one pays its own cold start, so a
    two-shop basket meant five round trips and the page sat on "Loading the live
    price…" for the sum of them.

    They are also all short-lived, low-cardinality reads of the same few rows,
    so they belong behind one cache entry. One request now, one cold start, and
    warm reads for every visitor afterwards.

    ``shop_ids`` is a comma-separated list; an empty value returns just the
    settings, which is what the checkout page needs before a shop is chosen.
    """
    wanted = [s.strip() for s in (shop_ids or "").split(",") if s.strip()][:20]

    async def _load():
        # The expensive part — the whole product catalogue — is read through its
        # OWN longer-lived cache entry and then filtered per shop in Python.
        #
        # It used to run `list_products()` inline under a 3-second TTL, so every
        # distinct cart re-scanned the entire products table several times a
        # minute. That is exactly the kind of load that makes EVERY portal feel
        # slow, and it grew worse the more students were checking out.
        products_by_shop: dict[str, list] = {}
        if wanted:
            catalogue = await _cached_read(60, "checkout:catalogue", db.list_products) or []
            grouped: dict[str, list] = {}
            for p in catalogue:
                if p.get("available"):
                    grouped.setdefault(str(p.get("shop_id")), []).append(p)
            products_by_shop = grouped

        # Shops are primary-key lookups; run them concurrently in ONE worker hop
        # (the old sequential ``await`` chain cost N pool checkouts in series).
        # PENTEST FIX (data exposure). This returned ``db.get_shop()`` raw. This
        # route has NO auth dependency — a student must see live prices before
        # logging in — so every field came straight off the shops table:
        # admin_dues_balance / admin_dues_last_paid_at (the platform's private
        # ledger of what each vendor owes), revenue_today / orders_today (a
        # competitor's live business metrics), and shopkeeper_email /
        # whatsapp_number (the vendor's private contact details). The public
        # /shops routes already funnel through _public_shop() for exactly this
        # reason; this one was added later and missed it. Verified live: an
        # anonymous GET returned all of them.
        def _load_shops(sids: list[str]) -> list[dict]:
            return [s for s in (db.get_shop(sid) for sid in sids) if s]

        shop_rows = await _db(_load_shops, wanted) if wanted else []
        shops = [_public_shop(shop) for shop in shop_rows]
        settings = await _db(db.get_payment_settings)
        return {
            "shops": shops,
            "products": {s["id"]: products_by_shop.get(str(s["id"]), []) for s in shops},
            "payment_settings": settings,
        }

    key = "checkout:" + ",".join(sorted(wanted))
    # 30 s, not 3. Shop/product data changes far more slowly than that, and a
    # short TTL turns a popular page into a database load generator.
    return await _cached_read(30, key, _load)


@router.get("/products/stock")
async def products_with_stock(_user: dict = Depends(get_current_local_user)):
    """Every product with its per-batch remaining stock."""
    return await _cached_read(5, "products-stock", _load_products_with_stock)


@router.post("/orders/multi")
async def create_multi_shop_order(data: LocalMultiShopOrder, current_user: dict = Depends(get_current_local_user)):
    """Place a multi-shop order (combo). Creates one parent order + per-shop
    sub-orders sharing a single token. The student pays ONE bill."""
    if not data.shops:
        raise HTTPException(status_code=400, detail="No shops selected.")
    payload = data.model_dump()
    payload["student_phone"] = _normalize_phone(payload.get("student_phone", ""))

    # ``shops`` is a free-form list[dict] (the shape is validated deeper in the
    # store), so the per-line quantity must be bounded HERE: an unbounded value
    # would be multiplied straight into the bill and the stock decrement.
    for group in payload["shops"]:
        items = group.get("items") or []
        if not items:
            raise HTTPException(status_code=400, detail="One of the selected shops has no items in your cart.")
        for item in items:
            raw_quantity = item.get("quantity", 1)
            if raw_quantity is None or raw_quantity == "":
                raw_quantity = 1  # older clients omit the field entirely
            try:
                quantity = int(raw_quantity)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="Invalid item quantity.")
            if not 1 <= quantity <= MAX_LINE_QUANTITY:
                raise HTTPException(
                    status_code=400,
                    detail=f"You can order between 1 and {MAX_LINE_QUANTITY} of the same item.",
                )
            item["quantity"] = quantity

    # Pre-validate each shop for clear error messages.
    for group in payload["shops"]:
        shop = await _db(db.get_shop, group["shop_id"])
        if not shop:
            raise HTTPException(status_code=400, detail="One of the shops could not be found.")
        if shop.get("approval_status") != "Approved":
            raise HTTPException(status_code=400, detail=f"{shop['name']} is not approved yet.")
        if not shop.get("present") or shop.get("status") != "Open":
            raise HTTPException(status_code=400, detail=f"{shop['name']} is currently closed.")

    try:
        parent = await _db(
            db.create_parent_order,
            student_name=payload["student_name"] or "Student",
            student_phone=payload["student_phone"] or "",
            delivery_location=payload["delivery_location"],
            payment_method=payload["payment_method"],
            shops=payload["shops"],
            student_email=payload.get("student_email", ""),
            student_id=str(current_user["id"]),
            owner_user_id=str(current_user["id"]),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not parent:
        raise HTTPException(status_code=400, detail="Could not place your order — a shop stopped accepting orders or an item was removed.")
    for sub in parent.get("sub_orders", []):
        try:
            asyncio.get_running_loop().create_task(
                push_service.notify_shop_new_order_async(
                    {
                        "id": sub["id"],
                        "token": sub["token"],
                        "shop_id": sub["shop_id"],
                        "shop_name": sub["shop_name"],
                        "items": sub["items_summary"],
                        "total": sub["subtotal"],
                        "student_name": parent.get("student_name", ""),
                        "student_phone": parent.get("student_phone", ""),
                        "delivery_location": parent.get("delivery_location", ""),
                    }
                )
            )
        except Exception as e:
            logger.warning(f"Could not schedule sub-order push for {sub['id']}: {e}")

    # COD multi-shop: money is on delivery, so each shopkeeper's WhatsApp
    # notification fires right away — exactly the COD rule from the single-shop
    # flow. (UPI/UTR parents stay Pending until proof arrives; multi-shop has no
    # per-shop gateway hook, so the verified trigger does not exist yet there.)
    if str(parent.get("payment_method") or "").upper() == "COD":
        for sub in parent.get("sub_orders", []):
            try:
                shop = await _db(db.get_shop, sub["shop_id"])
                wa_phone = str((shop or {}).get("whatsapp_number") or "").strip() or str((shop or {}).get("phone") or "").strip()
                if shop and wa_phone:
                    wa_order = {
                        "id": sub["id"],
                        "token": sub["token"],
                        "items": sub["items_summary"],
                        "student_name": parent.get("student_name", ""),
                        "student_phone": parent.get("student_phone", ""),
                        "delivery_location": parent.get("delivery_location", ""),
                        "total": sub["subtotal"],
                        "payment_method": "COD",
                    }
                    await _notify_shop_via_whatsapp(wa_order, shop, wa_phone)
            except Exception as e:
                logger.warning(f"Could not schedule sub-order WhatsApp for {sub.get('id')}: {e}")

    # The admin's confirmation queue, one row per shop sub-order. Awaited (not
    # fire-and-forget) for the same serverless reason as the single-shop path:
    # a dropped background task here is exactly how a combo order ends up placed
    # but never confirmed.
    for sub in parent.get("sub_orders", []):
        try:
            await _notify_admin_of_new_order({
                "id": sub["id"],
                "token": sub["token"],
                "shop_name": sub.get("shop_name") or "",
                "items": sub.get("items_summary") or "",
                "total": sub.get("subtotal") or 0,
                "student_name": parent.get("student_name", ""),
                "payment_method": parent.get("payment_method", "UPI"),
                "status": sub.get("status", ""),
            })
        except Exception as e:
            logger.warning(f"Could not queue the admin confirmation for {sub.get('id')}: {e}")

    return parent


@router.get("/shop-orders/{shop_id}")
async def shop_sub_orders(shop_id: str, status: str | None = None, _admin: dict = Depends(_require_admin)):
    """A shop's own sub-orders (only THIS shop's items, never other shops')."""
    return await _db(db.get_shop_sub_orders, shop_id, status)


@router.patch("/shop-orders/{sub_order_id}/status")
async def patch_sub_order_status(sub_order_id: str, data: LocalSubOrderStatusUpdate, _admin: dict = Depends(_require_admin)):
    updated = await _db(db.update_sub_order_status, sub_order_id, data.status, data.notes)
    if not updated:
        raise HTTPException(status_code=404, detail="Sub-order not found")
    return updated


@router.get("/announcements")
async def announcements(shop_id: str | None = None, active_only: bool = True):
    """Shop announcement bar items shown to students on the shop page."""
    return await _db(db.list_shop_announcements, shop_id, active_only)


@router.post("/announcements")
async def add_announcement(data: LocalAnnouncementCreate, _admin: dict = Depends(_require_admin)):
    ann = await _db(db.create_shop_announcement, data.shop_id, data.message)
    if not ann:
        raise HTTPException(status_code=400, detail="Could not post announcement.")
    return ann


@router.patch("/announcements/{ann_id}")
async def patch_announcement(ann_id: str, data: LocalAnnouncementToggle, _admin: dict = Depends(_require_admin)):
    ann = await _db(db.toggle_shop_announcement, ann_id, bool(data.is_active))
    if not ann:
        raise HTTPException(status_code=404, detail="Announcement not found")
    return ann


# ─── Complaints (student → admin review) ───


@router.get("/complaints")
async def complaints(status: str | None = None, _admin: dict = Depends(_require_admin)):
    if status:
        return await _cached_read(10, "complaints", db.list_complaints, status)
    return await _cached_read(10, "complaints", db.list_complaints)


@router.post("/complaints")
async def add_complaint(data: LocalComplaintCreate, current_user: dict = Depends(get_current_local_user)):
    complaint = await _db(
        db.create_complaint,
        parent_order_id=data.parent_order_id,
        student_name=data.student_name,
        student_phone=data.student_phone,
        shop_id=data.shop_id,
        shop_name=data.shop_name,
        subject=data.subject,
        message=data.message,
    )
    if not complaint:
        raise HTTPException(status_code=400, detail="Could not submit complaint.")
    return complaint


@router.patch("/complaints/{complaint_id}")
async def patch_complaint(complaint_id: str, data: LocalComplaintStatusUpdate, _admin: dict = Depends(_require_admin)):
    updated = await _db(db.update_complaint, complaint_id, data.status, data.admin_notes)
    if not updated:
        raise HTTPException(status_code=404, detail="Complaint not found")
    return updated


# ─── Refunds (admin → student back) ───


@router.get("/refunds")
async def refunds(status: str | None = None, _admin: dict = Depends(_require_admin)):
    if status:
        return await _cached_read(10, "refunds", db.list_refunds, status)
    return await _cached_read(10, "refunds", db.list_refunds)


@router.post("/refunds")
async def add_refund(data: LocalRefundCreate, _admin: dict = Depends(_require_admin)):
    refund = await _db(
        db.create_refund,
        parent_order_id=data.parent_order_id,
        sub_order_id=data.sub_order_id,
        student_name=data.student_name,
        shop_name=data.shop_name,
        original_amount=data.original_amount,
        refund_amount=data.refund_amount,
        refund_type=data.refund_type,
    )
    if not refund:
        raise HTTPException(status_code=400, detail="Could not create refund.")
    return refund


@router.patch("/refunds/{refund_id}")
async def patch_refund(refund_id: str, data: LocalRefundUpdate, _admin: dict = Depends(_require_admin)):
    updated = await _db(db.update_refund, refund_id, data.status, data.refund_utr, data.admin_notes)
    if not updated:
        raise HTTPException(status_code=404, detail="Refund not found")
    return updated


class LocalRefundUpdate(BaseModel):
    # PENTEST FIX (finding 12): closed vocabulary + bounded UTR/notes. (This
    # second definition must stay in lockstep with the primary one above.)
    status: RefundStatus
    refund_utr: str = Field(default="", max_length=40)
    admin_notes: str = Field(default="", max_length=2000)


# ─── Settlements (admin, 9:00 PM daily) ───


@router.get("/settlements")
async def settlements(status: str | None = None, _admin: dict = Depends(_require_admin)):
    if status:
        return await _cached_read(10, "settlements", db.list_settlements, status)
    return await _cached_read(10, "settlements", db.list_settlements)


@router.post("/settlements/run")
async def run_settlements(_admin: dict = Depends(_require_admin)):
    """Trigger today's settlement run (admin or nightly job)."""
    rows = await _db(db.run_daily_settlements)
    return {"message": f"Settlement computed for {len(rows)} shops.", "settlements": rows}


# ─── Menu change requests (shop → admin approval) ───


@router.get("/menu-change-requests")
async def menu_change_requests(status: str | None = None, _admin: dict = Depends(_require_admin)):
    if status:
        return await _cached_read(10, "menu-change-requests", db.list_menu_change_requests, status)
    return await _cached_read(10, "menu-change-requests", db.list_menu_change_requests)


@router.post("/menu-change-requests")
async def add_menu_change_request(data: LocalMenuChangeCreate, current_user: dict = Depends(get_current_local_user)):
    req = await _db(
        db.create_menu_change_request,
        shop_id=data.shop_id,
        product_id=data.product_id,
        change_type=data.change_type,
        old_value=data.old_value,
        new_value=data.new_value,
    )
    if not req:
        raise HTTPException(status_code=400, detail="Could not create menu change request.")
    return req


@router.patch("/menu-change-requests/{req_id}")
async def patch_menu_change_request(req_id: str, data: LocalMenuChangeApprove, _admin: dict = Depends(_require_admin)):
    req = await _db(db.update_menu_change_request, req_id, data.status, data.admin_notes)
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    return req


class LocalMenuChangeApprove(BaseModel):
    # PENTEST FIX (finding 12): closed vocabulary + bounded notes. (This second
    # definition must stay in lockstep with the primary one above.)
    status: MenuChangeStatus
    admin_notes: str = Field(default="", max_length=2000)


# ─── Misc ───


@router.get("/audit-logs")
async def audit_logs(limit: int = 200, _admin: dict = Depends(_require_admin)):
    return await _db(db.list_audit_logs, limit)


@router.get("/whatsapp-logs")
async def whatsapp_logs(limit: int = 100, _admin: dict = Depends(_require_admin)):
    return await _db(db.list_whatsapp_logs, limit)
