"""The module must import under the PYTHON VERSION THAT ACTUALLY SERVES IT.

A helper annotated with a name it never imported (``def f(x: Any) -> str:``)
booted fine locally and took production down with
``FUNCTION_INVOCATION_FAILED``. The cause is a version difference, not a typo:

  * the dev box and the test suite run Python 3.14, which DEFERRED annotation
    evaluation (PEP 649) — the name is never looked up, so the missing import
    is invisible and every test passes;
  * Vercel builds with Python 3.12, which evaluates annotations at def-time, so
    the module raises NameError on IMPORT and the whole API 500s.

299 green tests were therefore giving false confidence. These tests force the
eager evaluation that 3.12 performs, across every router module, so a missing
import is caught locally instead of in production.
"""
import importlib
import inspect
import typing

import pytest

API_MODULES = [
    "app.api.v1.local",
    "app.api.v1.vendor",
    "app.api.v1.admin",
    "app.api.v1.admin_super",
    "app.api.v1.local_admin",
    "app.api.v1.orders",
    "app.api.v1.payments",
    "app.api.v1.products",
    "app.api.v1.shops",
    "app.api.v1.users",
    "app.api.v1.campuses",
    "app.api.v1.reviews",
    "app.api.v1.tickets",
    "app.api.v1.auth",
    "app.main",
]


@pytest.mark.parametrize("module_name", API_MODULES)
def test_annotations_resolve_under_eager_evaluation(module_name):
    """Every annotation must resolve NOW, the way Python 3.12 resolves it.

    ``typing.get_type_hints`` forces exactly the evaluation the deployed
    runtime performs. A NameError here is the same NameError that made the
    import fail in production.
    """
    module = importlib.import_module(module_name)
    broken = []
    for name, obj in vars(module).items():
        if not (inspect.isfunction(obj) and obj.__module__ == module_name):
            continue
        try:
            typing.get_type_hints(obj)
        except Exception as exc:  # noqa: BLE001 - we are collecting every kind
            broken.append(f"{name} annotation: {type(exc).__name__}: {exc}")
    assert not broken, (
        f"{module_name} has annotations that only resolve lazily. Python 3.14 "
        f"defers these (PEP 649) and hides the bug, but Vercel runs 3.12 and "
        f"will fail to import the module:\n  " + "\n  ".join(broken)
    )


@pytest.mark.parametrize("module_name", API_MODULES)
def test_module_imports_under_the_deployed_runtime(module_name):
    """Every API module must import cleanly on its own.

    This is the direct guard for the outage class of bug. A name used in a
    parameter DEFAULT — `shop_ids: str = Query("")` with `Query` never
    imported — is evaluated when the function is DEFINED, so the module raises
    NameError on import and the entire API returns 500. It happened twice here:
    first for an annotation (`Any`), then for a default (`Query`).

    The annotation sweep above catches the lazy-annotation variant; this catches
    the rest, and states the failure in terms of what actually breaks.
    """
    module = importlib.import_module(module_name)
    assert module is not None


# ── API surface: every route must be authenticated unless it is public by
#    design. Read from FastAPI's REAL route table rather than grepping source,
#    so a route that changes shape (or is added) cannot quietly slip through
#    unauthenticated again. ──
# Paths that MUST stay reachable without a token. Each one is deliberate:
# sign-in/registration, the public shop+product catalogue the ordering pages
# read before login, health, the password-reset flow, and the payment gateway
# callbacks (which authenticate by provider signature, not by user token).
_INTENTIONALLY_PUBLIC = (
    "/api/v1/local/auth/login",
    "/api/v1/local/auth/register",
    "/api/v1/local/auth/phone",
    "/api/v1/local/status",
    "/api/v1/local/shops",
    "/api/v1/local/products",
    "/api/v1/local/payment-settings",
    "/api/v1/local/student-notice",
    "/api/v1/local/announcements",
    "/api/v1/local/batch",
    "/api/v1/local/home-feed",
    "/api/v1/local/checkout-data",
    "/api/v1/local/feedback",
    "/api/v1/users/login",
    "/api/v1/users/register",
    "/api/v1/users/forgot-password",
    "/api/v1/users/forgot-username",
    "/api/v1/users/reset-password",
    "/api/v1/admin/login",
    "/api/v1/vendor/login",
    "/api/v1/vendor/register",
    "/health",
    # Root is a liveness/welcome route: app name + version, no data. Keeping it
    # open is what lets a load balancer and a human "is it up?" check work.
    "/",
)


def _is_public(path: str) -> bool:
    if any(path == p or path.startswith(p + "/") for p in _INTENTIONALLY_PUBLIC):
        return True
    # Agent routes (SMS/WhatsApp bridge) authenticate with the shared agent
    # key checked inside the handler, not with a Depends() on the signature.
    return any(s in path for s in ("/sms/", "/whatsapp/"))


