from __future__ import annotations

import sqlite3
from typing import Any

from app.core.config import settings
from app.core.local_db.connection import _connect, _rows_to_dicts


def ensure_admin_user() -> None:
    """Seed the super admin as a real DB user (role='admin') so the admin
    portal login AND forgot-password flow work end-to-end. The DB email is a
    unique placeholder because DEFAULT_SUPER_ADMIN_EMAIL is often already
    claimed by a shopkeeper/student account (one email = one account) — the
    reset OTP is delivered to DEFAULT_SUPER_ADMIN_EMAIL instead (see
    users.py)._send_reset_otp). Idempotent: an existing account is left
    untouched so a password reset or role change is never overwritten on boot."""
    email = (settings.DEFAULT_SUPER_ADMIN_EMAIL or "").strip()
    password = settings.DEFAULT_SUPER_ADMIN_PASSWORD or ""
    if not email or not password:
        print("ensure_admin_user: DEFAULT_SUPER_ADMIN_EMAIL/PASSWORD not set — skipping")
        return
    username = email.split("@")[0].lower() or "admin"
    if get_user_by_username(username):
        print(f"ensure_admin_user: admin user already exists ({username}) — skipping")
        return
    from app.core.security import hash_password
    user, conflict = register_user(
        username=username,
        password_hash=hash_password(password),
        name="Administrator",
        role="admin",
        email="admin@detomsite.local",
    )
    if user:
        print(f"ensure_admin_user: created admin '{username}' — reset OTP goes to {email}")
    else:
        print(f"ensure_admin_user: could not create admin ({conflict}) — {username} may be in use")


