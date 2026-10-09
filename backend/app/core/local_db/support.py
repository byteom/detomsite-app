from __future__ import annotations

import uuid
from typing import Any

from app.core.local_db.connection import (
    _connect,
    _day_key,
    _insert_with_suffixed_id,
    _rows_to_dicts,
)
from app.core.local_db.notifications import create_notification


def create_shop_announcement(shop_id: str, message: str) -> dict[str, Any] | None:
    with _connect() as connection:
        ann_id = f"ann-{uuid.uuid4().hex[:12]}"
        connection.execute(
            "INSERT INTO shop_announcements (id, shop_id, message, is_active, created_at) VALUES (?, ?, ?, 1, datetime('now', '+05:30'))",
            (ann_id, shop_id, message),
        )
        row = connection.execute(
            "SELECT * FROM shop_announcements WHERE id = ?", (ann_id,)
        ).fetchone()
        return dict(row) if row else None


def list_shop_announcements(shop_id: str | None = None, active_only: bool = True) -> list[dict[str, Any]]:
    with _connect() as connection:
        sql = "SELECT * FROM shop_announcements"
        args: list[Any] = []
        if active_only:
            sql += " WHERE is_active = 1"
        if shop_id:
            sql += " AND shop_id = ?" if "WHERE" in sql else " WHERE shop_id = ?"
            args.append(shop_id)
        sql += " ORDER BY rowid DESC"
        rows = connection.execute(sql, args).fetchall()
        return _rows_to_dicts(rows)


def toggle_shop_announcement(ann_id: str, is_active: bool) -> dict[str, Any] | None:
    """Turn an announcement on/off."""
    with _connect() as connection:
        connection.execute(
            "UPDATE shop_announcements SET is_active = ? WHERE id = ?",
            (1 if is_active else 0, ann_id),
        )
        row = connection.execute(
            "SELECT * FROM shop_announcements WHERE id = ?", (ann_id,)
        ).fetchone()
        return dict(row) if row else None


def create_complaint(
    parent_order_id: str,
    student_name: str,
    student_phone: str,
    shop_id: str,
    shop_name: str,
    subject: str,
    message: str,
) -> dict[str, Any] | None:
    with _connect() as connection:
        complaint_id = f"cmp-{uuid.uuid4().hex[:12]}"
        connection.execute(
            """
            INSERT INTO complaints (
                id, parent_order_id, student_name, student_phone, shop_id,
                shop_name, subject, message, status, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'New', datetime('now', '+05:30'))
            """,
            (
                complaint_id,
                parent_order_id,
                student_name,
                student_phone,
                shop_id,
                shop_name,
                subject,
                message,
            ),
        )
        row = connection.execute(
            "SELECT * FROM complaints WHERE id = ?", (complaint_id,)
        ).fetchone()
        return dict(row) if row else None


def list_complaints(status: str | None = None) -> list[dict[str, Any]]:
    with _connect() as connection:
        sql = "SELECT * FROM complaints"
        args: list[Any] = []
        if status:
            sql += " WHERE status = ?"
            args.append(status)
        sql += " ORDER BY rowid DESC"
        rows = connection.execute(sql, args).fetchall()
        return _rows_to_dicts(rows)


def update_complaint(complaint_id: str, status: str, admin_notes: str = "") -> dict[str, Any] | None:
    with _connect() as connection:
        row = connection.execute(
            "SELECT * FROM complaints WHERE id = ?", (complaint_id,)
        ).fetchone()
        if not row:
            return None
        connection.execute(
            "UPDATE complaints SET status = ?, admin_notes = ? WHERE id = ?",
            (status, admin_notes, complaint_id),
        )
        updated = connection.execute(
            "SELECT * FROM complaints WHERE id = ?", (complaint_id,)
        ).fetchone()
        return dict(updated) if updated else None


def create_refund(
    parent_order_id: str,
    sub_order_id: str,
    student_name: str,
    shop_name: str,
    original_amount: int,
    refund_amount: int,
    refund_type: str = "Full",
) -> dict[str, Any] | None:
    with _connect() as connection:
        refund_id = f"ref-{uuid.uuid4().hex[:12]}"
        connection.execute(
            """
            INSERT INTO refunds (
                id, parent_order_id, sub_order_id, student_name, shop_name,
                original_amount, refund_amount, refund_type, status, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending', datetime('now', '+05:30'))
            """,
            (
                refund_id,
                parent_order_id,
                sub_order_id,
                student_name,
                shop_name,
                original_amount,
                refund_amount,
                refund_type,
            ),
        )
        row = connection.execute(
            "SELECT * FROM refunds WHERE id = ?", (refund_id,)
        ).fetchone()
        return dict(row) if row else None


