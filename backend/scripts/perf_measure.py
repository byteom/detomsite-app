"""Performance measurement harness (read-only). API latency, payload sizes,
concurrency (threads), and EXPLAIN ANALYZE for the hot queries behind
/shops and /shop/:id.

Usage: venv/bin/python scripts/perf_measure.py [--base URL] [--concurrency 1,10,25]
"""
import argparse
import statistics
import sys
import threading
import time
import urllib.request

BASE = "http://127.0.0.1:8000/api/v1/local"
ENDPOINTS = [
    "/shops?public_only=true",
    "/products",
    "/shops/s2",
    "/products?shop_id=s2",
    "/search?q=tea",
    "/search?q=biryani rice combo",
]


def fetch(path, timeout=90):
    t0 = time.monotonic()
    with urllib.request.urlopen(BASE + path, timeout=timeout) as r:
        body = r.read()
    return (time.monotonic() - t0) * 1000, len(body), r.status


def bench_endpoint(path, runs=5):
    lat, size, fails = [], 0, 0
    for _ in range(runs):
        try:
            ms, n, st = fetch(path)
            lat.append(ms)
            size = n
            if st != 200:
                fails += 1
        except Exception:
            fails += 1
    lat = lat or [float("nan")]
    return {"min": min(lat), "avg": sum(lat) / len(lat),
            "max": max(lat), "kb": (size or 0) / 1024, "fails": fails}


def concurrency_run(path, users, per_user=4):
    results, errors = [], []
    lock = threading.Lock()

    def worker():
        for _ in range(per_user):
            try:
                ms, _, _ = fetch(path)
                with lock:
                    results.append(ms)
            except Exception as e:
                with lock:
                    errors.append(str(e)[:60])

    threads = [threading.Thread(target=worker) for _ in range(users)]
    t0 = time.monotonic()
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    wall = (time.monotonic() - t0) * 1000
    ok = sorted(results)
    def pct(p):
        return ok[min(len(ok) - 1, int(len(ok) * p / 100))] if ok else float("nan")
    return {"users": users, "reqs": len(ok), "errors": len(errors),
            "avg": (sum(ok) / len(ok)) if ok else float("nan"),
            "p50": pct(50), "p95": pct(95), "wall": wall}


def explain():
    sys.path.insert(0, ".")
    import psycopg2
    import psycopg2.extras
    from app.core.config import settings
    c = psycopg2.connect(settings.SUPABASE_DATABASE_URL)
    c.autocommit = True
    cur = c.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    queries = {
        "shops_public": "EXPLAIN (ANALYZE, TIMING OFF) SELECT * FROM shops WHERE approval_status = 'Approved' ORDER BY rating DESC",
        "products_all": "EXPLAIN (ANALYZE, TIMING OFF) SELECT * FROM products ORDER BY category, name",
        "products_shop": "EXPLAIN (ANALYZE, TIMING OFF) SELECT * FROM products WHERE shop_id = 's2'",
        "search_shops": "EXPLAIN (ANALYZE, TIMING OFF) SELECT * FROM shops WHERE approval_status = 'Approved' AND (LOWER(name) LIKE '%tea%' OR LOWER(category) LIKE '%tea%' OR LOWER(description) LIKE '%tea%') ORDER BY rating DESC",
        "search_products": "EXPLAIN (ANALYZE, TIMING OFF) SELECT * FROM products WHERE (LOWER(name) LIKE '%tea%' OR LOWER(description) LIKE '%tea%' OR LOWER(category) LIKE '%tea%' OR LOWER(combo_items) LIKE '%tea%') ORDER BY category, name",
    }
    out = {}
    for name, q in queries.items():
        cur.execute(q)
        plan = "\n".join(r["QUERY PLAN"] for r in cur.fetchall())
        out[name] = plan
    c.close()
    return out


def main():
    global BASE
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=BASE)
    ap.add_argument("--concurrency", default="1,10,25")
    ap.add_argument("--runs", type=int, default=5)
    args = ap.parse_args()
    BASE = args.base.rstrip("/")

    print("=== endpoint latency (ms) + payload ===")
    for ep in ENDPOINTS:
        r = bench_endpoint(ep, runs=args.runs)
        print(f"{ep} min={r['min']:.0f} avg={r['avg']:.0f} max={r['max']:.0f} size={r['kb']:.1f}KB fails={r['fails']}")

    print("=== concurrency: GET /shops?public_only=true ===")
    for u in [int(x) for x in args.concurrency.split(",")]:
        r = concurrency_run("/shops?public_only=true", u)
        print(f"users={r['users']} reqs={r['reqs']} errors={r['errors']} avg={r['avg']:.0f} p50={r['p50']:.0f} p95={r['p95']:.0f} wall={r['wall']:.0f}ms")
    print("=== concurrency: GET /products?shop_id=s2 ===")
    for u in [int(x) for x in args.concurrency.split(",")]:
        r = concurrency_run("/products?shop_id=s2", u)
        print(f"users={r['users']} reqs={r['reqs']} errors={r['errors']} avg={r['avg']:.0f} p50={r['p50']:.0f} p95={r['p95']:.0f} wall={r['wall']:.0f}ms")

    print("=== query plans ===")
    for name, plan in explain().items():
        print(f"--- {name} ---")
        print(plan)


if __name__ == "__main__":
    main()
