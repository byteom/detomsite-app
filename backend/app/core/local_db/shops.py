from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from app.core.local_db.connection import (
    _connect,
    _insert_with_suffixed_id,
    _rows_to_dicts,
)


def list_shops(
    public_only: bool = False,
    search: str | None = None,
    limit: int | None = None,
    offset: int | None = None,
) -> list[dict[str, Any]]:
    with _connect() as connection:
        query = "SELECT * FROM shops"
        params = []
        conditions = []
        if public_only:
            conditions.append("approval_status = 'Approved'")
        if search and search.strip():
            s = f"%{search.strip().lower()}%"
            conditions.append("(LOWER(name) LIKE ? OR LOWER(category) LIKE ? OR LOWER(description) LIKE ?)")
            params.extend([s, s, s])
        if conditions:
            query += " WHERE " + " AND ".join(conditions)
        query += " ORDER BY rating DESC"
        if limit is not None:
            query += " LIMIT ?"
            params.append(max(1, min(int(limit), 500)))
            if offset:
                query += " OFFSET ?"
                params.append(max(0, int(offset)))
        elif offset:
            query += " LIMIT -1 OFFSET ?"
            params.append(max(0, int(offset)))
        rows = connection.execute(query, params).fetchall()
        shops = _rows_to_dicts(rows)
        if public_only:
            # Students see every APPROVED shop (open or closed) so they can browse
            # menus and see opening hours. Ordering is still blocked server-side
            # for shops that are closed / not accepting orders. The SQL above
            # already filters approval_status; keep the Python guard (plus the
            # is_removed check, which has no SQL equivalent here) as a backstop.
            return [shop for shop in shops if shop.get("approval_status") == "Approved" and shop.get("is_removed", 0) != 1]
        return shops


def get_shop_by_phone(phone: str) -> dict[str, Any] | None:
    """Find a shop by its phone number (the bank-linked number whose SMS the
    agent forwards). Matches on digits only so '+919876543210' == '9876543210'."""
    digits = re.sub(r"\D", "", phone or "")
    if not digits:
        return None
    if len(digits) == 10:
        digits = "91" + digits
    with _connect() as connection:
        rows = connection.execute("SELECT * FROM shops WHERE approval_status = 'Approved'").fetchall()
        for row in rows:
            shop = dict(row)
            shop_digits = re.sub(r"\D", "", shop.get("phone") or "")
            if len(shop_digits) == 10:
                shop_digits = "91" + shop_digits
            if shop_digits == digits:
                return shop
    return None


def get_shop(shop_id: str) -> dict[str, Any] | None:
    with _connect() as connection:
        row = connection.execute("SELECT * FROM shops WHERE id = ?", (shop_id,)).fetchone()
        return dict(row) if row else None


def get_shop_by_shopkeeper_email(email: str) -> dict[str, Any] | None:
    """Get a vendor's shop by shopkeeper email (avoids scanning the whole shops
    table on every vendor request)."""
    with _connect() as connection:
        row = connection.execute(
            "SELECT * FROM shops WHERE LOWER(shopkeeper_email) = ? LIMIT 1",
            (email.lower(),),
        ).fetchone()
        return dict(row) if row else None