def list_refunds(status: str | None = None) -> list[dict[str, Any]]:
    with _connect() as connection:
        sql = "SELECT * FROM refunds"
        args: list[Any] = []
        if status:
            sql += " WHERE status = ?"
            args.append(status)
        sql += " ORDER BY rowid DESC"
        rows = connection.execute(sql, args).fetchall()
        return _rows_to_dicts(rows)


def update_refund(
    refund_id: str, status: str, refund_utr: str = "", admin_notes: str = ""
) -> dict[str, Any] | None:
    with _connect() as connection:
        row = connection.execute(
            "SELECT * FROM refunds WHERE id = ?", (refund_id,)
        ).fetchone()
        if not row:
            return None
        connection.execute(
            "UPDATE refunds SET status = ?, refund_utr = COALESCE(?, refund_utr), admin_notes = ?, completed_at = CASE WHEN ? IN ('Completed','Refunded') THEN datetime('now', '+05:30') ELSE completed_at END WHERE id = ?",
            (status, refund_utr, admin_notes, status, refund_id),
        )
        updated = connection.execute(
            "SELECT * FROM refunds WHERE id = ?", (refund_id,)
        ).fetchone()
        return dict(updated) if updated else None


def list_settlements(status: str | None = None) -> list[dict[str, Any]]:
    with _connect() as connection:
        sql = "SELECT * FROM settlements"
        args: list[Any] = []
        if status:
            sql += " WHERE status = ?"
            args.append(status)
        sql += " ORDER BY date_key DESC, rowid DESC"
        rows = connection.execute(sql, args).fetchall()
        return _rows_to_dicts(rows)


def run_daily_settlements() -> list[dict[str, Any]]:
    """Compute every shop's gross sales, ₹10-per-order commission, and net payable
    for today and upsert a settlement record. Called by admin or a 9 PM job."""
    date_key = _day_key()
    with _connect() as connection:
        shops = connection.execute("SELECT id, name FROM shops").fetchall()
        settlements: list[dict[str, Any]] = []
        for shop_row in shops:
            shop_id = shop_row["id"]
            gross = connection.execute(
                """
                SELECT COALESCE(SUM(oi.total), 0) AS g, COUNT(DISTINCT sso.id) AS cnt
                FROM order_items oi
                JOIN shop_sub_orders sso ON sso.id = oi.sub_order_id
                WHERE sso.shop_id = ?
                """,
                (shop_id,),
            ).fetchone()
            gross_sales = gross["g"] or 0
            commission = (gross["cnt"] or 0) * 10
            net = gross_sales - commission
            existing = connection.execute(
                "SELECT id FROM settlements WHERE shop_id = ? AND date_key = ?",
                (shop_id, date_key),
            ).fetchone()
            settlement_id = existing["id"] if existing else f"set-{shop_id}-{uuid.uuid4().hex[:6]}"
            connection.execute(
                """
                INSERT OR REPLACE INTO settlements (
                    id, shop_id, shop_name, date_key, gross_sales,
                    commission_5pct, refunds_adjusted, net_payable, status, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'Pending', datetime('now', '+05:30'))
                """,
                (settlement_id, shop_id, shop_row["name"], date_key, gross_sales, commission, net),
            )
            settlements.append({
                "id": settlement_id,
                "shop_id": shop_id,
                "shop_name": shop_row["name"],
                "gross_sales": gross_sales,
                "commission_5pct": commission,
                "net_payable": net,
            })
        return settlements


def create_menu_change_request(
    shop_id: str, product_id: str, change_type: str, old_value: str, new_value: str
) -> dict[str, Any] | None:
    with _connect() as connection:
        req_id = f"mcr-{uuid.uuid4().hex[:12]}"
        connection.execute(
            """
            INSERT INTO menu_change_requests (
                id, shop_id, product_id, change_type, old_value, new_value, status, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, 'Pending', datetime('now', '+05:30'))
            """,
            (req_id, shop_id, product_id, change_type, old_value, new_value),
        )
        row = connection.execute(
            "SELECT * FROM menu_change_requests WHERE id = ?", (req_id,)
        ).fetchone()
        return dict(row) if row else None


