from __future__ import annotations

from typing import Any

from app.core.local_db.connection import (
    _connect,
    _day_key,
    _rows_to_dicts,
    _shop_is_orderable,
)
from app.core.local_db.notifications import create_notification


def list_orders(limit: int | None = None) -> list[dict[str, Any]]:
    """All orders, newest first. ``limit`` bounds the payload so hot endpoints
    never ship the entire order history on every poll."""
    with _connect() as connection:
        sql = "SELECT * FROM orders ORDER BY created_at DESC, token DESC"
        params: tuple = ()
        if limit:
            sql += " LIMIT ?"
            params = (limit,)
        rows = connection.execute(sql, params).fetchall()
        return _rows_to_dicts(rows)


def list_orders_by_shop(shop_id: str) -> list[dict[str, Any]]:
    """Orders for one shop only (vendor dashboard/history hot path)."""
    with _connect() as connection:
        rows = connection.execute(
            "SELECT * FROM orders WHERE shop_id = ? ORDER BY token DESC",
            (shop_id,),
        ).fetchall()
        return _rows_to_dicts(rows)


def list_orders_by_user_id(
    user_id: str,
    student_name: str | None = None,
    limit: int | None = None,
) -> list[dict[str, Any]]:
    """Orders belonging to a specific student, newest first."""
    uid = str(user_id or "").strip()
    s_name = str(student_name or "").strip()
    if not uid and not s_name:
        return []

    with _connect() as connection:
        if uid and s_name:
            sql = (
                "SELECT * FROM orders WHERE owner_user_id = ? "
                "OR (owner_user_id = '' AND LOWER(student_name) = LOWER(?)) "
                "ORDER BY created_at DESC, token DESC"
            )
            params = [uid, s_name]
        elif uid:
            sql = (
                "SELECT * FROM orders WHERE owner_user_id = ? "
                "ORDER BY created_at DESC, token DESC"
            )
            params = [uid]
        else:
            sql = (
                "SELECT * FROM orders WHERE LOWER(student_name) = LOWER(?) "
                "ORDER BY created_at DESC, token DESC"
            )
            params = [s_name]

        if limit:
            sql += " LIMIT ?"
            params.append(limit)

        rows = connection.execute(sql, params).fetchall()
        return _rows_to_dicts(rows)


def find_order_by_client_ref(client_ref: str, owner_user_id: str = "") -> dict[str, Any] | None:
    """Find a student's own order by the checkout idempotency key.

    Scoped to the OWNING ACCOUNT, never to the ref alone: the ref is chosen by
    the client, so two students could (and a hostile one would deliberately)
    send the same value. Without the owner scope, student B could claim student
    A's order id by guessing their ref and then read or pay against it.
    """
    ref = (client_ref or "").strip()
    if not ref:
        return None
    with _connect() as connection:
        if owner_user_id:
            row = connection.execute(
                "SELECT * FROM orders WHERE client_ref = ? AND owner_user_id = ?"
                " ORDER BY created_at DESC LIMIT 1",
                (ref, str(owner_user_id)),
            ).fetchone()
        else:
            row = connection.execute(
                "SELECT * FROM orders WHERE client_ref = ? ORDER BY created_at DESC LIMIT 1",
                (ref,),
            ).fetchone()
        return dict(row) if row else None


def list_recent_orders_by_shop(shop_id: str, limit: int = 250) -> list[dict[str, Any]]:
    """Latest orders for one shop (newest first) — the live feed in the vendor
    app. Bounded so the 30s auto-refresh never ships the shop's entire history."""
    with _connect() as connection:
        rows = connection.execute(
            "SELECT * FROM orders WHERE shop_id = ? ORDER BY created_at DESC LIMIT ?",
            (shop_id, limit),
        ).fetchall()
        return _rows_to_dicts(rows)


def get_order(order_id: str) -> dict[str, Any] | None:
    with _connect() as connection:
        row = connection.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
        return dict(row) if row else None


def find_order_by_token(token: str) -> dict[str, Any] | None:
    """Find the most recent order for a token number (tokens restart daily)."""
    with _connect() as connection:
        rows = connection.execute(
            "SELECT * FROM orders WHERE token = ? ORDER BY created_at DESC LIMIT 1",
            (token,),
        ).fetchall()
        return dict(rows[0]) if rows else None


