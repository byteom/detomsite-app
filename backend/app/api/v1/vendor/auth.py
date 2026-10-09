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
from app.services import push_service

from .schemas import (
    AuthResponse,
    VendorForgotPasswordRequest,
    VendorLoginRequest,
    VendorRegisterRequest,
    VendorResetPasswordRequest,
    VendorResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/register", status_code=201)
def register(data: VendorRegisterRequest, request: Request):
    """Register a new shopkeeper and auto-create their shop (Pending Approval)."""
    if not rate_allow("vendor_register", rate_ip(request), max_attempts=20, window_sec=3600):
        raise HTTPException(status_code=429, detail="Too many shop registrations from this network — try again later.")
    password_hash = hash_password(data.password)
    user, conflict = db.register_user(
        username=data.username,
        password_hash=password_hash,
        name=data.name,
        email=data.email,
        phone=data.phone,
        role="shopkeeper",
    )
    if conflict == "username":
        raise HTTPException(status_code=409, detail="Username already taken")
    if conflict == "email" or not user:
        # One email = one account across the whole platform, no matter the role.
        raise HTTPException(status_code=409, detail="This email is already registered. Try signing in instead.")

    # Auto-create shop with Pending Approval status
    try:
        shop = db.create_shop({
            "name": data.shop_name,
            "category": data.shop_category,
            "description": data.shop_description or f"{data.shop_name} - New vendor",
            "shopkeeper_email": data.email or f"{data.username}@campus.local",
            "shopkeeper_name": data.name,
            "phone": data.phone,
            "opening_time": "09:00 AM",
            "closing_time": "09:00 PM",
            "upi_id": data.upi_id,
        })
        logger.info(f"Shop '{data.shop_name}' created for vendor {data.username}")
    except Exception as e:
        logger.warning(f"Could not auto-create shop for {data.username}: {e}")
        shop = None

    # Record registration for admin notification
    try:
        db.record_registration(user)
    except Exception as e:
        logger.warning(f"Could not record vendor registration: {e}")

    # Notify the admin that a new vendor is waiting for approval
    try:
        db.create_notification(
            title="New vendor registration",
            message=f"{data.name} registered '{data.shop_name}' — pending admin approval.",
            target_role="admin",
        )
        # Ring the admin's phone too (best-effort, fire-and-forget).
        push_service.notify_admin_async(
            "New vendor registration",
            f"{data.name} registered '{data.shop_name}' — pending approval in Admin Center.",
            {"url": "/admin-dashboard", "tag": "vendor-reg"},
        )
    except Exception as e:
        logger.warning(f"Could not notify admin of vendor registration: {e}")

    return {
        "message": "Vendor registered successfully. Your shop is pending admin approval.",
        "user": user,
        "shop": shop,
    }


@router.post("/login")
def login(data: VendorLoginRequest, request: Request):
    """Login as a shopkeeper."""
    ip = rate_ip(request)
    if not rate_allow("vendor_login", f"{data.username}:{ip}", max_attempts=40, window_sec=300):
        raise HTTPException(status_code=429, detail="Too many sign-in attempts — please wait a few minutes and try again.")
    user = db.get_user_by_username(data.username)
    # PENTEST FIX: identical message for "no such user" and "wrong password",
    # and the password is checked BEFORE the role hint — otherwise the distinct
    # 401/403 replies (and their order) let an attacker enumerate which
    # shop usernames exist on the platform.
    bad_credentials = "Invalid username or password."
    if not user or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail=bad_credentials)
    if user["role"] != "shopkeeper":
        raise HTTPException(status_code=403, detail=f"This account is a {user['role']} account — please sign in from the {user['role']} portal instead.")
    rate_reset("vendor_login", f"{data.username}:{ip}")

    token_data = {
        "sub": str(user["id"]),
        "username": user["username"],
        "name": user["name"],
        "role": user["role"],
    }
    return AuthResponse(
        access_token=create_access_token(token_data),
        refresh_token=create_refresh_token(token_data),
        user=VendorResponse(
            id=user["id"],
            username=user["username"],
            name=user["name"],
            role=user["role"],
            created_at=user["created_at"],
        ),
    )


@router.post("/forgot-password")
def vendor_forgot_password(data: VendorForgotPasswordRequest):
    """Shopkeeper password recovery — Step 1: email the 4-digit OTP.

    Enter your username OR registered email → the code goes to the shop's
    registered email → enter it with your new password at /vendor/reset-password.
    The response never reveals whether an account exists (enumeration guard);
    non-shopkeeper identifiers get the identical answer.
    """
    from app.services.email_service import email_delivery_configured
    from app.services.password_reset_service import (
        GENERIC_SENT_MESSAGE,
        find_user_for_reset_sync,
        send_reset_otp_sync,
    )

    if not email_delivery_configured():
        logger.error(
            "vendor forgot-password requested but no email provider is configured "
            "(set SMTP_HOST or RESEND_API_KEY)"
        )
        raise HTTPException(
            status_code=503,
            detail=(
                "Password reset by email is not available right now — this "
                "server has no email service configured. Please contact the admin."
            ),
        )
    user = find_user_for_reset_sync(data.identifier)
    if not user or user.get("role") != "shopkeeper":
        return {"message": GENERIC_SENT_MESSAGE, "step": 1}
    if not send_reset_otp_sync(user):
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
def vendor_reset_password(data: VendorResetPasswordRequest):
    """Shopkeeper password recovery — Step 2: verify OTP + set new password."""
    from app.services.password_reset_service import (
        find_user_for_reset_sync,
        verify_otp_and_reset_sync,
    )

    user = find_user_for_reset_sync(data.identifier)
    if not user or user.get("role") != "shopkeeper":
        raise HTTPException(status_code=400, detail="Invalid code. Please try again.")
    ok, error = verify_otp_and_reset_sync(
        data.identifier, data.otp, hash_password(data.new_password)
    )
    if not ok:
        raise HTTPException(
            status_code=500 if error.startswith("Could not ") else 400, detail=error
        )
    return {"message": "Password updated successfully! You can now sign in with your new password."}
