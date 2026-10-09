import logging
from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.store import store as db
from app.services import push_service

from .deps import _my_shop, get_current_vendor
from .schemas import PushSubscriptionCreate

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/push/config")
def push_config(current_vendor: dict = Depends(get_current_vendor)):
    """Tell the vendor app whether web push is configured and hand it the
    public VAPID key needed to subscribe. When disabled, ``reason`` explains
    why so the app can show a helpful message instead of a dead button."""
    keys = push_service.get_vapid_keys()
    if keys:
        return {"enabled": True, "vapid_public_key": keys["public_key"], "reason": ""}
    return {
        "enabled": False,
        "vapid_public_key": "",
        "reason": "VAPID keys are not configured on the server yet.",
    }


@router.post("/push/subscribe")
def subscribe_push(
    data: PushSubscriptionCreate,
    current_vendor: dict = Depends(get_current_vendor),
):
    """Register this device's push subscription so the shop gets order alerts."""
    endpoint = data.endpoint.strip()
    if not endpoint.startswith("https://"):
        raise HTTPException(status_code=400, detail="Invalid push endpoint")
    my_shop = _my_shop(current_vendor)
    try:
        saved = db.save_push_subscription(
            shop_id=my_shop["id"],
            endpoint=endpoint,
            p256dh=data.keys.p256dh.strip(),
            auth=data.keys.auth.strip(),
        )
    except Exception as e:
        logger.error(f"Could not save push subscription for vendor {current_vendor['username']}: {e}")
        raise HTTPException(status_code=400, detail="Could not save the push subscription")
    if not saved:
        raise HTTPException(status_code=400, detail="Could not save the push subscription")
    return {"ok": True, "message": "Order notifications enabled 🔔", "subscription": saved}


@router.delete("/push/subscribe")
def unsubscribe_push(
    current_vendor: dict = Depends(get_current_vendor),
    endpoint: str = Query(..., min_length=10, description="The push subscription endpoint URL to remove"),
):
    """Remove this device's push subscription.

    The endpoint is passed as a query parameter on purpose — DELETE requests
    with a body are non-standard and can be stripped by proxies/CDNs."""
    my_shop = _my_shop(current_vendor)
    try:
        removed = db.remove_push_subscription(my_shop["id"], endpoint.strip())
    except Exception as e:
        logger.warning(f"Could not remove push subscription: {e}")
        removed = False
    return {"ok": removed, "message": "Order notifications disabled" if removed else "No subscription to remove"}


@router.post("/push/test")
def test_push(current_vendor: dict = Depends(get_current_vendor)):
    """Send a test push to THIS shop's own subscribed devices. Returns a
    human-readable result so the vendor can verify notifications work and
    see the real error if they don't."""
    my_shop = _my_shop(current_vendor)
    result = push_service.send_test_push(my_shop["id"])
    return result
