"""
Supabase (Postgres) data store for DETOMSITE — the ONLY database.

Connect using either ``SUPABASE_DATABASE_URL`` (a full Postgres connection
string) or the individual ``SUPABASE_DB_*`` settings.

Run the schema from ``backend/supabase/schema.sql`` in the Supabase SQL editor before
using this store.
"""
from __future__ import annotations

import logging
import os
import queue
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any

# Asia/Kolkata fixed offset (works even without the tzdata package)
_KOLKATA_TZ = timezone(timedelta(hours=5, minutes=30))


def _now_kolkata() -> datetime:
    return datetime.now(_KOLKATA_TZ)


def _day_key() -> str:
    """Today's date in IST as YYYY-MM-DD (matches local_demo_db)."""
    return _now_kolkata().strftime("%Y-%m-%d")


def _day_key_compact() -> str:
    """Today's date in IST as YYYYMMDD (used in order ids like p20240320-18)."""
    return _now_kolkata().strftime("%Y%m%d")


import psycopg2
import psycopg2.extras
from psycopg2 import pool as _pg_pool

from app.core import ttl_cache
from app.core.config import settings

logger = logging.getLogger(__name__)


_CONN_QUERY_PARAMS = (
    "connect_timeout=10"
    "&keepalives=1"
    "&keepalives_idle=30"
    "&keepalives_interval=10"
    "&keepalives_count=5"
    "&application_name=detomsite"
)


def _with_conn_params(dsn: str) -> str:
    """Attach fast-fail connect settings to a Postgres DSN."""
    if not dsn or "connect_timeout" in dsn:
        return dsn
    sep = "&" if "?" in dsn else "?"
    return f"{dsn}{sep}{_CONN_QUERY_PARAMS}"


def _connection_string() -> str:
    if settings.SUPABASE_DATABASE_URL:
        return _with_conn_params(settings.SUPABASE_DATABASE_URL)
    return (
        f"postgresql://{settings.SUPABASE_DB_USER}:{settings.SUPABASE_DB_PASSWORD}"
        f"@{settings.SUPABASE_DB_HOST}:{settings.SUPABASE_DB_PORT}/{settings.SUPABASE_DB_NAME}"
        f"?{_CONN_QUERY_PARAMS}"
    )


# ─── Connection pool ───────────────────────────────────────────────────────
_pool: Any = None

# How long a request may wait for a busy pool slot before giving up.
_POOL_WAIT_SECONDS = 3.0

# Pool size (overridable via DB_POOL_MAX).
_POOL_MIN = int(os.environ.get("DB_POOL_MIN", "5"))
_POOL_MAX = int(os.environ.get("DB_POOL_MAX", "10"))


def _dsn_options(dsn: str) -> str:
    """Best-effort read of an ``options=`` setting already in the DSN."""
    if not dsn:
        return ""
    value = ""
    if "://" in dsn:
        from urllib.parse import parse_qsl, urlsplit

        for key, val in parse_qsl(urlsplit(dsn).query):
            if key == "options":
                value = val
    else:
        import shlex

        try:
            tokens = shlex.split(dsn)
        except ValueError:
            tokens = dsn.split()
        for token in tokens:
            if token.startswith("options="):
                value = token.split("=", 1)[1]
    return value.strip()


def _pool_connect_kwargs() -> dict:
    """Connect-time kwargs that make a stalled Postgres fail fast."""
    kwargs: dict = {"connect_timeout": 10}
    budget_ms = max(1000, int(getattr(settings, "DB_STATEMENT_TIMEOUT_MS", 20000)))
    cap = f"-c statement_timeout={budget_ms}"
    existing = _dsn_options(_connection_string())
    kwargs["options"] = f"{existing} {cap}".strip() if existing else cap
    return kwargs


