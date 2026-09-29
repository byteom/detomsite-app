"""A stalled dependency must fail fast, never pin a request open.

Production read endpoints (``/shops``, ``/products``, ``/local/summary``) were
observed holding their sockets for minutes while ``/health`` answered in 0.3s.
Three things could pin a request, and each is covered here:

* a Postgres statement that wedges — capped server-side by
  ``DB_STATEMENT_TIMEOUT_MS`` on every pooled connection;
* a shared-cache lookup that hangs — the Redis and Postgres ``app_cache`` hops
  are now bounded, so a stuck cache degrades to a miss instead of a hang;
* one dead connection tearing the pool down — which made every in-flight
  request pay a fresh TLS handshake, turning a blip into an outage.
"""
from __future__ import annotations

import asyncio
import time

import pytest

from app.core import read_cache, shared_cache, supabase_db, ttl_cache
from app.core.config import settings


def _clear_memory_cache() -> None:
    """Drop the in-process layer so each test starts on a genuine miss."""
    try:
        ttl_cache.clear()
    except Exception:
        pass


# ─── statement_timeout ──────────────────────────────────────────────────────

def test_pool_connections_carry_a_server_side_statement_timeout():
    kwargs = supabase_db._pool_connect_kwargs()
    assert "statement_timeout=" in kwargs["options"]
    assert str(settings.DB_STATEMENT_TIMEOUT_MS) in kwargs["options"]
    # A connect timeout must always be set, even for a DSN that omits one.
    assert kwargs["connect_timeout"] > 0


def test_statement_timeout_respects_the_configured_budget(monkeypatch):
    monkeypatch.setattr(settings, "DB_STATEMENT_TIMEOUT_MS", 4500, raising=False)
    assert "statement_timeout=4500" in supabase_db._pool_connect_kwargs()["options"]


def test_statement_timeout_keeps_options_already_in_the_dsn(monkeypatch):
    monkeypatch.setattr(
        supabase_db, "_connection_string",
        lambda: "postgresql://u:p@h:5432/db?options=-c%20statement_timeout=999999",
    )
    options = supabase_db._pool_connect_kwargs()["options"]
    assert "statement_timeout=999999" in options  # the operator's value survives
    assert f"-c statement_timeout={settings.DB_STATEMENT_TIMEOUT_MS}" in options


def test_statement_timeout_is_found_in_a_key_value_dsn(monkeypatch):
    monkeypatch.setattr(
        supabase_db, "_connection_string",
        lambda: "host=h port=5432 dbname=db options='-c search_path=detomsite'",
    )
    options = supabase_db._pool_connect_kwargs()["options"]
    assert "-c search_path=detomsite" in options
    assert f"-c statement_timeout={settings.DB_STATEMENT_TIMEOUT_MS}" in options


# ─── one dead connection must not sink the pool ─────────────────────────────

class _FakeConn:
    def __init__(self, closed=1):
        self.closed = closed
        self.close_calls = 0

    def close(self):
        self.close_calls += 1
        self.closed = 1


class _FakePool:
    def __init__(self):
        self.putconn_calls = []

    def putconn(self, conn=None, close=False):
        # psycopg2 closes the connection itself when asked to.
        self.putconn_calls.append((conn, close))
        if close:
            conn.close()

    def closeall(self):
        raise AssertionError("one dead connection must not close the whole pool")


def test_release_discards_one_dead_connection_and_keeps_the_pool(monkeypatch):
    pool = _FakePool()
    monkeypatch.setattr(supabase_db, "_get_pool", lambda: pool)
    monkeypatch.setattr(
        supabase_db, "_rebuild_pool",
        lambda: pytest.fail("rebuilding the whole pool is the stampede we removed"),
    )
    conn = _FakeConn(closed=1)
    supabase_db._release(conn)
    assert pool.putconn_calls == [(conn, True)]
    assert conn.close_calls >= 1


def test_release_returns_a_healthy_connection_untouched(monkeypatch):
    pool = _FakePool()
    monkeypatch.setattr(supabase_db, "_get_pool", lambda: pool)
    conn = _FakeConn(closed=0)
    supabase_db._release(conn)
    assert pool.putconn_calls == [(conn, False)]
    assert conn.close_calls == 0


# ─── a hanging cache is a miss, not a hang ──────────────────────────────────

async def test_cached_read_falls_through_when_redis_hangs(monkeypatch):
    _clear_memory_cache()
    monkeypatch.setattr(settings, "CACHE_LOOKUP_TIMEOUT_SECONDS", 0.05, raising=False)
    monkeypatch.setattr(shared_cache, "enabled", lambda: False)

    async def _hang(_key):
        await asyncio.sleep(30)
        return "should never be reached"

    monkeypatch.setattr(read_cache.redis_cache, "get", _hang)

    started = time.monotonic()
    result = await read_cache.cached_read(60.0, "timeout-test-redis", lambda: ["from-loader"])
    elapsed = time.monotonic() - started

    assert result == ["from-loader"]
    assert elapsed < 5, "the read waited on a dead cache instead of falling through"


async def test_cached_read_falls_through_when_the_postgres_cache_hangs(monkeypatch):
    _clear_memory_cache()
    monkeypatch.setattr(settings, "CACHE_LOOKUP_TIMEOUT_SECONDS", 0.05, raising=False)

    async def _redis_miss(_key):
        return None

    def _pg_hang(_key):
        time.sleep(30)  # blocks a worker thread, like a real stuck query
        return "should never be reached"

    monkeypatch.setattr(read_cache.redis_cache, "get", _redis_miss)
    monkeypatch.setattr(shared_cache, "enabled", lambda: True)
    monkeypatch.setattr(shared_cache, "get", _pg_hang)

    started = time.monotonic()
    result = await read_cache.cached_read(60.0, "timeout-test-pg", lambda: ["from-loader"])
    elapsed = time.monotonic() - started

    assert result == ["from-loader"]
    assert elapsed < 5, "a stuck app_cache lookup must not hold the request"


async def test_a_broken_cache_never_breaks_the_read(monkeypatch):
    _clear_memory_cache()
    monkeypatch.setattr(shared_cache, "enabled", lambda: True)

    async def _redis_boom(_key):
        raise RuntimeError("redis exploded")

    def _pg_boom(_key):
        raise RuntimeError("app_cache exploded")

    monkeypatch.setattr(read_cache.redis_cache, "get", _redis_boom)
    monkeypatch.setattr(shared_cache, "get", _pg_boom)

    result = await read_cache.cached_read(60.0, "timeout-test-boom", lambda: ["from-loader"])
    assert result == ["from-loader"]


async def test_a_warm_cache_hit_is_still_served_without_the_loader(monkeypatch):
    _clear_memory_cache()
    monkeypatch.setattr(settings, "CACHE_LOOKUP_TIMEOUT_SECONDS", 5.0, raising=False)
    monkeypatch.setattr(shared_cache, "enabled", lambda: False)

    async def _hit(_key):
        return ["from-cache"]

    monkeypatch.setattr(read_cache.redis_cache, "get", _hit)

    def _loader():
        raise AssertionError("the loader must not run on a cache hit")

    assert await read_cache.cached_read(60.0, "timeout-test-hit", _loader) == ["from-cache"]

