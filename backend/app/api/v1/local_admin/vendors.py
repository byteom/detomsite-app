import logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException

from app.core.store import store as db

from .deps import _KOLKATA_TZ, _db, _ist_date, _sub_order_shape, verify_admin
from .schemas import (
    AdminProductCreate,
    AdminProductUpdate,
    AdminShopAction,
    AdminShopSettingsUpdate,
    ApprovalAction,
    ShopPresentToggle,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/vendors")
async def list_vendors(admin: dict = Depends(verify_admin)):
    """List all vendors/shops with approval status."""
    shops = await _db(db.list_shops)

    result = []
    for shop in shops:
        result.append({
            "id": shop["id"],
            "name": shop["name"],
            "category": shop["category"],
            "shopkeeper_name": shop["shopkeeper_name"],
            "shopkeeper_email": shop["shopkeeper_email"],
            "phone": shop["phone"],
            "upi_id": shop.get("upi_id", "") or "",
            "upi_enabled": bool(shop.get("upi_enabled", 0)),
            "cod_enabled": bool(shop.get("cod_enabled", 0)),
            "approval_status": shop["approval_status"],
            "status": shop["status"],
            "present": shop["present"],
            "orders_today": shop["orders_today"],
            "revenue_today": shop["revenue_today"],
        })

    return result


@router.get("/vendors/pending")
async def list_pending_vendors(admin: dict = Depends(verify_admin)):
    """List only vendors pending approval."""
    shops = await _db(db.list_shops)
    pending = [s for s in shops if s["approval_status"] == "Pending Approval"]
    return pending


@router.post("/vendors/{shop_id}/approve")
async def approve_vendor(shop_id: str, admin: dict = Depends(verify_admin)):
    """Approve a vendor/shop."""
    shop = await _db(db.update_shop, shop_id, {"approval_status": "Approved"})
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    logger.info(f"Admin approved shop: {shop['name']} ({shop_id})")
    return {"message": f"Shop '{shop['name']}' approved", "shop": shop}


@router.post("/vendors/{shop_id}/reject")
async def reject_vendor(shop_id: str, data: ApprovalAction, admin: dict = Depends(verify_admin)):
    """Reject a vendor/shop."""
    shop = await _db(db.update_shop, shop_id, {"approval_status": "Rejected"})
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    logger.info(f"Admin rejected shop: {shop['name']} ({shop_id}). Reason: {data.reason}")
    return {"message": f"Shop '{shop['name']}' rejected", "shop": shop}


@router.post("/vendors/{shop_id}/admin-action")
async def admin_shop_action(shop_id: str, data: AdminShopAction, admin: dict = Depends(verify_admin)):
    """Suspend or remove a shop from the platform."""
    if data.action == "suspend":
        shop = await _db(db.suspend_shop, shop_id)
        message = "suspended"
    elif data.action == "remove":
        shop = await _db(db.remove_shop, shop_id)
        message = "removed"
    else:
        shop = await _db(db.update_shop, shop_id, {"approval_status": "Approved", "present": False, "status": "Closed", "is_removed": False})
        message = "restored"

    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    logger.info(f"Admin {message} shop: {shop['name']} ({shop_id}). Reason: {data.reason}")
    return {"message": f"Shop '{shop['name']}' {message}", "shop": shop}


@router.patch("/vendors/{shop_id}/present")
async def toggle_shop_present(shop_id: str, data: ShopPresentToggle, admin: dict = Depends(verify_admin)):
    """Toggle a shop's present/absent status."""
    shop = await _db(db.update_shop, shop_id, {"present": data.present})
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    logger.info(f"Admin set shop {shop['name']} ({shop_id}) present={data.present}")
    return {"message": f"Shop '{shop['name']}' is now {'present' if data.present else 'absent'}", "shop": shop}


@router.get("/vendors/{shop_id}/orders/today")
async def shop_today_orders(shop_id: str, admin: dict = Depends(verify_admin)):
    """Get today's orders for a specific shop."""
    shop = await _db(db.get_shop, shop_id)
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    today_key = datetime.now(_KOLKATA_TZ).strftime("%Y-%m-%d")
    all_orders = await _db(db.list_orders, limit=5000)
    today_orders = []
    for o in all_orders:
        if o.get("shop_id") == shop_id:
            o_date = _ist_date(o.get("created_at"))
            if o_date == today_key:
                today_orders.append(o)
    for sub in (await _db(db.get_shop_sub_orders, shop_id)) or []:
        if _ist_date(sub.get("created_at")) == today_key:
            today_orders.append(_sub_order_shape(sub))
    today_orders.sort(key=lambda o: str(o.get("created_at") or ""), reverse=True)
    return {"shop": shop, "date": today_key, "orders": today_orders, "count": len(today_orders)}


@router.get("/vendors/{shop_id}/products")
async def vendor_products(shop_id: str, admin: dict = Depends(verify_admin)):
    """Get products for a specific vendor shop."""
    return await _db(db.list_products, shop_id)


@router.patch("/vendors/{shop_id}/settings")
async def update_shop_settings(shop_id: str, data: AdminShopSettingsUpdate, admin: dict = Depends(verify_admin)):
    """Admin can update a shop's UPI ID, UPI enabled, and COD enabled settings."""
    shop = await _db(db.get_shop, shop_id)
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    updates = data.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No settings to update")
    updated = await _db(db.update_shop, shop_id, updates)
    if not updated:
        raise HTTPException(status_code=500, detail="Failed to update shop")
    logger.info(f"Admin updated shop {shop['name']} ({shop_id}) settings: {updates}")
    return {"message": f"Shop '{shop['name']}' settings updated", "shop": updated}


@router.post("/vendors/{shop_id}/products")
async def admin_add_product(shop_id: str, data: AdminProductCreate, admin: dict = Depends(verify_admin)):
    """Admin can add a product to any shop."""
    shop = await _db(db.get_shop, shop_id)
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    if shop["approval_status"] != "Approved":
        raise HTTPException(status_code=400, detail="Shop is not approved yet")
    try:
        product = await _db(db.create_product, {
            "shop_id": shop_id,
            "name": data.name,
            "description": data.description,
            "price": data.price,
            "category": "Combo" if data.is_combo else data.category,
            "inventory": data.inventory,
            "prep_time": data.prep_time,
            "available": data.available,
            "is_combo": data.is_combo,
            "combo_items": data.combo_items,
        })
    except Exception as e:
        logger.error(f"Admin product creation failed for shop {shop_id}: {e}")
        raise HTTPException(status_code=400, detail="Could not add product")
    if not product:
        raise HTTPException(status_code=400, detail="Could not add product")
    logger.info(f"Admin added product '{data.name}' to shop {shop['name']}")
    return product


@router.patch("/vendors/{shop_id}/products/{product_id}")
async def admin_update_product(shop_id: str, product_id: str, data: AdminProductUpdate, admin: dict = Depends(verify_admin)):
    """Admin can update a product in any shop."""
    product = await _db(db.get_product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    if product["shop_id"] != shop_id:
        raise HTTPException(status_code=400, detail="Product does not belong to this shop")
    updates = data.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    updated = await _db(db.update_product, product_id, updates)
    if not updated:
        raise HTTPException(status_code=500, detail="Failed to update product")
    logger.info(f"Admin updated product '{product['name']}' in shop {shop_id}: {updates}")
    return updated


@router.delete("/vendors/{shop_id}/products/{product_id}")
async def admin_delete_product(shop_id: str, product_id: str, admin: dict = Depends(verify_admin)):
    """Admin can delete a product from any shop."""
    product = await _db(db.get_product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    if product["shop_id"] != shop_id:
        raise HTTPException(status_code=400, detail="Product does not belong to this shop")
    deleted = await _db(db.delete_product, product_id)
    if not deleted:
        raise HTTPException(status_code=500, detail="Could not delete product")
    logger.info(f"Admin deleted product '{product['name']}' from shop {shop_id}")
    return {"message": "Product deleted", "product": product}


@router.get("/vendors/{shop_id}/logs")
async def vendor_logs(shop_id: str, admin: dict = Depends(verify_admin)):
    """Get a vendor's daily earning logs."""
    shop = await _db(db.get_shop, shop_id)
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    daily = await _db(db.get_vendor_daily_logs, shop_id)
    orders = await _db(db.get_vendor_orders, shop_id)
    return {
        "shop": shop,
        "daily": daily,
        "orders": orders,
        "summary": {
            "total_revenue": sum(o["total"] for o in orders),
            "total_orders": len(orders),
            "total_admin_fee": sum((d.get("count") or 0) * 10 for d in daily),
        },
    }
