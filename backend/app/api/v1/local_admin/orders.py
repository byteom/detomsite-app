import asyncio
import logging
from typing import Optional
from fastapi import APIRouter, Body, Depends, HTTPException, Query

from app.core import read_cache
from app.core.store import store as db

from .deps import (
    CONFIRM_ORDER_ACTION,
    CONFIRMABLE_ORDER_STATUSES,
    _confirmable_shape,
    _db,
    _rebuild_wa_link,
    _sms_log_fn,
    _sub_order_shape,
    verify_admin,
)
from .schemas import ConfirmOrderRequest, RejectOrderRequest

logger = logging.getLogger(__name__)

router = APIRouter()


async def _load_admin_orders() -> list[dict]:
    """Latest single orders + multi-shop sub-orders, fetched concurrently."""
    sub_fn = getattr(db, "list_all_sub_orders", None)

    async def _subs() -> list[dict]:
        if sub_fn is not None:
            return await _db(sub_fn, 300) or []
        shops = await _db(db.list_shops) or []
        merged: list[dict] = []
        for shop in shops:
            merged.extend((await _db(db.get_shop_sub_orders, shop["id"])) or [])
        return merged

    orders, subs = await asyncio.gather(
        _db(db.list_orders, limit=1000),
        _subs(),
    )
    merged = list(orders or [])
    for sub in subs or []:
        merged.append(_sub_order_shape(sub))
    merged.sort(key=lambda o: str(o.get("created_at") or ""), reverse=True)
    return merged


async def _load_admin_orders_capped() -> list[dict]:
    """Newest 1500 orders — the admin centre never renders more than this."""
    merged = await _load_admin_orders()
    return merged[:1500]


@router.get("/orders")
async def list_all_orders(admin: dict = Depends(verify_admin)):
    """List orders across all shops, newest first — capped at 1500.
    Multi-shop sub-orders are merged in so they show in the admin centre too."""
    return await read_cache.cached_read(10, "admin-orders", _load_admin_orders_capped)


@router.get("/whatsapp-pending")
async def whatsapp_pending(admin: dict = Depends(verify_admin)):
    """Pending WhatsApp notifications — orders whose ``wa.me`` message to the
    shop is generated and waiting for the admin to send from their number."""
    logs = await _db(db.list_whatsapp_logs, limit=200)
    pending = [l for l in (logs or []) if str(l.get("status") or "").lower() != "sent"]
    enriched = []
    for log in pending:
        sub_id = log.get("order_id") or log.get("sub_order_id") or ""
        order = await _db(db.get_order, sub_id)
        if not order:
            order = await _db(db.get_sub_order, sub_id) if hasattr(db, "get_sub_order") else None
        shop = await _db(db.get_shop, (order or {}).get("shop_id") or "") if order else None
        doc = dict(log)
        doc["sub_order_id"] = sub_id
        if not (doc.get("url") or "").strip():
            doc["url"] = await _rebuild_wa_link(doc, sub_id)
        doc["order_token"] = (order or {}).get("token") or (order or {}).get("id")
        doc["student_name"] = (order or {}).get("student_name") or (order or {}).get("parent", {}).get("student_name")
        doc["total"] = (order or {}).get("total") or (order or {}).get("subtotal")
        doc["shop_name"] = (shop or {}).get("name") or (order or {}).get("shop_name")
        enriched.append(doc)
    return enriched


@router.post("/whatsapp/{whatsapp_id}/mark-sent")
async def whatsapp_mark_sent(whatsapp_id: str, admin: dict = Depends(verify_admin)):
    """Mark a WhatsApp notification as sent (after the admin tapped the link)."""
    doc = await _db(db.mark_whatsapp_sent, whatsapp_id)
    if not doc:
        raise HTTPException(status_code=404, detail="WhatsApp notification not found")
    return doc