def test_every_route_requires_authentication():
    """No route may be reachable with no credentials unless listed as public.

    An accidentally-public money path is the single most damaging thing in this
    codebase, and it is invisible in review because the route file looks
    ordinary.

    The route table is read INSIDE the test, deliberately. Importing
    ``app.main`` at collection time (a ``@parametrize`` over ``app.routes``)
    loads ``app.core.config`` BEFORE the environment setup lower down in this
    file has run, so the first ``settings`` object built has no JWT secret and
    no admin seed — and every later test inherits it. That silently broke
    unrelated admin-login and agent-key tests when it was tried that way.
    """
    from app.main import app

    public = {r for r in app.routes if hasattr(r, "methods")}
    assert public, "no routes found — is the app object wired up correctly?"

    unguarded = []
    for route in public:
        path = route.path
        if _is_public(path):
            continue
        has_dep = bool(getattr(route, "dependant", None) and route.dependant.dependencies)
        if not has_dep:
            unguarded.append(f"{sorted(route.methods)[0]} {path}")

    assert not unguarded, (
        "these routes have no authentication dependency and are not on the "
        "intentionally-public list, so anyone can call them:\n  "
        + "\n  ".join(sorted(unguarded))
    )


import os
import uuid

# CRITICAL: tests NEVER touch Supabase. They run against a throwaway local
# SQLite DB (app/core/local_demo_db.py, test-only) so no test user/shop/order
# can leak into the live Supabase project (this happened once; the rows had to
# be cleaned by hand). The store facade is swapped to the test module via
# store._use_test_store() in the session fixture below. Both shared caches
# (Redis/Vercel KV and the Supabase app_cache table) are disabled too, so tests
# never read or write a real cache store.
os.environ["LOCAL_DB_PATH"] = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".pytest_local.db")
os.environ["KV_REST_API_URL"] = ""
os.environ["KV_REST_API_TOKEN"] = ""
os.environ["UPSTASH_REDIS_REST_URL"] = ""
os.environ["UPSTASH_REDIS_REST_TOKEN"] = ""
os.environ["REDIS_URL"] = ""
# Never boot the in-process redis-server during tests (app/core/embedded_redis.py):
# a real test would fork a server, slow the suite down and leave a child process
# behind. The opt-in integration test flips this itself.
os.environ["DETOMSITE_EMBEDDED_REDIS"] = "0"
# Use explicit dummy settings before importing the app. Never load live DB
# credentials from backend/.env; the session fixture supplies the test store.
os.environ["DEBUG"] = "True"
os.environ["JWT_SECRET"] = "pytest-only-secret-not-for-deployment"
os.environ["SUPABASE_DATABASE_URL"] = "postgresql://dummy:dummy@127.0.0.1:1/test?connect_timeout=1"
os.environ["SUPABASE_DB_HOST"] = "127.0.0.1"
os.environ["SUPABASE_DB_PASSWORD"] = "dummy"
os.environ["DEFAULT_SUPER_ADMIN_EMAIL"] = "admin@example.com"
os.environ["DEFAULT_SUPER_ADMIN_PASSWORD"] = "pytest-admin-password"
os.environ["SMS_FORWARD_KEY"] = ""

import pytest
import httpx
from app.main import app
from app.core import store as store_module


@pytest.fixture(autouse=True)
def _init_test_db(tmp_path):
    """Point the store facade at throwaway SQLite and create its schema.

    A real server runs init_store() in the app lifespan against Supabase; the
    httpx test client does not, so we swap + init here explicitly (idempotent).
    """
    from app.core import local_demo_db as _test_db, shared_cache, supabase_db
    from app.core import rate_limit
    from app.core.config import settings
    from app import main as main_module

    settings.LOCAL_DB_PATH = str(tmp_path / "test.db")
    patch = pytest.MonkeyPatch()
    patch.setattr(shared_cache, "enabled", lambda: False)
    patch.setattr(shared_cache, "_pg_enabled", lambda: False)

    # Every test starts with empty throttling buckets. Both the middleware (60
    # auth calls/min per IP+path) and the per-endpoint limiter
    # (app/core/rate_limit) key on the client IP, and the whole suite hammers
    # those endpoints from ONE test-client IP — without this reset a later test
    # would randomly see 429 instead of the response it asserts on, so the suite
    # must only ever fail for real regressions.
    main_module._rate_limit_store.clear()
    rate_limit._hits.clear()

    def forbid_live_database():
        raise AssertionError("Tests must not connect to Supabase")

    patch.setattr(supabase_db, "_connect", forbid_live_database)
    store_module._use_test_store(_test_db)
    _test_db.init_local_demo_db()
    if hasattr(_test_db, "ensure_admin_user"):
        _test_db.ensure_admin_user()
    yield
    store_module._use_test_store(None)
    main_module._rate_limit_store.clear()
    rate_limit._hits.clear()
    patch.undo()


@pytest.fixture
async def client():
    """Create test client (httpx>=0.28 uses ASGITransport instead of app=).

    Each client carries its own synthetic ``x-forwarded-for`` (the header Vercel
    sets in production), so every test gets a private rate-limit bucket. The
    auth endpoints cap sign-ups at 40/hour per IP and the middleware at 60/min;
    with one shared test-client IP the suite exhausted that budget and later
    tests saw an unrelated 429 (a real flake: the run failed at
    ``test_tickets_username`` because an earlier test file had spent the quota).
    A per-test IP makes throttling deterministic and still exercises the limit
    *within* a test, where one client must share the bucket.
    """
    fake_ip = f"10.{uuid.uuid4().int % 250 + 1}.{(uuid.uuid4().int % 250) + 1}.{(uuid.uuid4().int % 250) + 1}"
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test", headers={"x-forwarded-for": fake_ip}
    ) as ac:
        yield ac


@pytest.fixture
async def test_user_data():
    """Test user data — matches the /local/auth/register schema"""
    return {
        "username": "testuser",
        "password": "test_password_123",
        "name": "Test User",
        "role": "student",
    }
