import logging
import traceback
from fastapi import APIRouter, Depends, HTTPException

from app.core.store import store as db

from .deps import _find_shop, get_current_vendor
from .schemas import ProductCreate, ProductUpdate

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/products")
def list_my_products(current_vendor: dict = Depends(get_current_vendor)):
    """List products for this vendor's shop."""
    my_shop = _find_shop(current_vendor)
    if not my_shop:
        return []
    return db.list_products(my_shop["id"])


@router.post("/products", status_code=201)
def create_product(data: ProductCreate, current_vendor: dict = Depends(get_current_vendor)):
    """Add a new product to this vendor's shop."""
    my_shop = _find_shop(current_vendor)

    if not my_shop:
        raise HTTPException(status_code=404, detail="Shop not found")

    if my_shop["approval_status"] != "Approved":
        raise HTTPException(status_code=403, detail="Shop not approved. Cannot add products.")

    try:
        # A combo is ONE menu row holding MANY items at one price — the category
        # is forced so students always find every combo together under "Combo"
        # (the DB layer enforces the same rule, so no path can bypass it).
        is_combo = bool(data.is_combo)
        product = db.create_product({
            "shop_id": my_shop["id"],
            "name": data.name,
            "description": data.description,
            "price": data.price,
            "category": "Combo" if is_combo else data.category,
            "inventory": data.inventory,
            "prep_time": data.prep_time,
            "available": data.available,
            "is_combo": is_combo,
            "combo_items": data.combo_items if is_combo else "",
        })
    except Exception as e:
        # Full details go to the server log (Render) — the vendor only gets a
        # concise message. The store self-heals missing columns automatically,
        # so reaching here means the table is missing or truly broken.
        logger.error(
            f"Product creation failed for vendor {current_vendor['username']} "
            f"(shop {my_shop['id']}): {e}\n{traceback.format_exc()}"
        )
        raise HTTPException(
            status_code=400,
            detail="Could not add product. Please try again — if it keeps failing, contact the admin.",
        )
    if not product:
        raise HTTPException(status_code=400, detail="Could not add product — please try again.")

    # Notify admin of vendor product changes (never students)
    try:
        db.create_notification(
            title="New product added by vendor",
            message=f"{current_vendor['name']} added '{data.name}' (₹{data.price}) to {my_shop['name']}.",
            target_role="admin",
        )
    except Exception as e:
        logger.warning(f"Could not notify admin of product add: {e}")
    return product


@router.patch("/products/{product_id}")
def update_product(product_id: str, data: ProductUpdate, current_vendor: dict = Depends(get_current_vendor)):
    """Update a product in this vendor's shop."""
    product = db.get_product(product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    # Verify this vendor owns the product's shop
    my_shop = _find_shop(current_vendor)
    if not my_shop or product["shop_id"] != my_shop["id"]:
        raise HTTPException(status_code=403, detail="You don't own this product")

    updates = data.model_dump(exclude_unset=True)
    updated = db.update_product(product_id, updates)
    # Notify admin of vendor product changes
    try:
        change_parts = [f"{k} → {v}" for k, v in updates.items() if k != "available"]
        change_desc = ", ".join(change_parts) if change_parts else "details"
        db.create_notification(
            title="Product updated by vendor",
            message=f"{current_vendor['name']} updated '{product['name']}' ({change_desc}).",
            target_role="admin",
        )
    except Exception as e:
        logger.warning(f"Could not notify admin of product update: {e}")
    return updated


@router.delete("/products/{product_id}")
def delete_product(product_id: str, current_vendor: dict = Depends(get_current_vendor)):
    """Delete a product (permanently removed from the menu)."""
    product = db.get_product(product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    my_shop = _find_shop(current_vendor)
    if not my_shop or product["shop_id"] != my_shop["id"]:
        raise HTTPException(status_code=403, detail="You don't own this product")

    deleted = db.delete_product(product_id)
    if not deleted:
        raise HTTPException(status_code=400, detail="Could not delete product")
    # Notify admin of vendor product removal
    try:
        db.create_notification(
            title="Product removed by vendor",
            message=f"{current_vendor['name']} removed '{product['name']}' from the menu.",
            target_role="admin",
        )
    except Exception as e:
        logger.warning(f"Could not notify admin of product delete: {e}")
    return {"message": "Product removed", "product": product}