def register_user(
    username: str,
    password_hash: str,
    name: str,
    role: str,
    email: str = "",
    phone: str = "",
) -> tuple[dict[str, Any] | None, str | None]:
    """Register a new user. Returns ``(user, None)`` on success, or
    ``(None, 'username')`` / ``(None, 'email')`` when that field is already
    taken. Email uniqueness is case-insensitive and applies across ALL roles —
    one email can only ever own one account (mirrored by the
    ``idx_users_email_unique`` partial index, which is the race-safe backstop)."""
    normalized_email = (email or "").strip()
    with _connect() as connection:
        existing = connection.execute(
            "SELECT id FROM users WHERE username = ?",
            (username.lower(),),
        ).fetchone()
        if existing:
            return None, "username"

        if normalized_email:
            existing_email = connection.execute(
                "SELECT id FROM users WHERE LOWER(email) = ? AND email != ''",
                (normalized_email.lower(),),
            ).fetchone()
            if existing_email:
                return None, "email"

        try:
            cursor = connection.execute(
                "INSERT INTO users (username, password_hash, name, email, phone, role) VALUES (?, ?, ?, ?, ?, ?)",
                (username.lower(), password_hash, name, normalized_email, phone, role),
            )
        except sqlite3.IntegrityError:
            # Race backstop: another request inserted the same email/username
            # between our checks and the insert — the unique index guarantees
            # consistency. Re-check to report the RIGHT conflict.
            if normalized_email:
                existing_email = connection.execute(
                    "SELECT id FROM users WHERE LOWER(email) = ? AND email != ''",
                    (normalized_email.lower(),),
                ).fetchone()
                if existing_email:
                    return None, "email"
            return None, "username"

        row = connection.execute(
            "SELECT id, username, name, email, phone, role, created_at FROM users WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone()
        return dict(row), None


def get_user_by_username(username: str) -> dict[str, Any] | None:
    """Get full user record (including password_hash) by username."""
    with _connect() as connection:
        row = connection.execute(
            "SELECT * FROM users WHERE username = ?",
            (username.lower(),),
        ).fetchone()
        return dict(row) if row else None


def get_user_by_id(user_id: int) -> dict[str, Any] | None:
    """Get user by id (without password_hash)."""
    with _connect() as connection:
        row = connection.execute(
            "SELECT id, username, name, email, phone, role, created_at FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        return dict(row) if row else None


def save_session(email: str, name: str, role: str) -> dict[str, Any]:
    with _connect() as connection:
        existing = connection.execute(
            "SELECT id FROM sessions WHERE email = ? AND role = ? ORDER BY id DESC LIMIT 1",
            (email, role),
        ).fetchone()
        if existing:
            connection.execute(
                "UPDATE sessions SET name = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?",
                (name, existing["id"]),
            )
            row = connection.execute(
                "SELECT id, email, name, role, created_at FROM sessions WHERE id = ?",
                (existing["id"],),
            ).fetchone()
            return dict(row)

        cursor = connection.execute(
            "INSERT INTO sessions (email, name, role) VALUES (?, ?, ?)",
            (email, name, role),
        )
        row = connection.execute(
            "SELECT id, email, name, role, created_at FROM sessions WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone()
        return dict(row)


def list_users() -> list[dict[str, Any]]:
    """List all registered users (without password_hash) with summary order/spend metrics."""
    with _connect() as connection:
        rows = connection.execute(
            """
            SELECT 
                u.id, 
                u.username, 
                u.name, 
                u.email, 
                u.phone, 
                u.role, 
                COALESCE(u.status, 'active') as status,
                COALESCE(u.avatar_url, '') as avatar_url,
                u.created_at,
                (SELECT COUNT(*) FROM orders o WHERE o.owner_user_id = CAST(u.id AS TEXT) OR (o.owner_user_id = '' AND LOWER(o.student_name) = LOWER(u.name))) as orders_count,
                (SELECT COALESCE(SUM(total), 0) FROM orders o WHERE (o.owner_user_id = CAST(u.id AS TEXT) OR (o.owner_user_id = '' AND LOWER(o.student_name) = LOWER(u.name))) AND o.status IN ('Completed', 'Delivered')) as total_spent,
                (SELECT MAX(created_at) FROM sessions s WHERE LOWER(s.email) = LOWER(u.email)) as last_login
            FROM users u
            ORDER BY u.created_at DESC
            """
        ).fetchall()
        return _rows_to_dicts(rows)


def get_user_overview(user_id: int) -> dict[str, Any] | None:
    """Retrieve full 360 overview of a user: profile, stats, orders, payments, addresses, reviews, feedback, activity."""
    with _connect() as connection:
        user_row = connection.execute(
            "SELECT id, username, name, email, phone, role, COALESCE(status, 'active') as status, COALESCE(avatar_url, '') as avatar_url, created_at FROM users WHERE id = ?",
            (user_id,)
        ).fetchone()
        if not user_row:
            return None
        user = dict(user_row)

        sess_row = connection.execute(
            "SELECT created_at FROM sessions WHERE LOWER(email) = LOWER(?) ORDER BY created_at DESC LIMIT 1",
            (user.get("email", ""),)
        ).fetchone()
        user["last_login"] = sess_row["created_at"] if sess_row else None

        uid_str = str(user_id)
        orders_rows = connection.execute(
            """
            SELECT id, token, student_name, student_phone, shop_id, shop_name, items,
                   subtotal, service_fee, tax, delivery_fee, total,
                   delivery_location, delivery_slot, status, payment_method, created_at
            FROM orders
            WHERE owner_user_id = ?
               OR (owner_user_id = '' AND LOWER(student_name) = LOWER(?))
               OR (student_phone != '' AND student_phone = ?)
            ORDER BY created_at DESC
            """,
            (uid_str, user.get("name", ""), user.get("phone", ""))
        ).fetchall()
        orders = _rows_to_dicts(orders_rows)

        order_ids = [o["id"] for o in orders]
        payments = []
        if order_ids:
            placeholders = ",".join("?" for _ in order_ids)
            p_rows = connection.execute(
                f"SELECT id, order_id, amount, method, status, utr_number, created_at FROM payments WHERE order_id IN ({placeholders}) ORDER BY created_at DESC",
                tuple(order_ids)
            ).fetchall()
            payments = _rows_to_dicts(p_rows)

        r_rows = connection.execute(
            "SELECT id, shop_id, shop_name, rating, comment, created_at FROM reviews WHERE user_id = ? OR LOWER(username) = LOWER(?) ORDER BY created_at DESC",
            (user_id, user.get("username", ""))
        ).fetchall()
        reviews = _rows_to_dicts(r_rows)

        f_rows = connection.execute(
            "SELECT id, category, subject, message, page, status, source, created_at FROM site_feedback WHERE user_id = ? OR LOWER(username) = LOWER(?) OR (email != '' AND LOWER(email) = LOWER(?)) ORDER BY created_at DESC",
            (user_id, user.get("username", ""), user.get("email", ""))
        ).fetchall()
        feedback = _rows_to_dicts(f_rows)

        addresses_map = {}
        for o in orders:
            loc = (o.get("delivery_location") or "").strip()
            if not loc:
                continue
            slot = (o.get("delivery_slot") or "").strip()
            key = f"{loc}::{slot}".lower()
            if key not in addresses_map:
                addresses_map[key] = {
                    "location": loc,
                    "slot": slot,
                    "order_count": 1,
                    "last_used": o.get("created_at"),
                }
            else:
                addresses_map[key]["order_count"] += 1
        addresses = sorted(addresses_map.values(), key=lambda a: a["order_count"], reverse=True)

        shop = None
        if user.get("role") == "shopkeeper":
            s_row = connection.execute(
                "SELECT id, name, category, description, rating, status, approval_status, orders_today, revenue_today, upi_id, cod_enabled, admin_dues_balance, phone FROM shops WHERE LOWER(shopkeeper_email) = LOWER(?) OR (phone != '' AND phone = ?) LIMIT 1",
                (user.get("email", ""), user.get("phone", ""))
            ).fetchone()
            if s_row:
                shop = dict(s_row)

        total_orders = len(orders)
        completed_orders = sum(1 for o in orders if o.get("status") in ("Completed", "Delivered"))
        cancelled_orders = sum(1 for o in orders if o.get("status") in ("Cancelled", "Rejected", "Failed"))
        pending_orders = sum(1 for o in orders if o.get("status") in ("Pending Acceptance", "Pending Payment", "Accepted", "Preparing", "Ready", "Placed"))
        total_spent = sum(o.get("total", 0) for o in orders if o.get("status") in ("Completed", "Delivered"))

        ref_row = connection.execute(
            "SELECT COUNT(*) as cnt FROM refunds WHERE LOWER(student_name) = LOWER(?)",
            (user.get("name", ""),)
        ).fetchone()
        refunds_count = ref_row["cnt"] if ref_row else 0

        stats = {
            "total_orders": total_orders,
            "total_spent": total_spent,
            "completed_orders": completed_orders,
            "cancelled_orders": cancelled_orders,
            "pending_orders": pending_orders,
            "refunds_count": refunds_count,
            "reviews_count": len(reviews),
            "feedback_count": len(feedback),
        }

        activity_events = []
        if user.get("created_at"):
            activity_events.append({
                "id": f"reg-{user_id}",
                "type": "registration",
                "title": "Account Registered",
                "description": f"Created {user.get('role', 'student')} account as @{user.get('username')}",
                "timestamp": user["created_at"],
            })

        sess_rows = connection.execute(
            "SELECT created_at FROM sessions WHERE LOWER(email) = LOWER(?) ORDER BY created_at DESC LIMIT 5",
            (user.get("email", ""),)
        ).fetchall()
        for idx, s in enumerate(sess_rows):
            activity_events.append({
                "id": f"sess-{idx}",
                "type": "login",
                "title": "Account Sign-in",
                "description": "Authenticated session started",
                "timestamp": s["created_at"],
            })

        for o in orders[:25]:
            activity_events.append({
                "id": f"ord-{o['id']}",
                "type": "order",
                "title": f"Placed Order #{o.get('token') or o['id']}",
                "description": f"Order total ₹{o.get('total', 0)} ({o.get('status')}) at {o.get('shop_name', 'Campus Kitchen')}",
                "timestamp": o["created_at"],
                "status": o.get("status"),
            })

        for r in reviews[:15]:
            activity_events.append({
                "id": f"rev-{r['id']}",
                "type": "review",
                "title": f"Reviewed {r.get('shop_name', 'Shop')}",
                "description": f"{r.get('rating')}★: \"{r.get('comment', '')[:80]}\"",
                "timestamp": r["created_at"],
            })

        for f in feedback[:15]:
            activity_events.append({
                "id": f"fb-{f['id']}",
                "type": "feedback",
                "title": f"Submitted {f.get('category', 'Feedback')}",
                "description": f.get("subject", ""),
                "timestamp": f["created_at"],
                "status": f.get("status"),
            })

        activity_events.sort(key=lambda x: str(x.get("timestamp") or ""), reverse=True)

        return {
            "user": user,
            "stats": stats,
            "orders": orders,
            "payments": payments,
            "addresses": addresses,
            "reviews": reviews,
            "feedback": feedback,
            "activity": activity_events[:50],
            "shop": shop,
        }


def update_user_admin(user_id: int, updates: dict[str, Any]) -> dict[str, Any] | None:
    """Admin update user fields in SQLite."""
    allowed = {"name", "email", "phone", "role", "status"}
    filtered = {k: v for k, v in updates.items() if k in allowed and v is not None}
    if not filtered:
        return get_user_by_id(user_id)
    set_clauses = [f"{k} = ?" for k in filtered.keys()]
    params = [str(v).strip() for v in filtered.values()]
    params.append(user_id)
    with _connect() as connection:
        connection.execute(f"UPDATE users SET {', '.join(set_clauses)} WHERE id = ?", tuple(params))
        row = connection.execute("SELECT id, username, name, email, phone, role, status, created_at FROM users WHERE id = ?", (user_id,)).fetchone()
        return dict(row) if row else None


def set_user_status(user_id: int, status: str) -> bool:
    """Set status ('active' | 'blocked') in SQLite."""
    with _connect() as connection:
        cursor = connection.execute("UPDATE users SET status = ? WHERE id = ?", (status, user_id))
        return cursor.rowcount > 0


def list_users_by_role(role: str) -> list[dict[str, Any]]:
    """List users filtered by role."""
    with _connect() as connection:
        rows = connection.execute(
            """
            SELECT 
                u.id, 
                u.username, 
                u.name, 
                u.email, 
                u.phone, 
                u.role, 
                COALESCE(u.status, 'active') as status,
                COALESCE(u.avatar_url, '') as avatar_url,
                u.created_at,
                (SELECT COUNT(*) FROM orders o WHERE o.owner_user_id = CAST(u.id AS TEXT) OR (o.owner_user_id = '' AND LOWER(o.student_name) = LOWER(u.name))) as orders_count,
                (SELECT COALESCE(SUM(total), 0) FROM orders o WHERE (o.owner_user_id = CAST(u.id AS TEXT) OR (o.owner_user_id = '' AND LOWER(o.student_name) = LOWER(u.name))) AND o.status IN ('Completed', 'Delivered')) as total_spent,
                (SELECT MAX(created_at) FROM sessions s WHERE LOWER(s.email) = LOWER(u.email)) as last_login
            FROM users u
            WHERE u.role = ?
            ORDER BY u.created_at DESC
            """,
            (role,),
        ).fetchall()
        return _rows_to_dicts(rows)


def record_registration(user: dict[str, Any]) -> None:
    """Record a user registration for admin notifications."""
    with _connect() as connection:
        connection.execute(
            "INSERT INTO user_registrations (username, name, email, phone, role) VALUES (?, ?, ?, ?, ?)",
            (user.get("username", ""), user.get("name", ""), user.get("email", ""), user.get("phone", ""), user.get("role", "")),
        )


def list_registrations() -> list[dict[str, Any]]:
    """List all user registrations for admin."""
    with _connect() as connection:
        rows = connection.execute(
            "SELECT * FROM user_registrations ORDER BY created_at DESC"
        ).fetchall()
        return _rows_to_dicts(rows)


def get_user_by_email(email: str) -> dict[str, Any] | None:
    """Find a user by their registered email (case-insensitive)."""
    with _connect() as connection:
        row = connection.execute(
            "SELECT * FROM users WHERE LOWER(email) = ? LIMIT 1",
            (email.lower(),),
        ).fetchone()
        return dict(row) if row else None


def create_password_reset(username: str, otp: str, step: int) -> dict[str, Any] | None:
    """Store an OTP for a password-reset step (1 or 2) for the given user.
    Older unused codes for the same user are cleared so only the newest counts.
    The expiry is computed in SQLite's own datetime format so the lexicographic
    comparison in get_password_reset stays correct."""
    minutes = int(settings.RESET_OTP_EXPIRE_MINUTES)
    with _connect() as connection:
        connection.execute(
            "DELETE FROM password_resets WHERE username = ?",
            (username.lower(),),
        )
        cursor = connection.execute(
            """
            INSERT INTO password_resets (username, otp, step, expires_at)
            VALUES (?, ?, ?, datetime('now', ?))
            """,
            (username.lower(), otp, step, f"+{minutes} minutes"),
        )
        row = connection.execute(
            "SELECT * FROM password_resets WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone()
        return dict(row) if row else None


def get_password_reset(username: str, otp: str, step: int) -> dict[str, Any] | None:
    """Return the valid, unused, unexpired reset code for this user/step.
    Codes are locked out after 5 wrong attempts (brute-force protection)."""
    with _connect() as connection:
        row = connection.execute(
            """
            SELECT * FROM password_resets
            WHERE username = ? AND otp = ? AND step = ? AND used = 0
              AND attempts < 5
              AND expires_at >= datetime('now')
            ORDER BY id DESC LIMIT 1
            """,
            (username.lower(), otp, step),
        ).fetchone()
        return dict(row) if row else None


def bump_password_reset_attempts(username: str) -> None:
    """Count one wrong OTP guess for this user's pending reset."""
    with _connect() as connection:
        connection.execute(
            "UPDATE password_resets SET attempts = attempts + 1 WHERE username = ? AND used = 0",
            (username.lower(),),
        )


def invalidate_password_resets(username: str) -> None:
    """Mark every pending reset code for this user as used."""
    with _connect() as connection:
        connection.execute(
            "UPDATE password_resets SET used = 1 WHERE username = ?",
            (username.lower(),),
        )


def update_user_password(username: str, new_password_hash: str) -> bool:
    """Set a new password hash for a user (by username)."""
    with _connect() as connection:
        cursor = connection.execute(
            "UPDATE users SET password_hash = ? WHERE username = ?",
            (new_password_hash, username.lower()),
        )
        return cursor.rowcount > 0


def update_user_profile(user_id: int, name: str | None = None, email: str | None = None, phone: str | None = None) -> dict[str, Any] | None:
    """Update a user's editable profile fields (name, email, phone) by id.
    Returns the full clean user row (without password_hash) or None if the
    user doesn't exist."""
    updates: list[str] = []
    params: list[Any] = []
    if name is not None:
        updates.append("name = ?")
        params.append(name.strip() or "")
    if email is not None:
        updates.append("email = ?")
        params.append(email.strip())
    if phone is not None:
        updates.append("phone = ?")
        params.append(phone.strip())
    if updates:
        params.append(user_id)
        with _connect() as connection:
            connection.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", params)
    return get_user_by_id(user_id)


def delete_user(user_id: int) -> bool:
    """Permanently delete a user and EVERY record that references them, so a
    deleted account's username/email become re-registrable immediately and no
    stale rows keep the old data around.

    Cascades:
    - ``sessions`` (by email) — old quick-login sessions
    - ``user_registrations`` (by username) — admin registration log
    - ``site_feedback`` (by user_id) — their bug reports
    - ``password_resets`` (by username) — pending OTPs
    - ``shops`` for a shopkeeper — soft-removed (orders keep their history)

    Each cleanup is guarded so a missing/legacy table can never block the
    delete of the user row itself."""
    with _connect() as connection:
        user = connection.execute(
            "SELECT * FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if not user:
            return False

        username = str(user["username"])
        email = str(user.get("email") or "").strip().lower()
        if email:
            for table in ("sessions",):
                try:
                    connection.execute(
                        f"DELETE FROM {table} WHERE LOWER(email) = ?",
                        (email,),
                    )
                except sqlite3.Error:
                    pass
        for table, where in (
            ("user_registrations", "username = ?"),
            ("password_resets", "username = ?"),
            ("site_feedback", "user_id = ?"),
        ):
            try:
                connection.execute(
                    f"DELETE FROM {table} WHERE {where}",
                    (username if "username" in where else user_id,),
                )
            except sqlite3.Error:
                pass
        if str(user.get("role") or "") == "shopkeeper" and email:
            try:
                connection.execute(
                    "UPDATE shops SET is_removed = 1, present = 0, status = 'Closed', "
                    "approval_status = 'Removed' WHERE LOWER(shopkeeper_email) = ?",
                    (email,),
                )
            except sqlite3.Error:
                pass
        cursor = connection.execute("DELETE FROM users WHERE id = ?", (user_id,))
        return cursor.rowcount > 0
