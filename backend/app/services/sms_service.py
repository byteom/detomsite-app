"""
SMS notification + order confirmation service.

Purpose
-------
The pipeline is: a student places an order → an SMS lands on the
shopkeeper's phone (and a copy reaches the admin) with the order details
and a plain-text confirm line → the shopkeeper replies ``YES <token>`` (or
``NO <token>``) → the incoming webhook (``POST /api/v1/local/sms/incoming``)
parses the reply and updates the order to **Confirmed** (or **Cancelled**).

Because there is no SMS provider key in the codebase yet, ``send_sms`` logs
every message to the ``sms_logs`` table and raises only on real gateway
failures — so the flow works end-to-end out of the box, and a real gateway
(Twilio / Fast2SMS / Textlocal) can be dropped in by replacing the single
``send_sms`` function. Nothing in the API layer changes.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable

logger = logging.getLogger(__name__)

# International SMS length cap (160 ASCII chars). Longer messages are split by
# the gateway; the completion line (YES/NO + token) is always the LAST fragment
# so it is never truncated away from a human reader.
SMS_LIMIT = 160


def or_none(value: Any) -> str:
    """Best-effort compact string for an optional field."""
    return str(value).strip() if value not in (None, "") else ""


def compose_order_sms(order: dict[str, Any]) -> str:
    """Build a clear, human-readable order SMS for the shopkeeper.

    Verbs are ALL-CAP and the reply instruction is the final line so the
    confirm action is impossible to miss. Every relevant fact the shop needs
    to accept the order is on its own line.
    """
    token = order.get("token") or order.get("id") or "?"
    items = or_none(order.get("items"))
    if not items:
        # Fallback: render item lines from the products list if present.
        products = order.get("products") or []
        items = ", ".join(
            f"{p.get('quantity', 1)}x {p.get('name', 'Item')}" for p in products
        ) or "(no items listed)"

    student = or_none(order.get("student_name")) or "(no name)"
    location = or_none(order.get("delivery_location")) or "(no location)"
    slot = or_none(order.get("delivery_slot")) or "Next batch"
    created = str(order.get("created_at") or "")[11:16] or "just now"
    amount = order.get("total") or 0
    payment = or_none(order.get("payment_method")) or "UPI"
    if payment.upper() == "COD":
        payment = "CASH ON DELIVERY"

    return (
        f"DETOMSITE ORDER #{token}\n"
        f"NEW ORDER ({created})\n"
        f"Student: {student}\n"
        f"Items: {items}\n"
        f"Where: {location}\n"
        f"Slot: {slot}\n"
        f"Pay: {payment.upper()} Rs {amount}\n"
        f"REPLY: YES {token} = CONFIRM | NO {token} = REJECT"
    )


def compose_confirmation_sms(order: dict[str, Any]) -> str:
    """SMS back to the student confirming their order is accepted."""
    token = order.get("token") or order.get("id") or "?"
    shop = or_none(order.get("shop_name"))
    return (
        f"DETOMSITE ORDER #{token} CONFIRMED ✓\n"
        f"{shop} accepted your order.\n"
        f"Track it in the app — collect from the counter when Ready."
    )


def shop_label(order: dict[str, Any]) -> str:
    """Best-effort shop name for a message body (handles sub-order shapes)."""
    return (
        or_none(order.get("shop_name"))
        or or_none((order.get("shop") or {}).get("name"))
        or "your shop"
    )


def compose_order_confirmed_wa(order: dict[str, Any]) -> str:
    """WhatsApp message sent to the shop the moment the ADMIN confirms an order.

    This is the third state in the shop's WhatsApp timeline:
      1. order placed          → "New DETOMSITE order #N … awaiting payment"
      2. admin confirmed it    → THIS message ("confirmed by the admin")
      3. payment verified      → "UPI paid ₹X ✓"

    Sent automatically when a WhatsApp provider is configured (``WA_PROVIDER``);
    otherwise it is stored as a Pending wa.me row so the admin centre can still
    one-tap send it. Never raises — a failed message must not block the confirm.
    """
    token = order.get("token") or order.get("id") or "?"
    items = or_none(order.get("items"))
    if not items:
        products = order.get("products") or []
        items = ", ".join(
            f"{p.get('quantity', 1)}x {p.get('name', 'Item')}" for p in products
        ) or "(no items listed)"
    student = or_none(order.get("student_name")) or "(no name)"
    amount = order.get("total") or 0
    payment = or_none(order.get("payment_method")) or "UPI"
    if payment.upper() == "COD":
        payment_label = f"Cash on Delivery ₹{amount}"
    else:
        payment_label = f"{payment.upper()} ₹{amount}"
    # Unique per-order reference — a multi-shop order shares one token across
    # every sub-order, so the phone bot needs the sub-order id to be sure which
    # chat it is verifying.
    ref = or_none(order.get("id"))
    ref_line = f"\n• Ref: {ref}" if ref else ""
    return (
        f"✅ DETOMSITE order #{token} is CONFIRMED{ref_line}\n\n"
        f"• {shop_label(order)}\n"
        f"• Student: {student}\n"
        f"• Items: {items}\n"
        f"• Payment: {payment_label}\n\n"
        f"The admin has approved this order. Please start preparing it and keep "
        f"the token ready for pickup. Thank you!"
    )


def compose_order_wa(order: dict[str, Any], paid: bool | None = None) -> str:
    """WhatsApp-ready order message for the shopkeeper.

    Same facts as the SMS but reads naturally on WhatsApp (no CAPS shout, no
    reply-token — the shopkeeper confirms from their app/portal instead). This
    text is pre-filled into a ``wa.me`` chat with the shop's WhatsApp number,
    so the shopkeeper receives it **from the admin's own number**, for free.

    ``paid`` reflects whether the payment is verified *at send time*:
      - ``True``  → "UPI paid ₹X ✓"   (bank-SMS/UTR match, screenshot verified)
      - ``False`` → "UPI ₹X — awaiting payment"   (order just placed, no proof yet)
      - ``None``  → old behaviour: assume the payer is proven (legacy callers)
    COD is always shown as "Cash on Delivery ₹X".
    """
    token = order.get("token") or order.get("id") or "?"
    items = or_none(order.get("items"))
    if not items:
        products = order.get("products") or []
        items = ", ".join(
            f"{p.get('quantity', 1)}x {p.get('name', 'Item')}" for p in products
        ) or "(no items listed)"
    student = or_none(order.get("student_name")) or "(no name)"
    location = or_none(order.get("delivery_location")) or "(no location)"
    slot = or_none(order.get("delivery_slot")) or "Next batch"
    amount = order.get("total") or 0
    payment = or_none(order.get("payment_method")) or "UPI"
    if payment.upper() == "COD":
        paid_label = "Cash on Delivery ₹" + str(amount)
    elif paid is False:
        paid_label = f"{payment.upper()} ₹{amount} — awaiting payment"
    else:
        paid_label = f"{payment.upper()} paid ₹{amount} ✓"
    # Unique per-order reference. A multi-shop (combo) order shares ONE token
    # across all its shop sub-orders, so the token alone cannot tell two
    # sub-order messages apart — the phone bot uses this Ref to verify the
    # exact message it is about to send and never taps the wrong chat.
    ref = or_none(order.get("id"))
    ref_line = f"\n• Ref: {ref}" if ref else ""
    # A COD order is PLACED, not proposed — the student has committed and the
    # money is collected on handover, so there is nothing for the shopkeeper to
    # confirm. Telling them to "confirm this order" in the app asked for a tap
    # that is no longer part of the flow. Prepaid orders still genuinely await
    # payment, so that instruction stays for them.
    if payment.upper() == "COD":
        closing = (
            "This order is already placed — please start preparing it and keep "
            "the token ready for pickup. Thank you!"
        )
    else:
        closing = "Please confirm this order in the DETOMSITE shop app. Thank you!"
    return (
        f"Hello! New DETOMSITE order #{token} for you 🛵\n\n"
        f"• Student: {student}\n"
        f"• Items: {items}\n"
        f"• Deliver to: {location}\n"
        f"• Slot: {slot}\n"
        f"• Payment: {paid_label}{ref_line}\n\n"
        f"{closing}"
    )


async def send_sms_async(
    phone: str,
    message: str,
    log_fn: Callable[..., Any],
    sub_order_id: str = "",
) -> bool:
    """Fire an SMS off the event loop and persist it in ``sms_logs``.

    ``log_fn`` is the active store's ``log_sms`` (wired differently for the
    SQLite/Supabase sync store and the async Mongo store), called on the
    worker thread. Returns True when the SMS was accepted.
    """
    if not phone or not phone.strip():
        return False
    try:
        await asyncio.to_thread(log_fn, sub_order_id, phone, message, "Sent")
        logger.info(f"SMS → {phone}: {message.splitlines()[0]}")
        return True
    except Exception as e:
        logger.error(f"SMS send failed to {phone}: {e}")
        return False


async def send_whatsapp_confirmed(
    order: dict[str, Any],
    shop: dict[str, Any] | None,
    db: Any,
) -> bool:
    """Tell the shop, on WhatsApp, that the admin CONFIRMED its order.

    Runs the moment the admin presses Confirm in the notification bell, which is
    what the shopkeeper needs: "stop waiting, this order is real, start cooking".

    Delivery is automatic when a gateway is configured (``WA_PROVIDER`` =
    wassenger / meta / webhook) and falls back to a Pending ``wa.me`` row in the
    admin → WhatsApp centre otherwise, so the zero-cost manual path still works.

    Every step is best-effort: a WhatsApp outage must never roll back or fail a
    confirmation the admin already made. Returns True when a gateway accepted
    the message, False when it is sitting in the Pending queue instead.
    """
    from urllib.parse import quote

    from app.services import whatsapp_service

    if not order or not order.get("id"):
        return False
    shop = shop or {}
    phone = str(shop.get("whatsapp_number") or "").strip() or str(shop.get("phone") or "").strip()
    if not phone:
        logger.info(f"No WhatsApp/phone number for shop of order {order.get('id')} — confirm WhatsApp skipped")
        return False

    try:
        message = compose_order_confirmed_wa(order)
        digits = "".join(ch for ch in phone if ch.isdigit())
        if len(digits) == 10:
            digits = "91" + digits
        url = f"https://wa.me/{digits}?text={quote(message)}"

        # Persist FIRST so the message is queued even if the gateway call below
        # fails or the process is frozen right after the response — nothing is
        # ever silently lost.
        created = await asyncio.to_thread(
            db.log_whatsapp,
            sub_order_id=order["id"],
            phone=phone,
            message=message,
            url=url,
            status="Pending",
        )
        row_id = (created or {}).get("id")

        if row_id and whatsapp_service.provider_configured():
            sent = await asyncio.to_thread(
                whatsapp_service.send_whatsapp, phone, message, None, order["id"]
            )
            if sent:
                await asyncio.to_thread(db.mark_whatsapp_sent, row_id)
                logger.info(f"Order {order['id']}: confirmation WhatsApp auto-sent to {phone}")
                return True
        logger.info(f"Order {order['id']}: confirmation WhatsApp queued for {phone}")
        return False
    except Exception as e:
        logger.warning(f"Confirmation WhatsApp error for order {order.get('id')}: {e}")
        return False
