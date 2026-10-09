from datetime import datetime
from pydantic import BaseModel, Field
from typing import Optional, Any
from app.core.status_values import ShopStatus, VendorOrderStatus


class VendorRegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: str = Field(..., max_length=100)
    password: str = Field(..., min_length=4, max_length=128)
    name: str = Field(..., min_length=1, max_length=100)
    phone: str = Field(..., max_length=15)
    shop_name: str = Field(..., min_length=2, max_length=100)
    shop_category: str = Field(..., max_length=50)
    shop_description: str = Field(default="", max_length=500)
    upi_id: str = Field(default="", max_length=100)


class VendorLoginRequest(BaseModel):
    username: str
    password: str


class VendorResponse(BaseModel):
    id: int
    username: str
    name: str
    role: str
    created_at: datetime


class AuthResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: VendorResponse


class ShopStatusUpdate(BaseModel):
    present: bool | None = None
    # PENTEST FIX (finding 12): the shop status drives every portal's badge and
    # the student-facing "open?" filter, so it can't be a free-form string.
    status: ShopStatus | None = None
    opening_time: str | None = Field(default=None, max_length=10)
    closing_time: str | None = Field(default=None, max_length=10)
    upi_id: str | None = Field(default=None, max_length=100)
    upi_enabled: bool | None = None
    cod_enabled: bool | None = None
    category: str | None = Field(default=None, max_length=50)


class VendorOrderStatusUpdate(BaseModel):
    status: VendorOrderStatus
    notes: str | None = Field(default=None, max_length=500)


class AdminDuesPayment(BaseModel):
    amount: int | None = None


class VendorForgotPasswordRequest(BaseModel):
    identifier: str = Field(..., min_length=2, max_length=120, description="Username or registered email")


class VendorResetPasswordRequest(BaseModel):
    identifier: str = Field(..., min_length=2, max_length=120)
    otp: str = Field(..., min_length=4, max_length=10)
    new_password: str = Field(..., min_length=8, max_length=128)


class ProductCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str = ""
    price: int = Field(..., ge=1)
    category: str = Field(..., max_length=50)
    inventory: int = 0
    prep_time: int = 10
    available: bool = True
    is_combo: bool = False
    combo_items: str = Field(default="", max_length=500)


class ProductUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    price: int | None = None
    category: str | None = None
    inventory: int | None = None
    prep_time: int | None = None
    available: bool | None = None
    is_combo: bool | None = None
    combo_items: str | None = Field(default=None, max_length=500)


class PushSubscriptionKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscriptionCreate(BaseModel):
    endpoint: str = Field(..., min_length=10)
    keys: PushSubscriptionKeys
