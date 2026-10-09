import asyncio
import logging
from fastapi import APIRouter, HTTPException, Request

from app.core.config import settings
from app.core.rate_limit import allow as rate_allow, reset as rate_reset, client_ip as rate_ip
from app.core.security import (
    create_access_token,
    create_refresh_token,
    hash_password,
    verify_password,
)
from app.core.store import store as db

from .deps import ADMIN_PASSWORD, ADMIN_USERNAME, _db
from .schemas import (
    AdminForgotPasswordRequest,
    AdminLoginRequest,
    AdminResetPasswordRequest,
    AdminResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/login")
async def login(data: AdminLoginRequest, request: Request):
    """Login as admin using username and password."""
    ip = rate_ip(request)
    if not rate_allow("admin_login", f"{data.username}:{ip}", max_attempts=6, window_sec=300):
        raise HTTPException(status_code=429, detail="Too many sign-in attempts — please wait a few minutes and try again.")

    user = await _db(db.get_user_by_username, data.username)

    bad_admin = "Invalid admin username or password"
    if user and user["role"] == "admin":
        if not verify_password(data.password, user["password_hash"]):
            raise HTTPException(status_code=401, detail=bad_admin)
    else:
        dummy = await asyncio.to_thread(hash_password, "x" * 16)
        await asyncio.to_thread(verify_password, data.password, dummy)
        if not settings.DEBUG:
            raise HTTPException(status_code=401, detail=bad_admin)
        if data.username != ADMIN_USERNAME or data.password != ADMIN_PASSWORD:
            raise HTTPException(status_code=401, detail=bad_admin)
        rate_reset("admin_login", f"{data.username}:{ip}")
        token_data = {
            "sub": "0",
            "username": ADMIN_USERNAME,
            "name": "Administrator",
            "role": "admin",
        }
        return AdminResponse(
            access_token=create_access_token(token_data),
            refresh_token=create_refresh_token(token_data),
            user={
                "id": 0,
                "username": ADMIN_USERNAME,
                "name": "Administrator",
                "role": "admin",
            },
        )

    rate_reset("admin_login", f"{data.username}:{ip}")
    token_data = {
        "sub": str(user["id"]),
        "username": user["username"],
        "name": user["name"],
        "role": user["role"],
    }
    return AdminResponse(
        access_token=create_access_token(token_data),
        refresh_token=create_refresh_token(token_data),
        user={
            "id": user["id"],
            "username": user["username"],
            "name": user["name"],
            "role": user["role"],
        },
    )


@router.post("/forgot-password")
async def admin_forgot_password(data: AdminForgotPasswordRequest):
    """Admin password recovery — Step 1: email the 4-digit OTP."""
    from app.services.email_service import email_delivery_configured
    from app.services.password_reset_service import (
        GENERIC_SENT_MESSAGE,
        find_user_for_reset,
        send_reset_otp,
    )

    if not email_delivery_configured():
        logger.error(
            "admin forgot-password requested but no email provider is configured "
            "(set SMTP_HOST or RESEND_API_KEY)"
        )
        raise HTTPException(
            status_code=503,
            detail=(
                "Password reset by email is not available right now — this "
                "server has no email service configured. Please contact the admin."
            ),
        )
    user = await find_user_for_reset(data.identifier)
    if not user or user.get("role") != "admin":
        return {"message": GENERIC_SENT_MESSAGE, "step": 1}
    if not await send_reset_otp(user):
        raise HTTPException(
            status_code=503,
            detail="We could not send the reset email. Please try again shortly.",
        )
    return {
        "message": "A 4-digit code was sent to your registered email. Enter it below to set a new password.",
        "step": 1,
        "expires_minutes": settings.RESET_OTP_EXPIRE_MINUTES,
    }


@router.post("/reset-password")
async def admin_reset_password(data: AdminResetPasswordRequest):
    """Admin password recovery — Step 2: verify OTP + set new password."""
    from app.services.password_reset_service import find_user_for_reset, verify_otp_and_reset

    user = await find_user_for_reset(data.identifier)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=400, detail="Invalid code. Please try again.")
    password_hash = await asyncio.to_thread(hash_password, data.new_password)
    ok, error = await verify_otp_and_reset(data.identifier, data.otp, password_hash)
    if not ok:
        raise HTTPException(
            status_code=500 if error.startswith("Could not ") else 400, detail=error
        )
    return {"message": "Password updated successfully! You can now sign in with your new password."}