def update_order_status(order_id: str, status: str) -> dict[str, Any] | None:
    with _connect() as connection:
        connection.execute("UPDATE orders SET status = ? WHERE id = ?", (status, order_id))
        row = connection.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
        if row:
            status_messages = {
                "Accepted": "The shop accepted your order.",
                "Confirmed": "Your order has been confirmed.",
                "Preparing": "Your food is being prepared.",
                "Ready": "Your order is ready.",
                "Completed": "Order completed successfully.",
                "Cancelled": "Order cancelled.",
                "Failed": "Payment failed.",
                "Refunded": "Order refunded.",
            }
            create_notification(
                title="Order completed" if status == "Completed" else "Order status updated",
                message=f"Token {row['token']}: {status_messages.get(status, f'Order is now {status}.')}",
                order_id=order_id,
                status=status,
                target_role="student",
                connection=connection,
            )
        return dict(row) if row else None


def create_order(values: dict[str, Any]) -> dict[str, Any] | None:
    with _connect() as connection:
        shop = connection.execute("SELECT * FROM shops WHERE id = ?", (values["shop_id"],)).fetchone()
        if not shop:
            return None
        if not _shop_is_orderable(dict(shop)):
            return None

        product_ids = [item["product_id"] for item in values["items"]]
        products_by_id = {}
        for product_id in product_ids:
            row = connection.execute(
                "SELECT * FROM products WHERE id = ? AND shop_id = ?",
                (product_id, values["shop_id"]),
            ).fetchone()
            if row and dict(row).get("available", 1):
                products_by_id[product_id] = dict(row)

        subtotal = 0
        item_labels = []
        for item in values["items"]:
            product = products_by_id.get(item["product_id"])
            if not product:
                continue
            quantity = int(item.get("quantity", 1) or 1)
            subtotal += int(product["price"]) * quantity
            item_labels.append(f"{quantity}x {product['name']}")

        if not item_labels:
            return None

        service_fee = 0
        tax = 0
        delivery_fee = 0
        total = subtotal

        payment_method = str(values.get("payment_method", "") or "").strip().upper()
        if payment_method == "COD":
            initial_status = "Pending Acceptance"
        elif payment_method == "UPI":
            initial_status = "Pending Payment"
        elif payment_method == "RAZORPAY":
            initial_status = "Pending Payment"
        else:
            initial_status = "Pending Payment" if values.get("pending_payment") else "Pending Acceptance"
            payment_method = "UPI" if initial_status == "Pending Payment" else "COD"

        next_token = connection.execute(
            "SELECT COALESCE(MAX(token), 17) + 1 FROM orders WHERE substr(created_at, 1, 10) = date('now', '+05:30')"
        ).fetchone()[0]
        today_key = connection.execute("SELECT strftime('%Y%m%d', 'now', '+05:30')").fetchone()[0]
        order_id = f"o{today_key}-{next_token}"

        connection.execute(
            """
            INSERT INTO orders (
                id, token, owner_user_id, student_name, student_phone, shop_id, shop_name,
                items, subtotal, service_fee, tax, delivery_fee, total,
                delivery_location, delivery_slot, status, payment_method, client_ref,
                created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    strftime('%Y-%m-%d %H:%M:%S', 'now', '+05:30'))
            """,
            (
                order_id,
                next_token,
                values.get("owner_user_id", ""),
                values.get("student_name", "Student"),
                values.get("student_phone", ""),
                values["shop_id"],
                shop["name"],
                ", ".join(item_labels),
                subtotal,
                service_fee,
                tax,
                delivery_fee,
                total,
                values["delivery_location"],
                values["delivery_slot"],
                initial_status,
                payment_method,
                values.get("client_ref") or None,
            ),
        )
        row = connection.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
        if row:
            connection.execute(
                """
                UPDATE shops
                SET orders_today = orders_today + 1,
                    revenue_today = revenue_today + ?,
                    current_token = ?
                WHERE id = ?
                """,
                (total, next_token, values["shop_id"]),
            )
            create_notification(
                title="Order placed",
                message=f"Token {row['token']} is pending shop acceptance.",
                order_id=order_id,
                status=row["status"],
                target_role="student",
                connection=connection,
            )
            row = connection.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
        return dict(row) if row else None


def get_daily_token_count(date_key: str | None = None) -> int:
    """Number of parent orders today (for the dashboard's token display)."""
    date_key = date_key or _day_key()
    with _connect() as connection:
        row = connection.execute(
            "SELECT COUNT(*) AS c FROM parent_orders WHERE substr(created_at, 1, 10) = ?",
            (date_key,),
        ).fetchone()
        return int(row["c"])
