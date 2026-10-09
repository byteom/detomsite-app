"""Email service for sending emails.

Delivery order: SMTP first when ``SMTP_HOST`` is set (Gmail App Password
default — see app.core.config), Resend HTTP API as fallback when SMTP is
absent or rejects the mail. With neither, it falls back to logging the email
body so the flow still works in development. Forgot-password OTPs are only
ever delivered by email — the API never returns the code.
"""
import asyncio
import logging
import smtplib

import httpx
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

from app.core.config import settings

logger = logging.getLogger(__name__)


def _smtp_configured() -> bool:
    return bool(settings.SMTP_HOST)


def email_delivery_configured() -> bool:
    """True when this deployment can actually DELIVER an email.

    PENTEST/RELIABILITY FIX. Without this, a flow that emails a one-time code
    (forgot-password, forgot-username, phone onboarding) cannot notice that no
    mail provider exists at all, so it reports "we sent you a code" while the
    code only ever reached the server log. Callers use this to fail honestly
    instead of sending the user to an inbox that will stay empty.

    ``_deliver`` prefers Resend over SMTP, so either one satisfies it.
    """
    return bool(settings.RESEND_API_KEY or settings.SMTP_HOST)


def _send_smtp(to_email: str, subject: str, html_body: str, text_body: str) -> bool:
    """Deliver an email over SMTP. Returns True when accepted by the server.
    smtplib is blocking, so callers must run this off the event loop — the
    public EmailService methods wrap it in asyncio.to_thread.

    Gmail default: host=smtp.gmail.com, port=587, STARTTLS on, auth with the
    full Gmail address + a 16-char App Password (Google Account → Security →
    2-Step Verification → App passwords). Port 465 uses implicit SSL instead.
    """
    if not _smtp_configured():
        # No mail server configured. PENTEST/RELIABILITY FIX: this used to
        # `return True`, i.e. "email sent", while nothing had been sent at all.
        # Every caller ignored the return value anyway, so the whole chain
        # reported success and the user was told "a 4-digit code was sent to
        # your registered email" while the code only ever reached the log file.
        # That is exactly why forgot-password looked broken with nothing to
        # debug: the API said it worked, so nobody checked the mail server.
        #
        # Return False so a caller CAN detect an undelivered message, and say so
        # plainly instead of claiming a success that never happened.
        if settings.DEBUG:
            logger.info(
                f"[EMAIL] To: {to_email} | Subject: {subject}\n"
                f"{text_body}"
            )
        else:
            logger.error(
                f"[EMAIL] SMTP not configured — could NOT deliver to {to_email} | "
                f"Subject: {subject}"
            )
        return False

    from email.utils import parseaddr

    _, sender_addr = parseaddr(settings.SMTP_FROM or "")
    envelope_from = sender_addr or (settings.SMTP_USER or "no-reply@detomsite.local")
    # Gmail App Passwords are shown with spaces ("xxxx xxxx ...") — spaces break login.
    smtp_password = (settings.SMTP_PASSWORD or "").replace(" ", "")
    timeout = getattr(settings, "SMTP_TIMEOUT_SECONDS", 15)

    message = MIMEMultipart("alternative")
    message["Subject"] = subject
    message["From"] = settings.SMTP_FROM or envelope_from
    message["To"] = to_email
    message.attach(MIMEText(text_body, "plain"))
    message.attach(MIMEText(html_body, "html"))

    server = None
    try:
        if int(settings.SMTP_PORT) == 465:
            # Implicit SSL (e.g. Gmail smtp.gmail.com:465 when STARTTLS is off).
            server = smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, timeout=timeout)
            server.ehlo()
        else:
            # Submission port 587 with STARTTLS (Gmail default).
            server = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=timeout)
            server.ehlo()
            if settings.SMTP_USE_TLS:
                server.starttls()
                server.ehlo()
        if settings.SMTP_USER:
            server.login(settings.SMTP_USER, smtp_password)
        server.sendmail(envelope_from, [to_email], message.as_string())
        logger.info(f"Email sent to {to_email} via SMTP {settings.SMTP_HOST}: {subject}")
        return True
    except Exception as e:
        logger.error(f"Error sending email to {to_email} via SMTP {settings.SMTP_HOST} ({subject}): {e}")
        return False
    finally:
        try:
            if server is not None:
                server.quit()
        except Exception:
            pass


async def _send_resend(to_email: str, subject: str, html_body: str, text_body: str) -> bool:
    """Deliver over the Resend HTTP API (https://resend.com). Chosen over SMTP
    for better deliverability; no new dependency needed — httpx is already a
    backend dependency."""
    payload = {
        "from": settings.RESEND_FROM or settings.SMTP_FROM,
        "to": [to_email],
        "subject": subject,
        "text": text_body,
        "html": html_body,
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {settings.RESEND_API_KEY}"},
                json=payload,
            )
        if response.status_code < 300:
            logger.info(f"Email sent to {to_email} via Resend: {subject}")
            return True
        logger.error(
            f"Resend rejected email to {to_email} ({subject}): {response.status_code} {response.text[:300]}"
        )
        return False
    except Exception as e:
        logger.error(f"Error sending email to {to_email} via Resend ({subject}): {e}")
        return False


