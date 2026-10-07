"""Telegram admin notifications (Bot API, server-side only).

The bot token and admin chat id live in environment variables and are never
sent to the frontend. All sends are best-effort: a Telegram outage is logged
and swallowed so an order/payment submission NEVER fails because the
notification did not go through.

API usage follows the official Telegram Bot API (sendMessage + inline URL
buttons, HTML parse_mode): ``POST https://api.telegram.org/bot<token>/...``.
"""
import html
import logging
import threading
from datetime import datetime
from typing import Any

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

_API_BASE = "https://api.telegram.org"
_TIMEOUT_SECONDS = 10.0


def is_configured() -> bool:
    return bool((settings.TELEGRAM_BOT_TOKEN or "").strip() and (settings.TELEGRAM_ADMIN_CHAT_ID or "").strip())


def admin_order_url(order_id: str) -> str:
    # The split admin portal (ADMIN_PORTAL_URL) serves the verify page at
    # /orders/<id>; the legacy single-portal frontend serves it at
    # <ADMIN_ORDER_PATH>/<id> (default /admin/orders/<id>).
    admin_base = (settings.ADMIN_PORTAL_URL or "").rstrip("/")
    if admin_base:
        return f"{admin_base}/orders/{order_id}"
    base = (settings.FRONTEND_URL or "").rstrip("/")
    path = (settings.ADMIN_ORDER_PATH or "/admin/orders").strip() or "/admin/orders"
    if not path.startswith("/"):
        path = f"/{path}"
    return f"{base}{path}/{order_id}" if base else f"{path}/{order_id}"


def _escape(value: Any) -> str:
    return html.escape(str(value if value is not None else ""), quote=False)


def _post(method: str, payload: dict[str, Any]) -> bool:
    """Single synchronous Bot API call. Returns True on ok, False otherwise."""
    token = (settings.TELEGRAM_BOT_TOKEN or "").strip()
    if not token:
        logger.warning("Telegram send skipped: TELEGRAM_BOT_TOKEN is not set.")
        return False
    url = f"{_API_BASE}/bot{token}/{method}"
    try:
        with httpx.Client(timeout=_TIMEOUT_SECONDS) as client:
            resp = client.post(url, json=payload)
    except Exception as exc:
        logger.error("Telegram %s failed (network): %s", method, exc)
        return False
    if resp.status_code == 429:
        try:
            retry_after = int(resp.json().get("parameters", {}).get("retry_after", 0))
        except Exception:
            retry_after = 0
        logger.warning("Telegram %s rate-limited (retry_after=%s).", method, retry_after)
        return False
    if resp.status_code != 200:
        logger.error("Telegram %s HTTP %s: %s", method, resp.status_code, resp.text[:300])
        return False
    try:
        ok = bool(resp.json().get("ok"))
    except Exception:
        ok = False
    if not ok:
        logger.error("Telegram %s not ok: %s", method, resp.text[:300])
    return ok


def send_message_to(chat_id: str, text: str, *, reply_markup: dict[str, Any] | None = None) -> bool:
    """Send a raw HTML-formatted message to one chat (blocking)."""
    chat_id = (chat_id or "").strip()
    if not chat_id:
        return False
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }
    if reply_markup:
        payload["reply_markup"] = reply_markup
    return _post("sendMessage", payload)


def send_message(text: str, *, reply_markup: dict[str, Any] | None = None) -> bool:
    """Send a raw HTML-formatted message to the admin chat (blocking)."""
    chat_id = (settings.TELEGRAM_ADMIN_CHAT_ID or "").strip()
    if not chat_id:
        logger.warning("Telegram send skipped: TELEGRAM_ADMIN_CHAT_ID is not set.")
        return False
    return send_message_to(chat_id, text, reply_markup=reply_markup)


def _view_order_button(order_id: str) -> dict[str, Any]:
    return {"inline_keyboard": [[{"text": "👉 VIEW ORDER", "url": admin_order_url(order_id)}]]}


def _is_public_url(url: str) -> bool:
    """Telegram rejects button URLs it cannot open (localhost, bare hosts).

    A rejected button fails the ENTIRE sendMessage call — the admin would get
    nothing at all — so in local development the button is dropped and the
    text still goes through. Production (deployed https admin URL) keeps it.
    """
    try:
        from urllib.parse import urlparse

        parts = urlparse(url or "")
        if parts.scheme not in ("http", "https"):
            return False
        host = (parts.hostname or "").lower()
        if not host or host in ("localhost", "127.0.0.1", "0.0.0.0", "::1"):
            return False
        if host.endswith(".local") or host.endswith(".localhost"):
            return False
        return True
    except Exception:
        return False


def _view_order_markup(order_id: str) -> dict[str, Any] | None:
    url = admin_order_url(order_id)
    if not _is_public_url(url):
        logger.info("Telegram VIEW ORDER button dropped (non-public base URL): %s", url)
        return None
    return {"inline_keyboard": [[{"text": "👉 VIEW ORDER", "url": url}]]}


