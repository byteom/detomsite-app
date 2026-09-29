"""Supabase-only routing and startup regression tests (no network access)."""
import re

import pytest
from pydantic import ValidationError

from app.core import store as store_module, supabase_db
from app.core.config import Settings
from app.main import app, lifespan


def test_store_always_targets_supabase(monkeypatch):
    monkeypatch.setattr(store_module, "_test_store", None)
    monkeypatch.setenv("USE_LOCAL_DB", "True")
    monkeypatch.setenv("USE_TURSO_DB", "True")
    monkeypatch.setenv("USE_SUPABASE_DB", "False")
    assert store_module.store._target() is supabase_db


def test_missing_database_settings_warn_but_boot():
    # A missing DB URL must NEVER crash the import/cold-start (that turns every
    # route into a 404/DEPLOYMENT_NOT_FOUND page on Vercel). Settings boot with
    # a warning and requests fail with a clear message instead. This test uses
    # DEBUG=True so no production-URL checks interfere.
    s = Settings(_env_file=None, DEBUG=True, JWT_SECRET="test-only",
                 SUPABASE_DATABASE_URL="", SUPABASE_DB_HOST="",
                 SUPABASE_DB_PASSWORD="")
    assert s.SUPABASE_DATABASE_URL == ""


def test_failed_initialization_does_not_seed_admin(monkeypatch):
    monkeypatch.setattr(supabase_db, "init_supabase_db", lambda: False)

    def unexpected_seed():
        pytest.fail("Must not seed an unavailable database")

    monkeypatch.setattr(supabase_db, "ensure_admin_user", unexpected_seed)
    assert store_module.init_store() is False


async def test_startup_serves_anyway_when_supabase_down(monkeypatch):
    # A cold Supabase pooler hiccup must NOT kill the whole serverless instance
    # (the old behaviour raised and every route became a 404 page). The app now
    # boots anyway; requests fail with a clear 503/513 message instead.
    monkeypatch.setattr(store_module, "init_store", lambda: False)
    import app.main as main

    async def no_background_work():
        return

    monkeypatch.setattr(main, "keep_alive_loop", no_background_work)
    monkeypatch.setattr(main, "auto_delivery_loop", no_background_work)
    async with lifespan(app):
        pass  # must not raise


async def test_successful_lifespan_and_health(monkeypatch, client):
    monkeypatch.setattr(store_module, "init_store", lambda: True)
    # Disable external self-pings for this isolated startup check.
    import app.main as main

    async def no_background_work():
        return

    monkeypatch.setattr(main, "keep_alive_loop", no_background_work)
    monkeypatch.setattr(main, "auto_delivery_loop", no_background_work)
    async with lifespan(app):
        response = await client.get("/health")
        assert response.status_code == 200


class _PostgresStyleCursor:
    """Cursor that names result columns the way psycopg2 does.

    The detail that matters is the products count: Postgres reports an
    *unaliased* aggregate under its function name — ``count`` — never the
    literal ``COUNT(*)``. The SQLite demo store the rest of the suite runs on
    keeps the literal name, so a query written against SQLite's naming passes
    every test and still explodes in production. This cursor derives the column
    names from the SQL (aliases are honoured, everything else gets the Postgres
    default), so the endpoints are exercised against the driver's real naming.
    """

    def __init__(self, executed: list[str]):
        self.executed = executed
        self._row: dict | None = None

    @staticmethod
    def _select_list(sql: str) -> list[str]:
        """Split the SELECT list on top-level commas (parens-aware)."""
        body = sql[sql.lower().index("select") + len("select"):]
        lowered = body.lower()
        if " from " in lowered:
            body = body[: lowered.index(" from ")]
        items, depth, current = [], 0, ""
        for char in body:
            if char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
            if char == "," and depth == 0:
                items.append(current)
                current = ""
            else:
                current += char
        items.append(current)
        return [item.strip() for item in items if item.strip()]

    @classmethod
    def _column_name(cls, item: str) -> str:
        aliased = re.search(r"\bas\s+(\w+)\s*$", item, re.IGNORECASE)
        if aliased:
            return aliased.group(1).lower()
        # No alias: Postgres falls back to the function/column name it can see.
        bare = re.match(r"[a-z_]+", item, re.IGNORECASE)
        return (bare.group(0) if bare else item).lower()

    def execute(self, sql: str, params=None):  # noqa: ARG002 - signature parity
        self.executed.append(sql)
        names = [self._column_name(item) for item in self._select_list(sql)]
        # Positional values, so an assertion pins which column was read.
        self._row = {name: index + 1 for index, name in enumerate(names)}

    def fetchone(self):
        return self._row

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False


class _PostgresStyleConnection:
    def __init__(self, executed: list[str]):
        self._executed = executed

    def cursor(self):
        return _PostgresStyleCursor(self._executed)


def test_get_summary_reads_the_columns_postgres_reports(monkeypatch):
    """``get_summary`` must work with the column names psycopg2 reports.

    Regression: the products count was read as ``row["COUNT(*)"]``. Postgres
    reports that unaliased column as ``count``, so ``db.get_summary()`` raised
    KeyError and the error middleware turned every admin call to
    ``GET /api/v1/local/summary`` into a 500. A fake cursor that names columns
    the way the real driver does is what catches this class of bug — the SQLite
    demo store is too forgiving to.
    """
    executed: list[str] = []
    monkeypatch.setattr(supabase_db, "_connect", lambda: _PostgresStyleConnection(executed))
    monkeypatch.setattr(supabase_db, "_release", lambda connection: None)

    summary = supabase_db.get_summary()

    # shops query: `AS n`, `AS open_n`; orders: `AS active`, `AS revenue`;
    # products: aliased count. Values are the column's 1-based position.
    assert summary["shops"] == 1
    assert summary["orderable_shops"] == 2
    assert summary["active_orders"] == 1
    assert summary["revenue"] == 2
    assert summary["products"] == 1  # KeyError here is the production 500
    assert len(executed) == 3