def create_shop(values: dict[str, Any]) -> dict[str, Any]:
    with _connect() as connection:
        next_id = connection.execute("SELECT COUNT(*) + 1 FROM shops").fetchone()[0]
        shop_id = f"s{next_id}"
        connection.execute(
            """
            INSERT INTO shops (
                id, name, category, description, rating, opening_time,
                closing_time, present, status, approval_status, shopkeeper_email,
                shopkeeper_name, phone, upi_id, orders_today, revenue_today, current_token,
                is_removed, admin_dues_balance, admin_dues_last_paid_at,
                upi_enabled, cod_enabled, whatsapp_number
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                shop_id,
                values["name"],
                values["category"],
                values.get("description", ""),
                0,
                values.get("opening_time", "09:00 AM"),
                values.get("closing_time", "09:00 PM"),
                0,
                "Closed",
                "Pending Approval",
                values.get("shopkeeper_email", ""),
                values["shopkeeper_name"],
                values["phone"],
                values.get("upi_id", ""),
                0,
                0,
                18,
                0,
                0,
                None,
                values.get("upi_enabled", 1),
                values.get("cod_enabled", 1),
                values.get("whatsapp_number", ""),
            ),
        )
        row = connection.execute("SELECT * FROM shops WHERE id = ?", (shop_id,)).fetchone()
        return dict(row)


def update_shop(shop_id: str, values: dict[str, Any]) -> dict[str, Any] | None:
    allowed_fields = {
        "name",
        "category",
        "description",
        "opening_time",
        "closing_time",
        "present",
        "status",
        "approval_status",
        "shopkeeper_email",
        "shopkeeper_name",
        "phone",
        "upi_id",
        "upi_enabled",
        "cod_enabled",
        "is_removed",
        "admin_dues_balance",
        "admin_dues_last_paid_at",
        "whatsapp_number",
    }
    updates = {key: value for key, value in values.items() if key in allowed_fields and value is not None}
    if not updates:
        return get_shop(shop_id)

    if "present" in updates:
        updates["present"] = 1 if updates["present"] else 0
        # The vendor UI has a single Start/Stop toggle. Keep the separate
        # ``status`` field in sync so students see Open/Closed consistently
        # (both fields are required by the orderability check).
        if "status" not in updates:
            updates["status"] = "Open" if updates["present"] else "Closed"

    if "approval_status" in updates and updates["approval_status"] in {"Suspended", "Removed"}:
        updates["present"] = 0
        updates["status"] = "Closed"

    assignments = ", ".join(f"{field} = ?" for field in updates)
    params = [*updates.values(), shop_id]
    with _connect() as connection:
        connection.execute(f"UPDATE shops SET {assignments} WHERE id = ?", params)
        row = connection.execute("SELECT * FROM shops WHERE id = ?", (shop_id,)).fetchone()
        return dict(row) if row else None


def suspend_shop(shop_id: str) -> dict[str, Any] | None:
    return update_shop(shop_id, {"approval_status": "Suspended", "present": False, "status": "Closed"})


def remove_shop(shop_id: str) -> dict[str, Any] | None:
    return update_shop(shop_id, {"approval_status": "Removed", "present": False, "status": "Closed", "is_removed": True})


def pay_admin_dues(shop_id: str, amount: int | None = None) -> dict[str, Any] | None:
    with _connect() as connection:
        shop = connection.execute("SELECT * FROM shops WHERE id = ?", (shop_id,)).fetchone()
        if not shop:
            return None
        current_balance = int(shop.get("admin_dues_balance", 0) or 0)
        pay_amount = amount if amount is not None else current_balance
        new_balance = max(0, current_balance - pay_amount)
        connection.execute(
            "UPDATE shops SET admin_dues_balance = ?, admin_dues_last_paid_at = ? WHERE id = ?",
            (new_balance, datetime.now().isoformat(), shop_id),
        )
        row = connection.execute("SELECT * FROM shops WHERE id = ?", (shop_id,)).fetchone()
        return dict(row) if row else None


# ─── Admin share payments (₹10 per order → admin) ───


def record_share_payment(shop_id: str, amount: int) -> dict[str, Any] | None:
    """Record a vendor's share payment to the admin.

    When the vendor taps Pay, the UPI app opens to the admin's UPI ID. We log a
    Pending record here; the admin marks it Received once the money lands.
    Returns an existing pending payment for today if one already exists."""
    with _connect() as connection:
        existing = connection.execute(
            "SELECT * FROM share_payments WHERE shop_id = ? AND status = 'Pending' AND substr(created_at, 1, 10) = date('now') ORDER BY created_at DESC LIMIT 1",
            (shop_id,),
        ).fetchone()
        if existing:
            return dict(existing)
        shop = connection.execute("SELECT * FROM shops WHERE id = ?", (shop_id,)).fetchone()
        if not shop:
            return None
        next_id = connection.execute("SELECT COUNT(*) + 1 FROM share_payments").fetchone()[0]
        payment_id = f"sp{next_id}"
        connection.execute(
            "INSERT INTO share_payments (id, shop_id, shop_name, amount, status) VALUES (?, ?, ?, ?, 'Pending')",
            (payment_id, shop_id, shop["name"], int(amount)),
        )
        connection.execute(
            "UPDATE shops SET admin_dues_last_paid_at = ? WHERE id = ?",
            (datetime.now().isoformat(), shop_id),
        )
        row = connection.execute("SELECT * FROM share_payments WHERE id = ?", (payment_id,)).fetchone()
        return dict(row) if row else None


def list_share_payments() -> list[dict[str, Any]]:
    """All vendor→admin share payments, newest first."""
    with _connect() as connection:
        rows = connection.execute("SELECT * FROM share_payments ORDER BY rowid DESC").fetchall()
        return _rows_to_dicts(rows)


def list_share_payments_by_shop(shop_id: str) -> list[dict[str, Any]]:
    """Share payments for one shop only (vendor dashboard hot path)."""
    with _connect() as connection:
        rows = connection.execute(
            "SELECT * FROM share_payments WHERE shop_id = ? ORDER BY rowid DESC",
            (shop_id,),
        ).fetchall()
        return _rows_to_dicts(rows)


def update_share_payment_status(payment_id: str, status: str) -> dict[str, Any] | None:
    """Mark a share payment Received (Completed) or Rejected. Sets paid_at on completion."""
    with _connect() as connection:
        if status == "Completed":
            connection.execute(
                "UPDATE share_payments SET status = ?, paid_at = ? WHERE id = ?",
                (status, datetime.now().isoformat(), payment_id),
            )
        else:
            connection.execute(
                "UPDATE share_payments SET status = ? WHERE id = ?",
                (status, payment_id),
            )
        row = connection.execute("SELECT * FROM share_payments WHERE id = ?", (payment_id,)).fetchone()
        return dict(row) if row else None


def list_products(
    shop_id: str | None = None,
    search: str | None = None,
    limit: int | None = None,
    offset: int | None = None,
) -> list[dict[str, Any]]:
    with _connect() as connection:
        query = "SELECT * FROM products"
        params = []
        conditions = []
        if shop_id:
            conditions.append("shop_id = ?")
            params.append(shop_id)
        if search and search.strip():
            s = f"%{search.strip().lower()}%"
            conditions.append("(LOWER(name) LIKE ? OR LOWER(description) LIKE ? OR LOWER(category) LIKE ? OR LOWER(combo_items) LIKE ?)")
            params.extend([s, s, s, s])
        if conditions:
            query += " WHERE " + " AND ".join(conditions)
        query += " ORDER BY category, name"
        if limit is not None:
            query += " LIMIT ?"
            params.append(max(1, min(int(limit), 500)))
            if offset:
                query += " OFFSET ?"
                params.append(max(0, int(offset)))
        elif offset:
            query += " LIMIT -1 OFFSET ?"
            params.append(max(0, int(offset)))
        rows = connection.execute(query, params).fetchall()
        return _rows_to_dicts(rows)


def menu_summary(keywords: list[str] | None = None) -> dict[str, Any]:
    """Per-shop menu flags for the storefront browse page (test-store mirror)."""
    kws = [k.strip().lower() for k in (keywords or []) if k and k.strip()][:5]
    kws = [k[:30] for k in kws]
    with _connect() as connection:
        if kws:
            conds = " OR ".join(["LOWER(name) LIKE ?"] * len(kws))
            params = [f"%{k}%" for k in kws]
            rows = connection.execute(
                f"""
                SELECT shop_id,
                       COUNT(*) AS dishes,
                       MAX(is_combo) AS has_combo,
                       SUM(CASE WHEN {conds} THEN 1 ELSE 0 END) AS matched
                FROM products
                GROUP BY shop_id
                """,
                params,
            ).fetchall()
        else:
            rows = connection.execute(
                """
                SELECT shop_id,
                       COUNT(*) AS dishes,
                       MAX(is_combo) AS has_combo
                FROM products
                GROUP BY shop_id
                """
            ).fetchall()
        shops = {}
        for r in rows:
            entry = {"dishes": r["dishes"], "has_combo": bool(r["has_combo"])}
            if kws:
                entry["matched"] = int(r["matched"] or 0)
            shops[r["shop_id"]] = entry
        total = connection.execute("SELECT COUNT(*) AS c FROM products").fetchone()["c"]
        return {"shops": shops, "total_dishes": total}


def create_product(values: dict[str, Any]) -> dict[str, Any]:
    with _connect() as connection:
        is_combo = bool(values.get("is_combo"))
        category = "Combo" if is_combo else values["category"]
        _insert_sql = """
            INSERT INTO products (
                id, shop_id, name, description, price, pending_price,
                category, inventory, prep_time, available, is_combo, combo_items
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        if values.get("id"):
            product_id = values["id"]
            connection.execute(
                _insert_sql,
                (
                    product_id,
                    values["shop_id"],
                    values["name"],
                    values.get("description", ""),
                    values["price"],
                    values.get("pending_price"),
                    category,
                    values.get("inventory", 0),
                    values.get("prep_time", 10),
                    1 if values.get("available", True) else 0,
                    1 if is_combo else 0,
                    str(values.get("combo_items", "") or ""),
                ),
            )
        else:
            product_id = _insert_with_suffixed_id(
                connection,
                "products",
                "p",
                _insert_sql,
                lambda rid: (
                    rid,
                    values["shop_id"],
                    values["name"],
                    values.get("description", ""),
                    values["price"],
                    values.get("pending_price"),
                    category,
                    values.get("inventory", 0),
                    values.get("prep_time", 10),
                    1 if values.get("available", True) else 0,
                    1 if is_combo else 0,
                    str(values.get("combo_items", "") or ""),
                ),
            )
        row = connection.execute("SELECT * FROM products WHERE id = ?", (product_id,)).fetchone()
        return dict(row)


def update_product(product_id: str, values: dict[str, Any]) -> dict[str, Any] | None:
    allowed_fields = {
        "name",
        "description",
        "price",
        "pending_price",
        "category",
        "inventory",
        "prep_time",
        "available",
        "is_combo",
        "combo_items",
    }
    updates = {key: value for key, value in values.items() if key in allowed_fields and (value is not None or key == "pending_price")}
    if not updates:
        return get_product(product_id)

    if "available" in updates:
        updates["available"] = 1 if updates["available"] else 0
    if "is_combo" in updates:
        updates["is_combo"] = 1 if updates["is_combo"] else 0
        if updates["is_combo"] and "category" not in updates:
            updates["category"] = "Combo"

    assignments = ", ".join(f"{field} = ?" for field in updates)
    params = [*updates.values(), product_id]
    with _connect() as connection:
        connection.execute(f"UPDATE products SET {assignments} WHERE id = ?", params)
        row = connection.execute("SELECT * FROM products WHERE id = ?", (product_id,)).fetchone()
        return dict(row) if row else None


def get_product(product_id: str) -> dict[str, Any] | None:
    with _connect() as connection:
        row = connection.execute("SELECT * FROM products WHERE id = ?", (product_id,)).fetchone()
        return dict(row) if row else None


def delete_product(product_id: str) -> bool:
    """Permanently remove a product row. Returns True when a row was deleted."""
    with _connect() as connection:
        cursor = connection.execute("DELETE FROM products WHERE id = ?", (product_id,))
        return cursor.rowcount > 0