class FastConnectionPool:
    """High-performance thread-safe connection pool for WAN/serverless databases."""

    def __init__(self, minconn: int = 5, maxconn: int = 15):
        self.minconn = max(1, minconn)
        self.maxconn = max(self.minconn, maxconn)
        self._pool: queue.LifoQueue = queue.LifoQueue()
        self._allocated = 0
        self._lock = threading.Lock()
        self.closed = False
        self._prewarm()

    def _prewarm(self) -> None:
        """Eagerly open warm connections on startup without blocking sequentially."""
        conn = self._create_connection()
        if conn:
            self._pool.put(conn)

        remaining = self.minconn - 1
        if remaining > 0:
            def _warm():
                for _ in range(remaining):
                    c = self._create_connection()
                    if c:
                        self._pool.put(c)
            threading.Thread(target=_warm, daemon=True, name="db-pool-warm").start()

    def _create_connection(self) -> Any | None:
        try:
            conn = psycopg2.connect(
                _connection_string(),
                cursor_factory=psycopg2.extras.RealDictCursor,
                **_pool_connect_kwargs(),
            )
            with self._lock:
                self._allocated += 1
            return conn
        except Exception as e:
            logger.warning("DB pool connection creation failed (%s)", e)
            return None

    def getconn(self, key: Any = None, timeout: float = _POOL_WAIT_SECONDS) -> Any:
        if self.closed:
            raise _pg_pool.PoolError("connection pool is closed")

        deadline = time.monotonic() + timeout
        # 1. Try to pop an existing warm connection from the LIFO queue
        while True:
            try:
                conn = self._pool.get_nowait()
                if getattr(conn, "closed", 1) == 0:
                    return conn
                with self._lock:
                    self._allocated = max(0, self._allocated - 1)
                try:
                    conn.close()
                except Exception:
                    pass
            except queue.Empty:
                break

        # 2. If under maxconn, create a new connection WITHOUT holding pool lock
        can_create = False
        with self._lock:
            if self._allocated < self.maxconn:
                self._allocated += 1
                can_create = True

        if can_create:
            try:
                conn = psycopg2.connect(
                    _connection_string(),
                    cursor_factory=psycopg2.extras.RealDictCursor,
                    **_pool_connect_kwargs(),
                )
                return conn
            except Exception:
                with self._lock:
                    self._allocated = max(0, self._allocated - 1)
                raise

        # 3. Pool is at capacity: wait for an in-use connection to be returned
        remaining = max(0.01, deadline - time.monotonic())
        try:
            conn = self._pool.get(timeout=remaining)
            if getattr(conn, "closed", 1) == 0:
                return conn
            with self._lock:
                self._allocated = max(0, self._allocated - 1)
            return self.getconn(key=key, timeout=max(0.1, deadline - time.monotonic()))
        except queue.Empty:
            raise _pg_pool.PoolError("connection pool exhausted")

    def putconn(self, conn: Any, key: Any = None, close: bool = False) -> None:
        if conn is None:
            return
        if close or getattr(conn, "closed", 1) != 0 or self.closed:
            try:
                conn.close()
            except Exception:
                pass
            with self._lock:
                self._allocated = max(0, self._allocated - 1)
            return

        # Ensure no abandoned transaction remains open
        try:
            status = getattr(conn, "get_transaction_status", lambda: 0)()
            if status != 0:
                conn.rollback()
        except Exception:
            try:
                conn.close()
            except Exception:
                pass
            with self._lock:
                self._allocated = max(0, self._allocated - 1)
            return

        self._pool.put(conn)

    def size(self) -> int:
        return self._allocated

    def idle_count(self) -> int:
        return self._pool.qsize()

    def ping_all(self) -> None:
        """Keep-alive ping on idle connections in the pool without draining the pool."""
        count = self._pool.qsize()
        for _ in range(count):
            try:
                c = self._pool.get_nowait()
            except queue.Empty:
                break
            try:
                if getattr(c, "closed", 1) == 0:
                    with c.cursor() as cur:
                        cur.execute("SELECT 1")
                    self._pool.put(c)
                else:
                    with self._lock:
                        self._allocated = max(0, self._allocated - 1)
            except Exception:
                try:
                    c.close()
                except Exception:
                    pass
                with self._lock:
                    self._allocated = max(0, self._allocated - 1)

    def closeall(self) -> None:
        self.closed = True
        while True:
            try:
                c = self._pool.get_nowait()
                try:
                    c.close()
                except Exception:
                    pass
            except queue.Empty:
                break
        with self._lock:
            self._allocated = 0