def build_payment_proof_message(
    *,
    customer_name: str,
    order_id: str,
    order_token: str = "",
    amount: Any = "",
    utr: str = "",
    item_count: Any = "",
    submitted_at: str = "",
) -> str:
    ref = f"#{order_token}" if order_token else f"#{order_id}"
    lines = [
        "🔔 <b>NEW PAYMENT VERIFICATION</b>",
        "",
        f"👤 Customer: {_escape(customer_name)}",
        f"🧾 Order: {_escape(ref)}",
        f"💰 Amount: ₹{_escape(amount)}",
        f"💳 UTR: <code>{_escape(utr)}</code>",
    ]
    if item_count not in ("", None):
        lines.append(f"📦 Items: {_escape(item_count)}")
    lines.append("💳 Payment Method: UPI")
    lines.append("⏳ Status: PAYMENT PROOF SUBMITTED")
    when = submitted_at or datetime.now().astimezone().strftime("%d %b %Y, %I:%M %p")
    lines.append(f"🕐 Submitted: {_escape(when)}")
    lines += ["", "⚠️ Payment requires manual verification."]
    return "\n".join(lines)


def _send_async(text: str, order_id: str) -> None:
    """Fire-and-forget delivery on a daemon thread — never raises."""

    def _run() -> None:
        try:
            send_message(text, reply_markup=_view_order_markup(order_id))
        except Exception as exc:  # never break the request path
            logger.error("Telegram async send failed for order %s: %s", order_id, exc)

    try:
        thread = threading.Thread(target=_run, name=f"telegram-{order_id}", daemon=True)
        thread.start()
    except Exception as exc:
        logger.error("Could not start Telegram thread for order %s: %s", order_id, exc)


def notify_payment_proof_async(
    *,
    customer_name: str,
    order_id: str,
    order_token: str = "",
    amount: Any = "",
    utr: str = "",
    item_count: Any = "",
    submitted_at: str = "",
) -> None:
    """Notify the admin of a new payment proof (non-blocking, best-effort)."""
    if not is_configured():
        logger.info("Telegram not configured — skipping proof notification for %s.", order_id)
        return
    _send_async(
        build_payment_proof_message(
            customer_name=customer_name,
            order_id=order_id,
            order_token=order_token,
            amount=amount,
            utr=utr,
            item_count=item_count,
            submitted_at=submitted_at,
        ),
        order_id,
    )


def notify_payment_decision_async(
    *, order_id: str, order_token: str = "", approved: bool, reason: str = ""
) -> None:
    """Optional approved/rejected follow-up for the admin chat."""
    if not is_configured():
        return
    ref = f"#{order_token}" if order_token else f"#{order_id}"
    if approved:
        text = f"✅ <b>PAYMENT APPROVED</b>\n\n🧾 Order: {_escape(ref)}\nOrder moved to processing."
    else:
        text = f"❌ <b>PAYMENT REJECTED</b>\n\n🧾 Order: {_escape(ref)}"
        if (reason or "").strip():
            text += f"\n📝 Reason: {_escape(reason.strip()[:300])}"
    _send_async(text, order_id)


# ─── Inbound commands (/start, /help, /status) ───
# The bot is primarily a notifier, but admins (and setup) message it, so the
# webhook answers the basics. Order/payment details are ONLY ever revealed to
# the configured admin chat — anyone else gets the generic intro.

def is_admin_chat(chat_id: Any) -> bool:
    configured = (settings.TELEGRAM_ADMIN_CHAT_ID or "").strip()
    return bool(configured) and str(chat_id or "").strip() == configured


def parse_incoming(update: dict[str, Any]) -> tuple[str, str] | None:
    """Extract (chat_id, command) from a Telegram update. Returns None for
    non-command updates (the bot stays silent on plain chatter)."""
    if not isinstance(update, dict):
        return None
    msg = update.get("message") or {}
    if not isinstance(msg, dict):
        return None
    text = str(msg.get("text") or "").strip()
    if not text.startswith("/"):
        return None
    chat = msg.get("chat") or {}
    chat_id = str(chat.get("id") or "").strip()
    if not chat_id:
        return None
    command = text.split()[0].lstrip("/").split("@")[0].lower()
    return chat_id, command


def command_reply(command: str, chat_id: str, *, pending_count: int | None = None) -> str | None:
    """Reply text for an inbound command, or None to stay silent."""
    admin = is_admin_chat(chat_id)
    if command == "start":
        lines = [
            "👋 <b>DETOMSITE order alerts</b>",
            "",
            "This bot notifies the admin about new UPI payment proofs that need manual verification.",
        ]
        if admin:
            lines += ["", "✅ This chat is registered as the admin chat. You will receive new-proof alerts here."]
        else:
            lines += [
                "",
                f"🆔 Your chat id is <code>{_escape(chat_id)}</code> — set it as TELEGRAM_ADMIN_CHAT_ID so this chat receives the alerts.",
            ]
        return "\n".join(lines)
    if command == "help":
        return "\n".join(
            [
                "📖 <b>Commands</b>",
                "",
                "/start — check this chat's registration",
                "/help — this message",
                "/status — proofs waiting for verification (admin chat only)",
            ]
        )
    if command == "status":
        if not admin:
            return "🔒 The /status command only works in the registered admin chat."
        if pending_count is None:
            return "⏳ Could not read the queue right now — try again in a moment."
        if pending_count == 0:
            return "✅ No payment proofs are waiting for verification."
        return f"🔔 <b>{pending_count} payment proof{'s' if pending_count != 1 else ''}</b> waiting for verification. Open the admin portal to review."
    return "❓ Unknown command. Try /help."
