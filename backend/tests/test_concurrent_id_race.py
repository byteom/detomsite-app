"""Regression tests for the third deep-pentest pass.

Finding fixed here (proven live with tests/probe_race_ids.py first):

**Non-atomic primary keys silently dropped rows under concurrency.** Six tables
derived their id with ``SELECT COALESCE(MAX(CAST(substr(id, N) AS INTEGER)), 0) + 1``
and then INSERTed it as a separate statement. Nothing serialised the gap between
the SELECT and the INSERT, so two concurrent writers read the same MAX, derived
the same id, and the loser's INSERT died on the primary key. The callers catch
and log, so the app looked healthy while the row was gone.

Measured on the SQLite store: 40 threads x 3 inserts lost **52 of 120 rows
(43%)**. The user-visible consequence is the worst kind — an order that exists,
is paid for, and is never queued for the admin's confirmation, so it is never
approved. The in-code comment claimed the MAX (rather than COUNT) form was
"collision-proof"; that is only true with respect to DELETED rows, not with
respect to concurrency.

The fix routes every such insert through ``_insert_with_suffixed_id``, which
proposes an id and attempts the INSERT together, retrying on the actual UNIQUE
violation. Nothing is lost.
"""
import threading

import pytest

from app.core import local_demo_db as db

CONCURRENCY = 24
PER_THREAD = 3
EXPECTED = CONCURRENCY * PER_THREAD


def _run_concurrently(fn, label):
    """Fire ``fn(i, j)`` from many threads at once and collect any exceptions."""
    errors: list[str] = []
    lock = threading.Lock()

    def wrapper(i: int) -> None:
        for j in range(PER_THREAD):
            try:
                fn(i, j)
            except Exception as exc:  # noqa: BLE001
                with lock:
                    errors.append(f"{label}: {type(exc).__name__}: {exc}")

    threads = [threading.Thread(target=wrapper, args=(i,)) for i in range(CONCURRENCY)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return errors


def _count(table: str, column: str, pattern: str) -> int:
    with db._connect() as c:
        return c.execute(
            f"SELECT COUNT(*) FROM {table} WHERE {column} LIKE ?", (pattern,)
        ).fetchone()[0]


# ─── notifications: the admin's "confirm this order" queue ───
def test_concurrent_notifications_are_all_persisted():
    errors = _run_concurrently(
        lambda i, j: db.create_notification(
            title="race-notif-%d-%d" % (i, j), message="concurrent insert",
            order_id=None, status="Pending", target_role="admin",
        ),
        "notifications",
    )
    assert not errors, "concurrent notification inserts raised: %s" % errors[:3]
    landed = _count("notifications", "title", "race-notif-%")
    assert landed == EXPECTED, f"lost {EXPECTED - landed} of {EXPECTED} notification rows"




# ─── sms_logs: the bank-credit audit trail the payment matcher reads ───
def test_concurrent_sms_logs_are_all_persisted():
    errors = _run_concurrently(
        lambda i, j: db.log_sms(
            sub_order_id="race-sub", phone="+919000000000",
            message=f"race-sms-{i}-{j}", direction="out", status="Sent",
        ),
        "sms_logs",
    )
    assert not errors, "concurrent sms log inserts raised: %s" % errors[:3]
    landed = _count("sms_logs", "message", "race-sms-%")
    assert landed == EXPECTED, f"lost {EXPECTED - landed} of {EXPECTED} sms log rows"


# ─── reviews ───
def test_concurrent_reviews_are_all_persisted():
    errors = _run_concurrently(
        lambda i, j: db.create_review({
            "user_id": None, "username": "racer", "student_name": "Racer",
            "shop_id": "s1", "rating": 5, "comment": f"race-review-{i}-{j}",
        }),
        "reviews",
    )
    assert not errors, "concurrent review inserts raised: %s" % errors[:3]
    landed = _count("reviews", "comment", "race-review-%")
    assert landed == EXPECTED, f"lost {EXPECTED - landed} of {EXPECTED} review rows"


# ─── site_feedback ───
def test_concurrent_site_feedback_is_all_persisted():
    errors = _run_concurrently(
        lambda i, j: db.create_site_feedback({
            "user_id": None, "username": "racer", "name": "Racer",
            "email": "racer@example.com", "category": "Bug",
            "subject": f"race-fb-{i}-{j}", "message": "m", "page": "/", "source": "User",
        }),
        "site_feedback",
    )
    assert not errors, "concurrent feedback inserts raised: %s" % errors[:3]
    landed = _count("site_feedback", "subject", "race-fb-%")
    assert landed == EXPECTED, f"lost {EXPECTED - landed} of {EXPECTED} feedback rows"


# ─── products ───
def test_concurrent_products_are_all_persisted():
    errors = _run_concurrently(
        lambda i, j: db.create_product({
            "shop_id": "s1", "name": f"race-prod-{i}-{j}", "price": 10,
            "category": "Food", "available": True,
        }),
        "products",
    )
    assert not errors, "concurrent product inserts raised: %s" % errors[:3]
    landed = _count("products", "name", "race-prod-%")
    assert landed == EXPECTED, f"lost {EXPECTED - landed} of {EXPECTED} product rows"


# ─── the helper itself ───
def test_caller_supplied_product_id_is_still_honoured():
    """The retry path must not break explicit ids (imports, fixtures, seeding)."""
    row = db.create_product({
        "id": "p-explicit-id", "shop_id": "s1", "name": "Explicit",
        "price": 5, "category": "Food", "available": True,
    })
    assert row is not None and row["id"] == "p-explicit-id"


def test_non_unique_integrity_errors_are_not_swallowed():
    """A genuine constraint violation must still raise, not be retried away."""
    db.create_product({
        "id": "p-dup-target", "shop_id": "s1", "name": "First",
        "price": 5, "category": "Food", "available": True,
    })
    with pytest.raises(Exception) as excinfo:
        db.create_product({
            "id": "p-dup-target", "shop_id": "s1", "name": "Second",
            "price": 5, "category": "Food", "available": True,
        })
    assert "unique" in str(excinfo.value).lower()

def test_concurrent_notification_ids_are_unique():
    _run_concurrently(
        lambda i, j: db.create_notification(
            title=f"race-unique-{i}-{j}", message="m", target_role="admin"
        ),
        "notifications-unique",
    )
    with db._connect() as c:
        dupes = c.execute(
            "SELECT id, COUNT(*) n FROM notifications GROUP BY id HAVING n > 1"
        ).fetchall()
    assert not dupes, f"duplicate notification ids stored: {[dict(d) for d in dupes]}"
