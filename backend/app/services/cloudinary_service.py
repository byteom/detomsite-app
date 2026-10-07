"""Centralised Cloudinary image storage (the app's primary file storage).

All uploads flow through this module — controllers never initialise the
Cloudinary SDK themselves. Credentials come from environment variables only
(``CLOUDINARY_CLOUD_NAME`` / ``CLOUDINARY_API_KEY`` / ``CLOUDINARY_API_SECRET``)
and never leave the server: callers and the frontend only handle the secure
delivery URL + public_id that uploads return.

Payment screenshots are validated (magic-byte MIME sniff + Pillow decode +
size cap) BEFORE upload so a crafted file can never reach the CDN.
"""
import io
import logging
from typing import Any

from app.core.config import settings

logger = logging.getLogger(__name__)

_ALLOWED_IMAGE_TYPES = {"jpeg", "png", "webp"}


def is_configured() -> bool:
    """True when server-side Cloudinary credentials are present."""
    return bool(
        (settings.CLOUDINARY_CLOUD_NAME or "").strip()
        and (settings.CLOUDINARY_API_KEY or "").strip()
        and (settings.CLOUDINARY_API_SECRET or "").strip()
    )


def max_bytes() -> int:
    return max(1, int(settings.PAYMENT_SCREENSHOT_MAX_MB or 5)) * 1024 * 1024


def sniff_image_type(data: bytes) -> str | None:
    """Detect jpeg/png/webp from magic bytes (never trusts the extension)."""
    if not data or len(data) < 12:
        return None
    head = bytes(data[:12])
    if head.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if head.startswith(b"RIFF") and head[8:12] == b"WEBP":
        return "webp"
    return None


def validate_image_bytes(data: bytes, *, limit: int | None = None) -> str:
    """Validate raw upload bytes; returns the detected type or raises ValueError."""
    cap = limit or max_bytes()
    if not data:
        raise ValueError("No file data received.")
    if len(data) > cap:
        raise ValueError(f"Screenshot must be {cap // (1024 * 1024)} MB or smaller.")
    kind = sniff_image_type(data)
    if kind not in _ALLOWED_IMAGE_TYPES:
        raise ValueError("Only JPEG, PNG or WEBP screenshots are accepted.")
    # Decode the pixels — a renamed script with a valid header dies here.
    try:
        from PIL import Image

        with Image.open(io.BytesIO(data)) as img:
            img.verify()
    except Exception as exc:
        raise ValueError("That file is not a readable image.") from exc
    return kind


def _client():
    import cloudinary

    cloudinary.config(
        cloud_name=settings.CLOUDINARY_CLOUD_NAME,
        api_key=settings.CLOUDINARY_API_KEY,
        api_secret=settings.CLOUDINARY_API_SECRET,
        secure=True,
    )
    return cloudinary


def upload_image(data: bytes, *, folder: str, public_id: str) -> dict[str, Any]:
    """Upload validated image bytes. Returns {secure_url, public_id, ...}.

    Raises RuntimeError when Cloudinary is not configured, ValueError for bad
    files, and the SDK error for transport failures (callers map these).
    """
    kind = validate_image_bytes(data)
    if not is_configured():
        raise RuntimeError("Screenshot storage is not configured on this server.")
    prefix = (settings.CLOUDINARY_FOLDER_PREFIX or "detomsite").strip() or "detomsite"
    full_folder = f"{prefix}/{folder.strip('/')}"
    cloudinary = _client()
    import cloudinary.uploader

    try:
        result = cloudinary.uploader.upload(
            io.BytesIO(data),
            folder=full_folder,
            public_id=public_id,
            resource_type="image",
            format=kind if kind != "jpeg" else "jpg",
            overwrite=True,
        )
    except Exception as exc:
        logger.error("Cloudinary upload failed for %s/%s: %s", full_folder, public_id, exc)
        raise
    return {
        "secure_url": result.get("secure_url", ""),
        "public_id": result.get("public_id", ""),
        "format": result.get("format", ""),
        "bytes": result.get("bytes", 0),
    }


def delete_image(public_id: str) -> bool:
    """Delete one asset by public_id (used when a proof is replaced)."""
    if not is_configured() or not public_id:
        return False
    try:
        import cloudinary.uploader

        _client()
        result = cloudinary.uploader.destroy(public_id, invalidate=True)
        return str(result.get("result") or "") == "ok"
    except Exception as exc:
        logger.warning("Cloudinary delete failed for %s: %s", public_id, exc)
        return False


def thumbnail_url(secure_url: str, width: int = 400) -> str:
    """Smaller delivery variant for list views (server-side string splice)."""
    if "/image/upload/" not in (secure_url or ""):
        return secure_url or ""
    return secure_url.replace("/image/upload/", f"/image/upload/w_{width},c_limit,q_auto,f_auto/", 1)
