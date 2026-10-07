"""
Main FastAPI application
"""
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from contextlib import asynccontextmanager
from app.core.config import settings
import asyncio
import logging
import os
import time
from collections import defaultdict

try:
    import sentry_sdk
except ImportError:
    sentry_sdk = None

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ─── In-app keep-alive cron ───
# Pings faster (every 2 min) and hits SEVERAL endpoints so Vercel keeps a few
# warm lambda instances instead of one — cold Python starts (≈10–20s) are the
# single biggest slowness users feel on the portals.
KEEP_ALIVE_INTERVAL_SECONDS = 2 * 60
KEEP_ALIVE_PATHS = ("/health", "/api/v1/local/batch", "/api/v1/local/status")


async def keep_alive_loop():
    """Background task: warm a few backend endpoints every 2 minutes so the
    portals rarely hit a cold start."""
    import httpx

    base = (os.environ.get("HEALTH_URL") or settings.BACKEND_URL or "").strip().rstrip("/")
    if not base:
        logger.warning("keep-alive: no HEALTH_URL/BACKEND_URL configured — self-ping disabled")
        return
    if not base.startswith("http"):
        base = f"https://{base}"

    logger.info(f"keep-alive: warm-up cron active every {KEEP_ALIVE_INTERVAL_SECONDS // 60} min → {base}")
    while True:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                for path in KEEP_ALIVE_PATHS:
                    try:
                        response = await client.get(f"{base}{path}")
                        logger.info(f"keep-alive: {path} → {response.status_code}")
                    except Exception as exc:
                        logger.warning(f"keep-alive: {path} error -> {exc}")
        except Exception as exc:
            logger.warning(f"keep-alive client session error -> {exc}")
        await asyncio.sleep(KEEP_ALIVE_INTERVAL_SECONDS)

# Initialize Sentry if DSN is provided — sample 10% of traces (not 100%)
if sentry_sdk and settings.SENTRY_DSN:
    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        traces_sample_rate=0.1
    )


# ─── Simple in-memory rate limiter ───
# Protects auth endpoints from brute-force attacks. No external deps needed.
_rate_limit_store: dict[str, list[float]] = {}
_last_rate_limit_cleanup: float = 0.0
_RATE_LIMIT_WINDOW = 60  # seconds
# Cap per real client IP (not per Vercel proxy IP), tuned for a campus behind
# a shared NAT: generous enough that a lunch-rush login flash is never blocked,
# tight enough to blunt naive flood attacks. Real brute-force defence happens
# per-account in the auth endpoints themselves.
_RATE_LIMIT_MAX = 60


def _prune_rate_limit_store(now: float) -> None:
    """Periodically purge all expired keys to prevent memory leak."""
    global _last_rate_limit_cleanup
    if now - _last_rate_limit_cleanup < 300 and len(_rate_limit_store) < 1000:
        return
    _last_rate_limit_cleanup = now
    cutoff = now - _RATE_LIMIT_WINDOW
    expired_keys = [k for k, timestamps in _rate_limit_store.items() if not timestamps or timestamps[-1] < cutoff]
    for k in expired_keys:
        _rate_limit_store.pop(k, None)


