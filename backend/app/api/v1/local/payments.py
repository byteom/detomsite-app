import asyncio
import logging
import time
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile

from app.core.config import settings
from app.api.v1.local.common import rate_allow, rate_ip
from app.core.store import store as db
from app.services import cloudinary_service, telegram_service
from app.api.v1.local.common import (
    _AWAITING_PAYMENT_STATUSES,
    _cached_read,
    _db,
    _is_valid_utr,
    _push_admin,
    _require_admin,
    _resolve_owned_order,
    _same_student,
    get_current_local_user,
)
from app.api.v1.local.schemas import (
    LocalPaymentClaimConfirm,
    LocalPaymentCreate,
    LocalPaymentProofVerify,
    LocalPaymentSettings,
    LocalPaymentStatusUpdate,
    LocalPaymentUtr,
    LocalRazorpayOrderCreate,
    LocalRazorpayVerify,
    LocalStudentNoticeUpdate,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/orders/{order_id}/confirm-payment")
async def confirm_own_payment(
    order_id: str,
    data: LocalPaymentClaimConfirm,
    current_user: dict = Depends(get_current_local_user),
):
    """CUT OFF — automated UTR-claim verification is disabled."""
    raise HTTPException(
        status_code=410,
        detail="Automatic payment confirmation is disabled. Please submit your UTR + payment screenshot for admin verification.",
    )


@router.post("/payments/utr")
async def submit_payment_utr(
    data: LocalPaymentUtr,
    request: Request,
    current_user: dict = Depends(get_current_local_user),
):
    """CUT OFF — UTR-only submission is disabled (screenshot is mandatory)."""
    raise HTTPException(
        status_code=410,
        detail="UTR-only submission is disabled. Please submit your UTR together with the payment screenshot for admin verification.",
    )


@router.get("/payments")
async def payments(_admin: dict = Depends(_require_admin)):
    """Payment records (with bank UTRs) are admin-only."""
    return await _cached_read(10, "payments", db.list_payments)


@router.post("/payments")
async def add_payment(
    data: LocalPaymentCreate,
    request: Request,
    current_user: dict = Depends(get_current_local_user),
):
    if not rate_allow(
        "payment",
        f"{current_user.get('id')}:{rate_ip(request)}",
        max_attempts=20,
        window_sec=300,
    ):
        raise HTTPException(
            status_code=429,
            detail="Too many payment submissions — please wait a few minutes and try again.",
        )

    utr_claim = (data.utr_number or "").strip().upper()
    if utr_claim and not _is_valid_utr(utr_claim):
        raise HTTPException(
            status_code=422,
            detail="That doesn't look like a UTR — it is usually a 12-digit number with no spaces or symbols.",
        )

    order, is_parent = await _resolve_owned_order(data.order_id, current_user)

    server_total = int(round(float(order.get("total") or 0)))
    if server_total > 0 and int(data.amount) != server_total:
        logger.warning(
            "Payment amount override for order %s: client=%s server=%s (user=%s)",
            data.order_id,
            data.amount,
            server_total,
            current_user.get("id"),
        )
        data.amount = server_total

    if current_user.get("role") != "admin" and not _same_student(current_user, order):
        raise HTTPException(status_code=403, detail="You can only pay for your own orders")

    if data.method == "Manual UTR":
        if is_parent:
            payment_settings_val = await _db(db.get_payment_settings)
            if (
                not payment_settings_val["manual_enabled"]
                or not payment_settings_val["upi_id"]
            ):
                raise HTTPException(
                    status_code=400, detail="No UPI payment configured for this order"
                )
        else:
            order = await _db(db.get_order, data.order_id)
            shop = await _db(db.get_shop, order["shop_id"]) if order else None
            shop_upi = (shop or {}).get("upi_id", "") or ""
            payment_settings_val = await _db(db.get_payment_settings)
            if not shop_upi and (
                not payment_settings_val["manual_enabled"]
                or not payment_settings_val["upi_id"]
            ):
                raise HTTPException(
                    status_code=400, detail="No UPI payment configured for this shop"
                )
            if shop is not None and not shop.get("upi_enabled", 1):
                raise HTTPException(status_code=400, detail="This shop has turned off UPI payments.")

    if (
        current_user.get("role") != "admin"
        and str(order.get("status") or "") not in _AWAITING_PAYMENT_STATUSES
    ):
        raise HTTPException(
            status_code=409,
            detail="This order is no longer awaiting payment — no new payment can be recorded against it.",
        )

    settled = await _db(db.get_payment_by_order_id, data.order_id)
    if settled and str(settled.get("status") or "") == "Success":
        raise HTTPException(status_code=409, detail="This order has already been paid.")

    if settled and str(settled.get("status") or "") == "Pending" and not utr_claim:
        return settled

    if utr_claim:
        existing = await _db(db.get_payment_by_utr, utr_claim)
        if existing and str(existing.get("order_id") or "") != str(data.order_id):
            raise HTTPException(
                status_code=409,
                detail="This UTR is already saved on another order — double-check the number, or leave it empty and submit it on the order page.",
            )

    if not is_parent:
        payment = await _db(
            db.create_payment,
            data.order_id,
            data.amount,
            data.method,
            data.utr_number,
        )
    else:
        payment = await _db(
            db.record_parent_payment,
            data.order_id,
            data.amount,
            data.method,
            data.utr_number,
        )
    if not payment:
        raise HTTPException(status_code=400, detail="Unable to create payment")

    if str(data.method or "").upper() != "COD":
        _push_admin(
            "New payment to verify",
            f"{current_user.get('name') or current_user.get('username')} submitted {'a multi-shop' if is_parent else 'a'} payment proof "
            f"(₹{data.amount}) — verify in Admin Center → Payments.",
            tag="payment-verify",
        )
    return payment


@router.post("/payments/create-razorpay-order")
async def create_razorpay_order(
    data: LocalRazorpayOrderCreate,
    current_user: dict = Depends(get_current_local_user),
):
    """CUT OFF — automated Razorpay verification is disabled."""
    raise HTTPException(
        status_code=410,
        detail="Online gateway payments are disabled. Please pay via UPI and submit your UTR + payment screenshot for admin verification.",
    )


@router.post("/payments/verify-razorpay")
async def verify_razorpay_payment(
    data: LocalRazorpayVerify,
    current_user: dict = Depends(get_current_local_user),
):
    """CUT OFF — automated Razorpay verification is disabled."""
    raise HTTPException(
        status_code=410,
        detail="Online gateway payments are disabled. Please pay via UPI and submit your UTR + payment screenshot for admin verification.",
    )


@router.get("/payment-settings")
async def payment_settings():
    return await _cached_read(30, "payment-settings", db.get_payment_settings)


@router.patch("/payment-settings")
async def patch_payment_settings(
    data: LocalPaymentSettings,
    _admin: dict = Depends(_require_admin),
):
    return await _db(db.update_payment_settings, data.model_dump(exclude_unset=True))


@router.get("/student-notice")
async def student_notice():
    return await _cached_read(120, "student-notice", db.get_student_notice)


@router.patch("/student-notice")
async def patch_student_notice(
    data: LocalStudentNoticeUpdate,
    _admin: dict = Depends(_require_admin),
):
    return await _db(db.update_student_notice, data.model_dump(exclude_unset=True))


@router.patch("/payments/{payment_id}/status")
async def patch_payment_status(
    payment_id: str,
    data: LocalPaymentStatusUpdate,
    _admin: dict = Depends(_require_admin),
):
    import app.api.v1.local as local_mod

    payment = await _db(db.update_payment_status, payment_id, data.status)
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    if str(data.status or "").upper() == "SUCCESS":
        order_id = str(payment.get("order_id") or "")
        if order_id:
            order = await _db(db.get_order, order_id)
            if order:
                notify_paid = getattr(
                    local_mod, "_notify_shop_of_paid_order", None
                )
                if notify_paid:
                    await notify_paid(order)

    return payment


def _proof_shape(order: dict, proof: dict | None, is_parent: bool) -> dict:
    """Public proof view: screenshot URL is shown, but nothing sensitive beyond order."""
    proof = proof or {}
    return {
        "order_id": order.get("id"),
        "payment_id": proof.get("id") or "",
        "is_parent": is_parent,
        "order_status": order.get("status"),
        "payment_method": order.get("payment_method"),
        "amount": order.get("total"),
        "proof_status": proof.get("proof_status")
        or proof.get("payment_proof_status")
        or "PENDING_PAYMENT",
        "legacy_status": proof.get("status") or "",
        "utr_saved": bool(str(proof.get("utr_number") or "").strip()),
        "payment_screenshot_url": proof.get("payment_screenshot_url") or "",
        "payment_submitted_at": str(proof.get("payment_submitted_at") or ""),
        "payment_verified_at": str(proof.get("payment_verified_at") or ""),
        "payment_verified_by": proof.get("payment_verified_by") or "",
        "payment_rejection_reason": proof.get("payment_rejection_reason") or "",
    }


async def _current_proof(order_id: str, is_parent: bool) -> dict | None:
    try:
        if is_parent:
            return await _db(db.get_parent_payment, order_id)
        return await _db(db.get_payment_by_order_id, order_id)
    except Exception as e:
        logger.warning(f"proof lookup failed for {order_id}: {e}")
        return None


@router.post("/payments/proof")
async def submit_payment_proof(
    request: Request,
    order_id: str = Form(..., max_length=100),
    utr_number: str = Form(..., max_length=40),
    screenshot: UploadFile = File(...),
    current_user: dict = Depends(get_current_local_user),
):
    """Submit UTR + payment screenshot for manual admin verification."""
    if not rate_allow(
        "proof",
        f"{current_user.get('id')}:{rate_ip(request)}",
        max_attempts=12,
        window_sec=300,
    ):
        raise HTTPException(
            status_code=429,
            detail="Too many proof submissions — please wait a few minutes and try again.",
        )

    order_id = (order_id or "").strip()
    order, is_parent = await _resolve_owned_order(order_id, current_user)

    if str(order.get("payment_method") or "").upper() == "COD":
        raise HTTPException(
            status_code=400, detail="Cash-on-delivery orders need no payment proof."
        )
    if str(order.get("status") or "") not in _AWAITING_PAYMENT_STATUSES:
        raise HTTPException(
            status_code=409,
            detail="This order is no longer awaiting payment — nothing left to verify.",
        )

    utr = (utr_number or "").strip().upper()
    if not _is_valid_utr(utr):
        raise HTTPException(
            status_code=422,
            detail="That doesn't look like a UTR — it is usually a 12-digit number with no spaces or symbols.",
        )

    existing = await _db(db.get_payment_by_utr, utr)
    if existing and str(existing.get("order_id") or "") != str(order_id):
        raise HTTPException(
            status_code=409,
            detail="This UTR is already saved on another order — double-check the number.",
        )

    current = await _current_proof(order_id, is_parent)
    current_status = str(
        (current or {}).get("proof_status")
        or (current or {}).get("payment_proof_status")
        or "PENDING_PAYMENT"
    )
    if current_status == "PAYMENT_PROOF_SUBMITTED":
        raise HTTPException(
            status_code=409,
            detail="Payment proof already submitted — it is waiting for admin verification.",
        )
    if current_status == "PAYMENT_APPROVED":
        raise HTTPException(status_code=409, detail="This order has already been paid.")

    try:
        raw = await screenshot.read()
    except Exception:
        raise HTTPException(status_code=400, detail="Could not read the uploaded screenshot.")
    if not raw:
        raise HTTPException(status_code=422, detail="A payment screenshot is required.")
    if len(raw) > cloudinary_service.max_bytes():
        raise HTTPException(
            status_code=413,
            detail=f"Screenshot must be {settings.PAYMENT_SCREENSHOT_MAX_MB} MB or smaller.",
        )
    try:
        cloudinary_service.validate_image_bytes(raw)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    if not cloudinary_service.is_configured():
        raise HTTPException(
            status_code=503,
            detail="Screenshot storage is not configured on this server.",
        )
    try:
        uploaded = await asyncio.to_thread(
            cloudinary_service.upload_image,
            raw,
            folder=f"payments/{order_id}",
            public_id=f"proof-{order_id}",
        )
    except Exception as e:
        logger.error(f"Proof upload failed for order {order_id}: {e}")
        raise HTTPException(
            status_code=502, detail="Could not store the screenshot — please try again."
        )
    if not uploaded.get("secure_url"):
        raise HTTPException(
            status_code=502, detail="Could not store the screenshot — please try again."
        )

    server_total = int(round(float(order.get("total") or 0)))
    if is_parent:
        saved = await _db(
            db.save_parent_payment_proof,
            order_id,
            server_total,
            utr,
            uploaded["secure_url"],
            uploaded.get("public_id", ""),
        )
    else:
        saved = await _db(
            db.save_single_payment_proof,
            order_id,
            server_total,
            utr,
            uploaded["secure_url"],
            uploaded.get("public_id", ""),
        )
    if not saved:
        cloudinary_service.delete_image(uploaded.get("public_id", ""))
        raise HTTPException(
            status_code=400, detail="Could not save the payment proof — please try again."
        )

    customer = str(order.get("student_name") or current_user.get("name") or "A student")
    try:
        sub_count = 0
        try:
            full = await _db(db.get_parent_order, order_id) if is_parent else None
            subs = (full or {}).get("sub_orders") or []
            sub_count = len(subs)
        except Exception:
            sub_count = 0
        telegram_service.notify_payment_proof_async(
            customer_name=customer,
            order_id=order_id,
            order_token=str(order.get("token") or ""),
            amount=server_total,
            utr=utr,
            item_count=sub_count if is_parent else 1,
            submitted_at=time.strftime("%d %b %Y, %I:%M %p"),
        )
    except Exception as e:
        logger.warning(f"Telegram proof notification failed for {order_id}: {e}")

    _push_admin(
        "New payment proof to verify",
        f"{customer} submitted UPI proof (₹{server_total}, UTR {utr}) — verify in Admin → Orders.",
        tag="payment-verify",
    )

    return {
        "message": "Payment proof submitted successfully. Your order is waiting for admin verification.",
        "order_id": order_id,
        "proof_status": "PAYMENT_PROOF_SUBMITTED",
        "utr_saved": True,
    }


@router.get("/payments/verification-queue")
async def verification_queue(_admin: dict = Depends(_require_admin)):
    """Admin queue of proofs awaiting manual verification (newest first)."""
    queue: list[dict] = []
    try:
        singles = await _db(db.list_payments)
    except Exception as e:
        logger.warning(f"verification queue list_payments failed: {e}")
        singles = []
    for p in singles or []:
        if str(p.get("proof_status") or "") != "PAYMENT_PROOF_SUBMITTED":
            continue
        order = None
        try:
            order = await _db(db.get_order, str(p.get("order_id") or ""))
        except Exception:
            order = None
        queue.append(
            {
                "payment_id": p.get("id"),
                "order_id": p.get("order_id"),
                "is_parent": False,
                "amount": p.get("amount"),
                "method": p.get("method"),
                "utr_number": p.get("utr_number"),
                "payment_screenshot_url": p.get("payment_screenshot_url") or "",
                "payment_submitted_at": str(
                    p.get("payment_submitted_at") or p.get("created_at") or ""
                ),
                "proof_status": "PAYMENT_PROOF_SUBMITTED",
                "customer_name": (order or {}).get("student_name") or "",
                "customer_phone": (order or {}).get("student_phone") or "",
                "customer_email": (order or {}).get("student_email") or "",
                "owner_user_id": (order or {}).get("owner_user_id") or "",
                "order_token": (order or {}).get("token") or "",
                "order_status": (order or {}).get("status") or "",
            }
        )
    try:
        parents = await _db(db.list_parent_payments)
    except Exception as e:
        logger.warning(f"verification queue list_parent_payments failed: {e}")
        parents = []
    for p in parents or []:
        shape_status = str(p.get("proof_status") or "")
        if shape_status != "PAYMENT_PROOF_SUBMITTED":
            continue
        order = None
        try:
            order = await _db(db.get_parent_order, str(p.get("order_id") or ""))
        except Exception:
            order = None
        order = order or {}
        queue.append(
            {
                "payment_id": p.get("id"),
                "order_id": p.get("order_id"),
                "is_parent": True,
                "amount": p.get("amount"),
                "method": p.get("method"),
                "utr_number": p.get("utr_number"),
                "payment_screenshot_url": p.get("payment_screenshot_url") or "",
                "payment_submitted_at": str(
                    p.get("payment_submitted_at") or p.get("created_at") or ""
                ),
                "proof_status": "PAYMENT_PROOF_SUBMITTED",
                "customer_name": order.get("student_name") or "",
                "customer_phone": order.get("student_phone") or "",
                "customer_email": order.get("student_email") or "",
                "owner_user_id": order.get("owner_user_id") or "",
                "order_token": order.get("token") or "",
                "order_status": order.get("status") or "",
            }
        )
    queue.sort(key=lambda q: q.get("payment_submitted_at") or "", reverse=True)
    return queue


@router.get("/payments/proof/{order_id}")
async def payment_proof_detail(
    order_id: str,
    current_user: dict = Depends(get_current_local_user),
):
    """One order's full verification view: order + items + proof + customer."""
    order, is_parent = await _resolve_owned_order(order_id, current_user)
    proof = await _current_proof(order_id, is_parent)
    view = _proof_shape(order, proof, is_parent)
    if is_parent:
        full = None
        try:
            full = await _db(db.get_parent_order, order_id)
        except Exception:
            full = None
        view["sub_orders"] = (full or {}).get("sub_orders") or []
        view["items_summary"] = "; ".join(
            str(s.get("items_summary") or "") for s in view["sub_orders"]
        )[:2000]
    else:
        view["items_summary"] = str(order.get("items") or "")[:2000]
        view["sub_orders"] = []
    view["customer_name"] = order.get("student_name") or ""
    view["customer_phone"] = order.get("student_phone") or ""
    view["customer_email"] = order.get("student_email") or ""
    view["owner_user_id"] = order.get("owner_user_id") or ""
    view["order_token"] = order.get("token") or ""
    view["delivery_location"] = order.get("delivery_location") or ""
    view["created_at"] = str(order.get("created_at") or "")
    if current_user.get("role") != "admin":
        view["utr_number"] = ""
        if view.get("proof_status") != "PAYMENT_PROOF_SUBMITTED":
            view.pop("payment_screenshot_url", None)
    elif proof:
        view["utr_number"] = proof.get("utr_number") or ""
    return view


@router.patch("/payments/{payment_id}/verify")
async def verify_payment_proof(
    payment_id: str,
    data: LocalPaymentProofVerify,
    _admin: dict = Depends(_require_admin),
):
    """Admin approve/reject of a submitted proof."""
    import app.api.v1.local as local_mod

    payment_id = (payment_id or "").strip()
    if not payment_id:
        raise HTTPException(status_code=404, detail="Payment not found")

    is_parent = False
    target: dict | None = None
    try:
        parent_order = await _db(db.get_parent_order, payment_id)
    except Exception:
        parent_order = None
    if parent_order:
        is_parent = True
        try:
            target = await _db(db.get_parent_payment, payment_id)
        except Exception:
            target = None
    else:
        try:
            target = await _db(db.get_payment_by_id, payment_id)
        except Exception:
            target = None
    if not target:
        raise HTTPException(status_code=404, detail="Payment not found")

    status_now = str(
        target.get("proof_status")
        or target.get("payment_proof_status")
        or "PENDING_PAYMENT"
    )
    if status_now != "PAYMENT_PROOF_SUBMITTED":
        raise HTTPException(
            status_code=409,
            detail=f"This proof is already decided ({status_now.replace('_', ' ').title()}).",
        )

    admin_name = str(
        _admin.get("name") or _admin.get("username") or _admin.get("sub") or "admin"
    )[:100]
    approved = data.action == "approve"
    if not approved and not (data.reason or "").strip():
        raise HTTPException(
            status_code=422,
            detail="A rejection reason is required so the student knows what to fix.",
        )

    if is_parent:
        saved = await _db(
            db.verify_parent_payment_proof,
            payment_id,
            approved,
            admin_name,
            (data.reason or "").strip(),
        )
        order_id = payment_id
    else:
        saved = await _db(
            db.verify_single_payment_proof,
            payment_id,
            approved,
            admin_name,
            (data.reason or "").strip(),
        )
        order_id = str((saved or {}).get("order_id") or "")
    if not saved:
        raise HTTPException(
            status_code=400, detail="Could not record the decision — please try again."
        )

    if approved and order_id and not is_parent:
        try:
            order = await _db(db.get_order, order_id)
            if order:
                notify_paid = getattr(
                    local_mod, "_notify_shop_of_paid_order", None
                )
                if notify_paid:
                    await notify_paid(order)
        except Exception as e:
            logger.warning(f"shop notify after approval failed for {order_id}: {e}")

    try:
        token = ""
        try:
            o = (
                await _db(db.get_parent_order, order_id)
                if is_parent
                else await _db(db.get_order, order_id)
            )
            token = str((o or {}).get("token") or "")
        except Exception:
            token = ""
        telegram_service.notify_payment_decision_async(
            order_id=order_id,
            order_token=token,
            approved=approved,
            reason=(data.reason or "").strip(),
        )
    except Exception as e:
        logger.warning(f"Telegram decision notification failed for {order_id}: {e}")

    return {
        "message": (
            "Payment approved — the order is now being processed."
            if approved
            else "Payment rejected — the student can submit a fresh proof."
        ),
        "approved": approved,
        "proof_status": "PAYMENT_APPROVED" if approved else "PAYMENT_REJECTED",
        "payment": saved,
    }