async def _deliver(to_email: str, subject: str, html_body: str, text_body: str) -> bool:
    """Route an email through whichever delivery path is configured.

    SMTP is the primary path (user requirement — Gmail App Password default);
    Resend is the fallback when SMTP is absent or its server rejects the mail.
    """
    if _smtp_configured():
        delivered = await asyncio.to_thread(_send_smtp, to_email, subject, html_body, text_body)
        if delivered:
            return True
        # SMTP configured but failed — try Resend before giving up so one
        # provider outage does not break password recovery.
        if settings.RESEND_API_KEY:
            logger.warning("SMTP delivery failed — retrying via Resend")
            return await _send_resend(to_email, subject, html_body, text_body)
        return False
    if settings.RESEND_API_KEY:
        return await _send_resend(to_email, subject, html_body, text_body)
    return await asyncio.to_thread(_send_smtp, to_email, subject, html_body, text_body)


class EmailService:
    """Email service for sending emails"""

    @staticmethod
    async def send_verification_email(
        to_email: str,
        verification_link: str
    ) -> bool:
        """Send email verification link"""
        subject = "Verify your DETOMSITE email"
        text = f"Hi,\n\nPlease verify your email by opening this link:\n{verification_link}\n\nIf you didn't request this, you can ignore this email.\n\n— DETOMSITE"
        html = f"<p>Hi,</p><p>Please verify your email by opening this link:</p><p><a href=\"{verification_link}\">{verification_link}</a></p><p>If you didn't request this, you can ignore this email.</p><p>— DETOMSITE</p>"
        return await _deliver(to_email, subject, html, text)

    @staticmethod
    async def send_password_reset_email(
        to_email: str,
        reset_link: str
    ) -> bool:
        """Send password reset email"""
        subject = "Reset your DETOMSITE password"
        text = f"Hi,\n\nWe received a request to reset your password. Open this link to set a new one:\n{reset_link}\n\nThis link expires shortly. If you didn't request it, ignore this email.\n\n— DETOMSITE"
        html = f"<p>Hi,</p><p>We received a request to reset your password. Open this link to set a new one:</p><p><a href=\"{reset_link}\">{reset_link}</a></p><p>If you didn't request it, ignore this email.</p><p>— DETOMSITE</p>"
        return await _deliver(to_email, subject, html, text)

    @staticmethod
    async def send_otp_email(
        to_email: str,
        code: str,
        purpose: str = "verification"
    ) -> bool:
        """Send a 4-digit OTP by email (single-code forgot-password flow)."""
        subject = f"DETOMSITE {purpose.replace('_', ' ').title()} Code: {code}"
        text = (
            f"Hi,\n\nYour {purpose.replace('_', ' ')} code is:\n\n  {code}\n\n"
            f"Enter it to continue. It expires in {settings.RESET_OTP_EXPIRE_MINUTES} minutes.\n\n"
            f"If you didn't request this, you can safely ignore this email.\n\n— DETOMSITE"
        )
        html = (
            f"<p>Hi,</p><p>Your <b>{purpose.replace('_', ' ')}</b> code is:</p>"
            f"<p style=\"font-size:28px;font-weight:bold;letter-spacing:6px;color:#064E3B;\">{code}</p>"
            f"<p>Enter it to continue. It expires in {settings.RESET_OTP_EXPIRE_MINUTES} minutes.</p>"
            f"<p>If you didn't request this, you can safely ignore this email.</p><p>— DETOMSITE</p>"
        )
        return await _deliver(to_email, subject, html, text)

    @staticmethod
    async def send_username_reminder(
        to_email: str,
        username: str,
        role: str = "student",
    ) -> bool:
        """Email a forgotten username to the account's registered address."""
        subject = "Your DETOMSITE username"
        text = (
            f"Hi,\n\nYou asked us to remind you of your username.\n\n"
            f"  Username: {username}\n\n"
            f"Use it to sign in to your {role} account. If you didn't request "
            f"this, you can safely ignore this email.\n\n— DETOMSITE"
        )
        html = (
            f"<p>Hi,</p><p>You asked us to remind you of your username.</p>"
            f"<p style=\"font-size:22px;font-weight:bold;color:#064E3B;\">{username}</p>"
            f"<p>Use it to sign in to your <b>{role}</b> account. If you didn't "
            f"request this, you can safely ignore this email.</p><p>— DETOMSITE</p>"
        )
        return await _deliver(to_email, subject, html, text)

    @staticmethod
    async def send_order_notification(
        to_email: str,
        order_number: str,
        status: str
    ) -> bool:
        """Send order notification email"""
        subject = f"Order {order_number} is now {status}"
        text = f"Hi,\n\nYour order {order_number} is now: {status}.\n\n— DETOMSITE"
        html = f"<p>Hi,</p><p>Your order <b>{order_number}</b> is now: <b>{status}</b>.</p><p>— DETOMSITE</p>"
        return await _deliver(to_email, subject, html, text)

    @staticmethod
    async def send_payment_confirmation(
        to_email: str,
        order_number: str,
        amount: float
    ) -> bool:
        """Send payment confirmation email"""
        subject = f"Payment received for order {order_number}"
        text = f"Hi,\n\nWe received your payment of ₹{amount} for order {order_number}.\n\n— DETOMSITE"
        html = f"<p>Hi,</p><p>We received your payment of <b>₹{amount}</b> for order <b>{order_number}</b>.</p><p>— DETOMSITE</p>"
        return await _deliver(to_email, subject, html, text)