@router.get("/orders/{order_id}/whatsapp-link")
async def order_whatsapp_link(order_id: str, admin: dict = Depends(verify_admin)):
    """Free WhatsApp notify: pre-filled ``wa.me`` chat to the shop."""
    from urllib.parse import quote
    from app.services.sms_service import compose_order_wa

    order = await _db(db.get_order, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    shop = await _db(db.get_shop, order.get("shop_id") or "")
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")

    number = str(shop.get("whatsapp_number") or "").strip() or str(shop.get("phone") or "").strip()
    if not number:
        raise HTTPException(status_code=400, detail="Shop has no phone / WhatsApp number on file")

    digits = "".join(ch for ch in number if ch.isdigit())
    if len(digits) == 10:
        digits = "91" + digits
    text = compose_order_wa(order)
    url = f"https://wa.me/{digits}?text={quote(text)}"
    return {"shop_id": shop["id"], "shop_name": shop["name"], "number": number,
            "message": text, "url": url}


@router.get("/orders/date")
async def list_orders_by_date(admin: dict = Depends(verify_admin), date: str = Query(..., description="YYYY-MM-DD")):
    """Get orders for a specific date."""
    return await _db(db.get_orders_by_date, date)


@router.get("/order-confirmations")
async def list_order_confirmations(admin: dict = Depends(verify_admin)):
    """Every order still waiting for the admin to press Confirm."""
    rows = await _db(db.list_actionable_notifications, CONFIRM_ORDER_ACTION, "pending")
    get_sub = getattr(db, "get_sub_order", None)

    async def _resolve(row: dict) -> dict | None:
        order_id = str(row.get("order_id") or "")
        if not order_id:
            return None
        order = await _db(db.get_order, order_id)
        is_sub = False
        if not order:
            sub = await _db(get_sub, order_id) if get_sub else None
            if not sub:
                return None
            order = _sub_order_shape(sub)
            is_sub = True
        if str(order.get("status") or "") not in CONFIRMABLE_ORDER_STATUSES:
            return None
        shop = await _db(db.get_shop, order.get("shop_id") or "")
        if not shop and is_sub:
            shop = (order.get("shop") or {}) or None
        return _confirmable_shape(order, shop, row)

    resolved = await asyncio.gather(*[_resolve(r) for r in rows or []], return_exceptions=True)
    return [r for r in resolved if isinstance(r, dict)]


@router.post("/orders/{order_id}/confirm")
async def admin_confirm_order(
    order_id: str,
    data: Optional[ConfirmOrderRequest] = Body(default=None),
    admin: dict = Depends(verify_admin),
):
    """Confirm one order — the single detail-page action for COD and UPI.

    For UPI orders this also approves the submitted payment proof first, so the
    admin never needs a separate Verify click. UPI orders without a submitted
    UTR + screenshot proof are rejected with 409.
    """
    order = await _db(db.get_order, order_id)
    is_sub_order = False
    if not order:
        getter = getattr(db, "get_sub_order", None)
        sub = await _db(getter, order_id) if getter else None
        if not sub:
            raise HTTPException(status_code=404, detail="Order not found")
        order = _sub_order_shape(sub)
        is_sub_order = True

    current = str(order.get("status") or "")
    if current in ("Cancelled", "Completed", "Delivered", "Refunded", "Failed"):
        raise HTTPException(
            status_code=409,
            detail=f"This order is already {current.lower()} — it can no longer be confirmed.",
        )

    already = current == "Confirmed"
    admin_name = str(
        admin.get("username") or admin.get("email") or admin.get("sub") or "admin"
    )[:100]
    payment_approved = False
    if not already:
        if current not in CONFIRMABLE_ORDER_STATUSES:
            raise HTTPException(
                status_code=409,
                detail=f"This order is {current} and can no longer be confirmed.",
            )
        is_cod = str(order.get("payment_method") or "UPI").upper() == "COD"
        if not is_cod:
            proof_status = await _upi_proof_status(order_id, is_sub_order, order)
            if proof_status == "PAYMENT_APPROVED":
                pass
            elif proof_status == "PAYMENT_PROOF_SUBMITTED":
                ok = await _approve_upi_proof(order_id, is_sub_order, order, admin_name)
                if not ok:
                    raise HTTPException(
                        status_code=500,
                        detail="Could not approve the payment proof — please try again.",
                    )
                payment_approved = True
            else:
                raise HTTPException(
                    status_code=409,
                    detail="Cannot confirm this UPI order yet — no UTR + screenshot proof submitted by the student.",
                )
        if is_sub_order:
            updated = await _db(db.update_sub_order_status, order_id, "Confirmed")
        else:
            updated = await _db(db.update_order_status, order_id, "Confirmed")
        if not updated:
            raise HTTPException(status_code=500, detail="Could not confirm this order — please try again.")
        order = updated

    shop = await _db(db.get_shop, order.get("shop_id") or "")
    if not shop and is_sub_order:
        shop = (order.get("shop") or {}) or None

    token = order.get("token")

    if is_sub_order:
        try:
            await _db(
                db.create_notification,
                title="Order confirmed",
                message=f"Token {token} confirmed — {order.get('shop_name') or 'the shop'} accepted your order.",
                order_id=None,
                status="Confirmed",
                target_role="student",
            )
        except Exception as e:
            logger.warning(f"Confirm {order_id}: sub-order student notification error: {e}")

    whatsapp_sent = False
    try:
        from app.services import sms_service

        whatsapp_sent = await sms_service.send_whatsapp_confirmed(order, shop, db)
    except Exception as e:
        logger.warning(f"Confirm {order_id}: WhatsApp error: {e}")

    try:
        from app.services import sms_service

        phone = str(order.get("student_phone") or "").strip()
        if phone:
            await sms_service.send_sms_async(
                phone,
                sms_service.compose_confirmation_sms(order),
                _sms_log_fn,
                sub_order_id=order_id,
            )
    except Exception as e:
        logger.warning(f"Confirm {order_id}: student SMS error: {e}")

    settled: list[str] = []
    try:
        candidates = []
        if data and data.notification_id:
            candidates.append(data.notification_id)
        for row in await _db(db.list_actionable_notifications, CONFIRM_ORDER_ACTION, "pending") or []:
            if str(row.get("order_id") or "") == str(order_id):
                candidates.append(row.get("id"))
        for notification_id in dict.fromkeys(c for c in candidates if c):
            if await _db(db.set_notification_action_state, notification_id, "done"):
                settled.append(notification_id)
    except Exception as e:
        logger.warning(f"Confirm {order_id}: could not settle the queue row: {e}")

    await read_cache.clear()

    logger.info(f"Admin confirmed order {order_id} (token #{token})")
    msg = (
        f"Order #{token} was already confirmed."
        if already
        else (f"Order #{token} confirmed ✓ (payment approved)" if payment_approved else f"Order #{token} confirmed ✓")
    )
    return {
        "message": msg,
        "already_confirmed": already,
        "payment_approved": payment_approved,
        "order": order,
        "whatsapp_sent": whatsapp_sent,
        "whatsapp_queued": not whatsapp_sent,
        "notification_ids": settled,
    }


async def _upi_proof_status(order_id: str, is_sub_order: bool, order: dict) -> str:
    """Latest UPI proof state for an order: APPROVED / SUBMITTED / REJECTED / PENDING."""
    try:
        if is_sub_order:
            parent_id = str(order.get("parent_order_id") or "")
            if parent_id:
                parent_payment = await _db(db.get_parent_payment, parent_id)
                if parent_payment:
                    return str(
                        parent_payment.get("proof_status")
                        or parent_payment.get("payment_proof_status")
                        or "PENDING_PAYMENT"
                    )
            return "PENDING_PAYMENT"
        payment = await _db(db.get_payment_by_order_id, order_id)
        if not payment:
            payment = await _db(db.get_payment_by_id, order_id)
        if not payment:
            return "PENDING_PAYMENT"
        return str(
            payment.get("proof_status")
            or payment.get("payment_proof_status")
            or "PENDING_PAYMENT"
        )
    except Exception as e:
        logger.warning(f"Confirm {order_id}: proof lookup failed: {e}")
        return "PENDING_PAYMENT"


async def _approve_upi_proof(
    order_id: str, is_sub_order: bool, order: dict, admin_name: str
) -> bool:
    """Approve the submitted UPI proof so confirm stays a single click."""
    try:
        if is_sub_order:
            parent_id = str(order.get("parent_order_id") or "")
            if not parent_id:
                return False
            saved = await _db(
                db.verify_parent_payment_proof, parent_id, True, admin_name, ""
            )
            return bool(saved)
        payment = await _db(db.get_payment_by_order_id, order_id)
        payment_id = str((payment or {}).get("id") or order_id)
        saved = await _db(
            db.verify_single_payment_proof, payment_id, True, admin_name, ""
        )
        return bool(saved)
    except Exception as e:
        logger.warning(f"Confirm {order_id}: auto-approve proof failed: {e}")
        return False


@router.post("/orders/{order_id}/reject")
async def admin_reject_order(
    order_id: str,
    data: RejectOrderRequest,
    admin: dict = Depends(verify_admin),
):
    """Reject from the detail page — admin picks resubmit or cancel.

    - resubmit: payment proof rejected, order stays actionable so the student
      can send a fresh UTR + screenshot.
    - cancel: proof rejected (when present) AND the order is cancelled, the
      student is told why and the queue row is settled.
    """
    mode = str(data.mode or "resubmit").lower()
    reason = str(data.reason or "").strip()
    if not reason:
        raise HTTPException(
            status_code=422,
            detail="A reason is required so the student knows what to fix.",
        )
    order = await _db(db.get_order, order_id)
    is_sub_order = False
    if not order:
        getter = getattr(db, "get_sub_order", None)
        sub = await _db(getter, order_id) if getter else None
        if not sub:
            raise HTTPException(status_code=404, detail="Order not found")
        order = _sub_order_shape(sub)
        is_sub_order = True

    current = str(order.get("status") or "")
    if current in ("Cancelled", "Completed", "Delivered", "Refunded", "Failed"):
        raise HTTPException(
            status_code=409,
            detail=f"This order is already {current.lower()} — it can no longer be rejected.",
        )

    admin_name = str(
        admin.get("username") or admin.get("email") or admin.get("sub") or "admin"
    )[:100]
    token = order.get("token")
    is_cod = str(order.get("payment_method") or "UPI").upper() == "COD"

    if mode == "cancel" or is_cod:
        # COD has no proof to resubmit — a reject is always a cancellation.
        if not is_cod:
            try:
                if is_sub_order:
                    parent_id = str(order.get("parent_order_id") or "")
                    if parent_id:
                        await _db(
                            db.verify_parent_payment_proof,
                            parent_id,
                            False,
                            admin_name,
                            reason,
                        )
                else:
                    payment = await _db(db.get_payment_by_order_id, order_id)
                    payment_id = str((payment or {}).get("id") or "")
                    if payment_id:
                        await _db(
                            db.verify_single_payment_proof,
                            payment_id,
                            False,
                            admin_name,
                            reason,
                        )
            except Exception as e:
                logger.warning(f"Reject {order_id}: proof reject before cancel failed: {e}")
        try:
            if is_sub_order:
                order = await _db(db.update_sub_order_status, order_id, "Cancelled")
            else:
                order = await _db(db.update_order_status, order_id, "Cancelled")
            try:
                payment = await _db(db.get_payment_by_order_id, order_id)
                payment_id = str((payment or {}).get("id") or "")
                if payment_id:
                    await _db(db.update_payment_status, payment_id, "Cancelled")
            except Exception as e:
                logger.warning(f"Reject {order_id}: payment cancel mark failed: {e}")
            await _db(
                db.create_notification,
                title="Order cancelled",
                message=f"Order #{token} was cancelled by support: {reason[:200]}",
                order_id=None if is_sub_order else order_id,
                status="Cancelled",
                target_role="student",
            )
        except Exception as e:
            logger.warning(f"Reject {order_id}: cancel error: {e}")
            raise HTTPException(status_code=500, detail="Could not cancel this order — please try again.")
        settled = await _settle_confirm_queue(order_id, data.notification_id)
        await read_cache.clear()
        return {
            "message": f"Order #{token} cancelled.",
            "mode": "cancel",
            "order": order,
            "notification_ids": settled,
        }

    # mode == resubmit for UPI: reject the proof, keep the order actionable.
    proof_id = ""
    try:
        if is_sub_order:
            parent_id = str(order.get("parent_order_id") or "")
            if parent_id:
                saved = await _db(
                    db.verify_parent_payment_proof,
                    parent_id,
                    False,
                    admin_name,
                    reason,
                )
                proof_id = str((saved or {}).get("id") or parent_id)
        else:
            payment = await _db(db.get_payment_by_order_id, order_id)
            payment_id = str((payment or {}).get("id") or order_id)
            saved = await _db(
                db.verify_single_payment_proof, payment_id, False, admin_name, reason
            )
            proof_id = str((saved or {}).get("id") or payment_id)
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"Reject {order_id}: resubmit error: {e}")
        raise HTTPException(status_code=500, detail="Could not reject this proof — please try again.")
    if not proof_id:
        raise HTTPException(status_code=404, detail="No payment proof found for this order")
    await read_cache.clear()
    return {
        "message": f"Proof rejected — student asked to resubmit for order #{token}.",
        "mode": "resubmit",
        "order": order,
        "notification_ids": [],
    }


async def _settle_confirm_queue(order_id: str, notification_id: Optional[str]) -> list[str]:
    settled: list[str] = []
    try:
        candidates = []
        if notification_id:
            candidates.append(notification_id)
        for row in await _db(db.list_actionable_notifications, CONFIRM_ORDER_ACTION, "pending") or []:
            if str(row.get("order_id") or "") == str(order_id):
                candidates.append(row.get("id"))
        for nid in dict.fromkeys(c for c in candidates if c):
            if await _db(db.set_notification_action_state, nid, "done"):
                settled.append(nid)
    except Exception as e:
        logger.warning(f"Reject {order_id}: could not settle the queue row: {e}")
    return settled


@router.post("/order-confirmations/{notification_id}/dismiss")
async def dismiss_order_confirmation(
    notification_id: str, admin: dict = Depends(verify_admin)
):
    """Hide one pending confirmation from the admin queue without confirming it."""
    row = await _db(db.set_notification_action_state, notification_id, "dismissed")
    if not row:
        raise HTTPException(status_code=404, detail="That notification no longer exists")
    await read_cache.clear()
    return {"message": "Removed from the confirm queue", "notification": row}
