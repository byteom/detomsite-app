import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.store import store as db
from app.api.v1.local.common import (
    _cached_read,
    _db,
    _is_staff,
    _optional_user,
    _public_shop,
    _require_admin,
    get_current_local_user,
)
from app.api.v1.local.schemas import (
    LocalAnnouncementCreate,
    LocalAnnouncementToggle,
    LocalProductCreate,
    LocalProductUpdate,
    LocalShopCreate,
    LocalShopUpdate,
)

logger = logging.getLogger(__name__)

router = APIRouter()


def _load_home_feed() -> dict:
    """Storefront home feed in ONE worker hop: shops + products + announcements."""
    shops = db.list_shops(public_only=True)
    products = db.list_products()
    announcements = db.list_shop_announcements(None, True)
    notice = db.get_student_notice()
    batch_type = db.get_current_batch()
    return {
        "shops": [_public_shop(s) for s in shops],
        "products": products,
        "announcements": announcements,
        "notice": notice,
        "batch": {
            "batch_type": batch_type,
            "next_token": db.get_next_token(),
            "date_key": db._day_key(),
            "accepted_until": "12:30" if batch_type == "Afternoon" else "18:00",
            "delivery_window": "13:00-13:30" if batch_type == "Afternoon" else "19:30-19:45",
        },
    }


def _load_products_with_stock() -> list[dict]:
    """Every product annotated with the remaining stock for the live batch."""
    batch_type = db.get_current_batch()
    products = db.list_products()
    date_key = db._day_key()
    stocks = db.get_product_stocks(batch_type, date_key)
    for p in products:
        p["batch_type"] = batch_type
        p["stock_left"] = stocks.get(p["id"], 0)
    return products


