"""
Admin order-confirmation queue: the bell's "Confirm" button.

The flow this pins down is the one an admin actually uses during a service:

  student places an order
      → an admin-targeted notification carrying ``action="confirm_order"``
        lands in the bell (and on the Approvals queue),
      → the admin presses Confirm,
      → the order is marked **Confirmed**,
      → the shopkeeper's WhatsApp confirmation is sent AUTOMATICALLY,
      → the queue row is settled so the button can never fire twice.

Plus the guard rails: a terminal order can never be re-confirmed, an
already-confirmed order is idempotent, and a dismiss only silences the bell
without touching the order.
"""
import pytest

from app.api.v1 import local
from app.core.security import hash_password
from app.core.store import store as db
from test_order_cancel import _approved_shop_with_product, _register_and_login


@pytest.fixture(autouse=True)
def _no_web_push(monkeypatch):
    """Web push needs real VAPID keys + a socket; silence it so tests are hermetic."""
    monkeypatch.setattr(local, "_push_admin", lambda *a, **k: None)


@pytest.fixture
async def admin_headers(client):
    """A real admin account + bearer header (the seeded one is env-dependent)."""
    username = "confirmadmin"
    db.register_user(
        username=username,
        password_hash=hash_password("admin_pass_123"),
        name="Confirm Admin",
        role="admin",
        email="",
        phone="",
    )
    res = await client.post(
        "/api/v1/admin/login", json={"username": username, "password": "admin_pass_123"}
    )
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def _place_order(client, username, phone="+919876543210", method="UPI"):
    """Register a student, build one approved shop, and place a real order."""
    token = await _register_and_login(
        client, username, "password123", f"Student {username}", "student", phone
    )
    shop, product = _approved_shop_with_product(f"{username}-shop@example.com", f"Shop {username}")
    db.update_shop(shop["id"], {"upi_id": f"{username}@upi", "whatsapp_number": "9600000009"})
    res = await client.post(
        "/api/v1/local/orders",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "shop_id": shop["id"],
            "items": [{"product_id": product["id"], "quantity": 1}],
            "student_name": f"Student {username}",
            "student_phone": phone,
            "delivery_location": "VIT-AP Main Gate",
            "delivery_slot": "Afternoon",
            "payment_method": method,
        },
    )
    assert res.status_code == 200, res.text
    return token, res.json(), shop


def _pending_rows(order_id):
    return [
        n
        for n in db.list_actionable_notifications("confirm_order", "pending")
        if n.get("order_id") == order_id
    ]


async def test_new_order_queues_an_admin_confirmation(client):
    """Placing an order must produce exactly one confirmable admin notification."""
    _token, order, _shop = await _place_order(client, "queue01")

    mine = _pending_rows(order["id"])
    assert len(mine) == 1, "exactly one confirmable row per new order"
    row = mine[0]
    assert row["target_role"] == "admin"
    assert "confirm" in row["title"].lower()
    assert str(order["token"]) in row["title"]
    # The message carries everything the admin needs to decide without opening
    # the order at all: who, what, which shop, how much, how to pay.
    assert "Student queue01" in row["message"]
    assert "Pizza" in row["message"]
    assert "₹100" in row["message"]


async def test_confirm_marks_the_order_and_whatsapps_the_shop(client, admin_headers):
    """One tap: order Confirmed + the shop told on WhatsApp automatically."""
    _token, order, _shop = await _place_order(client, "confirm01")
    assert order["status"] in ("Pending Payment", "Pending Acceptance")

    before = len(db.list_whatsapp_logs(100))
    res = await client.post(
        f"/api/v1/admin/orders/{order['id']}/confirm", headers=admin_headers
    )
    assert res.status_code == 200, res.text
    body = res.json()

    # 1. The order is marked Confirmed.
    assert body["order"]["status"] == "Confirmed"
    assert db.get_order(order["id"])["status"] == "Confirmed"

    # 2. The shopkeeper's WhatsApp confirmation was logged. No gateway is
    #    configured in tests, so it lands Pending for the admin to one-tap send —
    #    the message content is what matters here.
    #
    #    NOTE: for a PREPAID order this is now the ONLY message. Prepaid orders
    #    are withheld from the shop until payment is confirmed, so the "new
    #    order" message is no longer sent at creation time — otherwise the shop
    #    would start cooking an order nobody has paid for. The confirm action
    #    below is what tells the shop.
    logs = db.list_whatsapp_logs(100)
    assert len(logs) == before + 1
    mine = [log for log in logs if log["sub_order_id"] == order["id"]]
    assert len(mine) == 1, "a prepaid order must reach the shop only once, after payment"
    confirmations = [log for log in mine if "CONFIRMED" in log["message"]]
    assert len(confirmations) == 1
    assert confirmations[0]["phone"] == "9600000009"
    assert f"Ref: {order['id']}" in confirmations[0]["message"]
    assert "https://wa.me/919600000009" in confirmations[0]["url"]
    assert body["whatsapp_sent"] is False and body["whatsapp_queued"] is True

    # 3. The student is told the order is confirmed.
    assert any(
        n.get("order_id") == order["id"] for n in db.list_notifications(role="student")
    )

    # 4. The queue row is settled — the bell can no longer offer the button.
    assert _pending_rows(order["id"]) == []