def list_menu_change_requests(status: str | None = None) -> list[dict[str, Any]]:
    with _connect() as connection:
        sql = "SELECT * FROM menu_change_requests"
        args: list[Any] = []
        if status:
            sql += " WHERE status = ?"
            args.append(status)
        sql += " ORDER BY rowid DESC"
        rows = connection.execute(sql, args).fetchall()
        return _rows_to_dicts(rows)


def update_menu_change_request(req_id: str, status: str, admin_notes: str = "") -> dict[str, Any] | None:
    with _connect() as connection:
        row = connection.execute(
            "SELECT * FROM menu_change_requests WHERE id = ?", (req_id,)
        ).fetchone()
        if not row:
            return None
        connection.execute(
            "UPDATE menu_change_requests SET status = ?, admin_notes = ?, reviewed_at = datetime('now', '+05:30') WHERE id = ?",
            (status, admin_notes, req_id),
        )
        updated = connection.execute(
            "SELECT * FROM menu_change_requests WHERE id = ?", (req_id,)
        ).fetchone()
        return dict(updated) if updated else None


def add_audit_log(
    admin_user: str,
    action: str,
    entity_type: str,
    entity_id: str,
    old_value: str = "",
    new_value: str = "",
) -> None:
    with _connect() as connection:
        connection.execute(
            "INSERT INTO audit_logs (admin_user, action, entity_type, entity_id, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)",
            (admin_user, action, entity_type, entity_id, old_value, new_value),
        )


def list_audit_logs(limit: int = 200) -> list[dict[str, Any]]:
    with _connect() as connection:
        rows = connection.execute(
            "SELECT * FROM audit_logs ORDER BY rowid DESC LIMIT ?", (limit,)
        ).fetchall()
        return _rows_to_dicts(rows)


def log_whatsapp(
    sub_order_id: str = "",
    phone: str = "",
    message: str = "",
    url: str = "",
    status: str = "Pending",
) -> dict[str, Any] | None:
    """Persist one WhatsApp notification (link generated, ready to send)."""
    with _connect() as connection:
        wa_id = _insert_with_suffixed_id(
            connection,
            "whatsapp_logs",
            "w",
            "INSERT INTO whatsapp_logs (id, sub_order_id, phone, message, url, status)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            lambda rid: (rid, sub_order_id, phone or "", message or "", url or "", status),
        )
        row = connection.execute("SELECT * FROM whatsapp_logs WHERE id = ?", (wa_id,)).fetchone()
        return dict(row) if row else None


def mark_whatsapp_sent(whatsapp_id: str) -> dict[str, Any] | None:
    """Mark a WhatsApp notification as sent."""
    with _connect() as connection:
        connection.execute(
            "UPDATE whatsapp_logs SET status = 'Sent' WHERE id = ?", (whatsapp_id,)
        )
        row = connection.execute("SELECT * FROM whatsapp_logs WHERE id = ?", (whatsapp_id,)).fetchone()
        return dict(row) if row else None


def update_whatsapp_message(whatsapp_id: str, message: str, url: str = "") -> dict[str, Any] | None:
    """Refresh a pending WhatsApp notification (e.g. payment flipped to paid)."""
    with _connect() as connection:
        connection.execute(
            "UPDATE whatsapp_logs SET message = ?, url = ? WHERE id = ?",
            (message or "", url or "", whatsapp_id),
        )
        row = connection.execute("SELECT * FROM whatsapp_logs WHERE id = ?", (whatsapp_id,)).fetchone()
        return dict(row) if row else None


def claim_next_whatsapp_log(
    log_ids: list[str], stale_minutes: int = 5
) -> dict[str, Any] | None:
    """Atomically claim the single next DELIVERABLE row, or None.

    Mirrors the Supabase implementation. The claimable row is chosen INSIDE the
    statement — the newest one that is ``Pending``, or ``Sending`` but claimed
    long enough ago to be retried.
    """
    ids = [str(i) for i in (log_ids or []) if str(i).strip()]
    if not ids:
        return None
    placeholders = ",".join("?" for _ in ids)
    cutoff = f"-{int(stale_minutes)} minutes"
    with _connect() as connection:
        rows = connection.execute(
            f"""
            UPDATE whatsapp_logs
               SET status = 'Sending', claimed_at = CURRENT_TIMESTAMP
             WHERE id = (
                   SELECT id FROM whatsapp_logs
                    WHERE id IN ({placeholders})
                      AND (
                           status = 'Pending'
                        OR (status = 'Sending'
                            AND (claimed_at IS NULL
                                 OR claimed_at < datetime('now', ?)))
                      )
                    ORDER BY created_at DESC
                    LIMIT 1
             )
            RETURNING *
            """,
            (*ids, cutoff),
        ).fetchall()
        return _rows_to_dicts(rows)[0] if rows else None


