from __future__ import annotations

from typing import Any

from app.core.local_db.connection import (
    _connect,
    _insert_with_suffixed_id,
    _rows_to_dicts,
)

# Kept in sync with supabase_db.NOTIFICATION_LIST_LIMIT.
NOTIFICATION_LIST_LIMIT = 60


def create_notification(
    title: str,
    message: str,
    order_id: str | None = None,
    status: str | None = None,
    target_role: str | None = None,
    action: str = "",
    action_state: str = "none",
    connection: Any | None = None,
) -> dict[str, Any] | None:
    """Insert one notification, optionally carrying an inline admin action
    (``action="confirm_order"`` + ``action_state="pending"``). Mirrors the
    Supabase store exactly so tests cover the production shape."""
    owns_connection = connection is None
    active_connection = connection or _connect()
    try:
        # MAX (not COUNT) so deletes can never reuse an id, AND a retry on a
        # concurrent collision so a lost insert can never drop the admin's
        # "confirm this order" queue row (see _next_suffixed_id).
        notification_id = _insert_with_suffixed_id(
            active_connection,
            "notifications",
            "n",
            "INSERT INTO notifications (id, title, message, order_id, status, target_role, action, action_state)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            lambda rid: (rid, title, message, order_id, status, target_role, action or "", action_state or "none"),
        )
        row = active_connection.execute(
            "SELECT * FROM notifications WHERE id = ?",
            (notification_id,),
        ).fetchone()
        if owns_connection:
            active_connection.commit()
        return dict(row) if row else None
    finally:
        if owns_connection:
            active_connection.close()


def list_notifications(role: str | None = None) -> list[dict[str, Any]]:
    """List notifications. When ``role`` is given, only notifications targeted at
    that exact role are returned (strict role separation). Rows that still carry
    a PENDING admin action sort to the top so an un-confirmed order is never
    truncated away from the bell."""
    with _connect() as connection:
        pending_first = (
            "ORDER BY (CASE WHEN action <> '' AND action_state = 'pending' THEN 0 ELSE 1 END), rowid DESC"
        )
        if role:
            rows = connection.execute(
                f"SELECT * FROM notifications WHERE target_role = ? {pending_first} LIMIT ?",
                (role, NOTIFICATION_LIST_LIMIT),
            ).fetchall()
        else:
            rows = connection.execute(
                f"SELECT * FROM notifications {pending_first} LIMIT ?",
                (NOTIFICATION_LIST_LIMIT,),
            ).fetchall()
        return _rows_to_dicts(rows)


def list_student_notifications(user_id: int) -> list[dict[str, Any]]:
    """List notifications addressed to student role and owned by user_id in ONE query."""
    uid_str = str(user_id)
    with _connect() as connection:
        rows = connection.execute(
            """
            SELECT n.*
            FROM notifications n
            WHERE n.target_role = 'student'
              AND (
                n.order_id IS NULL
                OR EXISTS (
                  SELECT 1 FROM orders o
                  WHERE o.id = n.order_id AND (o.owner_user_id = ? OR o.owner_user_id = '' OR o.owner_user_id IS NULL)
                )
                OR EXISTS (
                  SELECT 1 FROM parent_orders po
                  WHERE po.id = n.order_id AND po.owner_user_id = ?
                )
                OR EXISTS (
                  SELECT 1 FROM shop_sub_orders sso
                  JOIN parent_orders po2 ON po2.id = sso.parent_order_id
                  WHERE sso.id = n.order_id AND po2.owner_user_id = ?
                )
              )
            ORDER BY n.rowid DESC
            LIMIT 50
            """,
            (uid_str, uid_str, uid_str),
        ).fetchall()
        return _rows_to_dicts(rows)


def list_actionable_notifications(action: str, action_state: str = "pending") -> list[dict[str, Any]]:
    """Every notification carrying a given inline action in a given state."""
    with _connect() as connection:
        rows = connection.execute(
            """SELECT * FROM notifications
               WHERE action = ? AND action_state = ?
               ORDER BY rowid DESC LIMIT 50""",
            (action, action_state),
        ).fetchall()
        return _rows_to_dicts(rows)


def set_notification_action_state(notification_id: str, action_state: str) -> dict[str, Any] | None:
    """Move a notification's inline action to a new state (pending → done)."""
    with _connect() as connection:
        exists = connection.execute(
            "SELECT id FROM notifications WHERE id = ?", (notification_id,)
        ).fetchone()
        if not exists:
            return None
        connection.execute(
            "UPDATE notifications SET action_state = ? WHERE id = ?",
            (action_state, notification_id),
        )
        row = connection.execute(
            "SELECT * FROM notifications WHERE id = ?", (notification_id,)
        ).fetchone()
        connection.commit()
        return dict(row) if row else None


# ─── Web push subscriptions (vendor order notifications) ───


def save_push_subscription(
    shop_id: str,
    endpoint: str,
    p256dh: str,
    auth: str,
) -> dict[str, Any] | None:
    """Save (or refresh) a browser push subscription for a vendor's shop.
    ``endpoint`` is unique per device+browser, so it's the natural key."""
    with _connect() as connection:
        connection.execute(
            """
            INSERT INTO push_subscriptions (endpoint, shop_id, p256dh, auth)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(endpoint) DO UPDATE SET
                shop_id = excluded.shop_id,
                p256dh = excluded.p256dh,
                auth = excluded.auth
            """,
            (endpoint, shop_id, p256dh, auth),
        )
        row = connection.execute(
            "SELECT * FROM push_subscriptions WHERE endpoint = ?",
            (endpoint,),
        ).fetchone()
        return dict(row) if row else None


def list_push_subscriptions(shop_id: str) -> list[dict[str, Any]]:
    """All push subscriptions registered for a shop (used to deliver pushes)."""
    with _connect() as connection:
        rows = connection.execute(
            "SELECT * FROM push_subscriptions WHERE shop_id = ? ORDER BY rowid",
            (shop_id,),
        ).fetchall()
        return _rows_to_dicts(rows)


def remove_push_subscription(shop_id: str, endpoint: str) -> bool:
    """Remove a push subscription (e.g. when the browser reports it's dead)."""
    with _connect() as connection:
        cursor = connection.execute(
            "DELETE FROM push_subscriptions WHERE endpoint = ? AND shop_id = ?",
            (endpoint, shop_id),
        )
        return cursor.rowcount > 0
