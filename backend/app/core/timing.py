"""
Lightweight production-safe request timing instrumentation.
Records duration for Server-Timing header without overhead or sensitive data leaks.
"""
from __future__ import annotations

import contextvars
import time
from contextlib import contextmanager
from typing import Generator

# ContextVar storing per-request stage timings in milliseconds
_request_timings: contextvars.ContextVar[dict[str, float] | None] = contextvars.ContextVar(
    "request_timings", default=None
)


def init_request_timing() -> dict[str, float]:
    """Initialize a timing accumulator for the current request."""
    timings: dict[str, float] = {}
    _request_timings.set(timings)
    return timings


def get_request_timing() -> dict[str, float] | None:
    """Get the timing accumulator for the current request."""
    return _request_timings.get()


def record_timing(stage: str, duration_ms: float) -> None:
    """Add duration in milliseconds to a named stage."""
    t = _request_timings.get()
    if t is not None:
        t[stage] = t.get(stage, 0.0) + duration_ms


@contextmanager
def time_stage(stage: str) -> Generator[None, None, None]:
    """Context manager to measure the execution time of a code block."""
    t0 = time.perf_counter()
    try:
        yield
    finally:
        record_timing(stage, (time.perf_counter() - t0) * 1000)
