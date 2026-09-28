"""
In-memory rate limiter for authentication endpoints.

Prevents brute-force password guessing and mass account creation without
adding a Redis dependency. The limiter is per (purpose, key) and IPv4/IPv6
host — enough for a campus-scale deployment behind Vercel.

Trade-off: memory-only state resets on cold starts, and behind a shared NAT
multiple students share an IPv4 address. The limits are chosen generously so
legitimate campus users are never blocked while still throttling attacks.
"""

import re
import threading
import time
from collections import defaultdict
from typing import Pattern  # noqa: F401  (kept for type readability)

from app.core.config import settings

_lock = threading.Lock()
_hits: dict[str, list[float]] = defaultdict(list)

# A bucket key has to look like an address and stay short: it becomes a dict key,
# so an unbounded header value would be a cheap way to grow this map's memory.
_IP_LIKE = re.compile(r"^(?:\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]{2,45}$")
_MAX_IP_LEN = 45


def _key(purpose: str, ident: str) -> str:
    return f"{purpose}:{ident}"


def allow(purpose: str, ident: str, *, max_attempts: int, window_sec: int = 300) -> bool:
    """Record one attempt; return True when it is within the allowed quota."""
    now = time.time()
    key = _key(purpose, ident)
    with _lock:
        recent = [t for t in _hits[key] if now - t < window_sec]
        _hits[key] = recent
        if len(recent) >= max_attempts:
            return False
        recent.append(now)
        _hits[key] = recent
        return True


def reset(purpose: str, ident: str) -> None:
    """Forget past attempts (e.g. after a successful login)."""
    with _lock:
        _hits.pop(_key(purpose, ident), None)


def client_ip(request) -> str:
    """The client address to bucket a rate limit by.

    PENTEST FIX (1st pass): this used to take the FIRST ``x-forwarded-for``
    entry. That header is supplied by the caller, so rotating it minted a fresh
    bucket per request and bypassed *every* limit in the app - proven live: 10
    login attempts with a different spoofed XFF each produced zero 429s.

    PENTEST FIX (2nd pass — this one): moving to the LAST entry is not enough on
    its own. A header with a SINGLE value carries no proxy-appended hop, so
    ``entries[-1]`` is still whatever the attacker typed. Rotating
    ``X-Forwarded-For: 1.2.3.4`` per request produced zero 429s across 70 live
    attempts, leaving the login lockout and the agent-key throttle decorative.

    The rule now: trust the forwarded header only when it carries MORE THAN ONE
    hop — i.e. a proxy appended the real address to a client-supplied chain,
    which is exactly what the Vercel and Render edges do — and take the last of
    those. A lone or malformed header falls back to the socket peer, which the
    caller cannot set. Set ``TRUST_PROXY_HEADERS=true`` ONLY when a single-hop
    header is written by your own trusted proxy.
    """
    peer = request.client.host if request.client else ""

    raw = (request.headers.get("x-forwarded-for") or "").strip()
    entries = [e.strip() for e in raw.split(",") if e.strip()]

    if settings.TRUST_PROXY_HEADERS:
        candidate = entries[-1] if entries else ""   # operator override
    elif len(entries) > 1:
        candidate = entries[-1]                     # proxy-appended chain
    else:
        candidate = ""                               # caller-written: ignore

    if candidate and len(candidate) <= _MAX_IP_LEN and _IP_LIKE.match(candidate):
        return candidate
    return peer or "unknown"
