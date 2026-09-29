"""
Authentication tests — use the /local/auth endpoints, which are registered in
every deployment mode (SQLite / Turso / Supabase). The Mongo-only /auth router
is not mounted in CI, so testing it here would 404.
"""
import pytest


class TestAuth:
    """Authentication endpoint tests"""

    async def test_register(self, client, test_user_data):
        """Test user registration"""
        response = await client.post("/api/v1/local/auth/register", json=test_user_data)
        assert response.status_code in [201, 409]  # 201 created, 409 username exists

    async def test_login(self, client, test_user_data):
        """Test user login (register first so the user exists in CI)"""
        await client.post("/api/v1/local/auth/register", json=test_user_data)
        login_data = {
            "username": test_user_data["username"],
            "password": test_user_data["password"],
        }
        response = await client.post("/api/v1/local/auth/login", json=login_data)
        assert response.status_code == 200
        body = response.json()
        assert body.get("access_token")
        assert body.get("user", {}).get("role") == "student"

    async def test_health_check(self, client):
        """Test health check endpoint"""
        response = await client.get("/health")
        assert response.status_code == 200
        assert "status" in response.json()


class TestTokenTypeConfusion:
    """A refresh token must never work as an API credential.

    SECURITY FIX: access and refresh tokens were signed from the same payload
    with no discriminator, and decode_token accepted any validly-signed JWT —
    proven live against production, where a 7-day refresh token returned
    HTTP 200 in the Authorization header. These lock the fix in place.
    """

    _CREDS = {"username": "tokentype_user", "password": "Tok3nTypePass!"}

    async def _tokens(self, client):
        await client.post("/api/v1/local/auth/register", json={
            "username": self._CREDS["username"], "password": self._CREDS["password"],
            "name": "Token Type", "role": "student", "phone": "+91900001234",
        })
        r = await client.post("/api/v1/local/auth/login", json=self._CREDS)
        assert r.status_code == 200, r.text
        body = r.json()
        return body["access_token"], body["refresh_token"]

    async def test_login_issues_both_token_classes(self, client):
        """Both tokens are issued and they must be distinguishable."""
        access, refresh = await self._tokens(client)
        assert access and refresh and access != refresh

    async def test_access_token_still_works(self, client):
        """The normal path must keep working — this fix must not log anyone out."""
        access, _ = await self._tokens(client)
        r = await client.get("/api/v1/local/auth/me",
                             headers={"Authorization": f"Bearer {access}"})
        assert r.status_code == 200, r.text

    async def test_refresh_token_is_rejected_as_an_access_token(self, client):
        """The core regression: a refresh token must NOT authenticate an API call."""
        _, refresh = await self._tokens(client)
        r = await client.get("/api/v1/local/auth/me",
                             headers={"Authorization": f"Bearer {refresh}"})
        assert r.status_code == 401, (
            f"refresh token was accepted as an access token (HTTP {r.status_code})"
        )

    async def test_refresh_token_cannot_reach_admin_routes(self, client):
        """A refresh token must not carry an admin role claim into an admin route."""
        _, refresh = await self._tokens(client)
        r = await client.get("/api/v1/admin/dashboard",
                             headers={"Authorization": f"Bearer {refresh}"})
        assert r.status_code == 401, f"HTTP {r.status_code}"

    def test_decode_token_rejects_the_wrong_class(self):
        """Unit level: the discriminator itself, independent of any endpoint."""
        from app.core.security import (
            TOKEN_TYPE_ACCESS, TOKEN_TYPE_REFRESH,
            create_access_token, create_refresh_token, decode_token,
        )
        data = {"sub": "1", "username": "u", "role": "admin"}
        access, refresh = create_access_token(data), create_refresh_token(data)
        assert decode_token(access) is not None
        assert decode_token(refresh) is None
        assert decode_token(refresh, expected_type=TOKEN_TYPE_REFRESH) is not None
        assert decode_token(access, expected_type=TOKEN_TYPE_REFRESH) is None

    def test_a_token_minted_before_the_fix_still_works(self):
        """Tokens with no `type` claim predate the fix. They must keep working
        (still bound by their own exp) so the deploy logs nobody out."""
        from datetime import datetime, timedelta, timezone
        from jose import jwt
        from app.core.config import settings
        from app.core.security import decode_token
        legacy = jwt.encode(
            {"sub": "1", "username": "u", "role": "student",
             "exp": datetime.now(timezone.utc) + timedelta(minutes=5)},
            settings.SECRET_KEY, algorithm=settings.ALGORITHM,
        )
        assert decode_token(legacy) is not None
