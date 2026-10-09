import asyncio
import logging
import re
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request

from app.api.v1.local.common import rate_allow, rate_ip
from app.core.store import store as db
from app.api.v1.local.common import (
    BANK_MATCH_WINDOW_MINUTES,
    BANK_SETTLEABLE_STATUSES,
    _db,
    _dialable_whatsapp_number,
    _extract_amount,
    _extract_utr,
    _is_valid_utr,
    _log_sms_inbound,
    _order_age_minutes,
    _push_admin,
    _require_admin,
    _require_agent_key,
)
from app.api.v1.local.schemas import (
    LocalIncomingSms,
    LocalSmsMatch,
)

logger = logging.getLogger(__name__)

router = APIRouter()


async def _get_payment_by_utr(utr: str):
    return await _db(db.get_payment_by_utr, utr)


async def _get_order(order_id: str):
    return await _db(db.get_order, order_id)


async def _bank_sms_seen(utr: str) -> bool:
    return bool(await _db(db.bank_sms_seen, utr))


@router.post("/sms/incoming")
async def sms_incoming(
    data: LocalIncomingSms,
    request: Request,
    x_agent_key: Optional[str] = Header(None),
):
    """Receive an inbound SMS reply and act on it."""
    _require_agent_key(x_agent_key, request)

    text = (data.text or "").strip()
    phone = (data.phone or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="No SMS text provided")

    report = {"received": True, "phone": phone, "text": text, "order": None}

    utr = _extract_utr(text)
    amount = _extract_amount(text)
    if utr and amount is not None:
        await _log_sms_inbound("", phone, f"bank-credit ignored:{utr}", "Ignored")
        raise HTTPException(
            status_code=410,
            detail="Automatic bank verification is disabled. Payments are verified manually by an admin.",
        )
    if not re.fullmatch(
        r"(?i)(?:yes|y|confirm|accept|ok|no|n|reject|decline|cancel)\s+#?\d+", text
    ):
        raise HTTPException(
            status_code=400,
            detail="Unrecognised or ambiguous SMS; manual review required",
        )

    lowered = text.lower().replace("#", " ")
    words = lowered.split()
    action = None
    token = ""
    for i, w in enumerate(words):
        if w in ("yes", "y", "confirm", "accept", "ok"):
            action = "Confirmed"
            if i + 1 < len(words):
                token = words[i + 1]
            break
        if w in ("no", "n", "reject", "decline", "cancel"):
            action = "Cancelled"
            if i + 1 < len(words):
                token = words[i + 1]
            break

    if not action or not token or not token.isdigit():
        raise HTTPException(status_code=400, detail="Could not find a valid order token in SMS")

    order = await _db(db.get_order_by_token, int(token))
    if not order:
        raise HTTPException(status_code=404, detail=f"No order found with token #{token}")

    if order.get("status") == "Pending Payment":
        await _log_sms_inbound(
            order["id"],
            phone,
            f"{text} -> Refused: order {order['id']} is pending payment",
            "Refused",
        )
        raise HTTPException(
            status_code=409,
            detail=f"Order #{token} has not been paid yet. Payment must be confirmed before accepting the order.",
        )

    updated = await _db(db.update_order_status, order["id"], action)
    await _log_sms_inbound(
        order["id"],
        phone,
        f"{text} -> {action} (token #{token})",
        "Applied",
    )

    try:
        await _db(
            db.create_notification,
            title=f"Order {action}",
            message=f"Order #{token} was {action.lower()} via SMS reply from {phone}.",
            order_id=order["id"],
            status=action,
            target_role="student",
        )
        await _db(
            db.create_notification,
            title=f"Order {action}",
            message=f"Order #{token} was {action.lower()} via SMS reply from {phone}.",
            order_id=order["id"],
            status=action,
            target_role="admin",
        )
    except Exception as e:
        logger.warning(f"SMS confirmation log error: {e}")

    report["order"] = updated or order
    return report


@router.post("/sms/match")
async def sms_match(
    data: LocalSmsMatch,
    request: Request,
    x_agent_key: Optional[str] = Header(None),
):
    """CUT OFF — automatic bank-credit settlement is disabled."""
    _require_agent_key(x_agent_key, request)
    raise HTTPException(
        status_code=410,
        detail="Automatic bank verification is disabled. Payments are verified manually by an admin.",
    )


