from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta
from typing import Any

from app.core.local_db.connection import (
    _connect,
    _rows_to_dicts,
    _shop_is_orderable,
    consume_batch_stock,
    consume_token,
    get_current_batch,
)


def create_parent_order(
    student_name: str,
    student_phone: str,
    delivery_location: str,
    payment_method: str,
    shops: list[dict[str, Any]],
    student_email: str = "",
    student_id: str = "",
    owner_user_id: str = "",
) -> dict[str, Any] | None:
    """Create a multi-shop parent order with per-shop sub-orders.

    ``shops`` is a list like::

        [{"shop_id": "...", "items": [{"product_id": "...", "quantity": 2}]}, ...]

    Returns the parent order dict (with nested ``sub_orders``) or ``None`` when
    any shop/item is invalid. One token is shared across ALL sub-orders.
    The student pays ONE bill (sum of every sub-order subtotal); each shop's
    ₹10-per-order commission is recorded per sub-order but never charged to the student.
    """
    with _connect() as connection:
        token = consume_token(connection=connection)
        today_key = connection.execute(
            "SELECT strftime('%Y%m%d', 'now', '+05:30')"
        ).fetchone()[0]
        parent_id = f"p{today_key}-{token}"
        batch_type = get_current_batch()

        sub_orders: list[dict[str, Any]] = []
        grand_total = 0

        for group in shops:
            shop_row = connection.execute(
                "SELECT * FROM shops WHERE id = ?", (group["shop_id"],)
            ).fetchone()
            if not shop_row:
                continue
            shop = dict(shop_row)
            if not _shop_is_orderable(shop):
                continue

            products_by_id = {}
            product_ids = [item["product_id"] for item in group.get("items", [])]
            for product_id in product_ids:
                row = connection.execute(
                    "SELECT * FROM products WHERE id = ? AND shop_id = ?",
                    (product_id, group["shop_id"]),
                ).fetchone()
                if row and dict(row).get("available", 1):
                    products_by_id[product_id] = dict(row)

            subtotal = 0
            order_item_rows: list[tuple] = []
            for item in group.get("items", []):
                product = products_by_id.get(item["product_id"])
                if not product:
                    continue
                quantity = int(item.get("quantity", 1) or 1)
                if quantity <= 0:
                    continue
                if not consume_batch_stock(
                    product["id"], batch_type, quantity, connection=connection
                ):
                    raise ValueError(
                        f"Insufficient stock for {product['name']}"
                    )
                subtotal += int(product["price"]) * quantity
                order_item_rows.append(
                    (
                        product["id"],
                        product["name"],
                        int(product["price"]),
                        quantity,
                        int(product["price"]) * quantity,
                    )
                )

            if not order_item_rows:
                continue

            commission = 10  # flat ₹10 per order (admin's cut)
            sub_order_id = f"{parent_id}-{len(sub_orders) + 1}"
            shop_whatsapp = str(shop.get("whatsapp_number") or "").strip()
            shop_phone = str(shop.get("phone") or "").strip()

            connection.execute(
                """
                INSERT INTO shop_sub_orders (
                    id, parent_order_id, shop_id, shop_name, shop_phone,
                    shop_whatsapp, token, subtotal, commission_5pct, status,
                    batch_type, created_at
                )
                VALUES (
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?,
                    strftime('%Y-%m-%d %H:%M:%S', 'now', '+05:30')
                )
                """,
                (
                    sub_order_id,
                    parent_id,
                    shop["id"],
                    shop["name"],
                    shop_phone,
                    shop_whatsapp,
                    token,
                    subtotal,
                    commission,
                    batch_type,
                ),
            )
            for product_id, name, price, qty, line_total in order_item_rows:
                connection.execute(
                    """
                    INSERT INTO order_items (sub_order_id, product_id, product_name, price, quantity, total)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (sub_order_id, product_id, name, price, qty, line_total),
                )

            item_labels = [f"{q}x {n}" for _, n, _, q, _ in order_item_rows]
            grand_total += subtotal

            sub_orders.append(
                {
                    "id": sub_order_id,
                    "shop_id": shop["id"],
                    "shop_name": shop["name"],
                    "shop_phone": shop_phone,
                    "shop_whatsapp": shop_whatsapp,
                    "token": token,
                    "items_summary": ", ".join(item_labels),
                    "subtotal": subtotal,
                    "commission_5pct": commission,
                    "status": "Pending",
                    "batch_type": batch_type,
                }
            )

            connection.execute(
                """
                UPDATE shops
                SET orders_today = orders_today + 1,
                    revenue_today = revenue_today + ?,
                    current_token = ?
                WHERE id = ?
                """,
                (subtotal, token, shop["id"]),
            )

        if not sub_orders:
            raise ValueError("No valid shops or items in order")

        parent_sql = """
            INSERT INTO parent_orders (
                id, token, student_name, student_phone, student_email,
                student_id, owner_user_id, total, payment_method, payment_status,
                delivery_location, status, created_at
            )
            VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, 'Pending',
                strftime('%Y-%m-%d %H:%M:%S', 'now', '+05:30')
            )
            """
        for _attempt in range(5):
            try:
                connection.execute(
                    parent_sql,
                    (
                        parent_id,
                        token,
                        student_name,
                        student_phone,
                        student_email,
                        student_id,
                        owner_user_id,
                        grand_total,
                        payment_method,
                        delivery_location,
                    ),
                )
                break
            except sqlite3.IntegrityError as exc:
                message = str(exc).lower()
                if "unique" not in message and "primary key" not in message:
                    raise
                if _attempt == 4:
                    raise
                token = consume_token(connection=connection)
                parent_id = f"p{today_key}-{token}"

        row = connection.execute(
            "SELECT * FROM parent_orders WHERE id = ?", (parent_id,)
        ).fetchone()
        parent = dict(row)
        parent["sub_orders"] = sub_orders
        return parent


def get_parent_order(parent_order_id: str, with_items: bool = True) -> dict[str, Any] | None:
    """Get a parent order including its shop sub-orders (and their items).

    Batched — one items query for all sub-orders instead of one per sub."""
    with _connect() as connection:
        row = connection.execute(
            "SELECT * FROM parent_orders WHERE id = ?", (parent_order_id,)
        ).fetchone()
        if not row:
            return None
        parent = dict(row)
        sub_rows = connection.execute(
            "SELECT * FROM shop_sub_orders WHERE parent_order_id = ? ORDER BY rowid",
            (parent_order_id,),
        ).fetchall()
        sub_orders = []
        if sub_rows:
            if with_items:
                placeholders = ",".join("?" * len(sub_rows))
                item_rows = connection.execute(
                    f"SELECT sub_order_id, product_name, quantity FROM order_items WHERE sub_order_id IN ({placeholders}) ORDER BY rowid",
                    [s["id"] for s in sub_rows],
                ).fetchall()
                items: dict[str, list[dict[str, Any]]] = {}
                for item in item_rows:
                    items.setdefault(item["sub_order_id"], []).append(dict(item))
            for sub_row in sub_rows:
                sub = dict(sub_row)
                if with_items:
                    sub["items"] = items.get(sub["id"], [])
                sub_orders.append(sub)
        parent["sub_orders"] = sub_orders
        return parent


def list_parent_orders(
    limit: int = 200,
    status: str | None = None,
    owner_user_id: str | None = None,
) -> list[dict[str, Any]]:
    """List parent orders, newest first, optional status / owner filter."""
    owner = str(owner_user_id or "").strip()
    with _connect() as connection:
        sql = "SELECT * FROM parent_orders"
        args: list[Any] = []
        clauses: list[str] = []
        if status:
            clauses.append("status = ?")
            args.append(status)
        if owner:
            clauses.append("owner_user_id = ?")
            args.append(owner)
        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        sql += " ORDER BY rowid DESC LIMIT ?"
        args.append(limit)
        rows = connection.execute(sql, args).fetchall()
        return _rows_to_dicts(rows)


def get_shop_sub_orders(shop_id: str, status: str | None = None) -> list[dict[str, Any]]:
    """All sub-orders for a shop. Only the shop's own orders.

    Batched — items + parent rows pulled in two queries total (1 + 2N → 3)."""
    with _connect() as connection:
        sql = "SELECT * FROM shop_sub_orders WHERE shop_id = ?"
        args: list[Any] = [shop_id]
        if status:
            sql += " AND status = ?"
            args.append(status)
        sql += " ORDER BY rowid DESC"
        rows = connection.execute(sql, args).fetchall()
        sub_orders = [dict(row) for row in rows]
        if not sub_orders:
            return sub_orders
        sub_ids = [s["id"] for s in sub_orders]
        parent_ids = list({s["parent_order_id"] for s in sub_orders if s.get("parent_order_id")})
        placeholders = ",".join("?" * len(sub_ids))
        item_rows = connection.execute(
            f"SELECT sub_order_id, product_name, quantity FROM order_items WHERE sub_order_id IN ({placeholders}) ORDER BY rowid",
            sub_ids,
        ).fetchall()
        items: dict[str, list[dict[str, Any]]] = {}
        for item in item_rows:
            items.setdefault(item["sub_order_id"], []).append(dict(item))
        parents: dict[str, dict[str, Any]] = {}
        if parent_ids:
            parent_placeholders = ",".join("?" * len(parent_ids))
            parent_rows = connection.execute(
                f"SELECT id, student_name, student_phone, delivery_location, total, payment_method, created_at FROM parent_orders WHERE id IN ({parent_placeholders})",
                parent_ids,
            ).fetchall()
            parents = {pr["id"]: dict(pr) for pr in parent_rows}
        for s in sub_orders:
            s["items"] = items.get(s["id"], [])
            s["parent"] = parents.get(s.get("parent_order_id", "")) or {}
        return sub_orders


def get_sub_order(sub_order_id: str) -> dict[str, Any] | None:
    """Find one shop sub-order with its parent + shop context attached.

    Used to enrich WhatsApp logs whose ``sub_order_id`` is a multi-shop
    sub-order id (those don't live in the plain ``orders`` table). Returns the
    sub-order dict plus ``parent`` (student/phone/location/total/payment) and
    ``shop`` context, or ``None`` when it's not a sub-order id at all.
    """
    with _connect() as connection:
        row = connection.execute(
            "SELECT * FROM shop_sub_orders WHERE id = ?", (sub_order_id,)
        ).fetchone()
        if not row:
            return None
        sub = dict(row)
        parent = connection.execute(
            "SELECT student_name, student_phone, delivery_location, total, payment_method, created_at FROM parent_orders WHERE id = ?",
            (sub["parent_order_id"],),
        ).fetchone()
        sub["parent"] = dict(parent) if parent else {}
        shop = connection.execute(
            "SELECT id, name, phone, whatsapp_number FROM shops WHERE id = ?",
            (sub["shop_id"],),
        ).fetchone()
        sub["shop"] = dict(shop) if shop else {}
        return sub


def update_parent_order_status(parent_order_id: str, status: str) -> dict[str, Any] | None:
    """Update a parent (multi-shop) order's own status.

    Kept for interface parity with ``supabase_db.update_parent_order_status``:
    the vendor status sync and the Razorpay verification path both call this for
    multi-shop orders, so without it those flows would raise AttributeError when
    the test/demo store is active.
    """
    with _connect() as connection:
        row = connection.execute(
            "SELECT * FROM parent_orders WHERE id = ?", (parent_order_id,)
        ).fetchone()
        if not row:
            return None
        connection.execute(
            "UPDATE parent_orders SET status = ? WHERE id = ?",
            (status, parent_order_id),
        )
        updated = connection.execute(
            "SELECT * FROM parent_orders WHERE id = ?", (parent_order_id,)
        ).fetchone()
        return dict(updated) if updated else None


def list_all_sub_orders() -> list[dict[str, Any]]:
    """Every sub-order across every parent order, newest parent first.

    Added for parity with ``supabase_db``: the admin orders view does
    ``getattr(db, "list_all_sub_orders", None)`` and skips the section when it
    is missing. Because the whole suite runs against this store, the ``None``
    branch was the only one ever exercised — the admin sub-order view was
    untested, and a typo in the Supabase implementation would have shipped
    without a single test touching it.
    """
    with _connect() as connection:
        rows = connection.execute(
            """
            SELECT s.* FROM shop_sub_orders s
            JOIN parent_orders p ON p.id = s.parent_order_id
            ORDER BY p.created_at DESC, s.rowid
            """
        ).fetchall()
        return [dict(r) for r in rows]


def cancel_parent_order(parent_order_id: str) -> dict[str, Any] | None:
    """Cancel a parent order and every sub-order that is still open.

    Mirrors ``supabase_db.cancel_parent_order`` exactly, including the
    terminal-status exclusions: a sub-order that already reached Completed or
    Delivered is left alone, because the goods changed hands and the money
    moved. Without this function the store proxy raised ``AttributeError``,
    so ``POST /orders/{id}/cancel`` on a multi-shop (combo) order could not be
    tested at all — the one cancel path a student is most likely to need.
    """
    with _connect() as connection:
        parent = connection.execute(
            "SELECT * FROM parent_orders WHERE id = ?", (parent_order_id,)
        ).fetchone()
        if not parent:
            return None
        connection.execute(
            """
            UPDATE shop_sub_orders SET status = 'Cancelled'
             WHERE parent_order_id = ?
               AND status NOT IN ('Completed', 'Delivered', 'Cancelled')
            """,
            (parent_order_id,),
        )
        connection.execute(
            "UPDATE parent_orders SET status = 'Cancelled' WHERE id = ?",
            (parent_order_id,),
        )
        updated = connection.execute(
            "SELECT * FROM parent_orders WHERE id = ?", (parent_order_id,)
        ).fetchone()
        return dict(updated) if updated else None


def update_sub_order_status(
    sub_order_id: str, status: str, notes: str = ""
) -> dict[str, Any] | None:
    """Update a shop sub-order's status and record the transition timestamp."""
    with _connect() as connection:
        row = connection.execute(
            "SELECT * FROM shop_sub_orders WHERE id = ?", (sub_order_id,)
        ).fetchone()
        if not row:
            return None
        sub = dict(row)
        timestamps = {
            "Accepted": "accepted_at",
            "Preparing": "prepared_at",
            "Ready": "ready_at",
            "Delivered": "delivered_at",
            "Completed": "completed_at",
        }
        ts_col = timestamps.get(status)
        now = "datetime('now', '+05:30')"
        if ts_col:
            connection.execute(
                f"UPDATE shop_sub_orders SET status = ?, {ts_col} = {now} WHERE id = ?",
                (status, sub_order_id),
            )
        else:
            connection.execute(
                "UPDATE shop_sub_orders SET status = ?, rejection_reason = COALESCE(?, rejection_reason) WHERE id = ?",
                (status, notes, sub_order_id),
            )
        updated = connection.execute(
            "SELECT * FROM shop_sub_orders WHERE id = ?", (sub_order_id,)
        ).fetchone()
        if status in ("Delivered", "Completed"):
            sub_rows = connection.execute(
                "SELECT status FROM shop_sub_orders WHERE parent_order_id = ?",
                (sub["parent_order_id"],),
            ).fetchall()
            if all(s["status"] in ("Delivered", "Completed") for s in sub_rows):
                connection.execute(
                    "UPDATE parent_orders SET status = 'Completed' WHERE id = ?",
                    (sub["parent_order_id"],),
                )
        return dict(updated) if updated else None


def auto_complete_expired_deliveries() -> int:
    """Auto-complete sub-orders that were delivered more than 30 minutes ago.

    Per spec section 36: after the 30-minute problem window, the order is
    auto-confirmed and the parent order completes once every sub-order is
    terminal. Safe to call on every request (it's fast and idempotent) so it
    also works on serverless/backgroundless hosts. Returns how many
    sub-orders were completed just now.
    """
    completed_now = 0
    with _connect() as connection:
        rows = connection.execute(
            """
            SELECT id, parent_order_id, delivered_at
            FROM shop_sub_orders
            WHERE status = 'Delivered' AND delivered_at IS NOT NULL
            """
        ).fetchall()
        now_ist = datetime.utcnow() + timedelta(hours=5, minutes=30)
        for row in rows:
            try:
                dt_str = str(row["delivered_at"] or "")
                dt_str_clean = dt_str.replace("+05:30", "").replace("+00:00", "")
                delivered = datetime.strptime(dt_str_clean[:19], "%Y-%m-%d %H:%M:%S")
                if (now_ist - delivered) >= timedelta(minutes=30):
                    connection.execute(
                        "UPDATE shop_sub_orders SET status = 'Completed', completed_at = datetime('now', '+05:30') WHERE id = ?",
                        (row["id"],),
                    )
                    completed_now += 1
                    sub_rows = connection.execute(
                        "SELECT status FROM shop_sub_orders WHERE parent_order_id = ?",
                        (row["parent_order_id"],),
                    ).fetchall()
                    if all(s["status"] in ("Delivered", "Completed") for s in sub_rows):
                        connection.execute(
                            "UPDATE parent_orders SET status = 'Completed' WHERE id = ?",
                            (row["parent_order_id"],),
                        )
            except Exception:
                continue
    return completed_now