def _get_pool() -> Any:
    """Lazily create the shared connection pool (thread-safe)."""
    global _pool
    if _pool is None:
        _pool = FastConnectionPool(
            minconn=_POOL_MIN,
            maxconn=_POOL_MAX,
        )
    return _pool


def _connect() -> Any:
    """Get a pooled Postgres connection with dict-row support."""
    pool = _get_pool()
    t0 = time.perf_counter()
    conn = pool.getconn(timeout=_POOL_WAIT_SECONDS)
    from app.core.timing import record_timing
    record_timing("db_conn", (time.perf_counter() - t0) * 1000)
    return conn


def _release(conn: Any, discard: bool = False) -> None:
    """Return a connection to the pool. If it broke (or discard=True), close it."""
    if conn is None:
        return
    is_dead = bool(discard or getattr(conn, "closed", 0))
    if not is_dead and _in_transaction(conn):
        try:
            conn.rollback()
        except Exception:
            is_dead = True
    pool = _get_pool()
    pool.putconn(conn, close=is_dead)
    if is_dead:
        try:
            conn.close()
        except Exception:
            pass


def _in_transaction(conn: Any) -> bool:
    """True when ``conn`` is inside an open transaction."""
    try:
        status_fn = getattr(conn, "get_transaction_status", None)
        if status_fn is None:
            return False
        return int(status_fn()) != 0
    except Exception:
        return False


def _next_suffixed_id(cursor: Any, table: str, prefix: str) -> str:
    """Propose the next ``<prefix><n>`` primary key for ``table``."""
    cursor.execute(
        f"SELECT COALESCE(MAX(CAST(SUBSTRING(id FROM {len(prefix) + 1}) AS INTEGER)), 0) + 1 AS next FROM {table}"
    )
    return f"{prefix}{cursor.fetchone()['next']}"


def _insert_with_suffixed_id(
    cursor: Any,
    table: str,
    prefix: str,
    insert_sql: str,
    params_for,
    attempts: int = 25,
) -> str:
    """INSERT a row with a generated id, retrying on a primary-key collision."""
    last_error: Exception | None = None
    for attempt in range(attempts):
        row_id = _next_suffixed_id(cursor, table, prefix)
        try:
            if attempt:
                cursor.execute("ROLLBACK TO SAVEPOINT suffixed_id_insert")
            cursor.execute("SAVEPOINT suffixed_id_insert")
            cursor.execute(insert_sql, params_for(row_id))
            return row_id
        except Exception as exc:  # noqa: BLE001
            sqlstate = getattr(exc, "pgcode", None)
            is_unique = sqlstate == "23505" or "duplicate key" in str(exc).lower()
            if not is_unique:
                raise
            last_error = exc
            continue
    raise RuntimeError(
        f"Could not allocate a unique id for {table} after {attempts} attempts"
    ) from last_error


def _putconn_discarding(pool: Any, conn: Any) -> None:
    """Hand a dead connection back so the pool forgets its slot."""
    try:
        pool.putconn(conn, close=True)
    except Exception:
        try:
            conn.close()
        except Exception:
            pass


def _rebuild_pool() -> None:
    """Close and drop the current pool (if any)."""
    global _pool
    old_pool = _pool
    _pool = None
    try:
        if old_pool is not None:
            old_pool.closeall()
    except Exception:
        pass


