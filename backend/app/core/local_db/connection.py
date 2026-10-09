from __future__ import annotations

import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any

from app.core.config import settings


class _NamedRow(dict):
    def __init__(self, columns: list[str], values: Any):
        super().__init__(zip(columns, values))
        self._values = tuple(values)

    def __getitem__(self, key: Any) -> Any:
        if isinstance(key, int):
            return self._values[key]
        return super().__getitem__(key)


class _NamedRowCursor:
    def __init__(self, cursor: Any):
        self._cursor = cursor

    def _row_to_dict(self, row: Any) -> dict[str, Any] | None:
        if row is None:
            return None
        columns = [column[0] for column in self._cursor.description or []]
        if not columns:
            return row
        return _NamedRow(columns, row)

    @property
    def lastrowid(self) -> Any:
        return getattr(self._cursor, "lastrowid", None)

    def fetchone(self) -> dict[str, Any] | None:
        return self._row_to_dict(self._cursor.fetchone())

    def fetchall(self) -> list[dict[str, Any]]:
        return [self._row_to_dict(row) for row in self._cursor.fetchall()]


class _NamedRowConnection:
    def __init__(self, connection: Any):
        self._connection = connection

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        if exc_type is None:
            self._connection.commit()
        self._connection.close()
        return False

    def execute(self, *args, **kwargs) -> _NamedRowCursor:
        return _NamedRowCursor(self._connection.execute(*args, **kwargs))

    def executemany(self, *args, **kwargs) -> _NamedRowCursor:
        return _NamedRowCursor(self._connection.executemany(*args, **kwargs))

    def executescript(self, *args, **kwargs) -> _NamedRowCursor:
        return _NamedRowCursor(self._connection.executescript(*args, **kwargs))

    def commit(self) -> None:
        self._connection.commit()

    def close(self) -> None:
        self._connection.close()


def _db_path(base_file: Path | str | None = None) -> Path:
    path = Path(settings.LOCAL_DB_PATH)
    if not path.is_absolute():
        origin = Path(base_file) if base_file else Path(__file__)
        # Resolve relative to the backend package dir (backend/)
        # If origin is in app/core/local_db/ -> parents[3] is backend/
        # If origin is in app/core/ -> parents[2] is backend/
        depth = 3 if "local_db" in str(origin) else 2
        path = origin.resolve().parents[depth] / path
    return path


