from pydantic import BaseModel, Field
from typing import Optional
from app.core.status_values import PaymentStatus, SharePaymentStatus


class AdminLoginRequest(BaseModel):
    username: str
    password: str


class AdminResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: dict


class VendorItem(BaseModel):
    id: str
    name: str
    category: str
    shopkeeper_name: str
    shopkeeper_email: str
    phone: str
    approval_status: str
    status: str
    orders_today: int
    revenue_today: int
    created_at: str = ""


class AdminUserUpdateRequest(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    role: Optional[str] = None
    status: Optional[str] = None


class AdminUserStatusRequest(BaseModel):
    status: str = Field(..., pattern="^(active|blocked|suspended)$")


class ApprovalAction(BaseModel):
    action: str = Field(..., pattern="^(approve|reject)$")
    reason: str = ""


class AdminShopAction(BaseModel):
    action: str = Field(..., pattern="^(suspend|remove|restore)$")
    reason: str = ""


class FeedbackStatusUpdate(BaseModel):
    status: str = Field(..., pattern="^(Open|In Review|Fixed|Won't Fix)$")


class AdminShopSettingsUpdate(BaseModel):
    upi_id: str | None = None
    upi_enabled: bool | None = None
    cod_enabled: bool | None = None
    phone: str | None = None


class AdminProductCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str = ""
    price: int = Field(..., ge=1)
    category: str = Field(..., max_length=50)
    inventory: int = 0
    prep_time: int = 10
    available: bool = True
    is_combo: bool = False
    combo_items: str = ""


class AdminProductUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    price: int | None = None
    category: str | None = None
    inventory: int | None = None
    prep_time: int | None = None
    available: bool | None = None
    is_combo: bool | None = None
    combo_items: str | None = None


class AdminForgotPasswordRequest(BaseModel):
    identifier: str = Field(..., min_length=2, max_length=120, description="Admin username or email")


class AdminResetPasswordRequest(BaseModel):
    identifier: str = Field(..., min_length=2, max_length=120)
    otp: str = Field(..., min_length=4, max_length=10)
    new_password: str = Field(..., min_length=8, max_length=128)


class ShopPresentToggle(BaseModel):
    present: bool


class ConfirmOrderRequest(BaseModel):
    notification_id: Optional[str] = Field(default=None, max_length=40)


class RejectOrderRequest(BaseModel):
    mode: str = Field(default="resubmit", pattern="^(resubmit|cancel)$")
    reason: str = Field(default="", max_length=500)
    notification_id: Optional[str] = Field(default=None, max_length=40)


class BroadcastRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=120)
    message: str = Field(..., min_length=1, max_length=2000)


class SharePaymentStatusUpdate(BaseModel):
    status: SharePaymentStatus = "Completed"


class PaymentVerifyRequest(BaseModel):
    status: PaymentStatus = "Success"


class PushSubscriptionKeys(BaseModel):
    p256dh: str = Field(..., min_length=1)
    auth: str = Field(..., min_length=1)


class PushSubscriptionCreate(BaseModel):
    endpoint: str = Field(..., min_length=10)
    keys: PushSubscriptionKeys
