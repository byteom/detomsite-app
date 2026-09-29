"""Three-layer read cache shared by every portal polling endpoint.

    layer 1  ``ttl_cache``    — per-instance memory (microseconds)
    layer 2  ``redis_cache``  — shared Redis (single-digit ms, warms every instance)
    layer 3  ``shared_cache`` — the Postgres ``app_cache`` table (fallback)
    layer 4  the loader       — the real query

``cached_read`` replaces the hand-rolled copies of this pattern that had drifted
apart across ``local.py`` and ``local_admin.py`` (some wrote only the in-process
layer, some only Postgres) with one predictable order, so a warm Redis is shared
by every serverless instance instead of every instance paying for the same query.

Cache keys embed a SHA-256 digest of the call arguments instead of their raw
``repr``: those arguments include the authenticated user row (name, e-mail,
phone), and a cache store is not the place for personal data. The digest keeps
per-user / per-filter results isolated while persisting no PII.
"""
from __future__ import annotations

import asyncio
import hashlib
import inspect
import logging
import threading
from typing import Any

from app.core import redis_cache, shared_cache, ttl_cache
from app.core.config import settings

logger = logging.getLogger(__name__)


def cache_key(key: str, args: tuple = (), kwargs: dict | None = None) -> str:
    """Namespace ``key`` by a stable digest of the call arguments.

    Two students asking for ``/orders`` must never share an entry, and the raw
    arguments (which carry names and phone numbers) must not be written into a
    shared cache store — hence the digest. ``repr`` of the usual argument types
    (str/int/None/bool/datetime/dict/list rows) is stable across processes, so
    the digest is too and every instance builds the same key.
    """
    if not args and not kwargs:
        return key
    material = f"{args!r}|{sorted((kwargs or {}).items())!r}"
    digest = hashlib.sha256(material.encode("utf-8", "replace")).hexdigest()[:16]
    return f"{key}:{digest}"


def _lookup_timeout() -> float:
    """How long a shared-cache lookup may take before it counts as a miss."""
    try:
        return max(0.05, float(settings.CACHE_LOOKUP_TIMEOUT_SECONDS))
    except (AttributeError, TypeError, ValueError):
        return 2.0


async def _cached_lookup(coro, what: str) -> Any:
    """Await a cache lookup, giving up on it rather than stalling the request.

    Both shared layers are a network hop away (Redis, and the Postgres
    ``app_cache`` table reached through the same pool as the loader), and
    neither is covered by a timeout of its own: ``shared_cache.get`` in
    particular can sit on a pool wait or a slow query indefinitely. That is the
    difference between "the cache was cold" and "the request never came back" —
    observed live, where read endpoints held their sockets open for minutes
    while ``/health`` stayed instant.

    A cache that cannot answer inside the budget is simply a miss: we fall
    through to the loader, which is what this module's own docstring demands
    (a cache must never take the portal down).
    """
    try:
        return await asyncio.wait_for(coro, timeout=_lookup_timeout())
    except asyncio.TimeoutError:
        logger.debug(f"{what} cache lookup exceeded {_lookup_timeout():.2f}s — treating as a miss")
    except Exception as exc:  # a broken cache must never break the read
        logger.debug(f"{what} cache lookup failed ({exc}) — treating as a miss")
    return None


async def cached_read(ttl: float, key: str, loader, *args, **kwargs) -> Any:
    """Return ``loader(*args, **kwargs)``, serving it from a warm cache if possible.

    ``key`` must identify the resource and every argument that changes the
    result (they are folded into the key), otherwise filtered lists cross wires.
    Synchronous loaders (the store) run in a worker thread; an async loader that
    merges several sources is awaited instead — both are supported.
    """
    store_key = cache_key(key, args, kwargs)

    value = ttl_cache.get(store_key)
    if value is not None:
        return value

    value = await _cached_lookup(redis_cache.get(store_key), "redis")
    if value is not None:
        # Promote the shared entry into this instance's memory for free hits.
        ttl_cache.set(store_key, value, ttl)
        return value

    if shared_cache.enabled():
        value = await _cached_lookup(
            asyncio.to_thread(shared_cache.get, store_key), "postgres"
        )
        if value is not None:
            ttl_cache.set(store_key, value, ttl)
            redis_cache.set_pair_bg(store_key, value, ttl)
            return value

    value = await asyncio.to_thread(loader, *args, **kwargs)
    if inspect.isawaitable(value):
        value = await value

    ttl_cache.set(store_key, value, ttl)
    redis_cache.set_pair_bg(store_key, value, ttl)
    if shared_cache.enabled():
        # Fire-and-forget so a cold load never waits on the fallback layer.
        try:
            threading.Thread(
                target=shared_cache.set_pair, args=(store_key, value, ttl), daemon=True
            ).start()
        except Exception as e:
            logger.debug(f"shared cache write skipped: {e}")
    return value


def clear_local() -> None:
    """Drop the in-process layer only — the cheap half of :func:`clear`.

    Used where a caller needs this instance to be fresh *immediately* and the
    shared layers can follow on their own (see ``redis_cache.spawn``).
    """
    ttl_cache.clear()


async def clear() -> None:
    """Invalidate every layer — call after any write to a cached resource."""
    ttl_cache.clear()
    await redis_cache.clear()
    if shared_cache.enabled():
        try:
            await asyncio.to_thread(shared_cache.clear)
        except Exception as e:
            logger.debug(f"shared cache clear skipped: {e}")


def clear_bg() -> None:
    """Schedule :func:`clear` without waiting for the shared stores (never raises).

    The in-process layer is dropped synchronously, so the instance that handled
    the write already serves fresh data; the Redis/Postgres copies follow within
    milliseconds.
    """
    ttl_cache.clear()
    redis_cache.spawn(clear())
