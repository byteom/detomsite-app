"""Unit tests for the Cloudinary + Telegram services (no network).

These pin the production-critical contracts without touching the API:
* screenshot validation (magic bytes + Pillow + size cap);
* Telegram sends never raise and never fire without configuration;
* the admin deep-link prefers the split admin portal and never leaks secrets;
* user content is HTML-escaped in admin messages.
"""
import io

import pytest


def _png(color=(0, 128, 0), size=(16, 16)) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="PNG")
    return buf.getvalue()


def _jpeg() -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (16, 16), (0, 0, 255)).save(buf, format="JPEG")
    return buf.getvalue()


class TestCloudinaryValidation:
    def test_valid_images_pass(self):
        from app.services import cloudinary_service as cs

        assert cs.validate_image_bytes(_png()) == "png"
        assert cs.validate_image_bytes(_jpeg()) == "jpeg"

    def test_wrong_extension_content_is_rejected(self):
        """Magic bytes win: a script renamed to .png must not pass."""
        from app.services import cloudinary_service as cs

        with pytest.raises(ValueError):
            cs.validate_image_bytes(b"#!/bin/bash\necho pwned")
        with pytest.raises(ValueError):
            cs.validate_image_bytes(b"\x89PNG\r\n\x1a\n12345")

    def test_empty_and_oversize_are_rejected(self):
        from app.services import cloudinary_service as cs

        with pytest.raises(ValueError):
            cs.validate_image_bytes(b"")
        with pytest.raises(ValueError):
            cs.validate_image_bytes(b"x" * (cs.max_bytes() + 1))

    def test_sniff_types(self):
        from app.services import cloudinary_service as cs

        assert cs.sniff_image_type(_png()) == "png"
        assert cs.sniff_image_type(_jpeg()) == "jpeg"
        assert cs.sniff_image_type(b"RIFF\x00\x00\x00\x00WEBPxxxx") == "webp"
        assert cs.sniff_image_type(b"GIF89a...") is None

    def test_unconfigured_upload_raises_without_network(self, monkeypatch):
        from app.services import cloudinary_service as cs
        from app.core.config import settings

        monkeypatch.setattr(settings, "CLOUDINARY_CLOUD_NAME", "")
        assert cs.is_configured() is False
        with pytest.raises(RuntimeError):
            cs.upload_image(_png(), folder="payments/x", public_id="proof-x")


class TestTelegramService:
    def test_sends_nothing_without_configuration(self, monkeypatch):
        from app.services import telegram_service as tg
        from app.core.config import settings

        monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", "")
        monkeypatch.setattr(settings, "TELEGRAM_ADMIN_CHAT_ID", "")
        assert tg.is_configured() is False
        # Must return False, never raise, and never touch the network.
        assert tg.send_message("hello") is False

    def test_network_failure_returns_false(self, monkeypatch):
        from app.services import telegram_service as tg
        from app.core.config import settings

        monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", "dummy")
        monkeypatch.setattr(settings, "TELEGRAM_ADMIN_CHAT_ID", "123")

        def boom(*a, **k):
            raise ConnectionError("offline")

        monkeypatch.setattr(tg.httpx, "Client", lambda *a, **k: (_ for _ in ()).throw(ConnectionError("offline")))
        assert tg.send_message("hello") is False

    def test_rate_limit_returns_false(self, monkeypatch):
        from app.services import telegram_service as tg
        from app.core.config import settings

        monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", "dummy")
        monkeypatch.setattr(settings, "TELEGRAM_ADMIN_CHAT_ID", "123")

        class Resp:
            status_code = 429

            def json(self):
                return {"parameters": {"retry_after": 5}}

            text = "too many"

        class Client:
            def __init__(self, *a, **k):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def post(self, *a, **k):
                return Resp()

        monkeypatch.setattr(tg.httpx, "Client", Client)
        assert tg.send_message("hello") is False

    def test_button_dropped_for_localhost_kept_for_public(self, monkeypatch):
        from app.services import telegram_service as tg
        from app.core.config import settings

        # Local dev base → button dropped (Telegram would 400 the whole send).
        monkeypatch.setattr(settings, "ADMIN_PORTAL_URL", "")
        monkeypatch.setattr(settings, "FRONTEND_URL", "http://localhost:5173")
        assert tg._view_order_markup("p1") is None
        # Deployed admin portal → button kept.
        monkeypatch.setattr(settings, "ADMIN_PORTAL_URL", "https://admin.example.com")
        markup = tg._view_order_markup("p1")
        assert markup and markup["inline_keyboard"][0][0]["url"] == "https://admin.example.com/orders/p1"

    def test_deep_link_prefers_admin_portal(self, monkeypatch):
        from app.services import telegram_service as tg
        from app.core.config import settings

        monkeypatch.setattr(settings, "ADMIN_PORTAL_URL", "https://admin.example.com")
        monkeypatch.setattr(settings, "FRONTEND_URL", "https://shop.example.com")
        assert tg.admin_order_url("p1") == "https://admin.example.com/orders/p1"

        monkeypatch.setattr(settings, "ADMIN_PORTAL_URL", "")
        monkeypatch.setattr(settings, "ADMIN_ORDER_PATH", "/admin/orders")
        assert tg.admin_order_url("p1") == "https://shop.example.com/admin/orders/p1"

    def test_message_escapes_user_content_and_has_button(self):
        from app.services import telegram_service as tg

        text = tg.build_payment_proof_message(
            customer_name='<script>alert("x")</script>',
            order_id="p20240101-1",
            order_token="42",
            amount=799,
            utr="ABC123",
            item_count=3,
            submitted_at="07 Oct 2026, 09:12 AM",
        )
        assert "<script>" not in text
        assert "&lt;script&gt;" in text
        assert "799" in text and "ABC123" in text
        btn = tg._view_order_button("p20240101-1")
        url = btn["inline_keyboard"][0][0]["url"]
        assert "p20240101-1" in url
        # No secrets in the message or the URL.
        for secret in ("TELEGRAM", "token", "Bearer", "CLOUDINARY"):
            assert secret not in url


