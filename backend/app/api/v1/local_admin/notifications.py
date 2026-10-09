import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query

from app.core import read_cache
from app.core.store import store as db
from app.services import push_service

from .deps import _db, verify_admin
from .schemas import (
    BroadcastRequest,
    FeedbackStatusUpdate,
    PushSubscriptionCreate,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/notifications")
async def admin_notifications(admin: dict = Depends(verify_admin)):
    """Notifications targeted at admins."""
    return await read_cache.cached_read(
        5, "admin-notifications", db.list_notifications, role="admin"
    )


@router.post("/notifications/broadcast")
async def broadcast_notification(data: BroadcastRequest, admin: dict = Depends(verify_admin)):
    """Admin writes a notification that surfaces in every student's notification bar."""
    title = data.title.strip()
    message = data.message.strip()
    if not title or not message:
        raise HTTPException(status_code=400, detail="Title and message are required")
    try:
        notification = await _db(
            db.create_notification,
            title=title,
            message=message,
            order_id=None,
            status="Broadcast",
            target_role="student",
        )
    except Exception as e:
        logger.error(f"Admin broadcast failed: {e}")
        raise HTTPException(status_code=500, detail="Could not save the broadcast")
    if not notification:
        raise HTTPException(status_code=500, detail="Could not save the broadcast")
    await read_cache.clear()
    logger.info(f"Admin broadcast: {title!r} to all students")
    return {"message": "Broadcast sent to all students", "notification": notification}


@router.get("/feedback")
async def list_feedback(
    source: Optional[str] = Query(None, pattern="^(User|ATS)?$"),
    admin: dict = Depends(verify_admin),
):
    """All student bug reports / improvement contributions."""
    return await read_cache.cached_read(
        10, "admin-feedback", db.list_site_feedback, source=source or None
    )


@router.patch("/feedback/{feedback_id}")
async def update_feedback(feedback_id: str, data: FeedbackStatusUpdate, admin: dict = Depends(verify_admin)):
    """Move a contribution along: Open → In Review → Fixed / Won't Fix."""
    feedback = await _db(db.update_site_feedback_status, feedback_id, data.status)
    if not feedback:
        raise HTTPException(status_code=404, detail="Feedback not found")
    logger.info(f"Admin marked feedback {feedback_id} as {data.status}")
    return feedback


@router.delete("/feedback")
async def delete_feedback(
    source: Optional[str] = Query(None, pattern="^(User|ATS)?$"),
    admin: dict = Depends(verify_admin),
):
    """Permanently delete feedback rows."""
    deleted = await _db(db.delete_site_feedback, source=source or None)
    label = "automated-test entries" if source == "ATS" else "user reports" if source == "User" else "feedback entries"
    logger.info(f"Admin deleted {deleted} {label}")
    return {"message": f"Deleted {deleted} {label}.", "deleted": deleted}


@router.get("/reviews")
async def list_all_reviews(admin: dict = Depends(verify_admin)):
    """All student reviews for shops."""
    return await _db(db.list_reviews)


@router.get("/push/config")
async def admin_push_config(admin: dict = Depends(verify_admin)):
    """Tell the admin app whether web push is configured and hand it the public VAPID key."""
    keys = push_service.get_vapid_keys()
    if keys:
        return {"enabled": True, "vapid_public_key": keys["public_key"], "reason": ""}
    return {
        "enabled": False,
        "vapid_public_key": "",
        "reason": "VAPID keys are not configured on the server yet.",
    }


@router.post("/push/subscribe")
async def admin_subscribe_push(data: PushSubscriptionCreate, admin: dict = Depends(verify_admin)):
    """Register this device's push subscription so the admin gets phone alerts."""
    endpoint = data.endpoint.strip()
    if not endpoint.startswith("https://"):
        raise HTTPException(status_code=400, detail="Invalid push endpoint")
    try:
        saved = await _db(
            db.save_push_subscription,
            "admin",
            endpoint,
            data.keys.p256dh.strip(),
            data.keys.auth.strip(),
        )
    except Exception as e:
        logger.error(f"Could not save admin push subscription: {e}")
        raise HTTPException(status_code=400, detail="Could not save the push subscription")
    if not saved:
        raise HTTPException(status_code=400, detail="Could not save the push subscription")
    return {"ok": True, "message": "Admin notifications enabled 🔔", "subscription": saved}


@router.delete("/push/subscribe")
async def admin_unsubscribe_push(
    admin: dict = Depends(verify_admin),
    endpoint: str = Query(..., min_length=10, description="The push subscription endpoint URL to remove"),
):
    """Remove this device's push subscription."""
    try:
        removed = await _db(db.remove_push_subscription, "admin", endpoint.strip())
    except Exception as e:
        logger.error(f"Could not remove admin push subscription: {e}")
        raise HTTPException(status_code=400, detail="Could not remove the push subscription")
    return {"ok": True, "removed": bool(removed)}


@router.post("/push/test")
async def admin_test_push(admin: dict = Depends(verify_admin)):
    """Send a test push to every subscribed admin device (test button)."""
    return await _db(push_service.send_admin_test_push)