class _DBContext:
    """Context manager: commits on success, rolls back on error, returns connection to pool."""

    def __init__(self, connection: Any, readonly: bool = False):
        self._connection = connection
        self._readonly = readonly

    def __enter__(self) -> Any:
        self._t0 = time.perf_counter()
        if self._readonly:
            try:
                self._connection.autocommit = True
            except Exception:
                pass
        return self._connection

    def __exit__(self, exc_type, exc, traceback) -> bool:
        dur = (time.perf_counter() - getattr(self, "_t0", time.perf_counter())) * 1000
        from app.core.timing import record_timing
        record_timing("db_query", dur)
        if self._readonly:
            try:
                if getattr(self._connection, "closed", 1) == 0:
                    self._connection.autocommit = False
            except Exception:
                _release(self._connection, discard=True)
                return False
            _release(self._connection)
            return False

        if exc_type is None:
            try:
                self._connection.commit()
            except Exception:
                _release(self._connection, discard=True)
                return False
            _release(self._connection)
            return False

        try:
            self._connection.rollback()
        except Exception:
            _release(self._connection, discard=True)
            return False
        _release(self._connection)
        return False


def _DBReadContext(connection: Any = None) -> _DBContext:
    """Read-only context manager: autocommit=True, avoids COMMIT WAN roundtrip."""
    return _DBContext(connection or _connect(), readonly=True)


def _rows_to_dicts(rows: list) -> list[dict[str, Any]]:
    return [dict(row) for row in rows]


def cursor_row(cursor) -> dict[str, Any] | None:
    """Return the next row from a cursor as a dict, or None."""
    row = cursor.fetchone()
    return dict(row) if row else None


def cursor_row_as_dict(cursor) -> dict[str, Any] | None:
    """Alias for cursor_row — return next row as dict or None."""
    return cursor_row(cursor)


def _shop_is_orderable(shop: dict[str, Any]) -> bool:
    return (
        shop["approval_status"] == "Approved"
        and bool(shop["present"])
        and shop["status"] == "Open"
    )


# ─── Auto-migrations ─────────────────────────────────────────────────────
from app.core.supabase.migrations import _MIGRATIONS, _apply_migrations



def init_supabase_db() -> bool:
    """Verify connectivity and auto-apply any missing columns (idempotent)."""
    try:
        with _DBContext(_connect()) as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
                cursor.fetchone()
        _apply_migrations()
        logger.info("Supabase Postgres connection verified (auto-migrations applied)")
        return True
    except Exception as e:  # pragma: no cover - network dependent
        logger.error(f"Supabase Postgres connection failed: {e}")
        return False


def ensure_admin_user() -> None:
    """Seed the super admin as a real DB user (role='admin')."""
    email = (settings.DEFAULT_SUPER_ADMIN_EMAIL or "").strip()
    password = settings.DEFAULT_SUPER_ADMIN_PASSWORD or ""
    if not email or not password:
        logger.info("ensure_admin_user: DEFAULT_SUPER_ADMIN_EMAIL/PASSWORD not set — skipping")
        return
    username = email.split("@")[0].lower() or "admin"
    if get_user_by_username(username):
        logger.info(f"ensure_admin_user: admin user already exists ({username}) — skipping")
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
        logger.info(f"ensure_admin_user: created admin '{username}' — reset OTP goes to {email}")
    else:
        logger.warning(f"ensure_admin_user: could not create admin ({conflict}) — {username} may be in use")


def claim_next_whatsapp_log(
    log_ids: list[str], stale_minutes: int = 5
) -> dict[str, Any] | None:
    """Atomically claim the single next DELIVERABLE row, or None."""
    ids = [str(i) for i in (log_ids or []) if str(i).strip()]
    if not ids:
        return None
    with _DBContext(_connect()) as connection:
        with connection.cursor() as cur:
            cur.execute(
                """
                UPDATE whatsapp_logs
                   SET status = 'Sending', claimed_at = NOW()
                 WHERE id = (
                       SELECT id FROM whatsapp_logs
                        WHERE id::text = ANY(%s)
                          AND (
                               status = 'Pending'
                            OR (status = 'Sending'
                                AND (claimed_at IS NULL
                                     OR claimed_at < NOW() - (%s || ' minutes')::interval))
                          )
                        ORDER BY created_at DESC
                        LIMIT 1
                 )
                RETURNING *
                """,
                (ids, int(stale_minutes)),
            )
            row = cur.fetchone()
            return dict(row) if row else None


