from datetime import datetime
import re
from typing import Any, Literal, Optional
from pydantic import BaseModel, EmailStr, Field, field_validator

from app.core.status_values import (
    ComplaintStatus,
    MenuChangeStatus,
    OrderStatus,
    PaymentProofStatus,
    PaymentStatus,
    RefundStatus,
    ShopApprovalStatus,
    ShopStatus,
)
from app.api.v1.local.common import (
    MAX_LINE_QUANTITY,
    _clean_payment_method,
    _require_vitap_location,
)


class LocalSessionCreate(BaseModel):
    email: EmailStr
    name: str = Field(..., max_length=100)
    role: str = Field(..., max_length=20)


class LocalShopUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    category: str | None = Field(default=None, max_length=50)
    description: str | None = Field(default=None, max_length=1000)
    opening_time: str | None = Field(default=None, max_length=20)
    closing_time: str | None = Field(default=None, max_length=20)
    present: bool | None = None
    status: ShopStatus | None = None
    approval_status: ShopApprovalStatus | None = None
    shopkeeper_email: str | None = Field(default=None, max_length=200)
    shopkeeper_name: str | None = Field(default=None, max_length=100)
    phone: str | None = Field(default=None, max_length=30)
    whatsapp_number: str | None = Field(default=None, max_length=30)
    upi_id: str | None = Field(default=None, max_length=100)


class LocalShopCreate(BaseModel):
    name: str = Field(..., max_length=100)
    category: str = Field(..., max_length=50)
    description: str = Field(default="", max_length=1000)
    shopkeeper_email: EmailStr
    shopkeeper_name: str = Field(..., max_length=100)
    phone: str = Field(..., max_length=30)
    opening_time: str = Field(default="09:00 AM", max_length=20)
    closing_time: str = Field(default="09:00 PM", max_length=20)
    upi_id: str = Field(default="", max_length=100)


class LocalProductCreate(BaseModel):
    shop_id: str = Field(..., max_length=100)
    name: str = Field(..., max_length=100)
    description: str = Field(default="", max_length=1000)
    price: int
    category: str = Field(..., max_length=50)
    inventory: int = 0
    prep_time: int = 10
    available: bool = True
    is_combo: bool = False
    combo_items: str = Field(default="", max_length=500)


class LocalProductUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    description: str | None = Field(default=None, max_length=1000)
    price: int | None = None
    pending_price: int | None = None
    category: str | None = Field(default=None, max_length=50)
    inventory: int | None = None
    prep_time: int | None = None
    available: bool | None = None
    is_combo: bool | None = None
    combo_items: str | None = Field(default=None, max_length=500)


class LocalOrderStatusUpdate(BaseModel):
    status: OrderStatus


class LocalOrderItem(BaseModel):
    product_id: str = Field(..., max_length=100)
    quantity: int = Field(1, ge=1, le=MAX_LINE_QUANTITY)


class LocalOrderCreate(BaseModel):
    shop_id: str = Field(..., max_length=100)
    items: list[LocalOrderItem]
    student_name: str = Field(default="Student", max_length=100)
    student_phone: str = Field(default="", max_length=30)
    delivery_location: str = Field(..., max_length=300)
    delivery_slot: str = Field(..., max_length=50)
    pending_payment: bool = False
    payment_method: str = "UPI"  # 'UPI' | 'COD' | 'Razorpay'
    client_ref: str = Field(default="", max_length=64, pattern=r"^[A-Za-z0-9_-]{1,64}$")

    @field_validator("delivery_location")
    @classmethod
    def _validate_location(cls, value: str) -> str:
        return _require_vitap_location(value)

    @field_validator("payment_method")
    @classmethod
    def _validate_payment_method(cls, value: str) -> str:
        return _clean_payment_method(value, ("UPI", "COD"))


class LocalMultiShopOrder(BaseModel):
    shops: list[dict]
    student_name: str = Field(default="Student", max_length=100)
    student_phone: str = Field(default="", max_length=30)
    student_email: str = Field(default="", max_length=200)
    delivery_location: str = Field(..., max_length=300)
    delivery_slot: str = Field(default="", max_length=50)
    payment_method: str = "UTR"  # 'UTR' | 'COD'

    @field_validator("delivery_location")
    @classmethod
    def _validate_location(cls, value: str) -> str:
        return _require_vitap_location(value)

    @field_validator("payment_method")
    @classmethod
    def _validate_payment_method(cls, value: str) -> str:
        return _clean_payment_method(value, ("UTR", "COD", "UPI", "MANUAL UTR"))


class LocalSubOrderStatusUpdate(BaseModel):
    status: OrderStatus
    notes: str = Field(default="", max_length=2000)


class LocalComplaintCreate(BaseModel):
    parent_order_id: str = Field(..., max_length=100)
    student_name: str = Field(default="", max_length=100)
    student_phone: str = Field(default="", max_length=30)
    shop_id: str = Field(default="", max_length=100)
    shop_name: str = Field(default="", max_length=200)
    subject: str = Field(..., max_length=300)
    message: str = Field(..., max_length=5000)
    proof_url: str = Field(default="", max_length=500)


class LocalRefundCreate(BaseModel):
    parent_order_id: str = Field(..., max_length=100)
    sub_order_id: str = Field(default="", max_length=100)
    student_name: str = Field(default="", max_length=100)
    shop_name: str = Field(default="", max_length=200)
    original_amount: int = 0
    refund_amount: int = 0
    refund_type: str = Field(default="Full", max_length=50)


