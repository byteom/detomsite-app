"""Large-scale REALISTIC seed for performance testing (dev/staging ONLY).

Creates a production-shaped dataset with skewed, non-uniform distributions so
slow queries, missing indexes, N+1s, huge payloads and render costs actually
show up. Deterministic (fixed RNG seed) and cumulative across levels:

    L1:   50 shops x  ~50 products, 100 users   (~2.5k products)
    L2:  100 shops x ~100 products, 250 users   (~10k products)
    L3:  200 shops x ~200 products, 500+ users  (~40k products)

Usage (from backend/ with venv):
    venv/bin/python scripts/seed_perf.py --level 1 --yes   # seed up to L1
    venv/bin/python scripts/seed_perf.py --level 3 --yes   # top up to L3
    venv/bin/python scripts/seed_perf.py --clean --yes     # delete ONLY seeded rows

SAFETY:
  * Never truncates, never touches unmarked rows. Every seeded row uses a
    reserved id/username namespace (s3+, p1001+, o1999*, p1999*, pay9*, n1*,
    rv3*, fb5*, perfuser*, ann_perf*), and --clean deletes ONLY those.
  * Product ids stay ``p<int>`` and notification/review/feedback ids stay
    ``n/rv/fb<int>`` because the app derives the next id from
    MAX(numeric suffix) — a non-numeric id would break future app inserts.
  * Shops are ``s3..`` contiguous so the app's COUNT-based ``s<N>`` allocator
    keeps working; s1/s2 (real dev shops) are never modified, except s2 gets
    extra MENU items (p95xxx) at L2+ so /shop/s2 can be stress-tested too.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from datetime import datetime, timedelta, timezone

import psycopg2
import psycopg2.extras

sys.path.insert(0, ".")
from app.core.config import settings  # noqa: E402

RNG_SEED = 20261004

LEVELS = {
    1: dict(shops=50, prod_per_shop=50, users=100, orders=200, parents=100,
             reviews=300, favorites=300, notifications=200, stock=1500,
             announcements=20, feedback=30, tickets=15, complaints=10, s2_extra=0),
    2: dict(shops=100, prod_per_shop=100, users=250, orders=800, parents=250,
             reviews=1000, favorites=800, notifications=600, stock=3000,
             announcements=40, feedback=60, tickets=30, complaints=20, s2_extra=100),
    3: dict(shops=200, prod_per_shop=200, users=550, orders=1500, parents=400,
             reviews=2500, favorites=2000, notifications=1500, stock=5000,
             announcements=60, feedback=100, tickets=50, complaints=30, s2_extra=250),
}

FIRST_NAMES = ["Aarav", "Ananya", "Arjun", "Diya", "Ishaan", "Kavya", "Krishna",
               "Meera", "Nikhil", "Priya", "Rahul", "Riya", "Rohan", "Sanya",
               "Sneha", "Varun", "Vikram", "Aditya", "Pooja", "Kiran", "Divya",
               "Harsh", "Lakshmi", "Manoj", "Neha", "Om", "Tanvi", "Yash"]
LAST_NAMES = ["Sharma", "Verma", "Reddy", "Iyer", "Patel", "Khan", "Gupta",
              "Nair", "Singh", "Das", "Kulkarni", "Rao", "Mehta", "Joshi",
              "Chopra", "Bose", "Pillai", "Agarwal", "Mishra", "Nayak"]

SHOP_CONCEPTS = [
    ("Biryani", ["Chicken Dum Biryani House", "Paradise Biryani Point", "Star Biryani Corner",
                 "Royal Biryani Kitchen", "Midnight Biryani Hub", "Andhra Spice Biryani"]),
    ("South Indian", ["Udupi Tiffin House", "Madurai Dosa Corner", "Filter Coffee Tiffins",
                      "Banana Leaf Meals", "Chennai Tiffin Express", "Dosa Plaza"]),
    ("Fast Food", ["Burger Barn", "Fries Factory", "Sandwich Square", "Pizza Pocket",
                   "Wrap Culture", "Crunchy Munchies"]),
    ("Beverages", ["Chai Sutta Point", "Juice Junction", "Cold Coffee Club",
                   "Lassi Lounge", "Bubble Tea Stop", "Fresh Lime Stand"]),
    ("Bakery", ["Night Owl Bakery", "Crumb & Crust", "Sweet Tooth Bakery",
                "Cake O'Clock", "Puff & Pastry Co", "Midnight Muffins"]),
    ("North Indian", ["Dhaba Nights", "Tandoori Tales", "Paneer Palace",
                      "Dal Makhani House", "Roti Rolla", "Chole Bhature Co"]),
    ("Chinese", ["Dragon Wok", "Hakka Noodle Bar", "Manchurian Magic",
                 "Schezwan Station", "Wok This Way", "Noodle Theory"]),
    ("Desserts", ["Ice Cream Island", "Brownie Brigade", "Kulfi Corner",
                  "Waffle Works", "Sundae Sundays", "Gulab Jamun Junction"]),
    ("Tiffins", ["Morning Tiffin Box", "Homely Meals Tiffin", "Ghar Ka Khana",
                 "Steel Dabba Service", "Amma's Tiffins", "Daily Dabba Wala"]),
    ("Snacks", ["Samosa Street", "Chaat Chowk", "Pani Puri Point",
                "Pakora Palace", "Vada Pav Van", "Bhel Bazaar"]),
]
AREAS = ["VIT-AP Campus", "Amaravati", "Guntur", "Vijayawada", "Mangalagiri",
         "Tadepalli", "Kankipadu", "Penamaluru", "Poranki", "Undavalli"]

DISHES = {
    "Biryani": [("Chicken Dum Biryani", 149, 249), ("Mutton Biryani", 229, 349),
                ("Egg Biryani", 99, 159), ("Veg Biryani", 119, 179),
                ("Chicken Fried Rice", 129, 189), ("Schezwan Rice Bowl", 139, 199),
                ("Curd Rice Combo", 79, 119), ("Birista Family Pack", 499, 799)],
    "South Indian": [("Masala Dosa", 79, 129), ("Idli Sambar (4 pc)", 49, 79),
                     ("Mendu Vada", 59, 89), ("Rava Onion Dosa", 99, 139),
                     ("Pongal", 69, 99), ("Filter Coffee", 29, 49),
                     ("Ghee Roast Dosa", 119, 159), ("Mini Tiffin Combo", 99, 149)],
    "Fast Food": [("Veggie Crunch Burger", 79, 129), ("Chicken Zinger", 129, 179),
                  ("Peri Peri Fries", 99, 139), ("Paneer Tikka Sandwich", 109, 149),
                  ("Corn Cheese Pizza (8\")", 199, 299), ("Veg Hakka Noodles", 109, 149),
                  ("Cold Coffee Frappe", 99, 139), ("Garlic Breadsticks", 89, 129)],
    "Beverages": [("Masala Chai Kulhad", 29, 49), ("Cold Coffee", 79, 119),
                  ("Mango Lassi", 69, 99), ("Fresh Lime Soda", 49, 79),
                  ("Oreo Thickshake", 119, 159), ("Buttermilk Spiced", 39, 59)],
    "Bakery": [("Choco Truffle Pastry", 69, 99), ("Veg Puff", 29, 45),
               ("Chicken Puff", 45, 65), ("Black Forest Cake 500g", 449, 649),
               ("Choco Chip Muffin", 49, 75), ("Cream Roll", 35, 55)],
    "North Indian": [("Butter Chicken + Naan", 199, 299), ("Paneer Butter Masala", 179, 249),
                     ("Dal Tadka + Jeera Rice", 149, 199), ("Chole Bhature", 99, 149),
                     ("Tandoori Roti Basket", 59, 89), ("Kadhai Veg + Rice", 159, 219)],
    "Chinese": [("Veg Fried Rice", 109, 149), ("Chicken Manchurian", 149, 199),
                ("Hakka Noodles", 109, 149), ("Chilli Paneer Dry", 159, 209),
                ("Momos Steamed (8 pc)", 89, 129), ("Schezwan Fried Rice", 129, 179)],
    "Desserts": [("Vanilla Scoop Sundae", 89, 129), ("Walnut Brownie", 99, 139),
                  ("Kulfi Falooda", 119, 159), ("Chocolate Waffle", 129, 179)],
    "Tiffins": [("Veg Meals (Full)", 99, 149), ("Chicken Meals", 149, 199),
                ("Curd Rice + Pickle", 59, 89), ("Lemon Rice", 69, 99),
                ("Tomato Bath", 69, 99), ("Monthly Veg Tiffin", 2499, 2999)],
    "Snacks": [("Punjabi Samosa (2 pc)", 39, 59), ("Pani Puri (8 pc)", 49, 79),
               ("Aloo Tikki Chaat", 69, 99), ("Masala Vada Pav", 49, 69),
               ("Onion Pakora 250g", 79, 109), ("Dahi Puri", 69, 99)],
}
COMBO_NAMES = ["Campus Feast Combo", "Buddy Box", "Exam Night Survival Pack",
               "Weekend Treat Combo", "Hostel Party Pack", "Value Meal Duo"]

REVIEW_TEXTS = ["Fresh and tasty, delivered hot.", "Good portion size for the price.",
                "Tastes homemade, will order again.", "A bit spicy for me but flavourful.",
                "Packaging was neat and spill-free.", "Average taste, quick service.",
                "Best biryani near campus, hands down.", "Coffee was lukewarm today.",
                "Amazing value combo for two people.", "Took a while but worth the wait."]

ORDER_STATUSES = ["Completed", "Completed", "Completed", "Delivered", "Delivered",
                  "Confirmed", "Preparing", "Ready", "Pending Acceptance",
                  "Cancelled", "Failed"]
PAY_METHODS = ["UPI", "UPI", "UPI", "COD", "Razorpay"]


def dsn() -> str:
    url = settings.SUPABASE_DATABASE_URL
    if not url:
        raise SystemExit("SUPABASE_DATABASE_URL is not set — refusing to run.")
    if "connect_timeout" not in url:
        sep = "&" if "?" in url else "?"
        url = f"{url}{sep}connect_timeout=10"
    return url


def connect():
    conn = psycopg2.connect(dsn())
    conn.autocommit = False
    return conn


def table_count(cur, table: str, where: str = "", params=()) -> int:
    q = f"SELECT count(*) AS c FROM {table} " + (f"WHERE {where}" if where else "")
    cur.execute(q, params) if params else cur.execute(q)
    return cur.fetchone()["c"]


def bulk_insert(cur, sql: str, rows: list[tuple], label: str) -> None:
    if not rows:
        return
    widths = {len(r) for r in rows}
    assert len(widths) == 1, f"{label}: ragged rows {widths}"
    psycopg2.extras.execute_values(cur, sql, rows, page_size=1000)
    print(f"  {label}: +{len(rows)}", flush=True)


def past_dt(rng: random.Random, max_days: int = 45) -> datetime:
    return datetime.now(timezone.utc) - timedelta(
        days=rng.randint(0, max_days), hours=rng.randint(0, 23),
        minutes=rng.randint(0, 59))


# ─── generators ──────────────────────────────────────────────────────────

def gen_shops(rng: random.Random, start_idx: int, count: int) -> list[tuple]:
    rows = []
    for k in range(count):
        i = start_idx + k
        cat, names = SHOP_CONCEPTS[i % len(SHOP_CONCEPTS)]
        name = f"{rng.choice(names)} {AREAS[i % len(AREAS)].split()[0]}-{100 + (i % 800)}"
        roll = rng.random()
        if roll < 0.72:
            approval, present, status = "Approved", True, "Open"
        elif roll < 0.82:
            approval, present, status = "Approved", False, "Closed"
        elif roll < 0.88:
            approval, present, status = "Approved", True, "Busy"
        elif roll < 0.94:
            approval, present, status = "Pending Approval", False, "Closed"
        elif roll < 0.97:
            approval, present, status = "Suspended", False, "Closed"
        else:
            approval, present, status = "Approved", False, "Maintenance"
        rating = round(min(5.0, max(2.8, rng.gauss(4.1, 0.5))), 1)
        rows.append((
            f"s{3 + i}", name, cat,
            f"{cat} kitchen near {AREAS[i % len(AREAS)]} serving fresh food for campus orders. " * 1,
            rating, rng.choice(["08:00 AM", "09:00 AM", "10:00 AM", "11:00 AM"]),
            rng.choice(["08:00 PM", "09:00 PM", "10:00 PM", "11:30 PM"]),
            present, status, approval,
            f"perfkeeper{i}@perfseed.test", f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}",
            f"+91{rng.choice(['98', '99', '90', '91', '96', '97'])}{rng.randint(10000000, 99999999)}",
            f"perfshop{i}@upi", rng.choice([True, True, True, False]),
            rng.choice([True, True, True, False]),
            rng.randint(0, 120), rng.randint(0, 15000),
            rng.randint(18, 400), False, 0, None,
            f"+91{rng.choice(['98', '99'])}{rng.randint(10000000, 99999999)}",
            rng.randint(0, 200), rng.random() < 0.08,
            "" if rng.random() < 0.85 else "https://images.unsplash.com/photo-1504674900247-0877df9cc836",
        ))
    return rows


SHOP_COLS = ("id, name, category, description, rating, opening_time, closing_time, "
             "present, status, approval_status, shopkeeper_email, shopkeeper_name, phone, "
             "upi_id, upi_enabled, cod_enabled, orders_today, revenue_today, current_token, "
             "is_removed, admin_dues_balance, admin_dues_last_paid_at, whatsapp_number, "
             "ordering_position, is_featured, shop_image")


def gen_products(rng: random.Random, shop_id: str, shop_idx: int, cat: str,
                 start_num: int, count: int) -> tuple[list[tuple], int]:
    dishes = DISHES.get(cat, DISHES["Snacks"])
    rows = []
    n = start_num
    for j in range(count):
        dname, plo, phi = dishes[(shop_idx + j) % len(dishes)]
        variant = "" if j < len(dishes) else f" v{(j // len(dishes)) + 1}"
        is_combo = rng.random() < 0.06
        price = rng.randint(plo, phi)
        rows.append((
            f"p{n}", shop_id, f"{dname}{variant}",
            f"Tasty {dname.lower()} prepared fresh. " + rng.choice(REVIEW_TEXTS),
            price, None,
            "Combo" if is_combo else (cat if rng.random() < 0.9 else rng.choice(list(DISHES))[0]),
            rng.randint(0, 60), rng.choice([5, 10, 10, 15, 20]),
            rng.random() < 0.9, is_combo,
            ("\n".join(rng.sample([d[0] for d in dishes], k=3))) if is_combo else "",
        ))
        n += 1
    if count >= 8 and not any(r[10] for r in rows):
        # Guarantee at least one combo per menu: rebuild row 0 as a combo.
        r0 = rows[0]
        rows[0] = (r0[0], r0[1], COMBO_NAMES[shop_idx % len(COMBO_NAMES)], r0[3],
                   r0[4], r0[5], "Combo", r0[7], r0[8], r0[9], True,
                   "Extra fries\nFree lime soda\nDessert of the day")
    return rows, n


PROD_COLS = ("id, shop_id, name, description, price, pending_price, category, "
             "inventory, prep_time, available, is_combo, combo_items")


def gen_users(rng: random.Random, start_idx: int, count: int, keeper_emails: set[str]) -> list[tuple]:
    rows = []
    for k in range(count):
        i = start_idx + k
        fn, ln = rng.choice(FIRST_NAMES), rng.choice(LAST_NAMES)
        r = rng.random()
        role = "shopkeeper" if r < 0.10 else ("admin" if r < 0.115 else "student")
        email = "" if i % 7 == 3 else f"perfuser{i:05d}@perfseed.test"
        if email in keeper_emails:
            email = f"perfuser{i:05d}+{i}@perfseed.test"
        status = "active" if rng.random() < 0.95 else rng.choice(["inactive", "suspended"])
        rows.append((
            f"perfuser{i:05d}", "$2b$12$perfseedhashplaceholderfortestingonly00000000000",
            f"{fn} {ln}", email,
            f"+91{rng.choice(['98', '99', '90', '91'])}{rng.randint(10000000, 99999999)}",
            role, status, "",
            (datetime.now(timezone.utc) - timedelta(days=rng.randint(0, 180))).isoformat(),
        ))
    return rows


# ─── seeding ─────────────────────────────────────────────────────────────

def seed_level(level: int) -> None:
    tgt = LEVELS[level]
    rng = random.Random(RNG_SEED)
    conn = connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT count(*) c FROM shops WHERE id IN ('s1','s2')")
            if cur.fetchone()["c"] != 2:
                raise SystemExit("Expected dev shops s1/s2 not found — wrong database? Aborting.")
            have_shops = table_count(cur, "shops", "id ~ '^s[0-9]+$' AND id NOT IN ('s1','s2')")
            have_users = table_count(cur, "users", "username LIKE 'perfuser%'")
            print(f"existing marked: shops={have_shops} users={have_users}")

            # shops (contiguous s3+)
            need_shops = max(0, tgt["shops"] - have_shops)
            if need_shops:
                shop_rows = gen_shops(rng, have_shops, need_shops)
                bulk_insert(cur, f"INSERT INTO shops ({SHOP_COLS}) VALUES %s ON CONFLICT (id) DO NOTHING",
                            [tuple(r) for r in shop_rows], "shops")
            conn.commit()

            cur.execute("SELECT id, category FROM shops WHERE id ~ '^s[0-9]+$' AND id NOT IN ('s1','s2') ORDER BY id")
            shops = [(r["id"], r["category"]) for r in cur.fetchall()]
            # s2 category for its extra menu
            cur.execute("SELECT category FROM shops WHERE id='s2'")
            s2cat = cur.fetchone()["category"]

            # products per shop (top up to level target; skewed counts at L3)
            # Floor at 1001: p1..p8 are the pre-existing dev rows and the app
            # derives new ids from MAX(numeric suffix), so seeded ids must be
            # p<int> and must never reuse the dev range.
            cur.execute("SELECT COALESCE(MAX(SUBSTRING(id FROM 2)::int), 1000) AS m FROM products "
                        "WHERE id ~ '^p[0-9]+$' AND SUBSTRING(id FROM 2)::int < 90000")
            pnext = max(1001, int(cur.fetchone()["m"]) + 1)
            per_shop_target = tgt["prod_per_shop"]
            for si, (sid, scat) in enumerate(shops):
                have = table_count(cur, "products", "shop_id = %s", (sid,))
                want = per_shop_target
                if level == 3:
                    want = 150 + (si * 37) % 111  # 150..260 skewed, deterministic
                if want > have:
                    prows, pnext = gen_products(rng, sid, si, scat, pnext, want - have)
                    bulk_insert(cur, f"INSERT INTO products ({PROD_COLS}) VALUES %s ON CONFLICT (id) DO NOTHING",
                                prows, f"products[{sid}]")
            conn.commit()

            # s2 stress menu (p95xxx, L2+)
            if tgt["s2_extra"]:
                have_s2 = table_count(cur, "products", "shop_id='s2' AND id ~ '^p9[0-9]+$'")
                if tgt["s2_extra"] > have_s2:
                    prows, _ = gen_products(rng, "s2", 999, s2cat, 95001 + have_s2,
                                            tgt["s2_extra"] - have_s2)
                    bulk_insert(cur, f"INSERT INTO products ({PROD_COLS}) VALUES %s ON CONFLICT (id) DO NOTHING",
                                prows, "products[s2-extra]")
                    conn.commit()

            # users
            keeper_emails = {f"perfkeeper{i}@perfseed.test" for i in range(tgt["shops"])}
            need_users = max(0, tgt["users"] - have_users)
            if need_users:
                urows = gen_users(rng, have_users, need_users, keeper_emails)
                bulk_insert(cur, "INSERT INTO users (username, password_hash, name, email, phone, role, status, avatar_url, created_at) "
                                 "VALUES %s ON CONFLICT (username) DO NOTHING",
                            urows, "users")
                conn.commit()
            cur.execute("SELECT id, username, name, phone, email FROM users WHERE username LIKE 'perfuser%' ORDER BY id")
            users = [dict(r) for r in cur.fetchall()]
            students = [u for u in users]
            cur.execute("SELECT id, name, phone FROM shops WHERE approval_status='Approved' AND id ~ '^s[0-9]+$'")
            approved = [dict(r) for r in cur.fetchall()] or [{"id": "s2", "name": "s2", "phone": ""}]

            # single orders o1999*
            have_orders = table_count(cur, "orders", "id LIKE 'o1999%'")
            need = max(0, tgt["orders"] - have_orders)
            order_ids, order_shop = [], {}
            if need:
                cur.execute("SELECT COALESCE(MAX(SUBSTRING(id FROM 11)::int), 0) AS m FROM orders WHERE id LIKE 'o1999%'")
                onext = int(cur.fetchone()["m"]) + 1
                orows = []
                for k in range(need):
                    n = onext + k
                    oid = f"o19990101-{n:05d}"
                    u = rng.choice(students); s = rng.choice(approved)
                    nlines = rng.choice([1, 1, 2, 2, 3, 4])
                    items, sub = [], 0
                    for _ in range(nlines):
                        price, qty = rng.choice([49, 79, 99, 129, 149, 199]), rng.randint(1, 3)
                        items.append({"name": f"Dish-{rng.randint(1, 9999)}", "price": price, "quantity": qty})
                        sub += price * qty
                    method = rng.choice(PAY_METHODS)
                    status = rng.choice(ORDER_STATUSES)
                    orows.append((oid, str(u["id"]), rng.randint(18, 900), u["name"], u["phone"],
                                  s["id"], s["name"], json.dumps(items), sub, 10, 0, 0, sub + 10,
                                  "VIT-AP Main Gate", rng.choice(["Afternoon", "Night"]),
                                  status, method, past_dt(rng).isoformat()))
                    order_ids.append(oid)
                    order_shop[oid] = s["id"]
                bulk_insert(cur, "INSERT INTO orders (id, owner_user_id, token, student_name, student_phone, shop_id, shop_name, items, subtotal, service_fee, tax, delivery_fee, total, delivery_location, delivery_slot, status, payment_method, created_at) VALUES %s ON CONFLICT (id) DO NOTHING",
                            orows, "orders")
                conn.commit()
            else:
                cur.execute("SELECT id, shop_id FROM orders WHERE id LIKE 'o1999%'")
                for r in cur.fetchall():
                    order_ids.append(r["id"]); order_shop[r["id"]] = r["shop_id"]

            # payments pay9* (80% of seeded single orders without one yet)
            if order_ids:
                cur.execute("SELECT order_id FROM payments WHERE order_id LIKE 'o1999%'")
                has_pay = {r["order_id"] for r in cur.fetchall()}
                candidates = [o for o in order_ids if o not in has_pay and rng.random() < 0.8]
                payrows = []
                base = 90001 + table_count(cur, "payments", "id LIKE 'pay9%'")
                for k, oid in enumerate(candidates):
                    payrows.append((f"pay{base + k}", oid, rng.choice([99, 149, 199, 249, 349]),
                                    rng.choice(["UPI", "UPI", "COD", "Razorpay"]),
                                    rng.choice(["Success", "Success", "Success", "Pending", "Failed"]),
                                    f"PERFUTR{(base + k):08d}" if rng.random() < 0.4 else None,
                                    None, past_dt(rng).isoformat()))
                bulk_insert(cur, "INSERT INTO payments (id, order_id, amount, method, status, utr_number, screenshot_name, created_at) VALUES %s ON CONFLICT (id) DO NOTHING",
                            payrows, "payments")
                conn.commit()

            # parent orders + sub orders + order items
            have_parents = table_count(cur, "parent_orders", "id LIKE 'p1999%'")
            need_p = max(0, tgt["parents"] - have_parents)
            if need_p:
                cur.execute("SELECT COALESCE(MAX(SUBSTRING(id FROM 11)::int), 0) AS m FROM parent_orders WHERE id LIKE 'p1999%'")
                pnext = int(cur.fetchone()["m"]) + 1
                parows, subrows, itemrows = [], [], []
                for k in range(need_p):
                    n = pnext + k
                    pid = f"p19990101-{n:05d}"
                    u = rng.choice(students)
                    nsubs = rng.choice([1, 1, 1, 2, 2, 3])
                    total, subids = 0, []
                    for si in range(nsubs):
                        subid = f"{pid}-{si + 1}"
                        s = rng.choice(approved)
                        nitems = rng.randint(1, 3)
                        subtotal, summary = 0, []
                        for _ in range(nitems):
                            price, qty = rng.choice([49, 79, 99, 129, 149]), rng.randint(1, 2)
                            pname = f"Dish-{rng.randint(1, 9999)}"
                            itemrows.append((subid, f"pp{n}-{si}-{_}", pname, price, qty, price * qty,
                                             past_dt(rng).isoformat()))
                            subtotal += price * qty
                            summary.append(f"{pname}x{qty}")
                        comm = subtotal * 5 // 100
                        # Status mix includes terminal states for realism.
                        subrows.append((subid, pid, s["id"], s["name"], s.get("phone", ""), "",
                                        rng.randint(18, 900), "; ".join(summary), subtotal, comm,
                                        rng.choice(["Pending", "Accepted", "Preparing", "Ready",
                                                    "Delivered", "Completed", "Cancelled"]),
                                        rng.choice(["Afternoon", "Night"]), "", past_dt(rng).isoformat()))
                        total += subtotal
                    parows.append((pid, str(u["id"]), rng.randint(18, 900), "1999-01-01",
                                   u["name"], u["phone"], u.get("email", ""), "", total,
                                   rng.choice(PAY_METHODS), rng.choice(["Pending", "Paid", "Failed"]),
                                   "VIT-AP Main Gate", rng.choice(["Pending", "Confirmed", "Delivered", "Cancelled"]),
                                   past_dt(rng).isoformat()))
                bulk_insert(cur, "INSERT INTO parent_orders (id, owner_user_id, token, date_key, student_name, student_phone, student_email, student_id, total, payment_method, payment_status, delivery_location, status, created_at) VALUES %s ON CONFLICT (id) DO NOTHING",
                            parows, "parent_orders")
                bulk_insert(cur, "INSERT INTO shop_sub_orders (id, parent_order_id, shop_id, shop_name, shop_phone, shop_whatsapp, token, items_summary, subtotal, commission_5pct, status, batch_type, rejection_reason, created_at) VALUES %s ON CONFLICT (id) DO NOTHING",
                            subrows, "sub_orders")
                bulk_insert(cur, "INSERT INTO order_items (sub_order_id, product_id, product_name, price, quantity, total, created_at) VALUES %s",
                            itemrows, "order_items")
                conn.commit()

            # reviews rv3*
            have_rv = table_count(cur, "reviews", "id LIKE 'rv3%'")
            need_rv = max(0, tgt["reviews"] - have_rv)
            if need_rv:
                cur.execute("SELECT COALESCE(MAX(SUBSTRING(id FROM 3)::int), 30000) AS m FROM reviews WHERE id ~ '^rv[0-9]+$'")
                rnext = max(30001, int(cur.fetchone()["m"]) + 1)
                rrows = []
                for k in range(need_rv):
                    u = rng.choice(students); s = rng.choice(approved)
                    rating = rng.choice([5, 5, 5, 4, 4, 4, 3, 2, 1])
                    rrows.append((f"rv{rnext + k}", u["id"], u["username"], u["name"], s["id"], s["name"],
                                  rating, rng.choice(REVIEW_TEXTS), past_dt(rng, 90).isoformat()))
                bulk_insert(cur, "INSERT INTO reviews (id, user_id, username, student_name, shop_id, shop_name, rating, comment, created_at) VALUES %s ON CONFLICT (id) DO NOTHING",
                            rrows, "reviews")
                conn.commit()

            # favorites (unique phone+product)
            have_fv = table_count(cur, "favorites", "product_id ~ '^p[0-9]+$'")
            need_fv = max(0, tgt["favorites"] - have_fv)
            if need_fv and students:
                cur.execute("SELECT id FROM products WHERE id ~ '^p[0-9]+$' ORDER BY id LIMIT 20000")
                pids = [r["id"] for r in cur.fetchall()]
                pairs, frows, seen = set(), [], set()
                guard = 0
                while len(frows) < need_fv and guard < need_fv * 10 and pids:
                    guard += 1
                    pair = (rng.choice(students)["phone"], rng.choice(pids))
                    if pair in seen or not pair[0]:
                        continue
                    seen.add(pair)
                    frows.append((pair[0], pair[1], past_dt(rng, 90).isoformat()))
                bulk_insert(cur, "INSERT INTO favorites (student_phone, product_id, created_at) VALUES %s ON CONFLICT (student_phone, product_id) DO NOTHING",
                            frows, "favorites")
                conn.commit()

            # notifications n1*
            # NOTE: LIKE 'n1%' does NOT count n6..n9/n20.. (only ids starting
            # with 'n1'), which once caused over-insertion. Count the numeric
            # range explicitly.
            have_n = table_count(cur, "notifications", "id ~ '^n[0-9]+$' AND SUBSTRING(id FROM 2)::int >= 6")
            need_n = max(0, tgt["notifications"] - have_n)
            if need_n:
                # Floor at 10001: the app also writes n<int> rows, so only the
                # 10001+ range is unambiguously ours (see --clean manifest note).
                cur.execute("SELECT COALESCE(MAX(SUBSTRING(id FROM 2)::int), 10000) AS m FROM notifications WHERE id ~ '^n[0-9]+$'")
                nnext = max(10001, int(cur.fetchone()["m"]) + 1)
                nrows = []
                for k in range(need_n):
                    role = rng.choice(["student", "student", "admin", "shopkeeper", ""])
                    oid = rng.choice(order_ids) if order_ids and rng.random() < 0.3 else None
                    nrows.append((f"n{nnext + k}", rng.choice(["Order update", "New order", "Payment received", "Menu change"]),
                                  rng.choice(REVIEW_TEXTS), oid,
                                  rng.choice(["Pending", "Confirmed", "Completed"]), role,
                                  rng.random() < 0.3, "", "none", past_dt(rng, 30).isoformat()))
                bulk_insert(cur, "INSERT INTO notifications (id, title, message, order_id, status, target_role, is_read, action, action_state, created_at) VALUES %s ON CONFLICT (id) DO NOTHING",
                            nrows, "notifications")
                conn.commit()

            # product stock (unique product+date+batch)
            have_st = table_count(cur, "product_stock", "product_id ~ '^p[0-9]+$'")
            need_st = max(0, tgt["stock"] - have_st)
            if need_st:
                from datetime import date as _d
                today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
                yday = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")
                cur.execute("SELECT id FROM products WHERE id ~ '^p[0-9]+$' ORDER BY RANDOM() LIMIT 6000")
                pids = [r["id"] for r in cur.fetchall()]
                srows, seen = [], set()
                guard = 0
                while len(srows) < need_st and guard < need_st * 10 and pids:
                    guard += 1
                    key = (rng.choice(pids), rng.choice([today, yday]), rng.choice(["Afternoon", "Night"]))
                    if key in seen:
                        continue
                    seen.add(key)
                    srows.append((key[0], key[1], key[2], rng.randint(0, 80), past_dt(rng, 2).isoformat()))
                bulk_insert(cur, "INSERT INTO product_stock (product_id, date_key, batch_type, total_stock, created_at) VALUES %s ON CONFLICT (product_id, date_key, batch_type) DO NOTHING",
                            srows, "product_stock")
                conn.commit()

            # announcements / feedback / tickets / complaints (small)
            have_a = table_count(cur, "shop_announcements", "id LIKE 'ann\\_perf%'")
            need_a = max(0, tgt["announcements"] - have_a)
            if need_a:
                arows = [(f"ann_perf{have_a + k:04d}", rng.choice([s["id"] for s in approved]),
                          f"Special offer week! Flat 10% off on combos.", rng.random() < 0.8,
                          past_dt(rng, 30).isoformat()) for k in range(need_a)]
                bulk_insert(cur, "INSERT INTO shop_announcements (id, shop_id, message, is_active, created_at) VALUES %s ON CONFLICT (id) DO NOTHING",
                            arows, "announcements")
                conn.commit()

            have_fb = table_count(cur, "site_feedback", "id LIKE 'fb5%'")
            need_fb = max(0, tgt["feedback"] - have_fb)
            if need_fb:
                cur.execute("SELECT COALESCE(MAX(SUBSTRING(id FROM 3)::int), 50000) AS m FROM site_feedback WHERE id ~ '^fb[0-9]+$'")
                fnext = max(50001, int(cur.fetchone()["m"]) + 1)
                fbrows = []
                for k in range(need_fb):
                    u = rng.choice(students)
                    fbrows.append((f"fb{fnext + k}", u["id"], u["username"], u["name"], u.get("email", ""),
                                   rng.choice(["Bug", "Improvement", "Suggestion", "Other"]),
                                   f"Perf test feedback {fnext + k}", rng.choice(REVIEW_TEXTS),
                                   rng.choice(["/shops", "/shop/s2", "/cart"]),
                                   rng.choice(["Open", "In Review", "Fixed"]), "ATS",
                                   past_dt(rng, 60).isoformat()))
                bulk_insert(cur, "INSERT INTO site_feedback (id, user_id, username, name, email, category, subject, message, page, status, source, created_at) VALUES %s ON CONFLICT (id) DO NOTHING",
                            fbrows, "feedback")
                conn.commit()

            have_t = table_count(cur, "tickets", "id LIKE 't9%'")
            need_t = max(0, tgt["tickets"] - have_t)
            if need_t:
                base = 90001 + have_t
                trows = []
                for k in range(need_t):
                    u = rng.choice(students)
                    trows.append((f"t{base + k}", f"TKT-{91000 + base + k}", u["name"], u.get("email", ""),
                                  u["phone"], rng.choice(["Payment", "Order", "Account", "Other"]),
                                  f"Perf ticket {base + k}", rng.choice(REVIEW_TEXTS),
                                  rng.choice(["Open", "Closed"]), past_dt(rng, 60).isoformat()))
                bulk_insert(cur, "INSERT INTO tickets (id, ticket_number, name, email, phone_number, category, title, description, status, created_at) VALUES %s ON CONFLICT (id) DO NOTHING",
                            trows, "tickets")
                conn.commit()

            have_c = table_count(cur, "complaints", "id LIKE 'c9%'")
            need_c = max(0, tgt["complaints"] - have_c)
            if need_c:
                base = 90001 + have_c
                crows = []
                for k in range(need_c):
                    u = rng.choice(students); s = rng.choice(approved)
                    crows.append((f"c{base + k}", f"p19990101-{(k % max(1, tgt['parents'])) + 1:05d}", "",
                                  u["name"], u["phone"], s["id"], s["name"],
                                  "Late delivery", rng.choice(REVIEW_TEXTS), "",
                                  rng.choice(["New", "Open", "Resolved"]), "",
                                  past_dt(rng, 30).isoformat()))
                bulk_insert(cur, "INSERT INTO complaints (id, parent_order_id, sub_order_id, student_name, student_phone, shop_id, shop_name, subject, message, proof_url, status, admin_notes, created_at) VALUES %s ON CONFLICT (id) DO NOTHING",
                            crows, "complaints")
                conn.commit()

        print("seed complete", flush=True)
    finally:
        conn.close()


MANIFEST_PATH = "scripts/.seed_perf_manifest.json"

#: Exact titles/messages this script ever writes to notifications — the only
#: reliable fingerprint, because app/test runs also write n<int> rows.
SEED_NOTIF_TITLES = ("Order update", "New order", "Payment received", "Menu change")


def _write_manifest(start_iso: str) -> None:
    import json as _json
    from datetime import datetime as _dt, timezone as _tz
    try:
        with open(MANIFEST_PATH, "w") as f:
            _json.dump({"seed_window_start": start_iso,
                        "seed_window_end": _dt.now(_tz.utc).isoformat(),
                        "review_texts": REVIEW_TEXTS}, f)
    except OSError as e:
        print(f"WARNING: could not write manifest ({e}) — --clean will be less precise")


def _read_manifest():
    import json as _json
    try:
        with open(MANIFEST_PATH) as f:
            return _json.load(f)
    except (OSError, ValueError):
        return None


def clean(dry_run: bool = False) -> None:
    """Delete ONLY perf-seeded rows.

    Id-range predicates cover the reserved namespaces; a created_at upper bound
    from the seed manifest protects real rows created AFTER seeding (the app
    continues the same p<int>/n<int>/rv<int> sequences). Notifications are
    matched by content fingerprint + seed window because live app/test runs
    also write n<int> rows.
    """
    import json as _json
    man = _read_manifest()
    if man is None:
        print("No manifest found — using id predicates only (less precise).")
        wstart, wend = "2000-01-01T00:00:00+00:00", "2999-01-01T00:00:00+00:00"
        texts = list(REVIEW_TEXTS)
    else:
        wstart, wend, texts = man["seed_window_start"], man["seed_window_end"], man["review_texts"]
    conn = connect()
    try:
        with conn.cursor() as cur:
            print(("DRY-RUN — " if dry_run else "") + "deleting ONLY perf-marked rows...", flush=True)
            stmts = [
                ("order_items", "DELETE FROM order_items WHERE sub_order_id LIKE 'p1999%%' AND created_at <= %s", (wend,)),
                ("payments", "DELETE FROM payments WHERE id LIKE 'pay9%%' AND created_at <= %s", (wend,)),
                ("notifications", "DELETE FROM notifications WHERE title = ANY(%s) AND message = ANY(%s) "
                                  "AND (order_id LIKE 'o1999%%' OR order_id IS NULL) "
                                  "AND created_at >= %s AND created_at <= %s",
                 (list(SEED_NOTIF_TITLES), texts, wstart, wend)),
                ("sub_orders", "DELETE FROM shop_sub_orders WHERE id LIKE 'p1999%%' AND created_at <= %s", (wend,)),
                ("parent_orders", "DELETE FROM parent_orders WHERE id LIKE 'p1999%%' AND created_at <= %s", (wend,)),
                ("orders", "DELETE FROM orders WHERE id LIKE 'o1999%%' AND created_at <= %s", (wend,)),
                ("favorites", "DELETE FROM favorites WHERE product_id ~ '^p[0-9]+$' AND SUBSTRING(product_id FROM 2)::int >= 9 "
                              "AND SUBSTRING(product_id FROM 2)::int NOT IN (1,2,3,4,5,6,7,8) AND created_at <= %s", (wend,)),
                ("product_stock", "DELETE FROM product_stock WHERE product_id ~ '^p[0-9]+$' AND SUBSTRING(product_id FROM 2)::int >= 9 "
                                  "AND SUBSTRING(product_id FROM 2)::int NOT IN (1,2,3,4,5,6,7,8) AND created_at <= %s", (wend,)),
                ("reviews", "DELETE FROM reviews WHERE id ~ '^rv[0-9]+$' AND SUBSTRING(id FROM 3)::int >= 30001 AND created_at <= %s", (wend,)),
                ("site_feedback", "DELETE FROM site_feedback WHERE source='ATS' AND created_at >= %s AND created_at <= %s", (wstart, wend)),
                ("tickets", "DELETE FROM tickets WHERE id LIKE 't9%%' AND created_at <= %s", (wend,)),
                ("complaints", "DELETE FROM complaints WHERE id LIKE 'c9%%' AND created_at <= %s", (wend,)),
                ("announcements", "DELETE FROM shop_announcements WHERE LEFT(id, 8)='ann_perf' AND created_at <= %s", (wend,)),
                ("products", "DELETE FROM products WHERE id ~ '^p[0-9]+$' AND SUBSTRING(id FROM 2)::int >= 9 "
                             "AND SUBSTRING(id FROM 2)::int NOT IN (1,2,3,4,5,6,7,8) AND created_at <= %s", (wend,)),
                ("shops", "DELETE FROM shops WHERE id ~ '^s[0-9]+$' AND id NOT IN ('s1','s2') AND created_at <= %s", (wend,)),
                ("users", "DELETE FROM users WHERE username LIKE 'perfuser%%' AND created_at <= %s", (wend,)),
            ]
            for label, sql, params in stmts:
                cur.execute(sql, params)
                print(f"  {label}: {cur.rowcount}")
            if dry_run:
                conn.rollback()
                print("dry-run: rolled back, nothing deleted")
            else:
                conn.commit()
                print("clean complete — s1/s2 and all unmarked rows untouched", flush=True)
    finally:
        conn.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="Perf seed (dev/staging only)")
    ap.add_argument("--level", type=int, choices=[1, 2, 3], default=1)
    ap.add_argument("--clean", action="store_true")
    ap.add_argument("--dry-run", action="store_true", help="with --clean: only print what would be deleted")
    ap.add_argument("--yes", action="store_true", help="confirm writes to the database")
    args = ap.parse_args()
    if not args.yes:
        print("Refusing to run without --yes (dev/staging safety). Nothing was written.")
        raise SystemExit(2)
    print(f"DSN host: {settings.SUPABASE_DATABASE_URL.split('@')[-1][:40]}...")
    if args.clean:
        clean(dry_run=args.dry_run)
    else:
        from datetime import datetime as _dt, timezone as _tz
        start = _dt.now(_tz.utc).isoformat()
        seed_level(args.level)
        _write_manifest(start)


if __name__ == "__main__":
    main()