# ─── Domain operations (re-exported from app.core.supabase modules) ─────────
from app.core.supabase.analytics import (
    get_admin_dashboard_stats,
    get_daily_stats,
    get_orders_by_date,
    get_orders_grouped_by_date,
    get_payments_by_date,
    get_summary,
    get_vendor_daily_logs,
    get_vendor_orders,
)
from app.core.supabase.notifications import (
    NOTIFICATION_LIST_LIMIT,
    create_notification,
    list_actionable_notifications,
    list_notifications,
    list_push_subscriptions,
    list_student_notifications,
    remove_push_subscription,
    save_push_subscription,
    set_notification_action_state,
)
from app.core.supabase.orders import (
    create_order,
    find_order_by_client_ref,
    get_order,
    list_orders,
    list_orders_by_shop,
    list_orders_by_user_id,
    list_recent_orders_by_shop,
    update_order_status,
)
from app.core.supabase.parent_orders import (
    auto_complete_expired_deliveries,
    cancel_parent_order,
    consume_batch_stock,
    consume_token,
    create_parent_order,
    get_current_batch,
    get_daily_token_count,
    get_next_token,
    get_parent_order,
    get_product_stock,
    get_product_stocks,
    get_shop_sub_orders,
    get_sub_order,
    init_batch_stock,
    list_all_sub_orders,
    list_parent_orders,
    release_batch_stock,
    update_parent_order_status,
    update_sub_order_status,
)
from app.core.supabase.payments import (
    bank_sms_seen,
    create_payment,
    get_payment_by_id,
    get_payment_by_order_id,
    get_payment_by_utr,
    get_payment_settings,
    get_payments_map_by_order_ids,
    get_student_notice,
    list_parent_payments,
    list_payments,
    list_payments_by_utr,
    record_parent_payment,
    save_parent_payment_proof,
    save_single_payment_proof,
    settle_payment_if_open,
    set_payment_utr,
    update_payment_settings,
    update_payment_status,
    update_student_notice,
    verify_parent_payment,
    verify_parent_payment_proof,
    verify_single_payment_proof,
)
from app.core.supabase.shops import (
    create_product,
    create_shop,
    delete_product,
    get_product,
    get_shop,
    get_shop_by_phone,
    get_shop_by_shopkeeper_email,
    list_products,
    list_share_payments,
    list_share_payments_by_shop,
    list_shops,
    menu_summary,
    pay_admin_dues,
    record_share_payment,
    remove_shop,
    suspend_shop,
    update_product,
    update_share_payment_status,
    update_shop,
)
from app.core.supabase.support import (
    add_audit_log,
    create_complaint,
    create_menu_change_request,
    create_refund,
    create_review,
    create_shop_announcement,
    create_site_feedback,
    create_ticket,
    delete_site_feedback,
    list_audit_logs,
    list_complaints,
    list_menu_change_requests,
    list_refunds,
    list_reviews,
    list_reviews_by_user,
    list_settlements,
    list_shop_announcements,
    list_site_feedback,
    list_site_feedback_by_user,
    list_sms_logs,
    list_tickets,
    list_tickets_for_user,
    list_whatsapp_logs,
    log_sms,
    log_whatsapp,
    mark_whatsapp_sent,
    run_daily_settlements,
    toggle_shop_announcement,
    update_complaint,
    update_menu_change_request,
    update_refund,
    update_site_feedback_status,
    update_whatsapp_message,
)
from app.core.supabase.users import (
    bump_password_reset_attempts,
    create_password_reset,
    delete_user,
    get_password_reset,
    get_user_by_email,
    get_user_by_id,
    get_user_by_username,
    get_user_overview,
    invalidate_password_resets,
    list_registrations,
    list_users,
    list_users_by_role,
    record_registration,
    register_user,
    save_session,
    set_user_status,
    update_user_admin,
    update_user_password,
    update_user_profile,
)
