import asyncio
import logging
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request

from app.api.v1.local.common import rate_allow, rate_ip, rate_reset
from app.core.security import (
    create_access_token,
    create_refresh_token,
    hash_password,
    verify_password,
)
from app.core.store import store as db
from app.core.user_store import persist_user_profile
from app.api.v1.local.common import (
    _cached_read,
    _db,
    _normalize_phone,
    _require_admin,
    get_current_local_user,
)
from app.api.v1.local.schemas import (
    LocalAuthLogin,
    LocalAuthRegister,
    LocalAuthResponse,
    LocalAuthUser,
    LocalPhoneOnboarding,
    LocalProfileUpdate,
    LocalSessionCreate,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/status")
async def database_status():
    return {
        "connected": True,
        "mode": "supabase",
        "database": "Supabase Postgres",
        "persistent": True,
        "message": "Supabase Postgres is active. Business data is stored in a persistent cloud database.",
    }


@router.post("/auth/register", status_code=201)
async def local_register(data: LocalAuthRegister, request: Request):
    """Register a new user in the local database."""
    if not rate_allow("register", rate_ip(request), max_attempts=40, window_sec=3600):
        raise HTTPException(
            status_code=429,
            detail="Too many sign-up attempts from this network — try again later.",
        )

    if data.role == "admin":
        raise HTTPException(
            status_code=403,
            detail="Admin accounts cannot be created through public registration.",
        )

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
        raise HTTPException(
            status_code=409,
            detail="This email is already registered. Try signing in instead.",
        )

    if data.role == "shopkeeper":
        try:
            await _db(
                db.create_shop,
                {
                    "name": f"{data.name}'s Shop",
                    "category": "Campus Food",
                    "description": "New shop awaiting admin approval.",
                    "shopkeeper_email": data.email or f"{data.username}@campus.local",
                    "shopkeeper_name": data.name,
                    "phone": data.phone or "9999999999",
                    "opening_time": "09:00 AM",
                    "closing_time": "09:00 PM",
                },
            )
            logger.info(f"Shop auto-created for shopkeeper: {data.username}")
        except Exception as e:
            logger.warning(f"Could not auto-create shop for {data.username}: {e}")

    return {"message": "User registered successfully", "user": user}


@router.post("/auth/login")
async def local_login(data: LocalAuthLogin, request: Request):
    """Authenticate user and return JWT tokens."""
    ip = rate_ip(request)
    if not rate_allow("login", f"{data.username}:{ip}", max_attempts=40, window_sec=300):
        raise HTTPException(
            status_code=429,
            detail="Too many sign-in attempts — please wait a few minutes and try again.",
        )

    user = await _db(db.get_user_by_username, data.username)
    bad_credentials = "Invalid username or password."
    if not await asyncio.to_thread(
        verify_password,
        data.password,
        (user or {}).get("password_hash") or await asyncio.to_thread(hash_password, "x" * 16),
    ):
        raise HTTPException(status_code=401, detail=bad_credentials)
    if not user:
        raise HTTPException(status_code=401, detail=bad_credentials)

    rate_reset("login", f"{data.username}:{ip}")

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
    """Phone-first student onboarding (the student portal RoleGate)."""
    ip = rate_ip(request)
    if not rate_allow("phone_onboard_ip", ip, max_attempts=20, window_sec=300):
        raise HTTPException(
            status_code=429,
            detail="Too many attempts from this device — please wait a few minutes.",
        )
    if not rate_allow("phone_onboard_no", data.phone, max_attempts=10, window_sec=300):
        raise HTTPException(
            status_code=429,
            detail="Too many attempts for this number — please wait a few minutes.",
        )

    phone = _normalize_phone(data.phone.strip())
    digits = "".join(ch for ch in phone if ch.isdigit())
    if len(digits) < 10:
        raise HTTPException(status_code=400, detail="Please enter a valid 10-digit mobile number")

    username = f"stu_{digits[-10:]}"
    name = (data.name or "").strip() or "Student"
    _signed_in_msg = (
        "This number is already registered. Enter the password you were given when "
        'you joined, or use "Forgot password" to reset it.'
    )

    user = await _db(db.get_user_by_username, username)
    generated_password: str | None = None

    if user:
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
            raise HTTPException(
                status_code=409,
                detail="Could not create your student account — please try again.",
            )
        user = new_user
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
        generated_password=generated_password,
    )


@router.get("/auth/me")
async def local_me(current_user: dict = Depends(get_current_local_user)):
    """Get the current authenticated user's profile."""
    return current_user


@router.patch("/auth/me")
async def local_update_me(
    data: LocalProfileUpdate,
    current_user: dict = Depends(get_current_local_user),
):
    """Update the current student's profile — name, phone, email, and/or password."""
    if current_user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    user_id = current_user["id"]
    name = data.name.strip() if data.name is not None else None
    email = (data.email or "").strip() if data.email is not None else None
    phone = data.phone.strip() if data.phone is not None else None

    if name is not None and not name:
        raise HTTPException(status_code=422, detail="Name cannot be empty")

    if email is not None and email:
        existing = await _db(db.get_user_by_email, email)
        if existing and existing["id"] != user_id:
            raise HTTPException(
                status_code=409,
                detail="This email is already registered to another account",
            )
    elif email is not None:
        email = ""

    if data.password:
        new_hash = await asyncio.to_thread(hash_password, data.password)
        await _db(db.update_user_password, current_user["username"], new_hash)

    updated = await _db(db.update_user_profile, user_id, name=name, email=email, phone=phone)
    if not updated:
        raise HTTPException(status_code=404, detail="User not found")

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
    """Platform-wide business aggregates (shops, products, ACTIVE ORDERS, REVENUE)."""
    return await _cached_read(15, "summary", db.get_summary)


@router.post("/sessions")
async def create_session(
    data: LocalSessionCreate,
    request: Request,
    _user: dict = Depends(get_current_local_user),
):
    if not rate_allow(
        "session", f"{_user.get('id')}:{rate_ip(request)}", max_attempts=15, window_sec=300
    ):
        raise HTTPException(
            status_code=429,
            detail="Too many session updates — please wait a few minutes and try again.",
        )
    return await _db(persist_user_profile, data.email, data.name, data.role)
