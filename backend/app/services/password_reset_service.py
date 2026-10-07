"""Shared forgot-password OTP service for student / shopkeeper / admin portals.

Flow (identical for every role — user asked for one flow everywhere):
  1. User enters username OR email  →  POST {portal}/forgot-password {identifier}
  2. Server emails a 4-digit OTP (SMTP first, Resend fallback) — never in the response
  3. User enters OTP + new password →  POST {portal}/reset-password {identifier, otp, new_password}

Security properties (kept from the student flow):
  - `secrets`-based 4-digit code, single-use, expires in RESET_OTP_EXPIRE_MINUTES
  - 5 wrong guesses lock the code (brute-force guard in the store layer)
  - identical responses for unknown accounts (no enumeration oracle)
  - role-locked: a code issued for one portal only resets that portal's role
  - honest 503 when no mail provider is configured (never claims "sent")
"""
from __future__ import annotations

import asyncio
import logging
import secrets
from typing import Optional

from app.core.config import settings
from app.core.store import store as db
from app.core.db_executor import run_db
from app.services.email_service import EmailService, email_delivery_configured

logger = logging.getLogger(__name__)

GENERIC_SENT_MESSAGE = (
    "If that account exists, a verification code was sent to its email."
)
GENERIC_SENT_MESSAGE_WITH_STEP = (
    "A 4-digit code was sent to your registered email. "
    "Enter it below to set a new password."
)


def generate_otp() -> str:
    """A cryptographically secure 4-digit numeric code."""
    return f"{secrets.randbelow(10_000):04d}"


def resolve_recipient_email(user: dict) -> str:
    """Where the reset OTP goes.

    Admin rows carry a placeholder DB email (admin@detomsite.local) because
    DEFAULT_SUPER_ADMIN_EMAIL is usually already claimed by another account,
    so admin codes go straight to DEFAULT_SUPER_ADMIN_EMAIL.
    """
    admin_email = (settings.DEFAULT_SUPER_ADMIN_EMAIL or "").strip()
    if user.get("role") == "admin" and admin_email:
        return admin_email
    return user.get("email") or f"{user['username']}@campus.local"


# ─── Sync core (vendor portal uses sync handlers) ───

def find_user_for_reset_sync(identifier: str) -> Optional[dict]:
    identifier = (identifier or "").strip()
    if not identifier:
        return None
    user = None
    if "@" in identifier:
        try:
            user = db.get_user_by_email(identifier)
        except Exception:
            user = None
    if not user:
        try:
            user = db.get_user_by_username(identifier)
        except Exception:
            user = None
    return user


def send_reset_otp_sync(user: dict) -> bool:
    """Generate + store a fresh OTP and email it. Returns True iff delivered."""
    otp = generate_otp()
    try:
        db.create_password_reset(user["username"], otp, 1)
    except Exception as e:
        logger.error(f"Could not store reset OTP for {user.get('username')}: {e}")
        return False
    to_email = resolve_recipient_email(user)
    # EmailService._deliver is async; vendor handlers are sync (thread-pool),
    # so run the coroutine to completion on a fresh loop via asyncio.run —
    # safe here because FastAPI already runs sync handlers in a worker thread.
    try:
        return bool(asyncio.run(EmailService.send_otp_email(to_email, otp, purpose="password reset")))
    except RuntimeError:
        # Already inside a running loop (tests) — fall back to a new loop in a thread.
        import concurrent.futures

        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            return bool(pool.submit(asyncio.run, EmailService.send_otp_email(to_email, otp, purpose="password reset")).result(timeout=30))
    except Exception as e:
        logger.error(f"Reset OTP email failed for {to_email}: {e}")
        return False


def verify_otp_and_reset_sync(identifier: str, otp: str, new_password_hash: str) -> tuple[bool, str]:
    """Validate the OTP for this identifier's account and set the new hash.

    Returns (ok, error_detail). Role is NOT checked here — callers check it
    before calling so cross-portal codes can never reset another role.
    """
    user = find_user_for_reset_sync(identifier)
    if not user:
        return False, "Invalid or expired code. Please request a new one."
    try:
        reset = db.get_password_reset(user["username"], (otp or "").strip(), 1)
    except Exception as e:
        logger.error(f"OTP lookup failed for {user.get('username')}: {e}")
        return False, "Could not verify the code. Please try again."
    if not reset:
        try:
            db.bump_password_reset_attempts(user["username"])
        except Exception:
            pass
        return False, "Invalid or expired code. Please request a new one."
    try:
        updated = db.update_user_password(user["username"], new_password_hash)
    except Exception as e:
        logger.error(f"Password update failed for {user.get('username')}: {e}")
        return False, "Could not update the password. Please try again."
    if not updated:
        return False, "Could not update the password. Please try again."
    try:
        db.invalidate_password_resets(user["username"])
    except Exception:
        pass
    logger.info(f"Password reset completed for user: {user['username']}")
    return True, ""


# ─── Async core (student + admin portals use async handlers) ───

async def find_user_for_reset(identifier: str) -> Optional[dict]:
    identifier = (identifier or "").strip()
    if not identifier:
        return None
    user = None
    if "@" in identifier:
        try:
            user = await run_db(db.get_user_by_email, identifier)
        except Exception:
            user = None
    if not user:
        try:
            user = await run_db(db.get_user_by_username, identifier)
        except Exception:
            user = None
    return user


async def send_reset_otp(user: dict) -> bool:
    """Generate + store a fresh OTP and email it. Returns True iff delivered."""
    otp = generate_otp()
    try:
        await run_db(db.create_password_reset, user["username"], otp, 1)
    except Exception as e:
        logger.error(f"Could not store reset OTP for {user.get('username')}: {e}")
        return False
    to_email = resolve_recipient_email(user)
    try:
        return bool(await EmailService.send_otp_email(to_email, otp, purpose="password reset"))
    except Exception as e:
        logger.error(f"Reset OTP email failed for {to_email}: {e}")
        return False


async def verify_otp_and_reset(identifier: str, otp: str, new_password_hash: str) -> tuple[bool, str]:
    user = await find_user_for_reset(identifier)
    if not user:
        return False, "Invalid or expired code. Please try again."
    try:
        reset = await run_db(db.get_password_reset, user["username"], (otp or "").strip(), 1)
    except Exception as e:
        logger.error(f"OTP lookup failed for {user.get('username')}: {e}")
        return False, "Could not verify the code. Please try again."
    if not reset:
        try:
            await run_db(db.bump_password_reset_attempts, user["username"])
        except Exception:
            pass
        return False, "Invalid or expired code. Please request a new one."
    try:
        updated = await run_db(db.update_user_password, user["username"], new_password_hash)
    except Exception as e:
        logger.error(f"Password update failed for {user.get('username')}: {e}")
        return False, "Could not update the password. Please try again."
    if not updated:
        return False, "Could not update the password. Please try again."
    try:
        await run_db(db.invalidate_password_resets, user["username"])
    except Exception:
        pass
    logger.info(f"Password reset completed for user: {user['username']}")
    return True, ""
