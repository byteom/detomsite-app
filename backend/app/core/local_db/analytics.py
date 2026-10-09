from __future__ import annotations

from typing import Any

from app.core.local_db.connection import _connect, _rows_to_dicts


def get_admin_dashboard_stats(today: str) -> dict[str, Any]:
    """Admin dashboard numbers computed in SQL instead of loading every row
    into Python. ``today`` is the Asia/Kolkata date string (YYYY-MM-DD);
    SQLite stores created_at as IST wall-clock text, so substr() matches it."""
    with _connect() as connection:
        row = connection.execute(
            """
            SELECT
              (SELECT COUNT(*) FROM shops) AS total_shops,
              (SELECT COUNT(*) FROM shops WHERE approval_status = 'Approved') AS approved_shops,
              (SELECT COUNT(*) FROM shops WHERE approval_status = 'Pending Approval') AS pending_approvals,
              (SELECT COUNT(*) FROM orders) AS total_orders,
              (SELECT COUNT(*) FROM orders WHERE status NOT IN ('Completed', 'Cancelled')) AS active_orders,
              (SELECT COALESCE(SUM(total), 0) FROM orders) AS total_revenue,
              (SELECT COUNT(*) FROM orders WHERE substr(created_at, 1, 10) = ?) AS today_orders,
              (SELECT COALESCE(SUM(total), 0) FROM orders WHERE substr(created_at, 1, 10) = ?) AS today_revenue,
              (SELECT COUNT(*) FROM products) AS total_products,
              (SELECT COUNT(*) FROM payments WHERE status = 'Pending Verification') AS pending_payments
            """,
            (today, today),
        ).fetchone()
        return dict(row) if row else {}


def get_orders_grouped_by_date() -> dict[str, Any]:
    """Get orders grouped by date for revenue tracking."""
    with _connect() as connection:
        rows = connection.execute(
            "SELECT substr(created_at, 1, 10) AS day, COUNT(*) as count, SUM(total) as revenue, "
            "SUM(subtotal) as subtotal, COUNT(*) * 10 as service_fee, "
            "SUM(tax) as tax, SUM(delivery_fee) as delivery_fee, "
            "GROUP_CONCAT(id) as ids FROM orders GROUP BY day ORDER BY day DESC"
        ).fetchall()
        return _rows_to_dicts(rows)


def get_orders_by_date(date_key: str) -> list[dict[str, Any]]:
    """Get orders for a specific date (YYYY-MM-DD) for daily log filtering."""
    with _connect() as connection:
        rows = connection.execute(
            "SELECT * FROM orders WHERE substr(created_at, 1, 10) = ? ORDER BY token DESC",
            (date_key,),
        ).fetchall()
        return _rows_to_dicts(rows)


def get_payments_by_date(date_key: str) -> list[dict[str, Any]]:
    """Get payments for a specific date (YYYY-MM-DD) for daily log filtering."""
    with _connect() as connection:
        rows = connection.execute(
            "SELECT * FROM payments WHERE substr(created_at, 1, 10) = ? ORDER BY rowid DESC",
            (date_key,),
        ).fetchall()
        return _rows_to_dicts(rows)


def get_daily_stats() -> dict[str, Any]:
    """Get today's statistics."""
    with _connect() as connection:
        today_orders = connection.execute(
            "SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as revenue, "
            "COUNT(*) * 10 as service_fee "
            "FROM orders WHERE substr(created_at, 1, 10) = date('now', '+05:30')"
        ).fetchone()
        total_users = connection.execute("SELECT COUNT(*) as count FROM users").fetchone()
        total_shops = connection.execute("SELECT COUNT(*) as count FROM shops WHERE approval_status = 'Approved'").fetchone()
        total_orders = connection.execute("SELECT COUNT(*) as count FROM orders").fetchone()
        total_service_fee = connection.execute(
            "SELECT COUNT(*) * 10 as total FROM orders"
        ).fetchone()
        return {
            "today_orders": dict(today_orders) if today_orders else {"count": 0, "revenue": 0, "service_fee": 0},
            "total_users": dict(total_users)["count"] if total_users else 0,
            "approved_shops": dict(total_shops)["count"] if total_shops else 0,
            "total_orders": dict(total_orders)["count"] if total_orders else 0,
            "total_service_fee": dict(total_service_fee)["total"] if total_service_fee else 0,
        }


def get_summary() -> dict[str, Any]:
    """Aggregate summary computed with COUNT/SUM SQL for speed."""
    with _connect() as connection:
        shop_count = connection.execute(
            "SELECT COUNT(*) FROM shops"
        ).fetchone()[0]
        orderable = connection.execute(
            "SELECT COUNT(*) FROM shops WHERE status = 'Open'"
        ).fetchone()[0]
        row = connection.execute(
            "SELECT COUNT(*) AS active, COALESCE(SUM(total), 0) AS revenue "
            "FROM orders WHERE status != 'Completed'"
        ).fetchone()
        active_orders = row["active"] if row else 0
        revenue = row["revenue"] if row else 0
        product_count = connection.execute(
            "SELECT COUNT(*) FROM products"
        ).fetchone()[0]
        return {
            "shops": shop_count,
            "orderable_shops": orderable,
            "products": product_count,
            "active_orders": active_orders,
            "revenue": revenue,
            "token_starts_at": 18,
        }


def get_vendor_daily_logs(shop_id: str) -> list[dict[str, Any]]:
    """Per-day earnings + order counts for one shop (admin vendor logs)."""
    with _connect() as connection:
        rows = connection.execute(
            """
            SELECT substr(created_at, 1, 10) AS created_at, COUNT(*) as count, SUM(total) as revenue,
                   COUNT(*) * 10 as admin_fee
            FROM orders WHERE shop_id = ?
            GROUP BY created_at ORDER BY created_at DESC
            """,
            (shop_id,),
        ).fetchall()
        return _rows_to_dicts(rows)


def get_vendor_orders(shop_id: str) -> list[dict[str, Any]]:
    """All orders for one shop (admin vendor logs)."""
    with _connect() as connection:
        rows = connection.execute(
            "SELECT * FROM orders WHERE shop_id = ? ORDER BY created_at DESC",
            (shop_id,),
        ).fetchall()
        return _rows_to_dicts(rows)
