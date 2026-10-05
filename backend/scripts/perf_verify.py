"""Verify perf-seed integrity + report counts. Read-only (no writes)."""
import sys

sys.path.insert(0, ".")
import psycopg2
import psycopg2.extras

from app.core.config import settings

NUM = r"^p[0-9]+$"
SHOPNUM = r"^s[0-9]+$"

conn = psycopg2.connect(settings.SUPABASE_DATABASE_URL)
conn.autocommit = True
cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

print("=== counts ===")
for t in ["shops", "products", "users", "orders", "parent_orders",
          "shop_sub_orders", "order_items", "payments", "reviews",
          "favorites", "notifications", "product_stock",
          "shop_announcements", "site_feedback", "tickets", "complaints"]:
    cur.execute("SELECT count(*) AS c FROM " + t)
    print(f"{t}: {cur.fetchone()['c']}")

print("=== seeded vs real ===")
checks = [
    ("seeded shops", "SELECT count(*) c FROM shops WHERE id ~ %s AND id NOT IN ('s1','s2')", (SHOPNUM,)),
    ("seeded products", "SELECT count(*) c FROM products WHERE id ~ %s AND SUBSTRING(id FROM 2)::int >= 1001", (NUM,)),
    ("real products (p1..p8 + s2 originals)", "SELECT count(*) c FROM products WHERE NOT (id ~ %s AND SUBSTRING(id FROM 2)::int >= 1001)", (NUM,)),
    ("seeded users", "SELECT count(*) c FROM users WHERE username LIKE 'perfuser%'", ()),
    ("seeded single orders", "SELECT count(*) c FROM orders WHERE id LIKE 'o1999%'", ()),
    ("seeded parents", "SELECT count(*) c FROM parent_orders WHERE id LIKE 'p1999%'", ()),
    ("seeded payments", "SELECT count(*) c FROM payments WHERE id LIKE 'pay9%'", ()),
    ("seeded reviews", "SELECT count(*) c FROM reviews WHERE id LIKE 'rv3%'", ()),
    ("seeded notifications n10001+", "SELECT count(*) c FROM notifications WHERE id ~ '^n[0-9]+$' AND SUBSTRING(id FROM 2)::int >= 10001", ()),
    ("other notifications (real/app)", "SELECT count(*) c FROM notifications WHERE NOT (id ~ '^n[0-9]+$' AND SUBSTRING(id FROM 2)::int >= 10001)", ()),
]
for name, q, params in checks:
    cur.execute(q, params) if params else cur.execute(q)
    print(f"{name}: {cur.fetchone()['c']}")

print("=== integrity ===")
integ = [
    ("orphan products", "SELECT count(*) c FROM products p LEFT JOIN shops s ON s.id=p.shop_id WHERE s.id IS NULL"),
    ("orphan order_items", "SELECT count(*) c FROM order_items i LEFT JOIN shop_sub_orders s ON s.id=i.sub_order_id WHERE s.id IS NULL"),
    ("orphan payments", "SELECT count(*) c FROM payments p LEFT JOIN orders o ON o.id=p.order_id WHERE o.id IS NULL"),
    ("orphan subs", "SELECT count(*) c FROM shop_sub_orders s LEFT JOIN parent_orders p ON p.id=s.parent_order_id WHERE p.id IS NULL"),
    ("dup usernames", "SELECT count(*) c FROM (SELECT username FROM users GROUP BY 1 HAVING count(*)>1) x"),
    ("dup emails", "SELECT count(*) c FROM (SELECT lower(email) e FROM users WHERE email<>'' GROUP BY 1 HAVING count(*)>1) x"),
    ("dup product ids", "SELECT count(*) c FROM (SELECT id FROM products GROUP BY 1 HAVING count(*)>1) x"),
    ("dup UTR", "SELECT count(*) c FROM (SELECT utr_number FROM payments WHERE utr_number IS NOT NULL AND utr_number<>'' GROUP BY 1 HAVING count(*)>1) x"),
    ("neg prices", "SELECT count(*) c FROM products WHERE price < 0"),
    ("bad roles", "SELECT count(*) c FROM users WHERE role NOT IN ('student','shopkeeper','admin')"),
]
for name, q in integ:
    cur.execute(q)
    print(f"{name}: {cur.fetchone()['c']}")

cur.execute("SELECT count(*) c, min(cnt) mn, max(cnt) mx, round(avg(cnt)) av FROM (SELECT shop_id, count(*) cnt FROM products GROUP BY 1) x")
print("products/shop:", dict(cur.fetchone()))
conn.close()