@router.get("/shops")
async def shops(
    public_only: bool = False,
    search: Optional[str] = Query(None),
    limit: Optional[int] = Query(None, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: Optional[dict] = Depends(_optional_user),
):
    """List shops with optional database-backed name/category/description search."""
    cache_key = f"shops:{public_only}:{search or ''}:{limit}:{offset}"
    rows = await _cached_read(
        120,
        cache_key,
        db.list_shops,
        public_only=public_only,
        search=search,
        limit=limit,
        offset=offset,
    )
    if _is_staff(user):
        return rows
    return [_public_shop(s) for s in rows]


@router.post("/shops")
async def create_shop(data: LocalShopCreate, _admin: dict = Depends(_require_admin)):
    return await _db(db.create_shop, data.model_dump())


@router.patch("/shops/{shop_id}")
async def patch_shop(shop_id: str, data: LocalShopUpdate, _admin: dict = Depends(_require_admin)):
    shop = await _db(db.update_shop, shop_id, data.model_dump(exclude_unset=True))
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    return shop


@router.get("/shops/{shop_id}")
async def shop(shop_id: str, user: Optional[dict] = Depends(_optional_user)):
    result = await _cached_read(60, f"shop:{shop_id}", db.get_shop, shop_id)
    if not result:
        raise HTTPException(status_code=404, detail="Shop not found")
    if _is_staff(user):
        return result
    return _public_shop(result)


@router.get("/products")
async def products(
    shop_id: str | None = None,
    search: Optional[str] = Query(None),
    limit: Optional[int] = Query(None, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """List products with optional database-backed search and shop filtering."""
    cache_key = f"products:{shop_id or ''}:{search or ''}:{limit}:{offset}"
    return await _cached_read(
        60,
        cache_key,
        db.list_products,
        shop_id=shop_id,
        search=search,
        limit=limit,
        offset=offset,
    )


@router.get("/menu-summary")
async def menu_summary(match: Optional[str] = Query(None, max_length=200)):
    """Per-shop menu flags (dish count, has-combo) plus per-shop match counts."""
    keywords = [k.strip() for k in (match or "").split(",") if k.strip()][:5]
    cache_key = f"menu-summary:{','.join(keywords)}"
    return await _cached_read(120, cache_key, db.menu_summary, keywords=keywords)


@router.get("/search")
async def search_endpoint(
    q: str = Query(..., min_length=1),
    user: Optional[dict] = Depends(_optional_user),
):
    """Unified search endpoint across approved kitchens and dishes."""
    term = q.strip()
    if not term:
        return {"query": "", "shops": [], "products": [], "total": 0}
    matching_shops = await _cached_read(
        5, f"search_shops:{term}", db.list_shops, public_only=True, search=term
    )
    matching_products = await _cached_read(
        5, f"search_products:{term}", db.list_products, search=term
    )
    if not _is_staff(user):
        matching_shops = [_public_shop(s) for s in matching_shops]
    return {
        "query": term,
        "shops": matching_shops,
        "products": matching_products,
        "total": len(matching_shops) + len(matching_products),
    }


@router.post("/products")
async def add_product(data: LocalProductCreate, _admin: dict = Depends(_require_admin)):
    return await _db(db.create_product, data.model_dump())


@router.patch("/products/{product_id}")
async def patch_product(
    product_id: str,
    data: LocalProductUpdate,
    _admin: dict = Depends(_require_admin),
):
    product = await _db(db.update_product, product_id, data.model_dump(exclude_unset=True))
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


@router.get("/home-feed")
async def home_feed():
    """Aggregated storefront payload for the Home page (1 request, not 5)."""
    return await _cached_read(60, "home-feed", _load_home_feed)


@router.get("/checkout-data")
async def checkout_data(shop_ids: str = Query("", max_length=600)):
    """Everything the checkout and payment pages need, in ONE cached request."""
    wanted = [s.strip() for s in (shop_ids or "").split(",") if s.strip()][:20]

    async def _load():
        products_by_shop: dict[str, list] = {}
        sem = asyncio.Semaphore(5)

        async def _one(sid: str) -> tuple[str, list]:
            async with sem:
                rows = await _db(db.list_products, shop_id=sid, limit=500) or []
            return sid, [p for p in rows if p.get("available")]

        def _load_shops(sids: list[str]) -> list[dict]:
            return [s for s in (db.get_shop(sid) for sid in sids) if s]

        async def _shops() -> list[dict]:
            return await _db(_load_shops, wanted) if wanted else []

        prod_pairs, shop_rows, settings = await asyncio.gather(
            asyncio.gather(*[_one(s) for s in wanted]),
            _shops(),
            _db(db.get_payment_settings),
        )
        for sid, rows in prod_pairs:
            products_by_shop[sid] = rows

        shops = [_public_shop(shop) for shop in shop_rows]
        return {
            "shops": shops,
            "products": {s["id"]: products_by_shop.get(str(s["id"]), []) for s in shops},
            "payment_settings": settings,
        }

    key = "checkout:" + ",".join(sorted(wanted))
    return await _cached_read(30, key, _load)


@router.get("/products/stock")
async def products_with_stock(_user: dict = Depends(get_current_local_user)):
    """Every product with its per-batch remaining stock."""
    return await _cached_read(5, "products-stock", _load_products_with_stock)


@router.get("/announcements")
async def announcements(shop_id: str | None = None, active_only: bool = True):
    """Shop announcement bar items shown to students on the shop page."""
    return await _db(db.list_shop_announcements, shop_id, active_only)


@router.post("/announcements")
async def add_announcement(
    data: LocalAnnouncementCreate,
    _admin: dict = Depends(_require_admin),
):
    ann = await _db(db.create_shop_announcement, data.shop_id, data.message)
    if not ann:
        raise HTTPException(status_code=400, detail="Could not post announcement.")
    return ann


@router.patch("/announcements/{ann_id}")
async def patch_announcement(
    ann_id: str,
    data: LocalAnnouncementToggle,
    _admin: dict = Depends(_require_admin),
):
    ann = await _db(db.toggle_shop_announcement, ann_id, bool(data.is_active))
    if not ann:
        raise HTTPException(status_code=404, detail="Announcement not found")
    return ann
