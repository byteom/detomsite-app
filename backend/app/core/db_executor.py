"""Dedicated worker pool for blocking database work.

Every portal read used to run through ``asyncio.to_thread``, i.e. the
process-wide DEFAULT executor (12 threads on an 8-CPU box). That pool is
shared with everything else the loop throws at it — the 60 s
auto-confirm sweep, checkout fan-out (up to 7 threads per request),
StrictMode dev double-mounts, password hashing — so one busy minute queued
*unrelated* endpoints behind each other. The backend logs proved it:
different endpoints (shops/batch/menu-summary, notifications/notice)
finishing with IDENTICAL multi-second durations, which is only possible
when they waited in the same queue and then each ran fast.

WAN-bound DB threads spend their lives parked on I/O, so a dedicated pool
sized for concurrency (not CPUs) ends the queueing without meaningful
memory cost. The default executor is left for genuinely trivial work.
Overridable via ``DB_IO_WORKERS`` for very small hosts.
"""
from __future__ import annotations

import asyncio
import functools
import os
from concurrent.futures import ThreadPoolExecutor

_pool: ThreadPoolExecutor | None = None


def _max_workers() -> int:
    # Sized from the DB pool, not CPUs: WAN-bound DB threads park on I/O, but
    # every worker beyond DB_POOL_MAX only queues on the pool (default pool is
    # 10 — see supabase_db._POOL_MAX, shared across Vercel instances against a
    # 60-connection Supabase budget). FastAPI docs recommend running blocking
    # DB calls on a threadpool via run_in_executor / def endpoints; the pool
    # here is that dedicated threadpool (never the default executor), kept at
    # pool+4 so checkout storms fail fast with retryable 503 instead of
    # queueing unrelated endpoints behind each other.
    try:
        pool_max = max(4, int(os.environ.get("DB_POOL_MAX", "10")))
    except (TypeError, ValueError):
        pool_max = 10
    try:
        override = os.environ.get("DB_IO_WORKERS")
        if override:
            return max(8, int(override))
    except (TypeError, ValueError):
        pass
    return pool_max + 4


def db_executor() -> ThreadPoolExecutor:
    """Process-wide executor for blocking store calls (thread-safe, lazy)."""
    global _pool
    if _pool is None:
        _pool = ThreadPoolExecutor(
            max_workers=_max_workers(), thread_name_prefix="db-io"
        )
    return _pool


async def run_db(fn, *args, **kwargs):
    """Run a blocking callable on the DB pool and return its result."""
    loop = asyncio.get_running_loop()
    # run_in_executor takes no kwargs — fold them in with partial.
    call = functools.partial(fn, *args, **kwargs)
    return await loop.run_in_executor(db_executor(), call)
