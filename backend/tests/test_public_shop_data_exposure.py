"""Regression tests for the public shop-data exposure fixed in this pass.

``GET /shops`` and ``GET /shops/{id}`` are intentionally PUBLIC (a student must
browse menus and the payment page needs the shop's UPI id before login). They
nonetheless used to return the raw store row, which also carried the platform's
private ledger and each vendor's business metrics and private contact details.
"""
import pytest

from app.api.v1.local import _PUBLIC_SHOP_FIELDS, _public_shop
from app.core import local_demo_db as db


@pytest.fixture
def seeded_shop():
    """One APPROVED, open shop with a UPI id — the row shape the student app sees.

    Also the row that must NOT leak: it carries the vendor's email, WhatsApp,
    revenue and the platform's dues ledger, exactly like a real store row.
    """
    shop = db.create_shop({
        "name": "Exposure Test Cafe", "category": "Food", "description": "d",
        "shopkeeper_email": "vendor-secret@example.com",
        "shopkeeper_name": "Vendor",
        "phone": "9000000099",
        "whatsapp_number": "+919000000099",
        "upi_id": "vendor@upi",
        "upi_enabled": 1,
        "cod_enabled": 1,
    })
    db.update_shop(shop["id"], {
        "approval_status": "Approved", "present": True, "status": "Open",
    })
    return db.get_shop(shop["id"])

# Must never appear in an unauthenticated shop response.
SENSITIVE = {
    "admin_dues_balance",
    "admin_dues_last_paid_at",
    "revenue_today",
    "orders_today",
    "shopkeeper_email",
    "whatsapp_number",
    "is_removed",
    "created_at",
}

# The student-facing screens and the payment QR depend on these, so redaction
# must never remove them.
REQUIRED_FOR_STUDENTS = {
    "id", "name", "category", "description", "rating",
    "opening_time", "closing_time", "present", "status",
    "approval_status", "phone", "upi_id", "upi_enabled", "cod_enabled",
    "shopkeeper_name",
}


def test_sensitive_fields_are_not_in_the_public_allowlist():
    assert not (SENSITIVE & _PUBLIC_SHOP_FIELDS), (
        "sensitive field(s) re-admitted to the public shop projection: "
        f"{SENSITIVE & _PUBLIC_SHOP_FIELDS}"
    )


def test_public_projection_drops_sensitive_and_keeps_the_rest():
    row = {field: f"v-{field}" for field in REQUIRED_FOR_STUDENTS}
    row.update({
        "admin_dues_balance": 500, "admin_dues_last_paid_at": "2026-01-01",
        "revenue_today": 12345, "orders_today": 99,
        "shopkeeper_email": "vendor@example.com",
        "whatsapp_number": "+919000000000",
        "is_removed": 0, "created_at": "2026-01-01",
    })
    out = _public_shop(row)
    assert not (SENSITIVE & set(out)), f"leaked: {SENSITIVE & set(out)}"
    assert (REQUIRED_FOR_STUDENTS & set(out)) == REQUIRED_FOR_STUDENTS


@pytest.mark.asyncio
async def test_public_shops_endpoint_redacts_for_anonymous_callers(client, seeded_shop):
    response = await client.get("/api/v1/local/shops?public_only=true")
    assert response.status_code == 200
    rows = response.json()
    assert rows, "expected the seeded approved shop to be listed"
    for row in rows:
        leaked = SENSITIVE & set(row)
        assert not leaked, f"public /shops leaked {leaked}"
        assert "upi_id" in row, "payment QR needs upi_id — redaction went too far"


@pytest.mark.asyncio
async def test_public_shop_detail_redacts_for_anonymous_callers(client, seeded_shop):
    response = await client.get(f"/api/v1/local/shops/{seeded_shop['id']}")
    assert response.status_code == 200
    row = response.json()
    assert not (SENSITIVE & set(row)), f"public /shops/{{id}} leaked {SENSITIVE & set(row)}"
    assert {"id", "name", "upi_enabled", "upi_id"} <= set(row)


@pytest.mark.asyncio
async def test_admin_still_sees_the_full_shop_row(client, seeded_shop):
    """Redaction must not blind the admin dashboard (it renders revenue/dues)."""
    login = await client.post("/api/v1/local/auth/login", json={
        "username": "admin", "password": "pytest-admin-password",
    })
    token = login.json().get("access_token")
    assert token, f"admin login failed: {login.status_code} {login.text[:200]}"
    rows = (await client.get(
        "/api/v1/local/shops", headers={"Authorization": f"Bearer {token}"}
    )).json()
    assert rows, "admin sees no shops at all"
    assert "revenue_today" in rows[0], "admin lost revenue_today after redaction"
    assert "orders_today" in rows[0], "admin lost orders_today after redaction"
    assert "admin_dues_balance" in rows[0], "admin lost the dues ledger after redaction"
