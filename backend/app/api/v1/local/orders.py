import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.order_slots import (
    CANCELLABLE_STATUSES,
    now_kolkata,
    slot_cutoff_for,
)
from app.api.v1.local.common import rate_allow
from app.core.store import store as db
from app.services import push_service, sms_service
from app.api.v1.local.common import (
    MAX_LINE_QUANTITY,
    _AWAITING_PAYMENT_STATUSES,
    _cached_read,
    _db,
    _normalize_phone,
    _process_due_auto_confirm,
    _push_admin,
    _require_admin,
    _same_student,
    _sms_log_fn,
    get_current_local_user,
)
from app.api.v1.local.schemas import (
    LocalMultiShopOrder,
    LocalOrderCreate,
    LocalOrderStatusUpdate,
    LocalSubOrderStatusUpdate,
)

logger = logging.getLogger(__name__)

router = APIRouter()


async def _list_orders_sliced(current_user: dict, limit: int = 100, offset: int = 0) -> list[dict]:
    """Return orders for the current user — filtered in SQL, never in Python."""
    limit = max(1, min(int(limit or 100), 200))
    offset = max(0, int(offset or 0))
    if current_user.get("role") == "admin":
        return await _db(db.list_orders, limit=limit + offset)
    uid = str(current_user.get("id") or "")
    name = str(current_user.get("name") or current_user.get("username") or "")
    rows = await _db(db.list_orders_by_user_id, uid, name, limit + offset)
    return rows[offset : offset + limit]