async def rate_limit_middleware(request: Request, call_next):
    """Rate-limit sensitive endpoints (login, register, forgot-password/username)."""
    path = request.url.path
    sensitive_prefixes = ("/auth/login", "/auth/register", "/users/login",
                           "/users/register", "/vendor/login", "/vendor/register",
                           "/admin/login", "/users/forgot-password",
                           "/users/forgot-username", "/users/reset-password",
                           "/vendor/forgot-password", "/vendor/reset-password",
                           "/admin/forgot-password", "/admin/reset-password")
    if not any(path.endswith(p) for p in sensitive_prefixes):
        return await call_next(request)

    # PENTEST FIX: this used to trust the FIRST x-forwarded-for hop
    # (``split(",")[0]``) — a value the caller chose — so rotating the header
    # minted a fresh bucket per request and the whole limiter was decorative
    # (proven live: 70 login attempts with a rotating XFF, zero 429s).
    #
    # It now delegates to ``app.core.rate_limit.client_ip`` so the app has ONE
    # definition of "who is this client": the two limiters can never disagree,
    # and the header is only honoured when a proxy actually appended to it.
    # request.client.host alone would lump a whole campus behind one proxy IP.
    from app.core.rate_limit import client_ip as resolve_client_ip

    client_ip = resolve_client_ip(request)
    now = time.time()
    _prune_rate_limit_store(now)
    key = f"{client_ip}:{path}"
    cutoff = now - _RATE_LIMIT_WINDOW
    existing = _rate_limit_store.get(key)
    valid = [t for t in existing if t > cutoff] if existing else []
    if len(valid) >= _RATE_LIMIT_MAX:
        _rate_limit_store[key] = valid
        return JSONResponse(
            status_code=429,
            content={"detail": "Too many requests. Please try again later."}
        )
    valid.append(now)
    _rate_limit_store[key] = valid
    return await call_next(request)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for startup and shutdown events"""
    # Startup — Supabase Postgres is the ONLY database. A failed DB connection
    # must NOT kill the whole serverless instance: without this lifespan the
    # single most common production outage is every route returning 404
    # (DEPLOYMENT_NOT_FOUND) right after a cold Supabase pooler hiccup.
    logger.info("Starting DETOMSITE application")
    from app.core.store import init_store
    try:
        ready = await asyncio.to_thread(init_store)
    except Exception as e:
        logger.error(f"Supabase init raised during startup (serving anyway): {e}")
        ready = False
    if not ready:
        logger.error("Supabase store not reachable at startup — serving API anyway; requests will retry the connection per-request.")
    else:
        logger.info("Supabase Postgres store initialized")
        # Pre-warm a few pool connections. Each fresh connection costs a
        # DNS + TCP + TLS handshake to Supabase; without this the first
        # visitor after a (re)start pays those serially inside their own
        # page-mount burst (measured seconds). Three warm connections cover a
        # typical burst head; the pool grows to DB_POOL_MAX on demand after.
        # Never blocks startup: a hiccup here just means the first requests
        # warm the pool themselves, exactly as before.
        try:
            from app.core import supabase_db
            from app.core.db_executor import run_db as _run_db

            def _prewarm() -> None:
                pool = supabase_db._get_pool()
                held = [pool.getconn() for _ in range(3)]
                for conn in held:
                    supabase_db._release(conn)

            await _run_db(_prewarm)
            logger.info("DB pool pre-warmed (3 connections)")
        except Exception as e:
            logger.warning(f"DB pool pre-warm skipped ({e})")

    # Shared read cache. When no external Redis is configured, run one inside
    # this process (unix socket, no network, no credential) so the shared layer
    # is real instead of dormant. Any failure leaves the Postgres cache in
    # place — startup is never blocked by the cache.
    try:
        url = embedded_redis.start()
        if url:
            settings.REDIS_URL = url
            # The transport may have latched "unavailable" while REDIS_URL was
            # still empty, so hand it a clean slate now that there is a server.
            redis_cache.reset_client()
            logger.info(f"Read cache: {redis_cache.status()['transport']} (embedded)")
    except Exception as e:
        logger.warning(f"Embedded cache setup skipped ({e}) — reads use the Postgres cache")

    keep_alive_task = asyncio.create_task(keep_alive_loop())
    auto_delivery_task = asyncio.create_task(auto_delivery_loop())
    pool_ping_task = asyncio.create_task(pool_keepalive_loop())

    yield

    # Shutdown — cancel background tasks so the process can exit cleanly.
    try:
        embedded_redis.stop()
    except Exception as e:
        logger.debug(f"Embedded cache shutdown notice: {e}")
    keep_alive_task.cancel()
    auto_delivery_task.cancel()
    pool_ping_task.cancel()
    try:
        await keep_alive_task
    except asyncio.CancelledError:
        pass
    try:
        await auto_delivery_task
    except asyncio.CancelledError:
        pass

    logger.info("Shutting down DETOMSITE application")


# ─── DB pool keep-alive ───
async def pool_keepalive_loop():
    """Ping pooled connections every 25 s so the pooler never sees them idle.

    Measured: a fresh TLS + pooler session assignment costs ~0.55 s, and
    concurrent fresh sessions serialize (up to ~1.7 s) — so every burst after
    an idle stretch paid seconds before running a single query. One cheap
    ``SELECT 1`` per cycle is real query activity (unlike TCP keepalives,
    which poolers ignore for idle timeouts) and keeps the warm sessions the
    pre-warm created. Fully best-effort: any failure just logs.
    """
    from app.core.db_executor import run_db as _run_db

    await asyncio.sleep(25)
    while True:
        try:
            from app.core import supabase_db

            def _ping() -> None:
                pool = supabase_db._get_pool()
                if hasattr(pool, "ping_all"):
                    pool.ping_all()
                else:
                    for _ in range(3):
                        conn = pool.getconn()
                        try:
                            with conn.cursor() as cur:
                                cur.execute("SELECT 1")
                        finally:
                            supabase_db._release(conn)

            await _run_db(_ping)
        except Exception as e:
            logger.debug(f"pool keep-alive ping skipped ({e})")
        await asyncio.sleep(25)


# ─── 30-minute auto-delivery background job ───
async def auto_delivery_loop():
    """Every 60 seconds, auto-complete sub-orders delivered more than 30 minutes
    ago (the student didn't report a problem) — see spec section 36. Uses the
    Supabase store."""
    while True:
        await asyncio.sleep(60)
        try:
            from app.core.store import store
            from app.core.db_executor import run_db as _run_db
            count = await _run_db(store.auto_complete_expired_deliveries)
            if count:
                logger.info(f"auto_delivery_loop: auto-completed {count} sub-order(s)")
        except Exception as e:
            logger.warning(f"auto_delivery_loop error: {e}")


# Create FastAPI app instance
#
# PENTEST FIX: /docs, /redoc and /openapi.json were served to the public,
# publishing the complete route map (133 KB of schema) to anyone who asked.
# That is free reconnaissance — every endpoint, parameter and schema, with no
# auth. They are now only mounted when DEBUG is on, so local development is
# unchanged while production exposes no API surface documentation.
#
# Do NOT "fix" a cold start by re-enabling these unconditionally: an
# unimportable app is a worse incident than a hidden schema.
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Enterprise Campus Food Ordering Platform",
    lifespan=lifespan,
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url="/redoc" if settings.DEBUG else None,
    openapi_url="/openapi.json" if settings.DEBUG else None,
)

# Configure CORS — the API is Bearer-token auth only (tokens travel in the
# Authorization header; no cookies, no withCredentials anywhere), so
# credentialed CORS stays off. PENTEST FIX: this was ``allow_origins=["*"]``,
# which echoes ANY origin. It now honours the ALLOWED_ORIGINS env var and
# always merges the known portal hosts + local dev ports, so no portal breaks
# while arbitrary origins receive no CORS headers. (Bearer auth is the real
# lock — CORS is defence in depth.) Vercel preview URLs are deliberately not
# wildcarded; add any extra host to ALLOWED_ORIGINS instead.
_CORS_PORTAL_ORIGINS = [
    "https://detomsite.in",
    "https://www.detomsite.in",
    "https://detomsite-frontend.vercel.app",
    "https://detomsite-student.vercel.app",
    "https://detomsite-shopkeeper.vercel.app",
    "https://detomsite-admin.vercel.app",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
    "http://localhost:3000",
]
_allow_origins = list(dict.fromkeys([*settings.allowed_origins_list, *_CORS_PORTAL_ORIGINS]))
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
)

# Compress every JSON response ≥ 500 bytes — cuts transfer ~80% on the big
# lists (orders, products, notifications) that the portals poll all day.
app.add_middleware(GZipMiddleware, minimum_size=500)


# Drop every read-cache layer after any successful write, so cached portals
# (admin/shopkeeper lists) never show stale rows once an action lands. The
# write path pays ZERO shared-cache round trips: the in-process layer is
# dropped synchronously (this instance is fresh immediately) and the Redis /
# Postgres copies expire on their own short TTLs (5–30 s). The old code
# awaited a bounded shared clear (Redis SCAN + Postgres DELETE) on EVERY
# POST/PATCH/DELETE — on a slow or unreachable shared cache that added up to
# 250 ms of user-facing latency to the exact requests a user is waiting on
# (order placement, payment, profile save) for at most seconds of cross-
# instance staleness in return.
from app.core import embedded_redis, read_cache, redis_cache, shared_cache, ttl_cache


_NOOP_WRITE_PATHS = (
    "/login", "/auth/login", "/users/login", "/vendor/login", "/admin/login",
    "/users/forgot-password", "/users/forgot-username", "/users/reset-password",
    "/users/verify-reset-otp", "/vendor/forgot-password", "/vendor/reset-password",
    "/admin/forgot-password", "/admin/reset-password",
    "/local/session", "/local/push/subscribe",
)


async def cache_invalidation_middleware(request: Request, call_next):
    response = await call_next(request)
    if request.method in ("POST", "PUT", "PATCH", "DELETE") and response.status_code < 400:
        path = request.url.path
        # Auth, login, session and push subscription endpoints mutate no domain data
        if any(path.endswith(p) for p in _NOOP_WRITE_PATHS):
            return response

        # Scoped eviction: only evict the cache key prefixes that the write target stales.
        # This keeps the read cache warm across unrelated writes (orders, products, shops).
        prefixes = _evict_prefixes_for(path)
        if prefixes is not None:
            read_cache.clear_matching(*prefixes)
        else:
            read_cache.clear_bg()
    return response


# Write path substring → cache key prefixes it can stale.
# First match wins; needles are distinctive path segments so ordering only
# matters for genuinely nested paths (none currently share a needle).
_WRITE_EVICT_MAP: tuple[tuple[str, tuple[str, ...]], ...] = (
    # Placing/cancelling/confirming an order moves stock, per-shop counters,
    # batch tokens, payments and every bell. Untouched: payment-settings,
    # student-notice, user profiles, complaints/refunds queues, feedback.
    ("/local/orders", ("orders", "checkout", "shops", "shop:", "shop:id:",
                       "products", "products:", "menu-summary", "search",
                       "payments", "notifications", "admin-", "admin:",
                       "batch", "home-feed", "summary", "settlements",
                       "products-stock", "refunds")),
    # Menu edits move the menu, search, checkout prices and vendor stock view.
    ("/local/products", ("products", "products:", "menu-summary", "search",
                         "checkout", "products-stock", "home-feed")),
    ("/vendor", ("products", "products:", "menu-summary", "search",
                 "checkout", "shops", "shop:", "shop:id:", "orders",
                 "home-feed", "products-stock", "admin-", "admin:")),
    # Shop create/toggle moves the shop list, detail, search and checkout.
    ("/local/shops", ("shops", "shop:", "shop:id:", "search", "checkout",
                      "home-feed", "summary", "menu-summary")),
    # Money movement moves payments, orders, checkout and bells.
    ("/local/payments", ("payments", "orders", "checkout", "notifications",
                        "admin-", "admin:", "settlements")),
    ("/local/utr", ("payments", "orders", "checkout", "notifications",
                    "admin-", "admin:")),
    ("/local/verify", ("payments", "orders", "checkout", "notifications",
                       "admin-", "admin:")),
    ("/local/razorpay", ("payments", "orders", "checkout", "notifications",
                         "admin-", "admin:")),
    ("/local/manual-utr", ("payments", "orders", "checkout", "notifications",
                           "admin-", "admin:")),
    ("/local/create-razorpay", ("payments", "orders", "checkout",
                               "notifications", "admin-", "admin:")),
    ("/local/payment-settings", ("payment-settings", "checkout", "home-feed")),
    ("/local/student-notice", ("student-notice", "home-feed")),
    ("/local/notifications", ("notifications", "admin-", "admin:")),
    ("/local/order-confirmations", ("notifications", "admin-", "admin:")),
    ("/local/complaints", ("complaints", "admin-", "admin:")),
    ("/local/refunds", ("refunds", "orders", "admin-", "admin:")),
    ("/local/settlements", ("settlements", "admin-", "admin:", "summary")),
    ("/local/dues", ("settlements", "admin-", "admin:", "summary")),
    ("/local/menu-change-requests", ("menu-change-requests", "admin-",
                                    "admin:")),
    ("/local/feedback", ("admin-feedback",)),
    ("/local/reviews", ("admin-", "admin:")),
    ("/local/tickets", ("admin-", "admin:")),
    ("/local/announcements", ("admin-", "admin:")),
    ("/local/feature-flags", ("admin-", "admin:")),
    # Bank-SMS webhooks confirm orders (status/payments/bells all move).
    ("/local/sms", ("orders", "checkout", "shops", "shop:", "products",
                    "products:", "payments", "notifications", "admin-",
                    "admin:", "batch", "home-feed", "summary")),
    ("/local/whatsapp", ("notifications", "admin-", "admin:")),
    # Auth/push/subscribe paths have no audited mapping on purpose: they are
    # rare, so they fall through to the safe full clear below.
    ("/users", ("user:", "admin-", "admin:")),
    ("/admin", ("admin-", "admin:", "shops", "shop:", "shop:id:", "products",
                "products:", "orders", "menu-summary", "search", "checkout",
                "home-feed", "summary", "complaints", "refunds",
                "settlements", "notifications")),
)


def _evict_prefixes_for(path: str) -> tuple[str, ...] | None:
    """Return the cache prefixes a write to ``path`` can stale, or None when
    the path has no audited mapping (caller falls back to a full clear)."""
    for needle, prefixes in _WRITE_EVICT_MAP:
        if needle in path:
            return prefixes
    return None


app.add_middleware(BaseHTTPMiddleware, dispatch=cache_invalidation_middleware)


# Include routers
from app.api.v1 import local, users, vendor, local_admin
from app.middleware.error_handler import ErrorHandlingMiddleware, LoggingMiddleware, SecurityHeadersMiddleware

# Add middleware (order matters — last added = first executed)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(BaseHTTPMiddleware, dispatch=rate_limit_middleware)
app.add_middleware(LoggingMiddleware)
app.add_middleware(ErrorHandlingMiddleware)

app.include_router(
    local.router,
    prefix="/api/v1/local",
    tags=["Local Runnable API"]
)

# Register the three portals (always available — all backed by Supabase).
app.include_router(
    users.router,
    prefix="/api/v1/users",
    tags=["User Portal"]
)
app.include_router(
    vendor.router,
    prefix="/api/v1/vendor",
    tags=["Vendor Portal"]
)
app.include_router(
    local_admin.router,
    prefix="/api/v1/admin",
    tags=["Admin Portal"]
)

# NOTE: the old Mongo-only routers (auth, campuses, shops, products, orders,
# payments, reviews, tickets, admin, super-admin) were removed with the MongoDB
# backend. Supabase is the only database; /api/v1/local + /users + /vendor +
# /admin above are the full API.


@app.get("/")
async def root():
    """Root endpoint"""
    payload = {
        "message": f"Welcome to {settings.APP_NAME}",
        "version": settings.APP_VERSION,
    }
    # Don't advertise docs that are not mounted — a pointer to a 404 is just
    # noise, and naming the paths re-tells a scanner they used to exist.
    if settings.DEBUG:
        payload.update({
            "docs": "/docs",
            "redoc": "/redoc",
            "openapi": "/openapi.json",
        })
    return payload


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        # Read-cache state, so a deploy can be verified with one request:
        # ``redis.transport`` is "rest" (Upstash/Vercel KV), "resp" (REDIS_URL)
        # or None when no shared cache is configured. No secrets are exposed.
        #
        # ``memory.hit_rate`` is the number that settles the "do we need Redis?"
        # question: on a single-instance host it sits high (repeat reads never
        # leave the process), which is exactly the case where a network hop to a
        # shared Redis would cost latency instead of saving it. Redis earns its
        # keep once ``hit_rate`` collapses — i.e. requests are landing on
        # different instances (serverless / a scaled service).
        "cache": {
            "redis": redis_cache.status(),
            "postgres": shared_cache.enabled(),
            "memory": ttl_cache.stats(),
            # True when the in-process Redis is serving the shared layer because
            # no external Redis is configured (app/core/embedded_redis.py).
            "embedded_redis": embedded_redis.status()["running"],
        },
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=settings.HOST, port=settings.PORT)