async def _sms_match_core(data: LocalSmsMatch) -> dict:
    """Shared matching logic behind sms/match."""
    import app.api.v1.local as local_mod

    utr = (data.utr or "").strip().upper()
    if utr and not _is_valid_utr(utr):
        raise HTTPException(status_code=422, detail="UTR is not a valid reference")
    amount = data.amount
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be > 0")

    try:
        shop = await _db(db.get_shop_by_phone, data.phone)
        if not shop:
            raise HTTPException(
                status_code=404,
                detail="No shop found matching this phone number",
            )

        orders = await _db(db.list_orders_by_shop, shop["id"])
        if utr:
            claims = await _db(db.list_payments_by_utr, utr)
        else:
            claims = []

        payment = None
        order = None
        if len(claims) == 1:
            payment = claims[0]
            order = next((o for o in orders if o["id"] == payment.get("order_id")), None)
            if payment.get("status") == "Success":
                raise HTTPException(
                    status_code=409,
                    detail="This payment is already settled — nothing left to verify.",
                )
            if (
                not order
                or order.get("status") != "Pending Payment"
                or str(order.get("payment_method") or "").upper() not in ("UPI", "MANUAL UTR")
                or abs(float(order.get("total") or 0) - amount) >= 0.01
                or abs(float(payment.get("amount") or 0) - amount) >= 0.01
            ):
                raise HTTPException(
                    status_code=409,
                    detail="Payment proof does not match this shop's pending UPI order",
                )
        elif len(claims) > 1:
            raise HTTPException(
                status_code=409,
                detail="Payment needs review: this UTR is claimed on more than one order",
            )
        else:
            prefiltered = []
            for candidate in orders:
                if str(candidate.get("status") or "") not in BANK_SETTLEABLE_STATUSES:
                    continue
                if str(candidate.get("payment_method") or "").upper() not in ("UPI", "MANUAL UTR"):
                    continue
                if abs(float(candidate.get("total") or 0) - amount) >= 0.01:
                    continue
                age = _order_age_minutes(candidate)
                if age is None or age > BANK_MATCH_WINDOW_MINUTES or age < -5:
                    continue
                prefiltered.append(candidate)
            payment_by_order: dict[str, dict] = {}
            if prefiltered:
                try:
                    payment_by_order = (
                        await _db(
                            db.get_payments_map_by_order_ids,
                            [str(c.get("id") or "") for c in prefiltered],
                        )
                        or {}
                    )
                except AttributeError:
                    for c in prefiltered:
                        row = await _db(db.get_payment_by_order_id, str(c.get("id") or ""))
                        if row:
                            payment_by_order[str(c.get("id") or "")] = row
            candidates = []
            for candidate in prefiltered:
                row = payment_by_order.get(str(candidate.get("id") or ""))
                if not row:
                    continue
                if str(row.get("status") or "") in ("Success", "Cancelled", "Failed", "Rejected"):
                    continue
                if abs(float(row.get("amount") or 0) - amount) >= 0.01:
                    continue
                candidates.append((candidate, row))

            if not candidates:
                raise HTTPException(
                    status_code=409,
                    detail="Payment needs review: no unpaid order at this shop matches the credited amount",
                )
            if len(candidates) > 1:
                owners = {str((c[0].get("owner_user_id") or "")).strip() for c in candidates}
                if len(owners) == 1 and "" not in owners:

                    def _age_key(pair):
                        row = pair[0]
                        try:
                            token_val = int(row.get("token") or 0)
                        except (TypeError, ValueError):
                            token_val = 0
                        return (str(row.get("created_at") or ""), token_val)

                    candidates.sort(key=_age_key)
                    keeper, keeper_row = candidates[-1]
                    for stale, stale_row in candidates[:-1]:
                        try:
                            if str(stale_row.get("status") or "") not in (
                                "Success",
                                "Cancelled",
                                "Failed",
                                "Rejected",
                            ):
                                await _db(db.update_payment_status, stale_row["id"], "Cancelled")
                            if str(stale.get("status") or "") in BANK_SETTLEABLE_STATUSES:
                                await _db(db.update_order_status, stale["id"], "Cancelled")
                        except Exception as e:
                            logger.warning(
                                f"Could not close superseded draft {stale.get('id')}: {e}"
                            )
                    logger.info(
                        f"sms/match: collapsed {len(candidates)} same-owner drafts at shop "
                        f"{shop.get('id')} to the live order {keeper.get('id')}"
                    )
                    candidates = [(keeper, keeper_row)]
            if len(candidates) > 1:
                raise HTTPException(
                    status_code=409,
                    detail="Payment needs review: more than one unpaid order matches this credit — settle it manually",
                )
            order, payment = candidates[0]
            burn_ref = utr or f"SMS-{shop['id']}-{order['id']}"
            stamped = await _db(db.set_payment_utr, order["id"], burn_ref)
            if stamped:
                payment = stamped

        try:
            settled = await _db(db.settle_payment_if_open, payment["id"])
        except AttributeError:
            settled = await _db(db.update_payment_status, payment["id"], "Success")
        if not settled:
            raise HTTPException(
                status_code=409,
                detail="This payment is already settled — nothing left to verify.",
            )

        notify_paid = getattr(local_mod, "_notify_shop_of_paid_order", None)
        if notify_paid:
            await notify_paid(order)

        await _db(db.update_order_status, order["id"], "Completed")

        proof_label = f"UTR {utr}" if utr else "QR payment (no reference)"
        await _log_sms_inbound(
            order["id"],
            data.phone,
            f"{proof_label} Amt:{int(order.get('total', 0))} -> Completed (bank SMS match)",
            "Auto-Confirmed",
        )

        try:
            await _db(
                db.create_notification,
                title="Payment verified — order confirmed",
                message=f"{proof_label} — ₹{order.get('total')} credit confirmed. Order #{order.get('token')} is complete.",
                order_id=order["id"],
                status="Completed",
                target_role="student",
            )
            await _db(
                db.create_notification,
                title="Payment verified — order confirmed",
                message=f"{proof_label} — ₹{order.get('total')} credit confirmed. Order #{order.get('token')} is complete.",
                order_id=order["id"],
                status="Completed",
                target_role="admin",
            )
        except Exception as e:
            logger.warning(f"sms/match notification error: {e}")
        _push_admin(
            (
                "Order paid & confirmed via bank UTR"
                if utr
                else "Order paid & confirmed via QR payment"
            ),
            f"{proof_label} — ₹{order.get('total')} credit confirmed. Token #{order.get('token')} completed.",
            tag="order-confirm",
        )

        try:
            wa_phone = (
                str((shop.get("whatsapp_number") or "")).strip()
                or str((shop.get("phone") or "")).strip()
            )
            if wa_phone:
                notify_wa = getattr(local_mod, "_notify_shop_via_whatsapp", None)
                if notify_wa:
                    await notify_wa(order, shop, wa_phone, paid=True)
        except Exception as e:
            logger.warning(f"sms/match WhatsApp error for {order.get('id')}: {e}")

        return {
            "matched": True,
            "utr": utr,
            "amount": int(amount),
            "shop": shop.get("id"),
            "order_id": order["id"],
            "order_status": "Completed",
            "matched_by": "utr_claim" if len(claims) == 1 else "bank_credit",
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"sms/match error: {e}")
        raise HTTPException(status_code=500, detail="Internal error")


