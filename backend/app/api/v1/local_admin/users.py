import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.store import store as db

from .deps import ADMIN_USERNAME, _db, verify_admin
from .schemas import AdminUserStatusRequest, AdminUserUpdateRequest

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/users")
async def list_all_users(
    role: Optional[str] = Query(None, description="Filter by role: student, shopkeeper, admin"),
    status: Optional[str] = Query(None, description="Filter by status: active, suspended, blocked"),
    search: Optional[str] = Query(None, description="Search term for username, name, email, phone"),
    admin: dict = Depends(verify_admin),
):
    """List all registered users with optional role, status, and search filtering."""
    users = await _db(db.list_users)
    if role and role.lower() != "all":
        users = [u for u in users if str(u.get("role", "")).lower() == role.lower()]
    if status and status.lower() != "all":
        users = [u for u in users if str(u.get("status", "active")).lower() == status.lower()]
    if search:
        s = search.strip().lower()
        users = [
            u for u in users
            if s in str(u.get("username", "")).lower()
            or s in str(u.get("name", "")).lower()
            or s in str(u.get("email", "")).lower()
            or s in str(u.get("phone", "")).lower()
        ]
    return users


@router.get("/users/students")
async def list_students(admin: dict = Depends(verify_admin)):
    """List all registered students."""
    return await _db(db.list_users_by_role, "student")


@router.get("/users/shopkeepers")
async def list_shopkeepers(admin: dict = Depends(verify_admin)):
    """List all registered shopkeepers."""
    return await _db(db.list_users_by_role, "shopkeeper")


@router.get("/users/{user_id}")
async def get_user_detail(user_id: int, admin: dict = Depends(verify_admin)):
    """Get full 360 overview of a specific user: profile, stats, orders, payments, addresses, activity, reviews, feedback."""
    overview = await _db(db.get_user_overview, user_id)
    if not overview:
        raise HTTPException(status_code=404, detail="User not found")
    return overview


@router.put("/users/{user_id}")
async def update_user(user_id: int, data: AdminUserUpdateRequest, admin: dict = Depends(verify_admin)):
    """Update user profile and account details."""
    user = await _db(db.get_user_by_id, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    updates = data.model_dump(exclude_unset=True)
    if not updates:
        return {"message": "No changes supplied", "user": user}

    if user.get("role") == "admin" and updates.get("role") and updates.get("role") != "admin":
        if user_id == 1 or user.get("username") == ADMIN_USERNAME:
            raise HTTPException(status_code=400, detail="The primary administrator account role cannot be changed.")

    if updates.get("status") in ("blocked", "suspended") and (user_id == 1 or user.get("username") == ADMIN_USERNAME):
        raise HTTPException(status_code=400, detail="The primary administrator account cannot be suspended.")

    updated = await _db(db.update_user_admin, user_id, updates)
    return {"message": "User updated successfully", "user": updated}


@router.post("/users/{user_id}/status")
async def toggle_user_status(user_id: int, data: AdminUserStatusRequest, admin: dict = Depends(verify_admin)):
    """Activate or suspend a user account."""
    user = await _db(db.get_user_by_id, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if data.status in ("blocked", "suspended") and (user_id == 1 or user.get("username") == ADMIN_USERNAME):
        raise HTTPException(status_code=400, detail="The primary administrator account cannot be suspended.")

    await _db(db.set_user_status, user_id, data.status)
    return {"message": f"User status set to {data.status}", "status": data.status}


@router.delete("/users/{user_id}")
async def delete_user(user_id: int, admin: dict = Depends(verify_admin)):
    """Permanently delete a user."""
    target = await _db(db.get_user_by_id, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.get("role") == "admin":
        raise HTTPException(status_code=400, detail="Administrator accounts cannot be deleted.")
    if not await _db(db.delete_user, user_id):
        raise HTTPException(status_code=404, detail="User not found")
    logger.info(f"Admin deleted user {user_id}")
    return {"message": "User deleted — their username and email can now be used again."}
