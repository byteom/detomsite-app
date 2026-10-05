"""
Error handling middleware
"""
import json
import os

from fastapi import Request, status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from app.core.config import settings
import logging
import time
import uuid

logger = logging.getLogger(__name__)

# TEMPORARY diagnostic switch, default OFF. Enabled for one deploy to identify
# the class of a production-only 500, then removed. It reveals the exception
# TYPE NAME only — never the message, which can contain SQL or credentials.
_EXPOSE_ERROR_CLASS = os.environ.get("EXPOSE_ERROR_CLASS", "") == "1"


def _is_client_body_error(exc: BaseException) -> bool:
    """True when an exception is the caller's fault (a malformed body).

    Narrow on purpose: a blanket ``except ValueError -> 400`` would relabel real
    server bugs as client errors and hide them from the 5xx dashboards.
    """
    if isinstance(exc, (json.JSONDecodeError, UnicodeDecodeError)):
        return True
    if isinstance(exc, ValueError):
        text = str(exc).lower()
        return "out of range float" in text or "not json compliant" in text
    return False


def _is_retryable_capacity_error(exc: BaseException) -> bool:
    """True for a transient "come back in a moment" server fault.

    Identified live, by exposing the exception class name for one deploy: a
    20-way burst of /checkout-data produced 20 × ``OperationalError`` and no
    ``PoolError`` at all.

    In psycopg2, ``QueryCanceled`` — a statement killed by the server-side
    ``statement_timeout`` — is a SUBCLASS of ``OperationalError``. So this was
    never the pool refusing a slot; it was a request that waited for a slot,
    then waited behind Supabase's own connection pooler, and finally had its
    query cancelled at the 20 s mark. The request was well-formed and the same
    call succeeds once the instance is warm, so the honest status is 503 +
    Retry-After, and the client should try again rather than be told the
    checkout is broken.

    Matched by class name and message rather than importing psycopg2 here, so
    this module stays free of a database dependency and cannot itself fail to
    import while handling an error.
    """
    for klass in type(exc).__mro__:
        if klass.__name__ in (
            "PoolError",
            "TooManyConnections",
            "QueryCanceled",
            # Connection-level problems are equally transient: a pooler that
            # recycled an idle backend, a dropped socket, a database restart.
            "OperationalError",
        ):
            return True
    text = str(exc).lower()
    return (
        "connection pool exhausted" in text
        or "too many connections" in text
        or "too many clients" in text
        or "canceling statement due to statement timeout" in text
        or "server closed the connection unexpectedly" in text
    )


class ErrorHandlingMiddleware(BaseHTTPMiddleware):
    """Middleware for error handling"""

    async def dispatch(self, request: Request, call_next):
        """Process request and handle errors"""
        request_id = str(uuid.uuid4())
        request.state.request_id = request_id

        try:
            response = await call_next(request)
            return response
        except Exception as e:
            # Client disconnect / aborted request (e.g. user navigated away or closed tab)
            if isinstance(e, RuntimeError) and "No response returned" in str(e):
                logger.info(
                    f"Client closed connection before response - Request ID: {request_id}, "
                    f"Path: {request.url.path}"
                )
                return JSONResponse(
                    status_code=499,
                    content={
                        "detail": "Client closed connection.",
                        "request_id": request_id,
                    },
                )

            # PENTEST FIX: a body of {"x": NaN} or {"x": Infinity} is not valid
            # JSON, but Python's json.loads accepts those bare literals as an
            # extension, so the value flowed into the response. Re-serialising a
            # non-finite float then raises "Out of range float values are not
            # JSON compliant" from inside FastAPI's own 422 builder, which escaped
            # as a 500. It is a malformed request, not a server fault, so answer
            # 400 and keep genuinely unexpected errors as 500.
            if _is_client_body_error(e):
                logger.info(
                    f"Malformed request body - Request ID: {request_id}, "
                    f"Path: {request.url.path}, Error: {str(e)}"
                )
                return JSONResponse(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    content={
                        "detail": "Request body is not valid JSON.",
                        "request_id": request_id,
                    },
                )

            logger.error(
                f"Unhandled error - Request ID: {request_id}, "
                f"Path: {request.url.path}, Error: {str(e)}"
            )

            # A saturated database pool is a CAPACITY problem, not a broken
            # request: nothing about the caller's request was wrong, and the
            # exact same call will succeed moments later. 503 says "try again"
            # to every client and any retry logic, while 500 reads as "this
            # request is invalid" and is what made a transient pool shortage
            # look like a permanent fault on the checkout page.
            if _is_retryable_capacity_error(e):
                return JSONResponse(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    content={
                        "detail": "The service is busy. Please try again in a moment.",
                        "request_id": request_id,
                    },
                    headers={"Retry-After": "2"},
                )

            # Determine error message safely based on environment
            if _EXPOSE_ERROR_CLASS:
                error_message = f"{type(e).__name__}"
            elif settings.DEBUG:
                error_message = str(e)
            else:
                error_message = "Internal Server Error"

            return JSONResponse(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content={
                    "detail": error_message,
                    "request_id": request_id
                }
            )


class LoggingMiddleware(BaseHTTPMiddleware):
    """Middleware for logging requests"""
    
    async def dispatch(self, request: Request, call_next):
        """Log request and response"""
        started = time.perf_counter()
        response = await call_next(request)
        duration_ms = (time.perf_counter() - started) * 1000
        response.headers.setdefault("Server-Timing", f"app;dur={duration_ms:.1f}")
        request_id = getattr(request.state, "request_id", "-")
        logger.info(
            "%s %s -> %s in %.1fms request_id=%s",
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
            request_id,
        )
        if duration_ms >= 1000:
            logger.warning(
                "slow_request path=%s method=%s duration_ms=%.1f status=%s request_id=%s",
                request.url.path,
                request.method,
                duration_ms,
                response.status_code,
                request_id,
            )
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add sensible security headers to every response.

    Defense-in-depth: guards against MIME sniffing, clickjacking and the like.
    The strictest CSP variant is impractical here because the frontends are
    served from separate Vercel origins (list-style directives would break the
    student/admin/shopkeeper portals), so we set the no-sniff/frame guards that
    are origin-agnostic.
    """

    # Responses that carry student PII (names, phone numbers, order and payment
    # rows). A shared cache or a browser bfcache holding these after logout is a
    # real leak on a shared campus laptop, so they are marked no-store. The
    # backend's own speed comes from the in-process/Redis read cache, which
    # honours this header because it is applied on the way out.
    _PRIVATE_PATH_MARKERS = (
        "/api/v1/local/orders",
        "/api/v1/local/payments",
        "/api/v1/local/notifications",
        "/api/v1/local/tickets",
        "/api/v1/local/complaints",
        "/api/v1/local/auth",
        "/api/v1/users",
        "/api/v1/admin",
        "/api/v1/vendor",
    )

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("X-XSS-Protection", "1; mode=block")
        response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        # Cross-origin isolation: a response carrying another origin's student
        # data must not be readable by a page on a third-party site.
        response.headers.setdefault("Cross-Origin-Resource-Policy", "same-site")
        # Never let a proxy keep a personalised response after logout.
        if request.url.path.startswith(self._PRIVATE_PATH_MARKERS):
            response.headers.setdefault("Cache-Control", "no-store, max-age=0")
            response.headers.setdefault("Pragma", "no-cache")
        return response
