"""
Tests for Admin User Management:
- GET /api/v1/admin/users (with orders_count, total_spent, last_login, role, status)
- Query filtering (role, status, search)
- GET /api/v1/admin/users/{user_id} (full 360 overview: user, stats, orders, payments, addresses, activity)
- PUT /api/v1/admin/users/{user_id} (profile updates, protection of primary admin)
- POST /api/v1/admin/users/{user_id}/status (suspend/activate, protection of primary admin)
- DELETE /api/v1/admin/users/{user_id} (deletion, protection of primary admin)
"""
import pytest
from app.core.security import hash_password
from app.core.store import store as db


@pytest.fixture
async def admin_auth(client):
    """Register and log in an admin account, returning authorization headers."""
    username = "mgmtadmin"
    db.register_user(
        username=username,
        password_hash=hash_password("admin_mgmt_secret"),
        name="Management Admin",
        role="admin",
        email="mgmtadmin@detomsite.local",
        phone="9998887770",
    )
    res = await client.post(
        "/api/v1/admin/login",
        json={"username": username, "password": "admin_mgmt_secret"},
    )
    assert res.status_code == 200, res.text
    token = res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _get_uid(u):
    if isinstance(u, tuple):
        return u[0]["id"]
    if isinstance(u, dict):
        return u["id"]
    return u


@pytest.mark.asyncio
async def test_list_users_includes_rich_stats(client, admin_auth):
    # Create test student
    u = db.register_user(
        username="statuser1",
        password_hash=hash_password("pass123"),
        name="Stat Student One",
        role="student",
        email="statuser1@test.com",
        phone="9123456780",
    )
    user_id = _get_uid(u)

    res = await client.get("/api/v1/admin/users", headers=admin_auth)
    assert res.status_code == 200
    users = res.json()
    assert isinstance(users, list)
    target = next((x for x in users if x["username"] == "statuser1"), None)
    assert target is not None
    assert target["name"] == "Stat Student One"
    assert target["email"] == "statuser1@test.com"
    assert "orders_count" in target
    assert "total_spent" in target
    assert target["status"] == "active"


@pytest.mark.asyncio
async def test_users_query_filtering(client, admin_auth):
    # Create test user for this test
    db.register_user(
        username="statuser1",
        password_hash=hash_password("pass123"),
        name="Stat Student One",
        role="student",
        email="statuser1@test.com",
        phone="9123456780",
    )

    # Filter by role
    res = await client.get("/api/v1/admin/users?role=student", headers=admin_auth)
    assert res.status_code == 200
    students = res.json()
    assert all(s["role"] == "student" for s in students)

    # Filter by search
    res = await client.get("/api/v1/admin/users?search=statuser1", headers=admin_auth)
    assert res.status_code == 200
    matches = res.json()
    assert len(matches) >= 1
    assert any(m["username"] == "statuser1" for m in matches)


@pytest.mark.asyncio
async def test_get_user_360_overview(client, admin_auth):
    # Create student with order
    u = db.register_user(
        username="overview_student",
        password_hash=hash_password("pass123"),
        name="Overview Student",
        role="student",
        email="overview@test.com",
        phone="9000000001",
    )
    user_id = _get_uid(u)

    res = await client.get(f"/api/v1/admin/users/{user_id}", headers=admin_auth)
    assert res.status_code == 200
    overview = res.json()
    assert "user" in overview
    assert "stats" in overview
    assert "orders" in overview
    assert "payments" in overview
    assert "addresses" in overview
    assert "activity" in overview
    assert overview["user"]["username"] == "overview_student"
    assert overview["stats"]["total_orders"] == 0
    assert overview["stats"]["total_spent"] == 0


@pytest.mark.asyncio
async def test_update_user_and_status(client, admin_auth):
    u = db.register_user(
        username="moduser",
        password_hash=hash_password("pass123"),
        name="Mod User",
        role="student",
        email="mod@test.com",
        phone="9000000002",
    )
    user_id = _get_uid(u)

    # Update profile
    put_res = await client.put(
        f"/api/v1/admin/users/{user_id}",
        json={"name": "Mod User Updated", "phone": "9999999999"},
        headers=admin_auth,
    )
    assert put_res.status_code == 200
    assert put_res.json()["user"]["name"] == "Mod User Updated"

    # Suspend user
    status_res = await client.post(
        f"/api/v1/admin/users/{user_id}/status",
        json={"status": "suspended"},
        headers=admin_auth,
    )
    assert status_res.status_code == 200
    assert status_res.json()["status"] == "suspended"

    # Verify status changed in overview
    ov_res = await client.get(f"/api/v1/admin/users/{user_id}", headers=admin_auth)
    assert ov_res.json()["user"]["status"] == "suspended"


@pytest.mark.asyncio
async def test_primary_admin_protection(client, admin_auth):
    # Attempting to suspend or demote super-admin (ID 1) must be rejected with 400
    status_res = await client.post(
        "/api/v1/admin/users/1/status",
        json={"status": "suspended"},
        headers=admin_auth,
    )
    assert status_res.status_code == 400

    put_res = await client.put(
        "/api/v1/admin/users/1",
        json={"role": "student"},
        headers=admin_auth,
    )
    assert put_res.status_code == 400

    del_res = await client.delete("/api/v1/admin/users/1", headers=admin_auth)
    assert del_res.status_code == 400
