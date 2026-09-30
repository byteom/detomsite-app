"""Regression tests for the forgot-password email-delivery lie.

The bug these pin down was found because "forget password is not working" had
no cause anyone could see:

``/users/forgot-password`` answered **200 with "A 6-digit code was sent to your
registered email"** while the deployment had **no mail provider configured at
all** — no ``RESEND_API_KEY`` and no ``SMTP_HOST``. The chain that hid it:

    _send_smtp()            -> not configured -> logs a warning -> **return True**
    send_otp_email()        -> returns that True
    _send_reset_otp()       -> discarded the return value
    forgot_password()       -> always replied "code was sent"

So the code only ever reached the server log, the user waited for an email that
could never arrive, and the API insisted it had worked. Nothing looked broken,
which is exactly why nobody could debug it.

Fixed by (a) ``_send_smtp`` returning False when it cannot deliver,
(b) ``_send_reset_otp`` returning the real delivery result, and (c)
``forgot_password`` refusing to claim success — answering 503 instead.
"""
import pytest

from app.services import email_service as email_svc


def test_send_smtp_reports_failure_when_unconfigured(monkeypatch):
    """The core lie: this used to return True with nothing sent."""
    from app.core.config import settings
    monkeypatch.setattr(settings, "SMTP_HOST", "")
    monkeypatch.setattr(settings, "DEBUG", False)

    delivered = email_svc._send_smtp(
        "student@example.com", "Reset code", "<p>123456</p>", "code 123456"
    )
    assert delivered is False, (
        "an unconfigured mail server reported success — the caller will tell the "
        "user an email was sent when it never was"
    )


def test_email_delivery_configured_is_false_without_a_provider(monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "SMTP_HOST", "")
    monkeypatch.setattr(settings, "RESEND_API_KEY", "")
    assert email_svc.email_delivery_configured() is False


def test_email_delivery_configured_is_true_with_either_provider(monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.example.com")
    monkeypatch.setattr(settings, "RESEND_API_KEY", "")
    assert email_svc.email_delivery_configured() is True

    monkeypatch.setattr(settings, "SMTP_HOST", "")
    monkeypatch.setattr(settings, "RESEND_API_KEY", "re_test")
    assert email_svc.email_delivery_configured() is True


@pytest.mark.asyncio
async def test_forgot_password_refuses_to_claim_success_without_email(client, monkeypatch):
    """No provider -> 503, NOT a reassuring 200 that lies."""
    from app.core.config import settings
    monkeypatch.setattr(settings, "SMTP_HOST", "")
    monkeypatch.setattr(settings, "RESEND_API_KEY", "")

    res = await client.post("/api/v1/users/forgot-password", json={"identifier": "someone@example.com"})
    assert res.status_code == 503, res.text
    body = res.json()["detail"].lower()
    assert "email" in body, "the message should name the real problem (no email service)"


@pytest.mark.asyncio
async def test_forgot_password_gives_the_same_answer_for_unknown_accounts(client, monkeypatch):
    """Account-enumeration protection must survive the honest 503.

    Both a real and a made-up identifier must receive the IDENTICAL response, so
    the 503 cannot be used to discover which usernames exist.
    """
    from app.core.config import settings
    monkeypatch.setattr(settings, "SMTP_HOST", "")
    monkeypatch.setattr(settings, "RESEND_API_KEY", "")

    known = await client.post("/api/v1/users/forgot-password", json={"identifier": "admin"})
    unknown = await client.post("/api/v1/users/forgot-password", json={"identifier": "no-such-user-zzz"})
    assert known.status_code == unknown.status_code == 503
    assert known.json() == unknown.json(), "responses differ — account existence is leaking"
