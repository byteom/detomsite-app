import pytest
import json
from unittest.mock import MagicMock
from fastapi import Request
from app.core.store import store as db
from app.middleware.error_handler import ErrorHandlingMiddleware


@pytest.mark.asyncio
async def test_user_orders_isolation_and_perf(client):
    # Register two distinct users
    u1_payload = {
        "username": "student_alpha",
        "password": "Password123!",
        "name": "Alpha Student",
        "email": "alpha@college.edu",
        "phone": "+919876543210",
        "role": "student",
    }
    u2_payload = {
        "username": "student_beta",
        "password": "Password123!",
        "name": "Beta Student",
        "email": "beta@college.edu",
        "phone": "+919876543211",
        "role": "student",
    }
    r1 = await client.post("/api/v1/users/register", json=u1_payload)
    assert r1.status_code in (201, 200), r1.text

    l1 = await client.post("/api/v1/users/login", json={"username": "student_alpha", "password": "Password123!"})
    assert l1.status_code == 200, l1.text
    token1 = l1.json()["access_token"]
    user1_id = str(l1.json()["user"]["id"])

    r2 = await client.post("/api/v1/users/register", json=u2_payload)
    assert r2.status_code in (201, 200), r2.text

    l2 = await client.post("/api/v1/users/login", json={"username": "student_beta", "password": "Password123!"})
    assert l2.status_code == 200, l2.text
    token2 = l2.json()["access_token"]
    user2_id = str(l2.json()["user"]["id"])

    # Create a shop to receive orders
    shop = db.create_shop({
        "name": "Perf Test Cafe",
        "category": "Food",
        "shopkeeper_name": "Cafe Owner",
        "shopkeeper_email": "owner@college.edu",
        "phone": "+919876543212",
        "status": "Open",
        "approval_status": "Approved",
        "present": 1,
    })
    shop_id = shop["id"]
    db.update_shop(shop_id, {"status": "Open", "approval_status": "Approved", "present": 1})

    p1 = db.create_product({
        "shop_id": shop_id,
        "name": "Samosa",
        "price": 20,
        "category": "Snacks",
        "available": True,
    })
    p2 = db.create_product({
        "shop_id": shop_id,
        "name": "Tea",
        "price": 10,
        "category": "Beverages",
        "available": True,
    })

    # Create order for user 1
    o1 = db.create_order({
        "shop_id": shop_id,
        "owner_user_id": user1_id,
        "student_name": "Alpha Student",
        "student_phone": "+919876543210",
        "items": [{"product_id": p1["id"], "name": "Samosa", "price": 20, "quantity": 2}],
        "delivery_location": "Hostel A",
        "delivery_slot": "1:00 PM",
        "status": "Placed",
    })
    assert o1 is not None

    # Create order for user 2
    o2 = db.create_order({
        "shop_id": shop_id,
        "owner_user_id": user2_id,
        "student_name": "Beta Student",
        "student_phone": "+919876543211",
        "items": [{"product_id": p2["id"], "name": "Tea", "price": 10, "quantity": 1}],
        "delivery_location": "Hostel B",
        "delivery_slot": "1:15 PM",
        "status": "Placed",
    })
    assert o2 is not None

    # Check user 1's orders via direct db call
    u1_orders = db.list_orders_by_user_id(user1_id, student_name="Alpha Student")
    assert len(u1_orders) >= 1
    assert any(o["id"] == o1["id"] for o in u1_orders)
    assert not any(o["id"] == o2["id"] for o in u1_orders)

    # Check user 2's orders via direct db call
    u2_orders = db.list_orders_by_user_id(user2_id, student_name="Beta Student")
    assert len(u2_orders) >= 1
    assert any(o["id"] == o2["id"] for o in u2_orders)
    assert not any(o["id"] == o1["id"] for o in u2_orders)

    # Check user 1's dashboard endpoint
    dash1 = await client.get("/api/v1/users/dashboard", headers={"Authorization": f"Bearer {token1}"})
    assert dash1.status_code == 200
    dash1_data = dash1.json()
    assert dash1_data["stats"]["total_orders"] == len(u1_orders)
    dash1_order_ids = [o["id"] for o in dash1_data["orders"]]
    assert o1["id"] in dash1_order_ids
    assert o2["id"] not in dash1_order_ids

    # Check user 2's orders endpoint
    orders2_resp = await client.get("/api/v1/users/orders", headers={"Authorization": f"Bearer {token2}"})
    assert orders2_resp.status_code == 200
    orders2_data = orders2_resp.json()
    orders2_ids = [o["id"] for o in orders2_data]
    assert o1["id"] not in orders2_ids
    assert o2["id"] in orders2_ids


@pytest.mark.asyncio
async def test_error_handling_middleware_no_unbound_error():
    async def dummy_call_next(req):
        raise RuntimeError("Simulated server failure")

    middleware = ErrorHandlingMiddleware(app=None)
    req = MagicMock(spec=Request)
    req.state = MagicMock()
    req.url = MagicMock()
    req.url.path = "/api/v1/test"

    response = await middleware.dispatch(req, dummy_call_next)
    assert response.status_code == 500
    data = json.loads(response.body.decode("utf-8"))
    assert "detail" in data
    assert data["detail"] != ""
    assert "request_id" in data


@pytest.mark.asyncio
async def test_student_profile_update_persists_only_supported_fields(client):
    payload = {
        "username": "profile_student",
        "password": "Password123!",
        "name": "Before Name",
        "email": "profile@college.edu",
        "phone": "+919876543299",
    }
    assert (await client.post("/api/v1/users/register", json=payload)).status_code == 201
    login = await client.post(
        "/api/v1/users/login",
        json={"username": payload["username"], "password": payload["password"]},
    )
    assert login.status_code == 200, login.text
    token = login.json()["access_token"]

    response = await client.put(
        "/api/v1/users/profile",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "After Name", "phone": "+919876543298", "role": "admin"},
    )
    assert response.status_code == 200, response.text
    updated = response.json()["user"]
    assert updated["name"] == "After Name"
    assert updated["phone"] == "+919876543298"
    assert updated["role"] == "student"
