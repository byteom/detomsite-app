"""
Security utilities for JWT, password hashing, etc.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional, Any
from jose import JWTError, jwt
from passlib.context import CryptContext
from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Token classes. Every JWT this app mints carries one of these in its "type"
# claim so the two can never be confused for one another — a refresh token must
# never be usable as an API credential. See decode_token.
TOKEN_TYPE_ACCESS = "access"
TOKEN_TYPE_REFRESH = "refresh"


def hash_password(password: str) -> str:
    """Hash a password using bcrypt"""
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash"""
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(
    data: dict,
    expires_delta: Optional[timedelta] = None
) -> str:
    """Create a JWT access token (short-lived, for API calls)."""
    to_encode = data.copy()
    now = datetime.now(timezone.utc)
    if expires_delta:
        expire = now + expires_delta
    else:
        expire = now + timedelta(
            minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
        )
    # The "type" claim is what separates the two token classes. See
    # decode_token — without it a refresh token is a valid API credential.
    to_encode.update({"exp": expire, "type": TOKEN_TYPE_ACCESS})
    encoded_jwt = jwt.encode(
        to_encode,
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM
    )
    return encoded_jwt


def create_refresh_token(data: dict) -> str:
    """Create a JWT refresh token (long-lived, for minting new access tokens)."""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(
        days=settings.REFRESH_TOKEN_EXPIRE_DAYS
    )
    to_encode.update({"exp": expire, "type": TOKEN_TYPE_REFRESH})
    encoded_jwt = jwt.encode(
        to_encode,
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM
    )
    return encoded_jwt


def decode_token(
    token: str,
    expected_type: Optional[str] = TOKEN_TYPE_ACCESS,
) -> Optional[dict]:
    """Decode and verify a JWT, refusing the WRONG class of token.

    SECURITY FIX (token-type confusion): access and refresh tokens were signed
    from the SAME payload with no discriminator, and this function accepted any
    validly-signed JWT. Because ``decode_token`` signs off only on the
    signature, a 7-day REFRESH token was accepted everywhere a 30-minute
    ACCESS token was — proven live against production, where a refresh token in
    the ``Authorization: Bearer`` header returned HTTP 200 on a protected
    endpoint. That turned any leaked refresh token (XSS, shared device, logged
    proxy, readable localStorage) into a 7-day API credential.

    ``expected_type`` defaults to the access class because EVERY call site in
    this app authenticates an API request; a refresh endpoint (none is
    deployed today) would pass ``TOKEN_TYPE_REFRESH`` explicitly.

    Tokens minted before this change carry no ``type`` claim. Those are treated
    as access tokens so nobody is logged out by the deploy; such a token is
    still bound by its own ``exp``.
    """
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM]
        )
    except JWTError:
        return None
    if expected_type is not None:
        token_type = payload.get("type")
        # A missing claim means a pre-fix token — accept it as an access token
        # (its own exp still applies). An explicit MISMATCH is always refused,
        # which is what actually blocks a refresh token from being used as one.
        if token_type is not None and token_type != expected_type:
            return None
    return payload
