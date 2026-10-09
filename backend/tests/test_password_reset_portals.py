"""Forgot-password OTP flow across all three portals (student/shopkeeper/admin).

Covers the unified flow the user asked for:
  identifier (username OR email) → emailed 4-digit OTP → OTP + new password.

Pins down:
  - OTP is 4 digits, never in the API response, delivered only by email
  - dedicated per-portal routes are role-locked (a student identifier on the
    vendor route sends nothing and reveals nothing)
  - wrong OTP rejected, correct OTP single-use, min-8 password enforced
  - new password actually logs in on the right portal
"""
import pytest

from app.core.config import settings
from app.services import email_service as email_svc


@pytest.fixture
def _mail_configured(monkeypatch):
    """Pretend an SMTP provider exists; capture emails instead of sending."""
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.test.local")
    monkeypatch.setattr(settings, "RESEND_API_KEY", "")


@pytest.fixture
def _capture_otp(monkeypatch):
    captured: dict = {}

    async def _fake_send(to_email: str, code: str, purpose: str = "verification") -> bool:
        captured["code"] = code
        captured["to"] = to_email
        captured["purpose"] = purpose
        return True

    monkeypatch.setattr(email_svc.EmailService, "send_otp_email", staticmethod(_fake_send))
    return captured


async def _register_student(client, tag: str):
    res = await client.post("/api/v1/users/register", json={
        "username": f"pwstu_{tag}", "email": f"pwstu_{tag}@campus.edu",
        "password": "oldpassword1", "name": f"Stu {tag}", "phone": "+919876543210",
    })
    assert res.status_code == 201, res.text
    return f"pwstu_{tag}", f"pwstu_{tag}@campus.edu"


async def _register_vendor(client, tag: str):
    res = await client.post("/api/v1/vendor/register", json={
        "username": f"pwven_{tag}", "email": f"pwven_{tag}@business.com",
        "password": "oldpassword1", "name": f"Ven {tag}", "phone": "+919876543211",
        "shop_name": f"Shop {tag}", "shop_category": "Cafe",
    })
    assert res.status_code == 201, res.text
    return f"pwven_{tag}", f"pwven_{tag}@business.com"


@pytest.mark.asyncio
async def test_student_4digit_flow(client, _mail_configured, _capture_otp):
    username, email = await _register_student(client, "s1")

    # Step 1 by username…
    res = await client.post("/api/v1/users/forgot-password", json={"identifier": username})
    assert res.status_code == 200, res.text
    assert res.json().get("step") == 1
    otp = _capture_otp.get("code")
    assert otp and len(otp) == 4 and otp.isdigit(), f"expected 4-digit OTP, got {otp!r}"
    assert otp not in res.text, "OTP leaked in the API response"
    assert _capture_otp["to"].lower() == email.lower()

    # …and by email resolves the same account
    _capture_otp.clear()
    res = await client.post("/api/v1/users/forgot-password", json={"identifier": email})
    assert res.status_code == 200, res.text
    otp = _capture_otp.get("code")
    assert otp and len(otp) == 4 and otp.isdigit()

    # Unknown identifier → same step shape, nothing sent (no OTP captured)
    _capture_otp.clear()
    ghost = await client.post("/api/v1/users/forgot-password", json={"identifier": "no-such-user-zzz"})
    assert ghost.status_code == 200
    assert ghost.json().get("step") == 1
    assert "code" not in _capture_otp

    # Wrong code rejected
    bad = await client.post("/api/v1/users/reset-password", json={
        "identifier": username, "otp": "0000" if otp != "0000" else "0001",
        "new_password": "newpassword1",
    })
    assert bad.status_code == 400, bad.text

    # Min-8 enforced (422 from pydantic)
    short = await client.post("/api/v1/users/reset-password", json={
        "identifier": username, "otp": otp, "new_password": "short",
    })
    assert short.status_code == 422, short.text

    # Correct code resets
    ok = await client.post("/api/v1/users/reset-password", json={
        "identifier": username, "otp": otp, "new_password": "newpassword1",
    })
    assert ok.status_code == 200, ok.text

    # Single-use
    reuse = await client.post("/api/v1/users/reset-password", json={
        "identifier": username, "otp": otp, "new_password": "anotherpw1",
    })
    assert reuse.status_code == 400, reuse.text

    # New password logs in, old does not
    assert (await client.post("/api/v1/users/login",
            json={"username": username, "password": "oldpassword1"})).status_code == 401
    assert (await client.post("/api/v1/users/login",
            json={"username": username, "password": "newpassword1"})).status_code == 200


@pytest.mark.asyncio
async def test_vendor_4digit_flow(client, _mail_configured, _capture_otp):
    username, email = await _register_vendor(client, "v1")

    res = await client.post("/api/v1/vendor/forgot-password", json={"identifier": username})
    assert res.status_code == 200, res.text
    otp = _capture_otp.get("code")
    assert otp and len(otp) == 4 and otp.isdigit(), f"expected 4-digit OTP, got {otp!r}"
    assert otp not in res.text
    assert _capture_otp["to"].lower() == email.lower()

    # A STUDENT identifier on the vendor route sends nothing (role lock, same answer)
    _capture_otp.clear()
    stu, _ = await _register_student(client, "v9")
    same = await client.post("/api/v1/vendor/forgot-password", json={"identifier": stu})
    assert same.status_code == 200
    assert same.json().get("step") == 1
    assert "code" not in _capture_otp

    ok = await client.post("/api/v1/vendor/reset-password", json={
        "identifier": username, "otp": otp, "new_password": "newpassword1",
    })
    assert ok.status_code == 200, ok.text
    assert (await client.post("/api/v1/vendor/login",
            json={"username": username, "password": "newpassword1"})).status_code == 200


@pytest.mark.asyncio
async def test_admin_4digit_flow(client, _mail_configured, _capture_otp, monkeypatch):
    # Test admin user is seeded by conftest (username "admin", placeholder DB email).
    monkeypatch.setattr(settings, "DEFAULT_SUPER_ADMIN_EMAIL", "admin@example.com")

    res = await client.post("/api/v1/admin/forgot-password", json={"identifier": "admin"})
    assert res.status_code == 200, res.text
    otp = _capture_otp.get("code")
    assert otp and len(otp) == 4 and otp.isdigit(), f"expected 4-digit OTP, got {otp!r}"
    assert otp not in res.text
    # Admin codes route to DEFAULT_SUPER_ADMIN_EMAIL, not the placeholder DB email.
    assert _capture_otp["to"].lower() == "admin@example.com"

    bad = await client.post("/api/v1/admin/reset-password", json={
        "identifier": "admin", "otp": "0000" if otp != "0000" else "0001",
        "new_password": "newadminpw1",
    })
    assert bad.status_code == 400, bad.text

    ok = await client.post("/api/v1/admin/reset-password", json={
        "identifier": "admin", "otp": otp, "new_password": "newadminpw1",
    })
    assert ok.status_code == 200, ok.text

    assert (await client.post("/api/v1/admin/login",
            json={"username": "admin", "password": "newadminpw1"})).status_code == 200