@router.get("/whatsapp/pending")
async def whatsapp_pending_agent(
    request: Request,
    x_agent_key: Optional[str] = Header(None),
):
    """Pending WhatsApp notifications for the on-phone auto-send bot."""
    _require_agent_key(x_agent_key, request)

    if not rate_allow(
        "wa_pending", rate_ip(request), max_attempts=30, window_sec=60
    ):
        raise HTTPException(
            status_code=429,
            detail="Too many queue polls — slow down.",
        )

    logs = await _db(db.list_whatsapp_logs, 100)
    candidates = []
    for log in logs or []:
        if str(log.get("status") or "").lower() == "sent":
            continue
        message = str(log.get("message") or "").strip()
        if "awaiting payment" in message.lower():
            continue
        if not _dialable_whatsapp_number(log.get("phone")):
            logger.warning(
                "Skipping WhatsApp row %s: no usable number (%r)",
                log.get("id"),
                log.get("phone"),
            )
            continue
        candidates.append(log)

    if not candidates:
        return []
    row = await _db(
        db.claim_next_whatsapp_log,
        [c.get("id") for c in candidates if c.get("id")],
        5,
    )
    if not row:
        return []
    return [
        {
            "id": row.get("id"),
            "sub_order_id": row.get("sub_order_id") or row.get("order_id") or "",
            "phone": str(row.get("phone") or "").strip(),
            "message": str(row.get("message") or "").strip(),
        }
    ]


@router.post("/whatsapp/{whatsapp_id}/mark-sent")
async def whatsapp_mark_sent_agent(
    whatsapp_id: str,
    request: Request,
    x_agent_key: Optional[str] = Header(None),
):
    """Mark a WhatsApp notification as sent once the phone bot delivered it."""
    _require_agent_key(x_agent_key, request)
    doc = await _db(db.mark_whatsapp_sent, whatsapp_id)
    if not doc:
        raise HTTPException(status_code=404, detail="WhatsApp notification not found")
    return doc


@router.get("/sms-logs")
async def sms_logs(limit: int = 100, _admin: dict = Depends(_require_admin)):
    """Admin view of all SMS messages (out-bound orders + inbound replies)."""
    return await _db(db.list_sms_logs, limit)