class LocalAnnouncementCreate(BaseModel):
    shop_id: str = Field(..., max_length=100)
    message: str = Field(..., max_length=1000)


class LocalAnnouncementToggle(BaseModel):
    is_active: int = 1


class LocalStudentNoticeUpdate(BaseModel):
    enabled: bool | None = None
    text: str | None = Field(default=None, max_length=500)


class LocalMenuChangeCreate(BaseModel):
    shop_id: str = Field(..., max_length=100)
    product_id: str = Field(default="", max_length=100)
    change_type: str = Field(..., max_length=100)
    old_value: str = Field(default="", max_length=500)
    new_value: str = Field(default="", max_length=500)


class LocalComplaintStatusUpdate(BaseModel):
    status: ComplaintStatus
    admin_notes: str = Field(default="", max_length=2000)


class LocalRefundUpdate(BaseModel):
    status: RefundStatus
    refund_utr: str = Field(default="", max_length=40)
    admin_notes: str = Field(default="", max_length=2000)


class LocalMenuChangeApprove(BaseModel):
    status: MenuChangeStatus
    admin_notes: str = Field(default="", max_length=2000)


class LocalPaymentCreate(BaseModel):
    order_id: str = Field(..., max_length=100)
    amount: int = Field(..., ge=1, le=1_000_000)
    method: str
    utr_number: str | None = Field(default=None, max_length=40)

    @field_validator("method")
    @classmethod
    def _validate_method(cls, value: str) -> str:
        if (value or "").strip().lower() not in {"manual utr", "upi", "cod"}:
            raise ValueError("Unsupported payment method")
        return value


class LocalPaymentStatusUpdate(BaseModel):
    status: PaymentStatus


class LocalPaymentSettings(BaseModel):
    manual_enabled: bool | None = None
    upi_id: str | None = Field(default=None, max_length=100)
    receiver_name: str | None = Field(default=None, max_length=100)
    instructions: str | None = Field(default=None, max_length=1000)
    razorpay_enabled: bool | None = None


class LocalTicketCreate(BaseModel):
    name: str = Field(..., max_length=100)
    email: EmailStr
    phone_number: str = Field(..., max_length=30)
    category: str = Field(..., max_length=50)
    title: str = Field(..., max_length=200)
    description: str = Field(..., max_length=3000)


class LocalFeedbackCreate(BaseModel):
    category: str = Field(..., pattern="^(Bug|Improvement|Suggestion|Other)$")
    subject: str = Field(..., min_length=3, max_length=150)
    message: str = Field(..., min_length=5, max_length=2000)
    page: str = Field(default="", max_length=200)
    source: str = Field(default="User", pattern="^(User|ATS)$")
    name: str = Field(default="", max_length=100)
    email: str = Field(default="", max_length=200)


class LocalAuthRegister(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=4, max_length=128)
    name: str = Field(..., min_length=1, max_length=100)
    role: str = Field(..., pattern="^(student|shopkeeper|admin)$")
    email: str = Field(default="", max_length=200)
    phone: str = Field(default="", max_length=30)


class LocalAuthLogin(BaseModel):
    username: str = Field(..., max_length=100)
    password: str = Field(..., max_length=128)


class LocalPhoneOnboarding(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    phone: str = Field(..., min_length=7, max_length=20)
    campus: str = Field(default="", max_length=100)
    default_delivery_location: str = Field(default="", max_length=300)
    password: str = Field(default="", max_length=128)


class LocalAuthUser(BaseModel):
    id: int
    username: str
    name: str
    role: str
    email: str = ""
    phone: str = ""
    created_at: datetime


class LocalAuthResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: LocalAuthUser
    generated_password: Optional[str] = None


class LocalProfileUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    email: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=30)
    password: str | None = Field(default=None, min_length=4, max_length=128)


class LocalIncomingSms(BaseModel):
    phone: str = Field(default="", max_length=30)
    text: str = Field(default="", max_length=2000)


class LocalPaymentUtr(BaseModel):
    order_id: str = Field(..., max_length=100)
    utr_number: str = Field(..., min_length=6, max_length=40)


class LocalPaymentClaimConfirm(BaseModel):
    utr_number: str = Field(..., max_length=40)


class LocalSmsMatch(BaseModel):
    phone: str = Field(default="", max_length=30)
    utr: str = Field(default="", max_length=40, pattern=r"^[A-Za-z0-9]*$")
    amount: float = Field(..., gt=0, le=1_000_000, allow_inf_nan=False)


class LocalRazorpayOrderCreate(BaseModel):
    amount: int = Field(..., ge=1, le=100_000_000)
    currency: str = Field(default="INR", max_length=8)
    order_id: str = Field(..., max_length=100)

    @field_validator("currency")
    @classmethod
    def _validate_currency(cls, value: str) -> str:
        norm = (value or "").strip().upper()
        if norm != "INR":
            raise ValueError("Only INR payments are supported")
        return norm


class LocalRazorpayVerify(BaseModel):
    razorpay_order_id: str = Field(..., max_length=64)
    razorpay_payment_id: str = Field(..., max_length=64)
    razorpay_signature: str = Field(..., max_length=256)
    order_id: str = Field(..., max_length=100)


class LocalPaymentProofVerify(BaseModel):
    action: Literal["approve", "reject"]
    reason: str = Field(default="", max_length=500)
