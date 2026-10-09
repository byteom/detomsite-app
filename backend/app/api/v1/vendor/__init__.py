"""
Vendor Portal API — Shopkeeper registration, shop management, orders
"""
from fastapi import APIRouter

from .auth import router as auth_router
from .dashboard import router as dashboard_router
from .deps import (
    _KOLKATA_TZ,
    _find_shop,
    _ist_date,
    _my_shop,
    _shop_orders_merged,
    _sub_order_shape,
    _visible_to_shop,
    _visible_to_shop_with_payment,
    get_current_vendor,
)
from .orders import _notify_shop_whatsapp_verified
from .orders import router as orders_router
from .products import router as products_router
from .push import router as push_router
from .schemas import (
    AdminDuesPayment,
    AuthResponse,
    ProductCreate,
    ProductUpdate,
    PushSubscriptionCreate,
    PushSubscriptionKeys,
    ShopStatusUpdate,
    VendorForgotPasswordRequest,
    VendorLoginRequest,
    VendorOrderStatusUpdate,
    VendorRegisterRequest,
    VendorResetPasswordRequest,
    VendorResponse,
)

router = APIRouter()
router.include_router(auth_router)
router.include_router(dashboard_router)
router.include_router(orders_router)
router.include_router(products_router)
router.include_router(push_router)

__all__ = [
    "router",
    "get_current_vendor",
    "_find_shop",
    "_my_shop",
    "_sub_order_shape",
    "_shop_orders_merged",
    "_visible_to_shop",
    "_visible_to_shop_with_payment",
    "_notify_shop_whatsapp_verified",
    "_ist_date",
    "_KOLKATA_TZ",
    "VendorRegisterRequest",
    "VendorLoginRequest",
    "VendorResponse",
    "AuthResponse",
    "ShopStatusUpdate",
    "VendorOrderStatusUpdate",
    "AdminDuesPayment",
    "VendorForgotPasswordRequest",
    "VendorResetPasswordRequest",
    "ProductCreate",
    "ProductUpdate",
    "PushSubscriptionKeys",
    "PushSubscriptionCreate",
]