async def test_confirm_queue_endpoint_lists_the_order(client, admin_headers):
    """The Approvals queue returns the order with everything the card renders."""
    _token, order, _shop = await _place_order(client, "queue02")
    res = await client.get("/api/v1/admin/order-confirmations", headers=admin_headers)
    assert res.status_code == 200, res.text
    row = [r for r in res.json() if r["order_id"] == order["id"]]
    assert len(row) == 1
    entry = row[0]
    assert entry["token"] == order["token"]
    assert entry["student_name"] == "Student queue02"
    assert entry["total"] == 100
    assert entry["payment_method"] == "UPI"
    assert entry["notification_id"]
    assert entry["action"] == "confirm_order"
    assert entry["action_state"] == "pending"


async def test_confirm_is_idempotent(client, admin_headers):
    """A double tap must not double-confirm, double-WhatsApp or 500."""
    _token, order, _shop = await _place_order(client, "confirm02")

    first = await client.post(f"/api/v1/admin/orders/{order['id']}/confirm", headers=admin_headers)
    assert first.status_code == 200, first.text
    assert first.json()["already_confirmed"] is False

    second = await client.post(f"/api/v1/admin/orders/{order['id']}/confirm", headers=admin_headers)
    assert second.status_code == 200
    assert second.json()["already_confirmed"] is True
    assert second.json()["order"]["status"] == "Confirmed"


async def test_terminal_orders_cannot_be_confirmed(client, admin_headers):
    """A late tap on an old notification must never resurrect a dead order."""
    _token, order, _shop = await _place_order(client, "confirm03")
    db.update_order_status(order["id"], "Cancelled")

    res = await client.post(f"/api/v1/admin/orders/{order['id']}/confirm", headers=admin_headers)
    assert res.status_code == 409
    assert "cancelled" in res.json()["detail"].lower()
    assert db.get_order(order["id"])["status"] == "Cancelled"


async def test_confirm_requires_the_admin_token(client):
    """The confirm endpoint is admin-only."""
    _token, order, _shop = await _place_order(client, "confirm04")
    assert (await client.post(f"/api/v1/admin/orders/{order['id']}/confirm")).status_code == 401
    assert (await client.get("/api/v1/admin/order-confirmations")).status_code == 401


