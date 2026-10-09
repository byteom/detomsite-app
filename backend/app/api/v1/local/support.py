import asyncio
import logging
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request

from app.core.config import settings
from app.api.v1.local.common import rate_allow, rate_ip
from app.core.security import decode_token
from app.core.store import store as db
from app.services import telegram_service
from app.api.v1.local.common import (
    _cached_read,
    _db,
    _push_admin,
    _require_admin,
    _same_student,
    get_current_local_user,
)
from app.api.v1.local.schemas import (
    LocalComplaintCreate,
    LocalComplaintStatusUpdate,
    LocalFeedbackCreate,
    LocalMenuChangeApprove,
    LocalMenuChangeCreate,
    LocalRefundCreate,
    LocalRefundUpdate,
    LocalTicketCreate,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/telegram/webhook")
async def telegram_webhook(request: Request):
    """Inbound Telegram updates — answers the bot's /start, /help, /status."""
    secret = (settings.TELEGRAM_WEBHOOK_SECRET or "").strip()
    if secret:
        given = request.headers.get("x-telegram-bot-api-secret-token", "")
        if not secrets.compare_digest(given, secret):
            raise HTTPException(status_code=401, detail="Invalid webhook secret")
    try:
        update = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid update body")
    parsed = telegram_service.parse_incoming(update if isinstance(update, dict) else {})
    if not parsed:
        return {"ok": True}
    chat_id, command = parsed
    if not rate_allow("tg_webhook", chat_id, max_attempts=30, window_sec=60):
        return {"ok": True}
    pending: int | None = None
    if command == "status" and telegram_service.is_admin_chat(chat_id):
        try:
            singles = await _db(db.list_payments)
            pending = sum(
                1
                for p in singles or []
                if str(p.get("proof_status") or "") == "PAYMENT_PROOF_SUBMITTED"
            )
            parents = await _db(db.list_parent_payments)
            pending += sum(
                1
                for p in parents or []
                if str(p.get("proof_status") or "") == "PAYMENT_PROOF_SUBMITTED"
            )
        except Exception as e:
            logger.warning(f"telegram /status queue read failed: {e}")
            pending = None
    reply = telegram_service.command_reply(command, chat_id, pending_count=pending)
    if reply:
        try:
            await asyncio.to_thread(telegram_service.send_message_to, chat_id, reply)
        except Exception as e:
            logger.warning(f"telegram reply to {chat_id} failed: {e}")
    return {"ok": True}


@router.get("/tickets")
async def tickets(current_user: dict = Depends(get_current_local_user)):
    """Support tickets — role-aware."""
    if current_user.get("role") == "admin":
        return await _db(db.list_tickets)
    email = str(current_user.get("email") or "").strip().lower()
    name = str(current_user.get("name") or "").strip().lower()
    phone = str(current_user.get("phone") or "").strip()
    if hasattr(db, "list_tickets_for_user"):
        return await _db(db.list_tickets_for_user, email, name, phone)
    all_tickets = await _db(db.list_tickets)
    if email:
        return [
            t for t in all_tickets if str(t.get("email") or "").strip().lower() == email
        ]
    if not name:
        return []
    phone_digits = "".join(ch for ch in phone if ch.isdigit())
    out = []
    for t in all_tickets:
        if str(t.get("name") or "").strip().lower() != name:
            continue
        if phone_digits:
            t_phone = "".join(ch for ch in str(t.get("phone_number") or "") if ch.isdigit())
            if t_phone[-10:] != phone_digits[-10:]:
                continue
        out.append(t)
    return out


@router.post("/tickets")
async def add_ticket(
    data: LocalTicketCreate,
    current_user: dict = Depends(get_current_local_user),
):
    payload = data.model_dump()
    if current_user.get("role") != "admin":
        server_email = str(current_user.get("email") or "").strip()
        server_name = str(current_user.get("name") or "").strip()
        server_phone = str(current_user.get("phone") or "").strip()
        if server_email:
            payload["email"] = server_email
        elif not payload.get("email"):
            payload["email"] = f"{current_user.get('username', 'student')}@phone.local"
        if server_name:
            payload["name"] = server_name
        if server_phone:
            payload["phone_number"] = server_phone
    return await _db(db.create_ticket, payload)


@router.get("/notifications")
async def notifications(
    role: str | None = None,
    current_user: dict = Depends(get_current_local_user),
):
    """Return only notifications the authenticated account may read."""
    role_user = current_user.get("role")
    user_id = current_user.get("id")
    if role_user == "admin":
        return await _cached_read(
            10, f"notifications:admin:{role or ''}", db.list_notifications, role=role
        )
    if role_user != "student" or not user_id:
        return []
    if hasattr(db, "list_student_notifications"):
        return await _cached_read(
            10,
            f"notifications:student:{user_id}",
            db.list_student_notifications,
            int(user_id),
        )
    rows = await _db(db.list_notifications, role="student")
    visible = []
    for row in rows:
        order_id = row.get("order_id")
        if not order_id:
            continue
        order = await _db(db.get_order, order_id)
        if not order:
            order = await _db(db.get_parent_order, order_id)
        if not order:
            sub = await _db(db.get_sub_order, order_id)
            if sub and sub.get("parent_order_id"):
                order = await _db(db.get_parent_order, sub["parent_order_id"])
        if order and _same_student(current_user, order):
            visible.append(row)
    return visible


def _resolve_feedback_user(authorization: Optional[str]):
    payload = None
    if authorization and authorization.lower().startswith("bearer "):
        payload = decode_token(authorization.split(" ", 1)[1].strip())
    if not payload or not payload.get("sub"):
        return None
    user = db.get_user_by_id(int(payload["sub"]))
    return user


@router.post("/feedback")
async def add_feedback(
    data: LocalFeedbackCreate,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    if not rate_allow(
        "feedback", rate_ip(request), max_attempts=20, window_sec=600
    ):
        raise HTTPException(
            status_code=429,
            detail="Too many feedback submissions — please wait a few minutes and try again.",
        )
    values = data.model_dump()
    user = await _db(_resolve_feedback_user, authorization)
    if user:
        values["user_id"] = user["id"]
        values["username"] = user["username"]
        values["name"] = user["name"] or values.get("name", "")
        values["email"] = user["email"] or values.get("email", "")
    feedback = await _db(db.create_site_feedback, values)
    if not feedback:
        raise HTTPException(
            status_code=400, detail="Could not submit feedback. Please try again."
        )
    logger.info(
        f"Site feedback submitted by {values.get('name') or values.get('email') or 'guest'}: {values.get('subject')}"
    )
    _push_admin(
        "New feedback",
        f"[{feedback.get('category') or 'Bug'}] {feedback.get('subject') or feedback.get('message', '')[:80]} — by {values.get('name') or values.get('username') or 'guest'}",
        tag="feedback",
    )
    return feedback


@router.get("/feedback/mine")
async def my_feedback(authorization: Optional[str] = Header(None)):
    user = await _db(_resolve_feedback_user, authorization)
    if not user:
        return []
    return await _db(db.list_site_feedback_by_user, user["id"])


@router.get("/complaints")
async def complaints(status: str | None = None, _admin: dict = Depends(_require_admin)):
    if status:
        return await _cached_read(10, "complaints", db.list_complaints, status)
    return await _cached_read(10, "complaints", db.list_complaints)


@router.post("/complaints")
async def add_complaint(
    data: LocalComplaintCreate,
    current_user: dict = Depends(get_current_local_user),
):
    complaint = await _db(
        db.create_complaint,
        parent_order_id=data.parent_order_id,
        student_name=data.student_name,
        student_phone=data.student_phone,
        shop_id=data.shop_id,
        shop_name=data.shop_name,
        subject=data.subject,
        message=data.message,
    )
    if not complaint:
        raise HTTPException(status_code=400, detail="Could not submit complaint.")
    return complaint


@router.patch("/complaints/{complaint_id}")
async def patch_complaint(
    complaint_id: str,
    data: LocalComplaintStatusUpdate,
    _admin: dict = Depends(_require_admin),
):
    updated = await _db(
        db.update_complaint, complaint_id, data.status, data.admin_notes
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Complaint not found")
    return updated


@router.get("/refunds")
async def refunds(status: str | None = None, _admin: dict = Depends(_require_admin)):
    if status:
        return await _cached_read(10, "refunds", db.list_refunds, status)
    return await _cached_read(10, "refunds", db.list_refunds)


@router.post("/refunds")
async def add_refund(data: LocalRefundCreate, _admin: dict = Depends(_require_admin)):
    refund = await _db(
        db.create_refund,
        parent_order_id=data.parent_order_id,
        sub_order_id=data.sub_order_id,
        student_name=data.student_name,
        shop_name=data.shop_name,
        original_amount=data.original_amount,
        refund_amount=data.refund_amount,
        refund_type=data.refund_type,
    )
    if not refund:
        raise HTTPException(status_code=400, detail="Could not create refund.")
    return refund


@router.patch("/refunds/{refund_id}")
async def patch_refund(
    refund_id: str,
    data: LocalRefundUpdate,
    _admin: dict = Depends(_require_admin),
):
    updated = await _db(
        db.update_refund,
        refund_id,
        data.status,
        data.refund_utr,
        data.admin_notes,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Refund not found")
    return updated


@router.get("/settlements")
async def settlements(status: str | None = None, _admin: dict = Depends(_require_admin)):
    if status:
        return await _cached_read(10, "settlements", db.list_settlements, status)
    return await _cached_read(10, "settlements", db.list_settlements)


@router.post("/settlements/run")
async def run_settlements(_admin: dict = Depends(_require_admin)):
    rows = await _db(db.run_daily_settlements)
    return {"message": f"Settlement computed for {len(rows)} shops.", "settlements": rows}


@router.get("/menu-change-requests")
async def menu_change_requests(
    status: str | None = None,
    _admin: dict = Depends(_require_admin),
):
    if status:
        return await _cached_read(
            10, "menu-change-requests", db.list_menu_change_requests, status
        )
    return await _cached_read(10, "menu-change-requests", db.list_menu_change_requests)


@router.post("/menu-change-requests")
async def add_menu_change_request(
    data: LocalMenuChangeCreate,
    current_user: dict = Depends(get_current_local_user),
):
    req = await _db(
        db.create_menu_change_request,
        shop_id=data.shop_id,
        product_id=data.product_id,
        change_type=data.change_type,
        old_value=data.old_value,
        new_value=data.new_value,
    )
    if not req:
        raise HTTPException(status_code=400, detail="Could not create menu change request.")
    return req


@router.patch("/menu-change-requests/{req_id}")
async def patch_menu_change_request(
    req_id: str,
    data: LocalMenuChangeApprove,
    _admin: dict = Depends(_require_admin),
):
    req = await _db(
        db.update_menu_change_request, req_id, data.status, data.admin_notes
    )
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    return req


@router.get("/audit-logs")
async def audit_logs(limit: int = 200, _admin: dict = Depends(_require_admin)):
    return await _db(db.list_audit_logs, limit)


@router.get("/whatsapp-logs")
async def whatsapp_logs(limit: int = 100, _admin: dict = Depends(_require_admin)):
    return await _db(db.list_whatsapp_logs, limit)
