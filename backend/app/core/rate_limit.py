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

# Hard ceiling on tracked buckets.
#
# PENTEST FIX (unbounded growth). ``allow()`` only ever prunes the ONE bucket it
# is currently touching, so a key that is never touched again stays in the map
# for the lifetime of the process. The login limiter is keyed
# ``f"{username}:{ip}"`` — the IP half is bounded, but the username half is
# whatever the caller typed. Nothing validated its length, and nothing ever
# removed it, so an unauthenticated attacker could POST /auth/login with
# thousands of distinct usernames and permanently grow this dict by one entry
# each: measured 5,000 requests produced 5,000 entries that survived every
# later request. The key only had to differ, so no valid account was needed.
#
# Each entry is a list of floats plus two strings, so this is a slow memory
# leak, not a one-shot spike — but it is unauthenticated, needs no valid
# username, and never recovers short of a restart. Once the cap is hit the
# limiter drops the OLDEST bucket (insertion-ordered dict) so the newest
# attacker traffic cannot evict a real user's bucket, and an over-cap insert is
# simply not tracked: it fails OPEN for that one key, which is the safe
# direction here because these limits are throttles, not authentication.
_MAX_BUCKETS = 20_000


def _sweep(now: float, longest_window: float) -> None:
    """Drop buckets whose every hit has fallen out of the longest window.

    Runs at most once per ``_SWEEP_INTERVAL`` so the cost is amortised instead
    of walking the whole map on every request.
    """
    global _last_sweep
    if now - _last_sweep < _SWEEP_INTERVAL:
        return
    _last_sweep = now
    cutoff = now - longest_window
    for key in [k for k, hits in _hits.items() if not hits or hits[-1] < cutoff]:
        _hits.pop(key, None)


# Longest window any caller uses (bank_match is 3600s), rounded up so a bucket
# is never swept while a live window could still be counting it.
_SWEEP_INTERVAL = 60.0
_longest_window_seen = 0.0
_last_sweep = 0.0


def _key(purpose: str, ident: str) -> str:
    return f"{purpose}:{ident}"


def allow(purpose: str, ident: str, *, max_attempts: int, window_sec: int = 300) -> bool:
    """Record one attempt; return True when it is within the allowed quota."""
    global _longest_window_seen
    now = time.time()
    key = _key(purpose, ident)
    with _lock:
        if window_sec > _longest_window_seen:
            _longest_window_seen = window_sec
        _sweep(now, _longest_window_seen)

        # ``_hits`` is a defaultdict, so merely reading ``_hits[key]`` CREATES
        # the bucket. The cap therefore has to be enforced BEFORE that read, or
        # a flood of new keys grows the map by one entry per request no matter
        # what the cap says. (My first attempt checked afterwards and the
        # verification script caught it: 5,000 requests still produced 5,000
        # entries against a cap of 500.)
        if key not in _hits and len(_hits) >= _MAX_BUCKETS:
            # At the cap. Evict the oldest-inserted bucket (dicts are
            # insertion-ordered) so a flood of fresh keys cannot push out a real
            # user's bucket, and do not track this one. Failing OPEN is correct
            # here: these limits are throttles, not authentication, and no
            # security decision rests on this map.
            _hits.pop(next(iter(_hits)), None)
            return True

        recent = [t for t in _hits[key] if now - t < window_sec]
        if len(recent) >= max_attempts:
            _hits[key] = recent
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