def _connect(base_file: Path | str | None = None) -> Any:
    """Test-only SQLite connection (pytest). Production uses Supabase."""
    connection = sqlite3.connect(_db_path(base_file), timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA synchronous=NORMAL")
    connection.execute("PRAGMA busy_timeout=8000")
    return connection


def _rows_to_dicts(rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
    return [dict(row) for row in rows]


def _next_suffixed_id(connection: Any, table: str, prefix: str) -> str:
    """Allocate the next <prefix><n> primary key for table, safely."""
    next_id = connection.execute(
        f"SELECT COALESCE(MAX(CAST(substr(id, ?) AS INTEGER)), 0) + 1 FROM {table}",
        (len(prefix) + 1,),
    ).fetchone()[0]
    return f"{prefix}{next_id}"


def _insert_with_suffixed_id(
    connection: Any,
    table: str,
    prefix: str,
    insert_sql: str,
    params_for,
    attempts: int = 25,
) -> str:
    """INSERT a row whose id comes from _next_suffixed_id, retrying on collision."""
    last_error: Exception | None = None
    for _ in range(attempts):
        row_id = _next_suffixed_id(connection, table, prefix)
        try:
            connection.execute(insert_sql, params_for(row_id))
            return row_id
        except sqlite3.IntegrityError as exc:
            message = str(exc).lower()
            if "unique" not in message and "primary key" not in message:
                raise
            last_error = exc
            continue
    raise RuntimeError(
        f"Could not allocate a unique id for {table} after {attempts} attempts"
    ) from last_error


def _day_key(now: str | None = None) -> str:
    """YYYY-MM-DD key for daily resets (token, batch stock, settlements)."""
    if now:
        return now[:10]
    return datetime.now().strftime("%Y-%m-%d")


def get_current_batch(now: str | None = None) -> str:
    """Determine current delivery batch by time of day. Afternoon: 9:00-12:30, Night: up to 6 PM."""
    try:
        if now:
            t = datetime.strptime(now[:19], "%Y-%m-%d %H:%M:%S")
        else:
            t = datetime.now()
    except ValueError:
        return "Night"
    hour = t.hour + t.minute / 60.0
    if hour < 12.5:
        return "Afternoon"
    return "Night"


def get_default_stock(product: dict[str, Any]) -> int:
    base = int(product.get("inventory") or 0)
    if base <= 0:
        return 0
    return base


def get_product_stock(product_id: str, batch_type: str, date_key: str | None = None) -> int:
    date_key = date_key or _day_key()
    with _connect() as connection:
        row = connection.execute(
            "SELECT current_stock FROM product_stock WHERE product_id = ? AND batch_type = ? AND date_key = ? ORDER BY id DESC LIMIT 1",
            (product_id, batch_type, date_key),
        ).fetchone()
        if row:
            return int(row["current_stock"])
        product = connection.execute("SELECT inventory FROM products WHERE id = ?", (product_id,)).fetchone()
        return int(product["inventory"]) if product else 0


def get_product_stocks(batch_type: str, date_key: str | None = None) -> dict[str, int]:
    date_key = date_key or _day_key()
    with _connect() as connection:
        rows = connection.execute(
            """SELECT p.id AS pid,
                      COALESCE(
                          (SELECT ps.current_stock FROM product_stock ps
                           WHERE ps.product_id = p.id AND ps.batch_type = ? AND ps.date_key = ?
                           ORDER BY ps.id DESC LIMIT 1),
                          p.inventory
                      ) AS stock_left
                 FROM products p""",
            (batch_type, date_key),
        ).fetchall()
        return {r["pid"]: max(0, int(r["stock_left"])) for r in rows}


def init_batch_stock(product_id: str, batch_type: str, default_stock: int, date_key: str | None = None) -> None:
    date_key = date_key or _day_key()
    with _connect() as connection:
        existing = connection.execute(
            "SELECT id FROM product_stock WHERE product_id = ? AND batch_type = ? AND date_key = ?",
            (product_id, batch_type, date_key),
        ).fetchone()
        if existing:
            return
        connection.execute(
            "INSERT INTO product_stock (product_id, batch_type, default_stock, current_stock, date_key) VALUES (?, ?, ?, ?, ?)",
            (product_id, batch_type, default_stock, default_stock, date_key),
        )


def consume_batch_stock(
    product_id: str,
    batch_type: str,
    qty: int,
    date_key: str | None = None,
    connection: Any | None = None,
) -> bool:
    date_key = date_key or _day_key()

    def _do(db: Any) -> bool:
        product = db.execute("SELECT inventory FROM products WHERE id = ?", (product_id,)).fetchone()
        if not product:
            return False
        row = db.execute(
            "SELECT id, current_stock FROM product_stock WHERE product_id = ? AND batch_type = ? AND date_key = ? ORDER BY id DESC LIMIT 1",
            (product_id, batch_type, date_key),
        ).fetchone()
        if row:
            stock_id, current = row["id"], int(row["current_stock"])
            if current < qty:
                return False
            db.execute(
                "UPDATE product_stock SET current_stock = current_stock - ? WHERE id = ?",
                (qty, stock_id),
            )
        return True

    if connection is not None:
        return _do(connection)
    with _connect() as conn:
        return _do(conn)


def release_batch_stock(
    product_id: str,
    batch_type: str,
    qty: int,
    date_key: str | None = None,
    connection: Any | None = None,
) -> None:
    date_key = date_key or _day_key()

    def _do(db: Any) -> None:
        row = db.execute(
            "SELECT id, current_stock FROM product_stock WHERE product_id = ? AND batch_type = ? AND date_key = ? ORDER BY id DESC LIMIT 1",
            (product_id, batch_type, date_key),
        ).fetchone()
        if row:
            db.execute(
                "UPDATE product_stock SET current_stock = current_stock + ? WHERE id = ?",
                (qty, row["id"]),
            )

    if connection is not None:
        return _do(connection)
    with _connect() as conn:
        return _do(conn)


def get_next_token(connection: Any | None = None) -> int:
    date_key = _day_key()

    def _do(db: Any) -> int:
        value = db.execute(
            "SELECT value FROM app_settings WHERE key = ?", (f"token_base_{date_key}",)
        ).fetchone()
        if value:
            return int(value["value"])
        db.execute(
            "INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)",
            (f"token_base_{date_key}", "18"),
        )
        return 18

    if connection is not None:
        return _do(connection)
    with _connect() as conn:
        return _do(conn)


def consume_token(connection: Any | None = None) -> int:
    date_key = _day_key()

    def _do(db: Any) -> int:
        token = get_next_token(connection=db)
        db.execute(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
            (f"token_base_{date_key}", str(token + 1)),
        )
        return token

    if connection is not None:
        return _do(connection)
    with _connect() as conn:
        return _do(conn)


def _shop_is_orderable(shop: dict[str, Any]) -> bool:
    return (
        shop["approval_status"] == "Approved"
        and bool(shop["present"])
        and shop["status"] == "Open"
    )


def _column_exists(connection: sqlite3.Connection, table_name: str, column_name: str) -> bool:
    rows = connection.execute(f"PRAGMA table_info({table_name})").fetchall()
    return any(row["name"] == column_name for row in rows)