def list_whatsapp_logs(limit: int = 100) -> list[dict[str, Any]]:
    with _connect() as connection:
        rows = connection.execute(
            "SELECT * FROM whatsapp_logs ORDER BY rowid DESC LIMIT ?", (limit,)
        ).fetchall()
        return _rows_to_dicts(rows)


def log_sms(
    sub_order_id: str = "",
    phone: str = "",
    message: str = "",
    status: str = "Sent",
    direction: str = "out",
) -> dict[str, Any] | None:
    """Persist one SMS (out = sent to a phone, in = received from a phone)."""
    with _connect() as connection:
        sms_id = _insert_with_suffixed_id(
            connection,
            "sms_logs",
            "s",
            "INSERT INTO sms_logs (id, sub_order_id, phone, message, direction, status)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            lambda rid: (rid, sub_order_id, phone or "", message or "", direction, status),
        )
        row = connection.execute("SELECT * FROM sms_logs WHERE id = ?", (sms_id,)).fetchone()
        return dict(row) if row else None


def list_sms_logs(limit: int = 100) -> list[dict[str, Any]]:
    with _connect() as connection:
        rows = connection.execute(
            "SELECT * FROM sms_logs ORDER BY rowid DESC LIMIT ?", (limit,)
        ).fetchall()
        return _rows_to_dicts(rows)


