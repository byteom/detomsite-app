"""Regression tests for the rate-limit bypass found by scripts/pentest.py.

The first pentest pass moved the bucket to the LAST x-forwarded-for hop, which
still left the whole limiter bypassable: a header with a SINGLE value has no
proxy-appended hop, so ``entries[-1]`` is exactly what the attacker typed.
Rotating the header per request produced zero 429s. These tests pin the
corrected behaviour in both directions - it must resist a forged single-hop
header, and it must still separate genuine users behind a real proxy.
"""
from app.core.rate_limit import client_ip, reset

import pytest


class _Client:
    def __init__(self, host="10.0.0.9"):
        self.host = host


class _Req:
    def __init__(self, xff=None, host="10.0.0.9"):
        self.headers = {} if xff is None else {"x-forwarded-for": xff}
        self.client = _Client(host)


def test_forged_single_hop_header_cannot_choose_the_bucket():
    """A lone header is caller-written, so it must not decide the bucket."""
    peer = _Req(host="10.0.0.9")
    for i in range(50):
        assert client_ip(_Req(xff=f"1.2.3.{i}")) == "10.0.0.9", f"header {i} was trusted"
    assert client_ip(peer) == "10.0.0.9"


def test_proxy_appended_chain_uses_the_last_hop():
    """Vercel/Render append the real address, so the last hop IS trusted."""
    assert client_ip(_Req(xff="1.2.3.4, 203.0.113.9")) == "203.0.113.9"
    assert client_ip(_Req(xff="1.2.3.4, 10.1.1.1, 203.0.113.9")) == "203.0.113.9"


def test_operator_override_trusts_a_single_hop(monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "TRUST_PROXY_HEADERS", True, raising=False)
    assert client_ip(_Req(xff="1.2.3.4")) == "1.2.3.4"


@pytest.mark.parametrize("bad", ["", "   ", ",,,", "not-an-ip", "1.2.3.4, evil", "x" * 500])
def test_malformed_headers_never_win(bad):
    """A junk chain must fall back to the peer, never to attacker text."""
    assert client_ip(_Req(xff=bad)) == "10.0.0.9"


def test_absent_header_uses_the_peer():
    assert client_ip(_Req()) == "10.0.0.9"


def test_reset_clears_a_bucket():
    reset("t", "k")
    assert reset("t", "k") is None   # idempotent, no exception on a fresh key


# ── Unbounded bucket growth (finding 16) ───────────────────────────────────
#
# ``allow()`` only ever pruned the ONE bucket it was touching, so a key that was
# never touched again lived for the lifetime of the process. The login limiter
# is keyed ``f"{username}:{ip}"``, and the username is caller-chosen, so an
# unauthenticated flood of distinct usernames grew the map by one permanent
# entry each — measured 5,000 requests → 5,000 surviving entries.


def test_flooding_distinct_keys_cannot_grow_the_map_without_bound(monkeypatch):
    from app.core import rate_limit

    monkeypatch.setattr(rate_limit, "_MAX_BUCKETS", 200)
    rate_limit._hits.clear()
    try:
        for i in range(2000):
            rate_limit.allow("login", f"attacker_{i}:1.2.3.4", max_attempts=40, window_sec=300)
        assert len(rate_limit._hits) <= 200
    finally:
        rate_limit._hits.clear()


def test_the_cap_does_not_weaken_the_throttle_for_existing_keys(monkeypatch):
    """At the cap a NEW key is untracked, but a known key is still enforced.

    Failing open for the overflow key is safe (these are throttles, not
    authentication), but a real user's bucket must keep counting normally.
    """
    from app.core import rate_limit

    monkeypatch.setattr(rate_limit, "_MAX_BUCKETS", 3)
    rate_limit._hits.clear()
    try:
        results = [
            rate_limit.allow("t", "real:1.2.3.4", max_attempts=3, window_sec=300)
            for _ in range(4)
        ]
        assert results == [True, True, True, False]
    finally:
        rate_limit._hits.clear()


def test_stale_buckets_are_swept(monkeypatch):
    """A bucket whose hits have all aged out is collected, a live one is kept."""
    import time

    from app.core import rate_limit

    rate_limit._hits.clear()
    try:
        rate_limit.allow("t", "old:1.2.3.4", max_attempts=5, window_sec=300)
        # Backdate past the LONGEST window this process has seen, not just this
        # call's 300s. ``_sweep`` conservatively ages buckets by the largest
        # window any caller registered, so a test that assumed 300s passed in
        # isolation and failed in the full suite, where an earlier test had
        # already registered the 3600s bank_match window.
        age = max(rate_limit._longest_window_seen, 300) + 60
        rate_limit._hits["t:old:1.2.3.4"] = [time.time() - age]
        monkeypatch.setattr(rate_limit, "_last_sweep", 0.0, raising=False)
        rate_limit.allow("t", "new:1.2.3.4", max_attempts=5, window_sec=300)
        assert "t:old:1.2.3.4" not in rate_limit._hits
        assert "t:new:1.2.3.4" in rate_limit._hits
    finally:
        rate_limit._hits.clear()