@router.get("/orders")
async def orders(
    current_user: dict = Depends(get_current_local_user),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """List orders for current user or all if admin."""
    cache_key = "orders"
    return await _cached_read(10, cache_key, _list_orders_sliced, current_user, limit, offset)


@router.get("/orders/parent")
async def parent_orders_list(
    status: str | None = None,
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(get_current_local_user),
):
    """List parent (multi-shop) orders."""
    limit = max(1, min(int(limit or 100), 200))
    offset = max(0, int(offset or 0))
    if current_user.get("role") == "admin":
        rows = await _db(db.list_parent_orders, limit + offset, status)
        return rows[offset : offset + limit]
    uid = str(current_user.get("id") or "")
    rows = await _db(db.list_parent_orders, limit + offset, status, uid)
    mine = [o for o in rows if _same_student(current_user, o)]
    return mine[offset : offset + limit]


@router.get("/orders/parent/{parent_order_id}")
async def parent_order_detail(
    parent_order_id: str,
    current_user: dict = Depends(get_current_local_user),
):
    result = await _db(db.get_parent_order, parent_order_id)
    if not result:
        raise HTTPException(status_code=404, detail="Order not found")
    if current_user.get("role") != "admin" and not _same_student(current_user, result):
        raise HTTPException(status_code=403, detail="You can only view your own orders")
    return result


@router.get("/orders/{order_id}")
async def order(order_id: str, current_user: dict = Depends(get_current_local_user)):
    result = await _db(db.get_order, order_id)
    if not result:
        raise HTTPException(status_code=404, detail="Order not found")
    if current_user.get("role") != "admin" and not _same_student(current_user, result):
        raise HTTPException(status_code=403, detail="You can only view your own orders")
    return result


@router.get("/orders/{order_id}/payment")
async def order_payment_status(
    order_id: str,
    current_user: dict = Depends(get_current_local_user),
):
    """Everything the student's payment portal needs about one order's payment."""
    result = await _db(db.get_order, order_id)
    is_parent = False
    if not result:
        result = await _db(db.get_parent_order, order_id)
        is_parent = bool(result)
    if not result:
        raise HTTPException(status_code=404, detail="Order not found")
    if current_user.get("role") != "admin" and not _same_student(current_user, result):
        raise HTTPException(status_code=403, detail="You can only view your own orders")

    payment = None
    try:
        if is_parent:
            payment = await _db(db.get_parent_payment, order_id)
        else:
            payment = await _db(db.get_payment_by_order_id, order_id)
    except Exception as e:
        logger.warning(f"payment status lookup failed for {order_id}: {e}")

    return {
        "order_id": order_id,
        "order_status": result.get("status"),
        "payment_method": result.get("payment_method"),
        "amount": result.get("total"),
        "is_parent": is_parent,
        "payment_status": (payment or {}).get("status"),
        "payment_method_recorded": (payment or {}).get("method"),
        "utr_saved": bool(str((payment or {}).get("utr_number") or "").strip()),
        "proof_status": (payment or {}).get("proof_status")
        or (payment or {}).get("payment_proof_status")
        or "PENDING_PAYMENT",
        "payment_submitted_at": str((payment or {}).get("payment_submitted_at") or ""),
        "payment_verified_at": str((payment or {}).get("payment_verified_at") or ""),
        "payment_rejection_reason": (payment or {}).get("payment_rejection_reason") or "",
    }


@router.post("/orders")
async def add_order(
    data: LocalOrderCreate,
    current_user: dict = Depends(get_current_local_user),
):
    import app.api.v1.local as local_mod

    payload = data.model_dump()
    payload["owner_user_id"] = str(current_user["id"])

    shop = None
    if payload.get("client_ref"):
        try:
            found, shop_row = await asyncio.gather(
                _db(db.find_order_by_client_ref, payload["client_ref"], payload["owner_user_id"]),
                _db(db.get_shop, payload["shop_id"]),
                return_exceptions=True,
            )
            if isinstance(found, Exception):
                logger.warning(f"client_ref lookup failed: {found}")
                found = None
            if isinstance(shop_row, Exception):
                raise shop_row
            shop = shop_row
        except Exception as e:
            logger.warning(f"client_ref lookup failed: {e}")
            existing = None
            shop = await _db(db.get_shop, payload["shop_id"])
        else:
            existing = found
        if existing and str(existing.get("status") or "") in _AWAITING_PAYMENT_STATUSES:
            return existing
    else:
        shop = await _db(db.get_shop, payload["shop_id"])

    if not rate_allow(
        "place_order", str(current_user.get("id")), max_attempts=20, window_sec=300
    ):
        raise HTTPException(
            status_code=429,
            detail="You are placing orders too quickly — please wait a minute and try again.",
        )

    payload["student_phone"] = _normalize_phone(payload.get("student_phone", ""))
    if not shop:
        raise HTTPException(
            status_code=400,
            detail="We couldn't find that shop — it may have been removed by the admin.",
        )
    if shop.get("approval_status") != "Approved":
        if str(shop.get("approval_status") or "").lower() in ("removed", "suspended"):
            raise HTTPException(
                status_code=400,
                detail="This shop is no longer available — it was removed by the admin.",
            )
        raise HTTPException(
            status_code=400,
            detail="This shop is not approved yet — wait until an admin approves it, then try again.",
        )
    if not shop.get("present") or shop.get("status") != "Open":
        raise HTTPException(
            status_code=400,
            detail="This shop is currently closed — the vendor hasn't started accepting orders right now. Please try again a little later.",
        )

    method = str(payload.get("payment_method") or "").strip()
    if method == "UPI" and not shop.get("upi_enabled", 1):
        raise HTTPException(
            status_code=400,
            detail="This shop has turned off UPI payments — please choose Cash on Delivery instead.",
        )
    if method == "COD" and not shop.get("cod_enabled", 1):
        raise HTTPException(
            status_code=400,
            detail="This shop has turned off Cash on Delivery — please pay via UPI instead.",
        )
    order = await _db(db.create_order, payload)
    if not order:
        raise HTTPException(
            status_code=400,
            detail="Could not place your order — the shop stopped accepting orders or an item in your cart was removed. Please check and try again.",
        )

    _pay_method = str(order.get("payment_method") or "").upper()
    _accept_needed = _pay_method == "COD" and order.get("status") == "Pending Acceptance"
    _pay_total = int(round(float(order.get("total") or 0)))
    _pay_kind = "COD" if _pay_method == "COD" else "Manual UTR"
    _finalize_tasks = []
    if _accept_needed:
        _finalize_tasks.append(("accept", _db(db.update_order_status, order["id"], "Accepted")))
    _finalize_tasks.append(
        ("payment", _db(db.create_payment, order["id"], _pay_total, _pay_kind, None))
    )
    for _name, _res in zip(
        [n for n, _ in _finalize_tasks],
        await asyncio.gather(*[c for _, c in _finalize_tasks], return_exceptions=True),
    ):
        if isinstance(_res, Exception):
            if _name == "accept":
                logger.warning(f"Could not mark order {order.get('id')} as placed: {_res}")
            else:
                logger.warning(f"Could not open the payment intent for {order.get('id')}: {_res}")
        elif _name == "accept" and _res:
            order = _res

    is_cash_on_delivery = str(order.get("payment_method") or "").upper() == "COD"
    if is_cash_on_delivery:
        try:
            push_srv = getattr(local_mod, "push_service", push_service)
            asyncio.get_running_loop().create_task(
                push_srv.notify_shop_new_order_async(order)
            )
        except Exception as e:
            logger.warning(f"Could not schedule order push notification: {e}")

    notify_sms = getattr(local_mod, "_notify_order_via_sms", _notify_order_via_sms)
    notify_admin = getattr(local_mod, "_notify_admin_of_new_order", _notify_admin_of_new_order)

    if is_cash_on_delivery:
        for _res in await asyncio.gather(
            notify_sms(order, shop),
            notify_admin(order),
            return_exceptions=True,
        ):
            if isinstance(_res, Exception):
                logger.warning(f"Order notification task failed for {order.get('id')}: {_res}")
    else:
        logger.info(
            f"Order {order.get('id')} ({order.get('token')}) is prepaid — holding it back "
            f"from the shop until payment is confirmed."
        )
        await notify_admin(order)

    return order


async def _notify_shop_of_paid_order(order: dict) -> None:
    """Tell the shop an order is theirs — called when a prepaid order is PAID."""
    import app.api.v1.local as local_mod

    if not order or not order.get("id"):
        return
    try:
        push_srv = getattr(local_mod, "push_service", push_service)
        asyncio.get_running_loop().create_task(
            push_srv.notify_shop_new_order_async(order)
        )
    except Exception as e:
        logger.warning(f"Could not schedule paid-order push for {order.get('id')}: {e}")
    try:
        notify_sms = getattr(local_mod, "_notify_order_via_sms", _notify_order_via_sms)
        await notify_sms(order)
    except Exception as e:
        logger.warning(f"Could not send paid-order notifications for {order.get('id')}: {e}")


async def _notify_admin_of_new_order(order: dict) -> None:
    """Put a freshly placed order in the ADMIN's confirmation queue."""
    import app.api.v1.local as local_mod

    if not order or not order.get("id"):
        return
    token = order.get("token")
    student = str(order.get("student_name") or "").strip() or "A student"
    shop = str(order.get("shop_name") or "").strip() or "a shop"
    total = order.get("total") or 0
    method = str(order.get("payment_method") or "UPI").upper()
    method_label = "Cash on Delivery" if method == "COD" else method
    message = (
        f"{student} ordered {order.get('items') or 'food'} from {shop} — "
        f"{method_label} ₹{total}. Tap Confirm to approve the order."
    )
    try:
        await _db(
            db.create_notification,
            title=f"New order #{token} — confirm",
            message=message,
            order_id=order["id"],
            status=order.get("status"),
            target_role="admin",
            action="confirm_order",
            action_state="pending",
        )
    except Exception as e:
        logger.warning(f"Admin order notification error for {order.get('id')}: {e}")
        return

    push_admin_fn = getattr(local_mod, "_push_admin", _push_admin)
    push_admin_fn(
        f"New order #{token} — confirm",
        message,
        tag=f"order-confirm-{order['id']}",
    )


@router.patch("/orders/{order_id}/status")
async def patch_order_status(
    order_id: str,
    data: LocalOrderStatusUpdate,
    _admin: dict = Depends(_require_admin),
):
    order = await _db(db.update_order_status, order_id, data.status)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


@router.patch("/orders/{order_id}/cancel")
@router.post("/orders/{order_id}/cancel")
async def cancel_own_order(
    order_id: str,
    current_user: dict = Depends(get_current_local_user),
):
    """Let a student cancel their own order within its delivery window."""
    import app.api.v1.local as local_mod

    order = await _db(db.get_order, order_id)
    is_parent = False
    if not order:
        order = await _db(db.get_parent_order, order_id)
        is_parent = bool(order)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if not _same_student(current_user, order):
        raise HTTPException(status_code=403, detail="You can only cancel your own orders")

    if order["status"] not in CANCELLABLE_STATUSES and order["status"] != "Pending":
        raise HTTPException(
            status_code=400,
            detail="This order can no longer be cancelled.",
        )
    cutoff_fn = getattr(local_mod, "slot_cutoff_for", slot_cutoff_for)
    cutoff = cutoff_fn(order.get("created_at"))
    if cutoff is None:
        raise HTTPException(
            status_code=400,
            detail="This order was placed outside the delivery windows and can no longer be cancelled.",
        )
    time_fn = getattr(local_mod, "now_kolkata", now_kolkata)
    if time_fn().time() >= cutoff:
        raise HTTPException(
            status_code=400,
            detail="The cancellation window for this order has closed.",
        )

    if is_parent:
        updated = await _db(db.cancel_parent_order, order_id)
    else:
        updated = await _db(db.update_order_status, order_id, "Cancelled")

    try:
        payment = await _db(db.get_payment_by_order_id, order_id)
        if payment and payment.get("status") == "Pending":
            await _db(db.update_payment_status, payment["id"], "Cancelled")
    except Exception as e:
        logger.warning(f"Could not mark payment cancelled for order {order_id}: {e}")

    return {
        "message": "Order cancelled — you can place a new order anytime.",
        "order": updated or await _db(db.get_order, order_id),
    }


async def _notify_order_via_sms(order: dict, shop: dict | None = None) -> None:
    """Send the new-order SMS to the shopkeeper's phone and a copy to the admin."""
    import app.api.v1.local as local_mod

    try:
        if not order or not order.get("id"):
            return
        message = sms_service.compose_order_sms(order)
        if shop is None:
            shop = await _db(db.get_shop, order["shop_id"])
        shop_phone = str((shop or {}).get("phone") or "").strip()
        admins = await _db(db.list_users_by_role, "admin")
        admin_phone = ""
        for a in admins or []:
            p = str((a or {}).get("phone") or "").strip()
            if p:
                admin_phone = p
                break
        if shop_phone:
            await sms_service.send_sms_async(
                shop_phone, message, _sms_log_fn, sub_order_id=order["id"]
            )
        if admin_phone:
            await sms_service.send_sms_async(
                admin_phone,
                f"DETOMSITE: {message.splitlines()[0]} — order is waiting for confirmation.",
                _sms_log_fn,
                sub_order_id=order["id"],
            )
        if shop:
            whatsapp_phone = (
                str((shop or {}).get("whatsapp_number") or "").strip()
                or str((shop or {}).get("phone") or "").strip()
            )
            if whatsapp_phone:
                notify_wa = getattr(
                    local_mod, "_notify_shop_via_whatsapp", _notify_shop_via_whatsapp
                )
                await notify_wa(order, shop, whatsapp_phone, paid=False)
    except Exception as e:
        logger.warning(f"SMS notify error for order {order.get('id')}: {e}")


async def _whatsapp_link_for_order(order: dict, shop: dict, paid: bool | None = None) -> str:
    """Build the free wa.me deep-link that sends the order message from admin to shop."""
    from urllib.parse import quote
    from app.services.sms_service import compose_order_wa

    number = (
        str(shop.get("whatsapp_number") or "").strip()
        or str(shop.get("phone") or "").strip()
    )
    if not number:
        return ""
    digits = "".join(ch for ch in number if ch.isdigit())
    if len(digits) == 10:
        digits = "91" + digits
    text = compose_order_wa(order, paid=paid)
    return f"https://wa.me/{digits}?text={quote(text)}"


async def _notify_shop_via_whatsapp(
    order: dict, shop: dict, phone: str, paid: bool | None = None
) -> None:
    """Notify the shopkeeper of an order on WhatsApp."""
    import app.api.v1.local as local_mod

    try:
        from app.services.sms_service import compose_order_wa
        from app.services import whatsapp_service

        message = compose_order_wa(order, paid=paid)
        link_fn = getattr(local_mod, "_whatsapp_link_for_order", _whatsapp_link_for_order)
        url = await link_fn(order, shop, paid=paid)
        if not url:
            return

        auto = (paid is True) or str(
            order.get("payment_method") or order.get("pay_method") or ""
        ).upper() == "COD"
        row_id = None

        existing = await _db(db.list_whatsapp_logs, 200)
        already_sent = False
        for row in existing or []:
            ref = str(row.get("sub_order_id") or row.get("order_id") or "")
            if ref == str(order["id"]):
                row_id = row.get("id")
                already_sent = str(row.get("status") or "") == "Sent"
                if paid is True:
                    await _db(db.update_whatsapp_message, row["id"], message, url)
                break

        if row_id is None:
            created = await _db(
                db.log_whatsapp,
                sub_order_id=order["id"],
                phone=phone,
                message=message,
                url=url,
                status="Pending",
            )
            row_id = (created or {}).get("id") or row_id

        if auto and row_id and not already_sent and whatsapp_service.provider_configured():
            ok = await asyncio.to_thread(
                whatsapp_service.send_whatsapp, phone, message, None, order["id"]
            )
            if ok:
                await _db(db.mark_whatsapp_sent, row_id)
    except Exception as e:
        logger.warning(f"WhatsApp notify error for order {order.get('id')}: {e}")


def _load_current_batch() -> dict:
    """Live batch window + token info."""
    _process_due_auto_confirm()
    batch_type = db.get_current_batch()
    return {
        "batch_type": batch_type,
        "token_starts_at": 18,
        "next_token": db.get_next_token(),
        "date_key": db._day_key(),
        "accepted_until": "12:30" if batch_type == "Afternoon" else "18:00",
        "delivery_window": "13:00-13:30" if batch_type == "Afternoon" else "19:30-19:45",
    }


@router.get("/batch")
async def current_batch():
    """Which delivery batch is accepting orders right now + stock info."""
    return await _cached_read(60, "batch", _load_current_batch)


@router.post("/orders/multi")
async def create_multi_shop_order(
    data: LocalMultiShopOrder,
    current_user: dict = Depends(get_current_local_user),
):
    """Place a multi-shop order (combo)."""
    import app.api.v1.local as local_mod

    if not data.shops:
        raise HTTPException(status_code=400, detail="No shops selected.")
    payload = data.model_dump()
    payload["student_phone"] = _normalize_phone(payload.get("student_phone", ""))

    for group in payload["shops"]:
        items = group.get("items") or []
        if not items:
            raise HTTPException(
                status_code=400, detail="One of the selected shops has no items in your cart."
            )
        for item in items:
            raw_quantity = item.get("quantity", 1)
            if raw_quantity is None or raw_quantity == "":
                raw_quantity = 1
            try:
                quantity = int(raw_quantity)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="Invalid item quantity.")
            if not 1 <= quantity <= MAX_LINE_QUANTITY:
                raise HTTPException(
                    status_code=400,
                    detail=f"You can order between 1 and {MAX_LINE_QUANTITY} of the same item.",
                )
            item["quantity"] = quantity

    for group in payload["shops"]:
        shop = await _db(db.get_shop, group["shop_id"])
        if not shop:
            raise HTTPException(status_code=400, detail="One of the shops could not be found.")
        if shop.get("approval_status") != "Approved":
            raise HTTPException(status_code=400, detail=f"{shop['name']} is not approved yet.")
        if not shop.get("present") or shop.get("status") != "Open":
            raise HTTPException(status_code=400, detail=f"{shop['name']} is currently closed.")

    try:
        parent = await _db(
            db.create_parent_order,
            student_name=payload["student_name"] or "Student",
            student_phone=payload["student_phone"] or "",
            delivery_location=payload["delivery_location"],
            payment_method=payload["payment_method"],
            shops=payload["shops"],
            student_email=payload.get("student_email", ""),
            student_id=str(current_user["id"]),
            owner_user_id=str(current_user["id"]),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not parent:
        raise HTTPException(
            status_code=400,
            detail="Could not place your order — a shop stopped accepting orders or an item was removed.",
        )
    for sub in parent.get("sub_orders", []):
        try:
            push_srv = getattr(local_mod, "push_service", push_service)
            asyncio.get_running_loop().create_task(
                push_srv.notify_shop_new_order_async(
                    {
                        "id": sub["id"],
                        "token": sub["token"],
                        "shop_id": sub["shop_id"],
                        "shop_name": sub["shop_name"],
                        "items": sub["items_summary"],
                        "total": sub["subtotal"],
                        "student_name": parent.get("student_name", ""),
                        "student_phone": parent.get("student_phone", ""),
                        "delivery_location": parent.get("delivery_location", ""),
                    }
                )
            )
        except Exception as e:
            logger.warning(f"Could not schedule sub-order push for {sub['id']}: {e}")

    notify_wa = getattr(local_mod, "_notify_shop_via_whatsapp", _notify_shop_via_whatsapp)
    notify_admin = getattr(local_mod, "_notify_admin_of_new_order", _notify_admin_of_new_order)

    if str(parent.get("payment_method") or "").upper() == "COD":
        for sub in parent.get("sub_orders", []):
            try:
                shop = await _db(db.get_shop, sub["shop_id"])
                wa_phone = (
                    str((shop or {}).get("whatsapp_number") or "").strip()
                    or str((shop or {}).get("phone") or "").strip()
                )
                if shop and wa_phone:
                    wa_order = {
                        "id": sub["id"],
                        "token": sub["token"],
                        "items": sub["items_summary"],
                        "student_name": parent.get("student_name", ""),
                        "student_phone": parent.get("student_phone", ""),
                        "delivery_location": parent.get("delivery_location", ""),
                        "total": sub["subtotal"],
                        "payment_method": "COD",
                    }
                    await notify_wa(wa_order, shop, wa_phone)
            except Exception as e:
                logger.warning(f"Could not schedule sub-order WhatsApp for {sub.get('id')}: {e}")

    for sub in parent.get("sub_orders", []):
        try:
            await notify_admin(
                {
                    "id": sub["id"],
                    "token": sub["token"],
                    "shop_name": sub.get("shop_name") or "",
                    "items": sub.get("items_summary") or "",
                    "total": sub.get("subtotal") or 0,
                    "student_name": parent.get("student_name", ""),
                    "payment_method": parent.get("payment_method", "UPI"),
                    "status": sub.get("status", ""),
                }
            )
        except Exception as e:
            logger.warning(f"Could not queue the admin confirmation for {sub.get('id')}: {e}")

    return parent


@router.get("/shop-orders/{shop_id}")
async def shop_sub_orders(
    shop_id: str,
    status: str | None = None,
    _admin: dict = Depends(_require_admin),
):
    """A shop's own sub-orders (only THIS shop's items, never other shops')."""
    return await _db(db.get_shop_sub_orders, shop_id, status)


@router.patch("/shop-orders/{sub_order_id}/status")
async def patch_sub_order_status(
    sub_order_id: str,
    data: LocalSubOrderStatusUpdate,
    _admin: dict = Depends(_require_admin),
):
    updated = await _db(db.update_sub_order_status, sub_order_id, data.status, data.notes)
    if not updated:
        raise HTTPException(status_code=404, detail="Sub-order not found")
    return updated