class TestTelegramCommands:
    def test_parse_incoming(self):
        from app.services import telegram_service as tg

        assert tg.parse_incoming({}) is None
        assert tg.parse_incoming({"message": {"chat": {"id": 1}, "text": "hello"}}) is None
        assert tg.parse_incoming({"message": {"chat": {"id": 7}, "text": "/start"}}) == ("7", "start")
        assert tg.parse_incoming({"message": {"chat": {"id": 7}, "text": "/help@fooddetomot_bot"}}) == ("7", "help")
        assert tg.parse_incoming({"message": {"chat": {}, "text": "/start"}}) is None
        assert tg.parse_incoming("junk") is None

    def test_command_replies(self, monkeypatch):
        from app.services import telegram_service as tg
        from app.core.config import settings

        monkeypatch.setattr(settings, "TELEGRAM_ADMIN_CHAT_ID", "999")
        start_admin = tg.command_reply("start", "999")
        assert "registered as the admin chat" in start_admin
        start_stranger = tg.command_reply("start", "111")
        assert "chat id is" in start_stranger and "111" in start_stranger
        assert "Commands" in (tg.command_reply("help", "111") or "")
        assert "Unknown command" in (tg.command_reply("dance", "999") or "")
        # /status is admin-only and never leaks counts to strangers.
        assert "only works in the registered admin chat" in (tg.command_reply("status", "111", pending_count=5) or "")
        assert "5" in (tg.command_reply("status", "999", pending_count=5) or "")
        assert "No payment proofs" in (tg.command_reply("status", "999", pending_count=0) or "")

    async def test_webhook_answers_start(self, client, monkeypatch):
        from app.services import telegram_service as tg

        sent = []
        monkeypatch.setattr(tg, "send_message_to", lambda chat, text, **k: sent.append((chat, text)) or True)
        r = await client.post("/api/v1/local/telegram/webhook", json={
            "message": {"chat": {"id": 555}, "text": "/start"},
        })
        assert r.status_code == 200, r.text
        assert sent and sent[0][0] == "555" and "DETOMSITE" in sent[0][1]

    async def test_webhook_silent_on_chatter(self, client, monkeypatch):
        from app.services import telegram_service as tg

        sent = []
        monkeypatch.setattr(tg, "send_message_to", lambda chat, text, **k: sent.append((chat, text)) or True)
        r = await client.post("/api/v1/local/telegram/webhook", json={
            "message": {"chat": {"id": 555}, "text": "hello there"},
        })
        assert r.status_code == 200, r.text
        assert sent == []

    async def test_webhook_secret_gate(self, client, monkeypatch):
        from app.core.config import settings

        monkeypatch.setattr(settings, "TELEGRAM_WEBHOOK_SECRET", "shibboleth")
        body = {"message": {"chat": {"id": 555}, "text": "/start"}}
        assert (await client.post("/api/v1/local/telegram/webhook", json=body)).status_code == 401
        ok = await client.post(
            "/api/v1/local/telegram/webhook", json=body,
            headers={"X-Telegram-Bot-Api-Secret-Token": "shibboleth"},
        )
        assert ok.status_code == 200, ok.text

    async def test_webhook_status_counts_queue(self, client, monkeypatch):
        from app.services import telegram_service as tg
        from app.core.config import settings
        from test_payment_pentest import _submit_proof, _student_with_upi_order

        monkeypatch.setattr(settings, "TELEGRAM_ADMIN_CHAT_ID", "999")
        sent = []
        monkeypatch.setattr(tg, "send_message_to", lambda chat, text, **k: sent.append((chat, text)) or True)
        headers, order, _s, _p = await _student_with_upi_order(client, monkeypatch)
        assert (await _submit_proof(client, monkeypatch, headers, order["id"], "WEBHOOK111222")).status_code == 200
        r = await client.post("/api/v1/local/telegram/webhook", json={
            "message": {"chat": {"id": 999}, "text": "/status"},
        })
        assert r.status_code == 200, r.text
        # sent[0] is the new-proof alert from the submission itself; sent[-1]
        # is the /status reply.
        assert sent and "1 payment proof" in sent[-1][1], sent