async def test_multi_shop_sub_order_can_be_confirmed(client, admin_headers):
    """A combo order's per-shop sub-orders confirm through the same endpoint.

    Sub-order ids live in ``shop_sub_orders``, not ``orders``, so this exercises
    the other branch of the confirm handler: the sub-order status write, the
    student notification (which must use a null order_id — that column is an FK
    to ``orders``), and the WhatsApp confirmation to THAT sub-order's shop.
    """
    token = await _register_and_login(
        client, "combo01", "password123", "Combo Student", "student"
    )
    shop_a, prod_a = _approved_shop_with_product("comboa@example.com", "Shop A")
    shop_b, prod_b = _approved_shop_with_product("combob@example.com", "Shop B")
    db.update_shop(shop_a["id"], {"whatsapp_number": "9611111111"})
    db.update_shop(shop_b["id"], {"whatsapp_number": "9622222222"})

    res = await client.post(
        "/api/v1/local/orders/multi",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "shops": [
                {"shop_id": shop_a["id"], "items": [{"product_id": prod_a["id"], "quantity": 1}]},
                {"shop_id": shop_b["id"], "items": [{"product_id": prod_b["id"], "quantity": 1}]},
            ],
            "student_name": "Combo Student",
            "student_phone": "+919876543210",
            "delivery_location": "VIT-AP Main Gate",
            "payment_method": "COD",
        },
    )
    assert res.status_code == 200, res.text
    subs = res.json()["sub_orders"]
    assert len(subs) == 2

    # The queue carries one confirmable row per sub-order.
    pending = db.list_actionable_notifications("confirm_order", "pending")
    sub_ids = {s["id"] for s in subs}
    queued = [n for n in pending if n.get("order_id") in sub_ids]
    assert len(queued) == 2, [n["order_id"] for n in queued]

    sub = subs[0]
    resp = await client.post(f"/api/v1/admin/orders/{sub['id']}/confirm", headers=admin_headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["order"]["status"] == "Confirmed"
    assert db.get_sub_order(sub["id"])["status"] == "Confirmed"

    # The right shop got the message, the other one did not.
    mine = [log for log in db.list_whatsapp_logs(100) if log["sub_order_id"] == sub["id"]]
    confirmations = [log for log in mine if "CONFIRMED" in log["message"]]
    assert len(confirmations) == 1
    expected = "9611111111" if sub["shop_id"] == shop_a["id"] else "9622222222"
    assert confirmations[0]["phone"] == expected
    assert f"Ref: {sub['id']}" in confirmations[0]["message"]

    # The student is told, without violating the notifications.order_id FK.
    assert any(
        n.get("status") == "Confirmed" and n.get("target_role") == "student"
        for n in db.list_notifications(role="student")
    )
    # Only the confirmed sub-order left the queue; the other is still waiting.
    still_pending = [
        n for n in db.list_actionable_notifications("confirm_order", "pending")
        if n.get("order_id") in sub_ids
    ]
    assert [n["order_id"] for n in still_pending] == [
        s["id"] for s in subs if s["id"] != sub["id"]
    ]


async def test_dismiss_silences_the_bell_without_touching_the_order(client, admin_headers):
    """"Not now" hides the row; the order itself stays exactly as it was."""
    _token, order, _shop = await _place_order(client, "dismiss01")
    before_status = db.get_order(order["id"])["status"]
    row = _pending_rows(order["id"])[0]

    res = await client.post(
        f"/api/v1/admin/order-confirmations/{row['id']}/dismiss", headers=admin_headers
    )
    assert res.status_code == 200
    assert res.json()["notification"]["action_state"] == "dismissed"

    # Gone from the queue, untouched in the orders table.
    assert _pending_rows(order["id"]) == []
    assert db.get_order(order["id"])["status"] == before_status

    missing = await client.post(
        "/api/v1/admin/order-confirmations/nope/dismiss", headers=admin_headers
    )
    assert missing.status_code == 404


def test_pending_actions_sort_to_the_top_of_the_bell():
    """A busy bell must never push an un-actioned order out of view."""
    plain = db.create_notification(title="old", message="noise", target_role="admin")
    # Churn the plain row towards the far end of the list, then queue an action.
    for i in range(70):
        db.create_notification(title=f"noise {i}", message="x", target_role="admin")
    action = db.create_notification(
        title="New order #9 — confirm",
        message="confirm me",
        order_id="o9",
        target_role="admin",
        action="confirm_order",
        action_state="pending",
    )
    rows = db.list_notifications(role="admin")
    assert rows[0]["id"] == action["id"], "the actionable row must be first"
    # History is still shown — just ranked below whatever needs a tap.
    assert len(rows) > 20


def test_compose_order_confirmed_wa_names_the_shop_and_order():
    """The message the shopkeeper receives has to be self-explanatory."""
    from app.services.sms_service import compose_order_confirmed_wa

    msg = compose_order_confirmed_wa({
        "id": "o20260930-7-3", "token": 7, "shop_name": "Anna Tiffin",
        "items": "Masala Dosa", "total": 90, "payment_method": "UPI",
        "student_name": "Ravi", "delivery_location": "VIT-AP Main Gate",
    })
    assert "CONFIRMED" in msg
    assert "Anna Tiffin" in msg
    assert "Ravi" in msg
    assert "Masala Dosa" in msg
    assert "UPI ₹90" in msg
    assert "Ref: o20260930-7-3" in msg
    # The shop must never be told the money is in — only that the order is real.
    assert "paid" not in msg.lower()

    cod = compose_order_confirmed_wa({
        "id": "o1", "token": 1, "shop_name": "Shop", "items": "Dosa",
        "total": 50, "payment_method": "COD", "student_name": "S",
    })
    assert "Cash on Delivery ₹50" in cod
