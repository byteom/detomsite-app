import asyncio
import logging
from datetime import datetime
from fastapi import APIRouter, Depends

from app.core.store import store as db

from .deps import _KOLKATA_TZ, _db, verify_admin

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/dashboard")
async def dashboard(admin: dict = Depends(verify_admin)):
    """Get admin dashboard statistics."""
    today_key = datetime.now(_KOLKATA_TZ).strftime("%Y-%m-%d")
    stats, recent_orders = await asyncio.gather(
        _db(db.get_admin_dashboard_stats, today_key),
        _db(db.list_orders, limit=10),
    )

    total_revenue = stats.get("total_revenue", 0)
    total_service_fee = stats.get("total_orders", 0) * 10  # flat ₹10 per order
    today_revenue = stats.get("today_revenue", 0)

    return {
        "stats": {
            "total_shops": stats.get("total_shops", 0),
            "approved_shops": stats.get("approved_shops", 0),
            "pending_approvals": stats.get("pending_approvals", 0),
            "total_orders": stats.get("total_orders", 0),
            "active_orders": stats.get("active_orders", 0),
            "total_revenue": total_revenue,
            "total_service_fee": total_service_fee,
            "vendor_share": max(0, total_revenue - total_service_fee),
            "today_orders": stats.get("today_orders", 0),
            "today_revenue": today_revenue,
            "today_service_fee": stats.get("today_orders", 0) * 10,
            "pending_payments": stats.get("pending_payments", 0),
            "total_products": stats.get("total_products", 0),
        },
        "recent_orders": recent_orders,
    }


@router.get("/registrations")
async def list_user_registrations(admin: dict = Depends(verify_admin)):
    """List all user registrations."""
    return await _db(db.list_registrations)


@router.get("/orders/daily")
async def daily_orders(admin: dict = Depends(verify_admin)):
    """Get orders grouped by date."""
    return await _db(db.get_orders_grouped_by_date)


@router.get("/stats")
async def stats(admin: dict = Depends(verify_admin)):
    """Get daily stats."""
    return await _db(db.get_daily_stats)
