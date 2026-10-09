"""
Admin Portal API — Admin login with username/password from DB,
approve/reject shops, view all statistics
"""
from fastapi import APIRouter

from .auth import router as auth_router
from .dashboard import router as dashboard_router
from .deps import (
    ADMIN_PASSWORD,
    ADMIN_USERNAME,
    CONFIRM_ORDER_ACTION,
    CONFIRMABLE_ORDER_STATUSES,
    _KOLKATA_TZ,
    _confirmable_shape,
    _db,
    _ist_date,
    _notify_shop_whatsapp_verified,
    _rebuild_wa_link,
    _sms_log_fn,
    _sub_order_shape,
    verify_admin,
)
from .notifications import router as notifications_router
from .orders import router as orders_router
from .payments import router as payments_router
from .schemas import (
    AdminForgotPasswordRequest,
    AdminLoginRequest,
    AdminProductCreate,
    AdminProductUpdate,
    AdminResetPasswordRequest,
    AdminResponse,
    AdminShopAction,
    AdminShopSettingsUpdate,
    AdminUserStatusRequest,
    AdminUserUpdateRequest,
    ApprovalAction,
    BroadcastRequest,
    ConfirmOrderRequest,
    FeedbackStatusUpdate,
    PaymentVerifyRequest,
    PushSubscriptionCreate,
    PushSubscriptionKeys,
    SharePaymentStatusUpdate,
    ShopPresentToggle,
    VendorItem,
)
from .users import router as users_router
from .vendors import router as vendors_router

router = APIRouter()
router.include_router(auth_router)
router.include_router(dashboard_router)
router.include_router(vendors_router)
router.include_router(orders_router)
router.include_router(users_router)
router.include_router(payments_router)
router.include_router(notifications_router)

__all__ = [
    "router",
    "verify_admin",
    "ADMIN_USERNAME",
    "ADMIN_PASSWORD",
    "_db",
    "_KOLKATA_TZ",
    "_ist_date",
    "_sub_order_shape",
    "_rebuild_wa_link",
    "_sms_log_fn",
    "_confirmable_shape",
    "_notify_shop_whatsapp_verified",
    "CONFIRMABLE_ORDER_STATUSES",
    "CONFIRM_ORDER_ACTION",
    "AdminLoginRequest",
    "AdminResponse",
    "VendorItem",
    "AdminUserUpdateRequest",
    "AdminUserStatusRequest",
    "ApprovalAction",
    "AdminShopAction",
    "FeedbackStatusUpdate",
    "AdminShopSettingsUpdate",
    "AdminProductCreate",
    "AdminProductUpdate",
    "AdminForgotPasswordRequest",
    "AdminResetPasswordRequest",
    "ShopPresentToggle",
    "ConfirmOrderRequest",
    "BroadcastRequest",
    "SharePaymentStatusUpdate",
    "PaymentVerifyRequest",
    "PushSubscriptionKeys",
    "PushSubscriptionCreate",
]