def create_ticket(values: dict[str, Any]) -> dict[str, Any]:
    with _connect() as connection:
        next_id = connection.execute("SELECT COUNT(*) + 1 FROM tickets").fetchone()[0]
        ticket_id = f"t{next_id}"
        ticket_number = f"TKT-{1000 + next_id}"
        connection.execute(
            """
            INSERT INTO tickets (
                id, ticket_number, name, email, phone_number, category,
                title, description, status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                ticket_id,
                ticket_number,
                values["name"],
                values["email"],
                values["phone_number"],
                values["category"],
                values["title"],
                values["description"],
                "Open",
            ),
        )
        row = connection.execute("SELECT * FROM tickets WHERE id = ?", (ticket_id,)).fetchone()
        return dict(row)


def list_tickets() -> list[dict[str, Any]]:
    with _connect() as connection:
        rows = connection.execute("SELECT * FROM tickets ORDER BY created_at DESC").fetchall()
        return _rows_to_dicts(rows)


def list_tickets_for_user(email: str = "", name: str = "", phone: str = "") -> list[dict[str, Any]]:
    clean_email = email.strip().lower()
    clean_name = name.strip().lower()
    clean_phone = "".join(ch for ch in phone if ch.isdigit())
    phone_pattern = f"%{clean_phone[-10:]}" if len(clean_phone) >= 10 else f"%{clean_phone}" if clean_phone else ""

    with _connect() as connection:
        if clean_email:
            rows = connection.execute(
                "SELECT * FROM tickets WHERE LOWER(email) = ? ORDER BY created_at DESC LIMIT 100",
                (clean_email,),
            ).fetchall()
        elif clean_name and phone_pattern:
            rows = connection.execute(
                "SELECT * FROM tickets WHERE LOWER(name) = ? AND phone_number LIKE ? ORDER BY created_at DESC LIMIT 100",
                (clean_name, phone_pattern),
            ).fetchall()
        elif clean_name:
            rows = connection.execute(
                "SELECT * FROM tickets WHERE LOWER(name) = ? ORDER BY created_at DESC LIMIT 100",
                (clean_name,),
            ).fetchall()
        else:
            return []
        return _rows_to_dicts(rows)


def create_site_feedback(values: dict[str, Any]) -> dict[str, Any] | None:
    """Store a student's bug report / improvement contribution."""
    with _connect() as connection:
        feedback_id = _insert_with_suffixed_id(
            connection,
            "site_feedback",
            "fb",
            """
            INSERT INTO site_feedback (
                id, user_id, username, name, email, category,
                subject, message, page, status, source
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Open', ?)
            """,
            lambda rid: (
                rid,
                values.get("user_id"),
                values.get("username", ""),
                values.get("name", ""),
                values.get("email", ""),
                values.get("category", "Bug"),
                values.get("subject", ""),
                values.get("message", ""),
                values.get("page", ""),
                values.get("source", "User"),
            ),
        )
        row = connection.execute(
            "SELECT * FROM site_feedback WHERE id = ?",
            (feedback_id,),
        ).fetchone()
        if row:
            create_notification(
                title=f"New {row['category'].lower()} reported",
                message=f"{row['name'] or row['username'] or 'A user'}: {row['subject'] or row['message'][:60]}",
                target_role="admin",
                connection=connection,
            )
        return dict(row) if row else None


def list_site_feedback(source: str | None = None) -> list[dict[str, Any]]:
    with _connect() as connection:
        if source:
            rows = connection.execute(
                "SELECT * FROM site_feedback WHERE source = ? ORDER BY rowid DESC",
                (source,),
            ).fetchall()
        else:
            rows = connection.execute(
                "SELECT * FROM site_feedback ORDER BY rowid DESC"
            ).fetchall()
        return _rows_to_dicts(rows)


def list_site_feedback_by_user(user_id: int) -> list[dict[str, Any]]:
    with _connect() as connection:
        rows = connection.execute(
            "SELECT * FROM site_feedback WHERE user_id = ? ORDER BY rowid DESC",
            (user_id,),
        ).fetchall()
        return _rows_to_dicts(rows)


def update_site_feedback_status(feedback_id: str, status: str) -> dict[str, Any] | None:
    allowed = {"Open", "In Review", "Fixed", "Won't Fix"}
    if status not in allowed:
        return None
    with _connect() as connection:
        connection.execute(
            "UPDATE site_feedback SET status = ? WHERE id = ?",
            (status, feedback_id),
        )
        row = connection.execute(
            "SELECT * FROM site_feedback WHERE id = ?",
            (feedback_id,),
        ).fetchone()
        return dict(row) if row else None


def delete_site_feedback(source: str | None = None) -> int:
    with _connect() as connection:
        if source:
            cursor = connection.execute(
                "DELETE FROM site_feedback WHERE source = ?",
                (source,),
            )
        else:
            cursor = connection.execute("DELETE FROM site_feedback")
        return cursor.rowcount or 0


def create_review(values: dict[str, Any]) -> dict[str, Any] | None:
    """Save a student's shop review."""
    with _connect() as connection:
        shop_name = values.get("shop_name", "")
        if not shop_name and values.get("shop_id"):
            try:
                shop = connection.execute(
                    "SELECT name FROM shops WHERE id = ?", (values["shop_id"],)
                ).fetchone()
                if shop:
                    shop_name = shop["name"]
            except Exception:
                pass
        review_id = _insert_with_suffixed_id(
            connection,
            "reviews",
            "rv",
            """
            INSERT INTO reviews (id, user_id, username, student_name, shop_id, shop_name, rating, comment)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            lambda rid: (
                rid,
                values.get("user_id"),
                values.get("username", ""),
                values.get("student_name", ""),
                values.get("shop_id", ""),
                shop_name,
                values.get("rating", 5),
                values.get("comment", ""),
            ),
        )
        row = connection.execute("SELECT * FROM reviews WHERE id = ?", (review_id,)).fetchone()
        return dict(row) if row else None


def list_reviews(shop_id: str | None = None) -> list[dict[str, Any]]:
    with _connect() as connection:
        if shop_id:
            rows = connection.execute(
                "SELECT * FROM reviews WHERE shop_id = ? ORDER BY rowid DESC",
                (shop_id,),
            ).fetchall()
        else:
            rows = connection.execute(
                "SELECT * FROM reviews ORDER BY rowid DESC"
            ).fetchall()
        return _rows_to_dicts(rows)


def list_reviews_by_user(user_id: int) -> list[dict[str, Any]]:
    with _connect() as connection:
        rows = connection.execute(
            "SELECT * FROM reviews WHERE user_id = ? ORDER BY rowid DESC",
            (user_id,),
        ).fetchall()
        return _rows_to_dicts(rows)
