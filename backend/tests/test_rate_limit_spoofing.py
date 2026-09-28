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
