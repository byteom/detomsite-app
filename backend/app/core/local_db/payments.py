from __future__ import annotations

from typing import Any

from app.core.local_db.connection import _connect, _rows_to_dicts
from app.core.local_db.notifications import create_notification

_PROOF_SUBMITTED = "PAYMENT_PROOF_SUBMITTED"
_PROOF_APPROVED = "PAYMENT_APPROVED"
_PROOF_REJECTED = "PAYMENT_REJECTED"


def bank_sms_seen(utr: str) -> bool:
    """True when a bank credit SMS containing this UTR was already logged inbound.

    This is the security anchor for the double-confirm flow: an order only
    auto-confirms via a student-entered UTR if the bank's SMS (proving the money
    actually arrived) was received too.
    """
    with _connect() as connection:
        row = connection.execute(
            "SELECT 1 FROM sms_logs WHERE direction='in' AND status='UTR Received' "
            "AND UPPER(message) LIKE ? LIMIT 1",
            (f"%{utr}%",),
        ).fetchone()
        return row is not None


def create_payment(
    order_id: str,
    amount: int,
    method: str,
    utr_number: str | None = None,
    screenshot_name: str | None = None,
) -> dict[str, Any] | None:
    with _connect() as connection:
        order = connection.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
        if not order:
            return None
        next_id = connection.execute("SELECT COUNT(*) + 1 FROM payments").fetchone()[0]
        payment_id = f"pay{next_id}"
        status = "Pending" if method in ("Manual UTR", "UPI") else "Success"
        connection.execute(
            """
            INSERT INTO payments (id, order_id, amount, method, status, utr_number, screenshot_name)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (payment_id, order_id, amount, method, status, utr_number, screenshot_name),
        )
        row = connection.execute("SELECT * FROM payments WHERE id = ?", (payment_id,)).fetchone()
        return dict(row) if row else None


def list_payments() -> list[dict[str, Any]]:
    with _connect() as connection:
        rows = connection.execute("SELECT * FROM payments ORDER BY rowid DESC").fetchall()
        return _rows_to_dicts(rows)


def get_payment_by_order_id(order_id: str) -> dict[str, Any] | None:
    """Get the most recent payment record for an order."""
    with _connect() as connection:
        row = connection.execute(
            "SELECT * FROM payments WHERE order_id = ? ORDER BY rowid DESC LIMIT 1",
            (order_id,),
        ).fetchone()
        return dict(row) if row else None


def get_payments_map_by_order_ids(order_ids: list[str]) -> dict[str, dict[str, Any]]:
    """Batch fetch latest payments for order IDs in a single query."""
    if not order_ids:
        return {}
    clean_ids = list({str(oid).strip() for oid in order_ids if oid})
    if not clean_ids:
        return {}
    placeholders = ",".join("?" for _ in clean_ids)
    with _connect() as connection:
        rows = connection.execute(
            f"""
            SELECT p.*
            FROM payments p
            JOIN (
                SELECT order_id, MAX(rowid) as max_rowid
                FROM payments
                WHERE order_id IN ({placeholders})
                GROUP BY order_id
            ) latest ON p.rowid = latest.max_rowid
            """,
            clean_ids,
        ).fetchall()
        result: dict[str, dict[str, Any]] = {}
        for r in rows:
            d = dict(r)
            if d.get("order_id"):
                result[d["order_id"]] = d
            if d.get("parent_order_id"):
                result[d["parent_order_id"]] = d
        return result


def set_payment_utr(order_id: str, utr_number: str) -> dict[str, Any] | None:
    """Stamp the student-provided UTR on the latest payment for an order."""
    with _connect() as connection:
        row = connection.execute(
            "SELECT * FROM payments WHERE order_id = ? ORDER BY rowid DESC LIMIT 1",
            (order_id,),
        ).fetchone()
        if not row:
            return None
        connection.execute(
            "UPDATE payments SET utr_number = ? WHERE id = ?",
            (utr_number, row["id"]),
        )
        updated = connection.execute("SELECT * FROM payments WHERE id = ?", (row["id"],)).fetchone()
        return dict(updated) if updated else None


def get_payment_by_utr(utr_number: str) -> dict[str, Any] | None:
    """Find the most recent payment record carrying this UTR (student-entered).

    UTRs are unique per transaction, but SQLite has no per-row uniqueness on a
    nullable column — so the newest match wins (a student re-entering the same
    UTR on a second order would otherwise match twice).
    """
    if not utr_number:
        return None
    with _connect() as connection:
        row = connection.execute(
            "SELECT * FROM payments WHERE utr_number = ? ORDER BY rowid DESC LIMIT 1",
            (utr_number,),
        ).fetchone()
        return dict(row) if row else None


def list_payments_by_utr(utr_number: str) -> list[dict[str, Any]]:
    """Indexed UTR lookup for /sms/match Tier-1 (avoids full-table scan)."""
    if not utr_number:
        return []
    with _connect() as connection:
        rows = connection.execute(
            "SELECT * FROM payments WHERE utr_number = ? ORDER BY rowid DESC",
            (utr_number,),
        ).fetchall()
        return _rows_to_dicts(rows)


def settle_payment_if_open(payment_id: str) -> dict[str, Any] | None:
    """Atomically settle only an open payment (SQLite single-statement)."""
    with _connect() as connection:
        cur = connection.execute(
            """UPDATE payments SET status = 'Success'
               WHERE id = ? AND status NOT IN ('Success','Cancelled','Failed','Rejected')""",
            (payment_id,),
        )
        if cur.rowcount == 0:
            return None
        row = connection.execute("SELECT * FROM payments WHERE id = ?", (payment_id,)).fetchone()
        return dict(row) if row else None


def get_payment_by_id(payment_id: str) -> dict[str, Any] | None:
    with _connect() as connection:
        row = connection.execute("SELECT * FROM payments WHERE id = ?", (payment_id,)).fetchone()
        return dict(row) if row else None


# ─── Parent (multi-shop) payments ────────────────────────────────────


def _parent_payment_shape(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "order_id": row["id"],
        "amount": row["total"],
        "method": row["payment_method"],
        "status": "Success" if str(row.get("payment_status") or "").upper() == "PAID" else row.get("payment_status", "Pending"),
        "proof_status": row.get("payment_proof_status") or "PENDING_PAYMENT",
        "utr_number": row.get("utr_number"),
        "screenshot_name": row.get("screenshot_name"),
        "payment_screenshot_url": row.get("payment_screenshot_url") or "",
        "payment_screenshot_public_id": row.get("payment_screenshot_public_id") or "",
        "payment_submitted_at": str(row.get("payment_submitted_at") or ""),
        "payment_verified_at": str(row.get("payment_verified_at") or ""),
        "payment_verified_by": row.get("payment_verified_by") or "",
        "payment_rejection_reason": row.get("payment_rejection_reason") or "",
        "created_at": str(row.get("created_at") or ""),
        "is_parent": True,
    }


def record_parent_payment(
    parent_order_id: str,
    amount: int,
    method: str,
    utr_number: str | None = None,
    screenshot_name: str | None = None,
) -> dict[str, Any] | None:
    with _connect() as connection:
        parent = connection.execute("SELECT * FROM parent_orders WHERE id = ?", (parent_order_id,)).fetchone()
        if not parent:
            return None
        connection.execute(
            """UPDATE parent_orders
               SET payment_method = COALESCE(?, payment_method),
                   utr_number = COALESCE(?, utr_number),
                   screenshot_name = COALESCE(?, screenshot_name)
               WHERE id = ?""",
            (method, utr_number, screenshot_name, parent_order_id),
        )
        parent = connection.execute("SELECT * FROM parent_orders WHERE id = ?", (parent_order_id,)).fetchone()
        return _parent_payment_shape(dict(parent)) if parent else None


def get_parent_payment(parent_order_id: str) -> dict[str, Any] | None:
    with _connect() as connection:
        row = connection.execute("SELECT * FROM parent_orders WHERE id = ?", (parent_order_id,)).fetchone()
        return _parent_payment_shape(dict(row)) if row else None


def list_parent_payments() -> list[dict[str, Any]]:
    with _connect() as connection:
        rows = connection.execute("SELECT * FROM parent_orders ORDER BY created_at DESC").fetchall()
        return [_parent_payment_shape(dict(r)) for r in rows]


def verify_parent_payment(parent_order_id: str, status: str) -> dict[str, Any] | None:
    with _connect() as connection:
        if str(status).lower() in ("success", "verified", "received"):
            prow = connection.execute(
                "SELECT token, status FROM parent_orders WHERE id = ?", (parent_order_id,)
            ).fetchone()
            if not prow:
                return None
            connection.execute("UPDATE parent_orders SET payment_status = 'Paid' WHERE id = ?", (parent_order_id,))
            if prow["status"] == "Pending":
                connection.execute("UPDATE parent_orders SET status = 'Pending Acceptance' WHERE id = ?", (parent_order_id,))
            connection.execute(
                "UPDATE shop_sub_orders SET status = 'Accepted' WHERE parent_order_id = ? AND status = 'Pending'",
                (parent_order_id,),
            )
            create_notification(
                title="Payment confirmed",
                message=f"Payment for token {prow['token']} confirmed — the shops will accept your order soon.",
                order_id=None,
                status="Pending Acceptance",
                target_role="student",
            )
        else:
            if not connection.execute("SELECT id FROM parent_orders WHERE id = ?", (parent_order_id,)).fetchone():
                return None
            connection.execute("UPDATE parent_orders SET payment_status = 'Failed' WHERE id = ?", (parent_order_id,))
        row = connection.execute("SELECT * FROM parent_orders WHERE id = ?", (parent_order_id,)).fetchone()
        return _parent_payment_shape(dict(row)) if row else None


def update_payment_status(payment_id: str, status: str) -> dict[str, Any] | None:
    with _connect() as connection:
        connection.execute("UPDATE payments SET status = ? WHERE id = ?", (status, payment_id))
        row = connection.execute("SELECT * FROM payments WHERE id = ?", (payment_id,)).fetchone()
        if row and status == "Success":
            connection.execute("UPDATE orders SET status = ? WHERE id = ?", ("Pending Acceptance", row["order_id"]))
            order_row = connection.execute("SELECT * FROM orders WHERE id = ?", (row["order_id"],)).fetchone()
            if order_row:
                create_notification(
                    title="Payment confirmed",
                    message=f"Payment for token {order_row['token']} confirmed — the shop will accept your order soon.",
                    order_id=row["order_id"],
                    status="Pending Acceptance",
                    target_role="student",
                    connection=connection,
                )
        if row and status == "Failed":
            connection.execute("UPDATE orders SET status = ? WHERE id = ?", ("Failed", row["order_id"]))
        return dict(row) if row else None


# ─── Manual UPI payment proofs (screenshot + UTR + admin verification) ───


def save_single_payment_proof(
    order_id: str,
    amount: int,
    utr_number: str,
    screenshot_url: str,
    screenshot_public_id: str,
) -> dict[str, Any] | None:
    with _connect() as connection:
        if not connection.execute("SELECT id FROM orders WHERE id = ?", (order_id,)).fetchone():
            return None
        row = connection.execute(
            "SELECT * FROM payments WHERE order_id = ? ORDER BY rowid DESC LIMIT 1",
            (order_id,),
        ).fetchone()
        if row:
            connection.execute(
                """UPDATE payments
                   SET amount = ?, method = 'Manual UTR', utr_number = ?,
                       proof_status = 'PAYMENT_PROOF_SUBMITTED', status = 'Pending Verification',
                       payment_screenshot_url = ?, payment_screenshot_public_id = ?,
                       payment_submitted_at = CURRENT_TIMESTAMP,
                       payment_verified_at = NULL, payment_verified_by = '',
                       payment_rejection_reason = ''
                   WHERE id = ?""",
                (amount, utr_number, screenshot_url, screenshot_public_id, row["id"]),
            )
            payment_id = row["id"]
        else:
            next_id = connection.execute("SELECT COUNT(*) + 1 FROM payments").fetchone()[0]
            payment_id = f"pay{next_id}"
            try:
                connection.execute(
                    """INSERT INTO payments (id, order_id, amount, method, status,
                                            utr_number, proof_status, payment_screenshot_url,
                                            payment_screenshot_public_id, payment_submitted_at)
                       VALUES (?, ?, ?, 'Manual UTR', 'Pending Verification',
                               ?, 'PAYMENT_PROOF_SUBMITTED', ?, ?, CURRENT_TIMESTAMP)""",
                    (payment_id, order_id, amount, utr_number, screenshot_url, screenshot_public_id),
                )
            except Exception:
                return None
        saved = connection.execute("SELECT * FROM payments WHERE id = ?", (payment_id,)).fetchone()
        return dict(saved) if saved else None


def save_parent_payment_proof(
    parent_order_id: str,
    amount: int,
    utr_number: str,
    screenshot_url: str,
    screenshot_public_id: str,
) -> dict[str, Any] | None:
    with _connect() as connection:
        if not connection.execute("SELECT id FROM parent_orders WHERE id = ?", (parent_order_id,)).fetchone():
            return None
        connection.execute(
            """UPDATE parent_orders
               SET payment_method = 'Manual UTR',
                   payment_status = 'Pending',
                   payment_proof_status = 'PAYMENT_PROOF_SUBMITTED',
                   utr_number = ?,
                   payment_screenshot_url = ?,
                   payment_screenshot_public_id = ?,
                   payment_submitted_at = CURRENT_TIMESTAMP,
                   payment_verified_at = NULL,
                   payment_verified_by = '',
                   payment_rejection_reason = ''
               WHERE id = ?""",
            (utr_number, screenshot_url, screenshot_public_id, parent_order_id),
        )
        updated = connection.execute("SELECT * FROM parent_orders WHERE id = ?", (parent_order_id,)).fetchone()
        return _parent_payment_shape(dict(updated)) if updated else None


def verify_single_payment_proof(
    payment_id: str, approved: bool, admin_name: str, reason: str = ""
) -> dict[str, Any] | None:
    with _connect() as connection:
        row = connection.execute("SELECT * FROM payments WHERE id = ?", (payment_id,)).fetchone()
        if not row:
            return None
        proof = _PROOF_APPROVED if approved else _PROOF_REJECTED
        legacy = "Success" if approved else "Rejected"
        connection.execute(
            """UPDATE payments
               SET proof_status = ?, status = ?, payment_verified_at = CURRENT_TIMESTAMP,
                   payment_verified_by = ?, payment_rejection_reason = ?
               WHERE id = ?""",
            (proof, legacy, admin_name[:100], (reason or "")[:500], payment_id),
        )
        order_row = connection.execute("SELECT * FROM orders WHERE id = ?", (row["order_id"],)).fetchone()
        if order_row and approved:
            if str(order_row["status"]) in ("Pending", "Pending Payment", "Pending Acceptance"):
                connection.execute("UPDATE orders SET status = ? WHERE id = ?", ("Pending Acceptance", order_row["id"]))
            create_notification(
                title="Payment verified",
                message=f"Payment for token {order_row['token']} is verified — the shop will accept your order soon.",
                order_id=order_row["id"],
                status="Pending Acceptance",
                target_role="student",
                connection=connection,
            )
        elif order_row and not approved:
            create_notification(
                title="Payment rejected",
                message=(
                    f"Payment proof for token {order_row['token']} was rejected"
                    + (f": {reason[:200]}" if (reason or "").strip() else "")
                    + ". Please submit a fresh UTR + screenshot."
                ),
                order_id=order_row["id"],
                status=str(order_row["status"]),
                target_role="student",
                connection=connection,
            )
        saved = connection.execute("SELECT * FROM payments WHERE id = ?", (payment_id,)).fetchone()
        return dict(saved) if saved else None


def verify_parent_payment_proof(
    parent_order_id: str, approved: bool, admin_name: str, reason: str = ""
) -> dict[str, Any] | None:
    with _connect() as connection:
        parent = connection.execute("SELECT * FROM parent_orders WHERE id = ?", (parent_order_id,)).fetchone()
        if not parent:
            return None
        parent = dict(parent)
        proof = _PROOF_APPROVED if approved else _PROOF_REJECTED
        legacy = "Paid" if approved else "Failed"
        connection.execute(
            """UPDATE parent_orders
               SET payment_proof_status = ?, payment_status = ?,
                   payment_verified_at = CURRENT_TIMESTAMP, payment_verified_by = ?,
                   payment_rejection_reason = ?
               WHERE id = ?""",
            (proof, legacy, admin_name[:100], (reason or "")[:500], parent_order_id),
        )
        if approved:
            if parent["status"] == "Pending":
                connection.execute("UPDATE parent_orders SET status = 'Pending Acceptance' WHERE id = ?", (parent_order_id,))
            connection.execute(
                "UPDATE shop_sub_orders SET status = 'Accepted' WHERE parent_order_id = ? AND status = 'Pending'",
                (parent_order_id,),
            )
            create_notification(
                title="Payment verified",
                message=f"Payment for token {parent['token']} is verified — the shops will accept your order soon.",
                order_id=None,
                status="Pending Acceptance",
                target_role="student",
                connection=connection,
            )
        else:
            create_notification(
                title="Payment rejected",
                message=(
                    f"Payment proof for token {parent['token']} was rejected"
                    + (f": {reason[:200]}" if (reason or "").strip() else "")
                    + ". Please submit a fresh UTR + screenshot."
                ),
                order_id=None,
                status=str(parent.get("status") or "Pending"),
                target_role="student",
                connection=connection,
            )
        updated = connection.execute("SELECT * FROM parent_orders WHERE id = ?", (parent_order_id,)).fetchone()
        return _parent_payment_shape(dict(updated)) if updated else None


def get_payment_settings() -> dict[str, Any]:
    defaults = {
        "manual_enabled": False,
        "upi_id": "",
        "receiver_name": "",
        "instructions": "",
        "razorpay_enabled": False,
    }
    with _connect() as connection:
        rows = connection.execute("SELECT key, value FROM app_settings").fetchall()
        values = {row["key"]: row["value"] for row in rows}
    return {
        "manual_enabled": values.get("manual_enabled", "false") == "true",
        "upi_id": values.get("upi_id", defaults["upi_id"]),
        "receiver_name": values.get("receiver_name", defaults["receiver_name"]),
        "instructions": values.get("instructions", defaults["instructions"]),
        "razorpay_enabled": values.get("razorpay_enabled", "false") == "true",
    }


def update_payment_settings(values: dict[str, Any]) -> dict[str, Any]:
    allowed = {"manual_enabled", "upi_id", "receiver_name", "instructions", "razorpay_enabled"}
    with _connect() as connection:
        for key, value in values.items():
            if key not in allowed or value is None:
                continue
            stored_value = str(value).lower() if isinstance(value, bool) else str(value)
            connection.execute(
                "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
                (key, stored_value),
            )
    return get_payment_settings()


# ─── Student info notice (site-wide banner on the student home page) ───


def get_student_notice() -> dict[str, Any]:
    """The info block students see on their home page, edited from the Admin
    Centre. Stored in ``app_settings`` (no extra table/migration needed):
    ``student_notice_enabled`` = "true"/"false", ``student_notice_text`` = the
    message. An empty message can never render — ``enabled`` is False whenever
    the text is blank."""
    with _connect() as connection:
        rows = connection.execute(
            "SELECT key, value FROM app_settings "
            "WHERE key IN ('student_notice_text', 'student_notice_enabled')"
        ).fetchall()
    values = {row["key"]: row["value"] for row in rows}
    text = str(values.get("student_notice_text", "") or "").strip()
    return {
        "enabled": values.get("student_notice_enabled", "false") == "true" and bool(text),
        "text": text,
    }


def update_student_notice(values: dict[str, Any]) -> dict[str, Any]:
    """Save the student info notice (admin only — see the local API routes)."""
    columns = {"enabled": "student_notice_enabled", "text": "student_notice_text"}
    with _connect() as connection:
        for field, key in columns.items():
            if field not in values or values[field] is None:
                continue
            value = values[field]
            stored_value = ("true" if value else "false") if isinstance(value, bool) else str(value)
            connection.execute(
                "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
                (key, stored_value),
            )
    return get_student_notice()
