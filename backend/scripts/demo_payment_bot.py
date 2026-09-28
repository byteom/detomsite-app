"""Website ↔ payment-bot demo & BUG HUNT for DETOMSITE.

Drives the REAL HTTP API (ASGI app) on a THROWAWAY SQLite database — Supabase is
hard-blocked, so a bug can never touch production data.

The happy path it walks is the one students actually use:

  1. Vendor registers → admin approves the shop → student browses and adds food.
  2. Student checks out with the UPI QR method (exactly what the portal sends).
  3. Student opens the PAYMENT PORTAL (``GET /orders/{id}/payment``) and saves
     the transaction reference from their UPI app.
  4. The bank credits the shop. The phone bot posts ``/sms/match``.
  5. The order flips to Completed and that is verified in FOUR places at once:
     the student's order page, the student's payment portal, the admin orders
     list, and the admin payments table — plus the WhatsApp outbox flips to
     "paid ✓".
  6. A second order with NO reference is settled by amount (tier 2).

Then it attacks the flow. Every check below is an assertion: a red line means a
real bug, and the script exits non-zero.

Run:  python scripts/demo_payment_bot.py        (from the backend/ directory)
"""
import asyncio
import os
import sys
import tempfile
from datetime import datetime, time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# ── Force a throwaway local DB BEFORE any app import (same guard as tests) ──
_DEMO_DIR = tempfile.mkdtemp(prefix="detomsite-botdemo-")
os.environ["LOCAL_DB_PATH"] = os.path.join(_DEMO_DIR, "demo.db")
os.environ["KV_REST_API_URL"] = ""
os.environ["KV_REST_API_TOKEN"] = ""
os.environ["UPSTASH_REDIS_REST_URL"] = ""
os.environ["UPSTASH_REDIS_REST_TOKEN"] = ""
os.environ["REDIS_URL"] = ""
os.environ["DETOMSITE_EMBEDDED_REDIS"] = "0"
os.environ["SUPABASE_DATABASE_URL"] = ""
os.environ["SUPABASE_DB_HOST"] = ""
os.environ["SUPABASE_DB_PASSWORD"] = ""
os.environ["DEBUG"] = "True"
os.environ["JWT_SECRET"] = "demo-only-secret"
# A real agent key, so the demo exercises the ACTUAL shared-secret gate rather
# than the DEBUG bypass the tests use.
os.environ["SMS_FORWARD_KEY"] = "demo-agent-key"

import httpx

from app.main import app
from app.core import config, local_demo_db, order_slots as slots_mod, store as store_mod
from app.core.config import settings
from app.core.store import store as db
from app.core.security import hash_password

settings.SMS_FORWARD_KEY = "demo-agent-key"
settings.DEBUG = True

RUN = datetime.now().strftime("%d %b %Y %H:%M")
AGENT = {"X-Agent-Key": "demo-agent-key"}
GATE = "VIT-AP Main Gate"

# ── Tiny assertion harness ─────────────────────────────────────────────────
_RESULTS: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    _RESULTS.append((name, bool(ok), detail))
    print(f"    {'✓' if ok else '✗ FAIL'}  {name}" + (f"  → {detail}" if detail and not ok else ""))
    return bool(ok)


def step(title: str) -> None:
    print(f"\n{'─' * 74}\n  {title}\n{'─' * 74}")


def freeze_morning() -> None:
    """Pin IST to 10:00 AM so orders auto-accept inside the delivery window."""
    import app.api.v1.local as local_mod

    fixed = datetime(2026, 8, 16, 10, 0, tzinfo=slots_mod.KOLKATA_TZ)
    slots_mod.now_kolkata = lambda: fixed
    local_mod.now_kolkata = lambda: fixed
    local_mod.slot_cutoff_for = lambda _dt: time(12, 30)


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def make_student(client, username: str, phone: str) -> str:
    await client.post("/api/v1/local/auth/register", json={
        "username": username, "password": "password123", "name": username.title(),
        "role": "student", "email": f"{username}@demo.in", "phone": phone,
    })
    res = await client.post("/api/v1/local/auth/login", json={
        "username": username, "password": "password123",
    })
    return res.json()["access_token"]


def make_shop(name: str, phone: str, price: int):
    """An approved, open shop with a UPI ID + one product."""
    shop = db.create_shop({
        "name": name, "category": "Food", "description": "Demo shop",
        "shopkeeper_email": f"{name.lower().replace(' ', '-')}@demo.in",
        "shopkeeper_name": f"{name} Owner", "phone": phone,
        "whatsapp_number": phone, "upi_id": f"{name.split()[0].lower()}@upi",
        "upi_enabled": 1, "cod_enabled": 1,
    })
    db.update_shop(shop["id"], {"approval_status": "Approved", "present": True, "status": "Open"})
    product = db.create_product({
        "shop_id": shop["id"], "name": "Masala Dosa", "description": "Crisp dosa",
        "price": price, "category": "Food", "inventory": 99, "prep_time": 10, "available": True,
    })
    return db.get_shop(shop["id"]), product


async def checkout(client, token: str, shop, product, qty: int = 1, method: str = "UPI") -> dict:
    """Exactly the payload the student portal's checkout page posts."""
    res = await client.post("/api/v1/local/orders", json={
        "shop_id": shop["id"],
        "items": [{"product_id": product["id"], "quantity": qty}],
        "student_name": "Demo Student", "student_phone": "+919000000123",
        "delivery_location": GATE, "delivery_slot": "Morning",
        "payment_method": method, "total": product["price"] * qty,
    }, headers=auth(token))
    if res.status_code != 200:
        raise SystemExit(f"checkout failed: {res.status_code} {res.text}")
    order = res.json()
    # The portal records a payment row per order right after placing it.
    pay = await client.post("/api/v1/local/payments", json={
        "order_id": order["id"], "amount": order["total"],
        "method": "COD" if method == "COD" else "Manual UTR", "utr_number": "",
    }, headers=auth(token))
    if pay.status_code != 200:
        raise SystemExit(f"payment row failed: {pay.status_code} {pay.text}")
    return order


def _init_throwaway_store() -> None:
    """Point the store at SQLite and make any Supabase call a hard error."""
    from app.core import shared_cache, supabase_db

    def _forbid_supabase(*a, **k):
        raise AssertionError("BUG: the demo touched Supabase — it must never.")

    store_mod._use_test_store(local_demo_db)
    supabase_db._connect = _forbid_supabase
    shared_cache.enabled = lambda: False
    shared_cache._pg_enabled = lambda: False
    local_demo_db.init_local_demo_db()


def _report() -> int:
    """Print the verdict. Returns a process exit code (0 = no bugs found)."""
    passed = [r for r in _RESULTS if r[1]]
    failed = [r for r in _RESULTS if not r[1]]
    print("\n" + "=" * 74)
    print(f"  VERDICT: {len(passed)}/{len(_RESULTS)} checks passed")
    if failed:
        print(f"\n  {len(failed)} BUG(S) FOUND:")
        for name, _, detail in failed:
            print(f"    ✗ {name}\n        → {detail}")
    else:
        print("  No bugs found. The website ↔ bot payment flow behaves as designed.")
    print("=" * 74)
    return 1 if failed else 0


async def main() -> int:
    print("=" * 74)
    print(f"  DETOMSITE — website ↔ payment-bot demo & bug hunt   ({RUN})")
    print("  Throwaway SQLite. Supabase is hard-blocked for this process.")
    print("=" * 74)

    _init_throwaway_store()
    freeze_morning()

    # A real admin row (public registration refuses role=admin).
    db.register_user(username="demo_admin", password_hash=hash_password("admin_pass_123"),
                     name="Demo Admin", role="admin", email="admin@demo.in", phone="+919000000001")
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://demo")

    admin_login = await client.post("/api/v1/admin/login",
                                    json={"username": "demo_admin", "password": "admin_pass_123"})
    admin = admin_login.json()["access_token"]
    stu = await make_student(client, "demo_student", "+919000000123")
    other_stu = await make_student(client, "demo_other", "+919000000456")

    shop, product = make_shop("Sai Tiffins", "9876543210", 120)
    shop2, product2 = make_shop("Anna Foods", "9876500000", 250)
    print(f"\n  ✓ admin + 2 students + 2 approved shops "
          f"(Sai Tiffins ₹{product['price']}, Anna Foods ₹{product2['price']})")

    # ── 1. The student checks out by QR ─────────────────────────────────────
    step("STEP 1 — Student checks out with the UPI QR method")
    order = await checkout(client, stu, shop, product, qty=1)
    oid = order["id"]
    print(f"    order #{order['token']}  id={oid}  total=₹{order['total']}  status={order['status']}")
    check("UPI order starts in 'Pending Payment'", order["status"] == "Pending Payment", order["status"])

    # ── 2. The payment portal ───────────────────────────────────────────────
    step("STEP 2 — Student opens the PAYMENT PORTAL and saves the UTR")
    view = await client.get(f"/api/v1/local/orders/{oid}/payment", headers=auth(stu))
    check("payment portal returns 200", view.status_code == 200, f"{view.status_code} {view.text[:120]}")
    v = view.json()
    print(f"    portal shows: order={v['order_status']!r} payment={v['payment_status']!r} "
          f"amount=₹{v['amount']} utr_saved={v['utr_saved']}")
    check("portal amount == order total", v["amount"] == order["total"], f"{v['amount']} vs {order['total']}")
    check("portal never leaks the UTR field", "utr_number" not in v, str(list(v.keys())))

    utr = "HDFC123456789123"
    saved = await client.post("/api/v1/local/payments/utr", headers=auth(stu),
                              json={"order_id": oid, "utr_number": utr})
    check("saving the reference returns 200", saved.status_code == 200, f"{saved.status_code} {saved.text[:140]}")
    after = (await client.get(f"/api/v1/local/orders/{oid}/payment", headers=auth(stu))).json()
    check("portal now reports the reference on file", after["utr_saved"] is True, str(after))
    check("order is STILL unpaid (a reference alone proves nothing)",
          after["order_status"] == "Pending Payment", after["order_status"])

    # ── 3. The bank credits, the phone bot reports it ───────────────────────
    step("STEP 3 — Bank credits the shop; the phone bot posts /sms/match")
    bank = ("Dear customer, Rs 120.00 credited to your HDFC Bank A/c ***1234 on 16-Aug "
            f"UTR {utr}. Available balance Rs 1450.50.")
    print(f"    bank SMS (read on-device; only UTR+amount are sent):\n      \"{bank}\"")
    m = await client.post("/api/v1/local/sms/match", headers=AGENT,
                          json={"phone": shop["phone"], "utr": utr, "amount": 120})
    check("bot match returns 200", m.status_code == 200, f"{m.status_code} {m.text[:200]}")
    body = m.json()
    print(f"    matched order={body.get('order_id')} status={body.get('order_status')} "
          f"via={body.get('matched_by')}")
    check("matched the RIGHT order", body.get("order_id") == oid, str(body))
    check("order is now Completed", body.get("order_status") == "Completed", str(body))
    check("matched by the saved UTR (tier 1)", body.get("matched_by") == "utr_claim", str(body.get("matched_by")))

    # ── 4. It must show up everywhere, at once ──────────────────────────────
    step("STEP 4 — The completed order reflects in BOTH portals immediately")
    stu_order = (await client.get(f"/api/v1/local/orders/{oid}", headers=auth(stu))).json()
    check("student sees 'Completed' on the order page", stu_order["status"] == "Completed", stu_order["status"])
    stu_pay = (await client.get(f"/api/v1/local/orders/{oid}/payment", headers=auth(stu))).json()
    check("student's payment portal shows payment Success",
          stu_pay["payment_status"] == "Success", str(stu_pay))
    check("student's payment portal shows order Completed",
          stu_pay["order_status"] == "Completed", str(stu_pay))

    admin_orders = (await client.get("/api/v1/local/orders", headers=auth(admin))).json()
    hit = [o for o in admin_orders if o["id"] == oid]
    check("admin orders list shows it Completed",
          bool(hit) and hit[0]["status"] == "Completed", str(hit[:1])[:160])

    admin_pays = (await client.get("/api/v1/local/payments", headers=auth(admin))).json()
    paid = [p for p in admin_pays if p.get("order_id") == oid]
    check("admin payments table shows a settled payment",
          bool(paid) and paid[0]["status"] == "Success", str(paid[:1])[:160])
    check("the bank UTR is stored on the payment row",
          bool(paid) and paid[0].get("utr_number") == utr, str(paid[:1])[:160])

    notifs = (await client.get("/api/v1/local/notifications",
                               headers=auth(stu), params={"role": "student"})).json()
    check("student got a 'payment verified' notification",
          any("Payment verified" in (n.get("title") or "") for n in notifs), str(notifs[:2])[:200])
    admin_notifs = (await client.get("/api/v1/local/notifications",
                                     headers=auth(admin), params={"role": "admin"})).json()
    check("admin got a 'payment verified' notification",
          any("Payment verified" in (n.get("title") or "") for n in admin_notifs), str(admin_notifs[:2])[:200])

    outbox = (await client.get("/api/v1/local/whatsapp/pending", headers=AGENT)).json()
    mine = [w for w in outbox if w.get("sub_order_id") == oid]
    check("WhatsApp bot outbox has the 'paid ✓' message for the shop",
          bool(mine) and "awaiting payment" not in mine[0]["message"].lower(), str(mine[:1])[:220])

    # ── 5. Tier 2: no reference typed at all ────────────────────────────────
    step("STEP 5 — A QR order with NO reference is settled by the credit amount")
    order2 = await checkout(client, stu, shop, product, qty=1)
    o2 = order2["id"]
    p2 = (await client.get(f"/api/v1/local/orders/{o2}/payment", headers=auth(stu))).json()
    check("portal shows no reference on file for a plain QR order",
          p2["utr_saved"] is False, str(p2))
    m2 = await client.post("/api/v1/local/sms/match", headers=AGENT,
                           json={"phone": shop["phone"], "utr": "ICIC998877665544", "amount": 120})
    check("amount-only match returns 200", m2.status_code == 200, f"{m2.status_code} {m2.text[:200]}")
    b2 = m2.json()
    print(f"    matched order={b2.get('order_id')} status={b2.get('order_status')} via={b2.get('matched_by')}")
    check("matched by the bank credit (tier 2)", b2.get("matched_by") == "bank_credit", str(b2.get("matched_by")))
    check("tier-2 order is Completed", b2.get("order_status") == "Completed", str(b2))
    row2 = [p for p in (await client.get("/api/v1/local/payments", headers=auth(admin))).json()
            if p.get("order_id") == o2]
    check("the credit is burned onto the payment row (replay guard)",
          bool(row2) and row2[0].get("utr_number") == "ICIC998877665544", str(row2[:1])[:160])

    # ── 6. Attack the flow ──────────────────────────────────────────────────
    step("STEP 6 — BUG HUNT: attack every door")
    from app.core import rate_limit

    # (a) No agent key / (b) wrong agent key.
    no_key = await client.post("/api/v1/local/sms/match",
                               json={"phone": shop["phone"], "utr": "HACK000000000001", "amount": 120})
    check("anonymous caller cannot settle a payment", no_key.status_code in (401, 403), str(no_key.status_code))
    bad_key = await client.post("/api/v1/local/sms/match", headers={"X-Agent-Key": "wrong"},
                                json={"phone": shop["phone"], "utr": "HACK000000000002", "amount": 120})
    check("a wrong agent key is rejected", bad_key.status_code == 401, str(bad_key.status_code))

    # (c) Replaying a credit that already settled an order.
    replay = await client.post("/api/v1/local/sms/match", headers=AGENT,
                               json={"phone": shop["phone"], "utr": "ICIC998877665544", "amount": 120})
    check("replaying the same credit is refused", replay.status_code == 409, f"{replay.status_code} {replay.text[:120]}")

    # (d) Two identical unpaid orders → must refuse to guess.
    a1 = await checkout(client, stu, shop, product, qty=1)
    a2 = await checkout(client, other_stu, shop, product, qty=1)
    amb = await client.post("/api/v1/local/sms/match", headers=AGENT,
                            json={"phone": shop["phone"], "utr": "AMBIG00000001", "amount": 120})
    check("an ambiguous same-amount credit is refused, not guessed",
          amb.status_code == 409, f"{amb.status_code} {amb.text[:140]}")
    # Read each order back with ITS OWN owner's token — using the wrong one is a
    # 403, which is correct behaviour but not what this check is about.
    for o, owner in ((a1, stu), (a2, other_stu)):
        st = (await client.get(f"/api/v1/local/orders/{o['id']}", headers=auth(owner))).json()["status"]
        check(f"  …and order #{o['token']} was left untouched ({st})", st == "Pending Payment", st)

    # (e) Another shop's phone must never settle this shop's order.
    x = await client.post("/api/v1/local/sms/match", headers=AGENT,
                          json={"phone": shop2["phone"], "utr": "OTHER000000001", "amount": 120})
    st_a1 = (await client.get(f"/api/v1/local/orders/{a1['id']}", headers=auth(stu))).json()["status"]
    check("another shop's agent cannot settle this shop's order", st_a1 == "Pending Payment", st_a1)
    check("  (and it got a clean refusal, not a crash)", x.status_code in (404, 409), str(x.status_code))

    # (f) A student cannot read or pay someone else's order.
    peek = await client.get(f"/api/v1/local/orders/{a1['id']}/payment", headers=auth(other_stu))
    check("a student cannot read another student's payment portal", peek.status_code == 403, str(peek.status_code))
    anon = await client.get(f"/api/v1/local/orders/{a1['id']}/payment")
    check("an anonymous caller cannot read the payment portal", anon.status_code == 401, str(anon.status_code))
    steal = await client.post("/api/v1/local/payments/utr", headers=auth(other_stu),
                              json={"order_id": a1["id"], "utr_number": "STEAL00000001"})
    check("a student cannot attach a reference to someone else's order",
          steal.status_code in (403, 409), str(steal.status_code))

    # (g) Amount forgery: the client cannot declare its own price.
    forged = await client.post("/api/v1/local/payments", headers=auth(stu), json={
        "order_id": a1["id"], "amount": 1, "method": "Manual UTR", "utr_number": "",
    })
    row = [p for p in (await client.get("/api/v1/local/payments", headers=auth(admin))).json()
           if p.get("order_id") == a1["id"]]
    check("a forged ₹1 amount is overwritten by the server total",
          bool(row) and all(abs(float(p["amount"]) - 120) < 0.01 for p in row),
          str([p["amount"] for p in row]))
    check("  (and the request did not 500)", forged.status_code in (200, 409), str(forged.status_code))

    # (h) Junk references are rejected before touching the database.
    junk = await client.post("/api/v1/local/payments/utr", headers=auth(stu),
                             json={"order_id": a1["id"], "utr_number": "../../etc/passwd"})
    check("a path-traversal reference is rejected", junk.status_code == 422, str(junk.status_code))

    # (i) The agent-key brute-force throttle actually engages.
    rate_limit._hits.clear()
    codes = []
    for i in range(22):
        r = await client.post("/api/v1/local/sms/match", headers={"X-Agent-Key": f"guess{i}"},
                              json={"phone": shop["phone"], "utr": f"BRUTE{i:011d}", "amount": 999})
        codes.append(r.status_code)
    check("brute-forcing the agent key gets throttled (429 appears)", 429 in codes, str(codes[-6:]))

    # (j) The real agent still works after someone else's failed guesses.
    ok_after = await client.post("/api/v1/local/sms/match", headers=AGENT,
                                 json={"phone": shop["phone"], "utr": "AFTER00000001", "amount": 120})
    check("the REAL agent key still works after those failures",
          ok_after.status_code in (200, 409), f"{ok_after.status_code} {ok_after.text[:120]}")

    # (k) Cancel closes the payment intent, so no live payment is left behind.
    cancel = await client.post(f"/api/v1/local/orders/{a2['id']}/cancel", headers=auth(other_stu))
    check("a student can cancel their own order in-window",
          cancel.status_code == 200, f"{cancel.status_code} {cancel.text[:140]}")
    p_a2 = [p for p in (await client.get("/api/v1/local/payments", headers=auth(admin))).json()
            if p.get("order_id") == a2["id"]]
    check("cancelling closes the pending payment row",
          bool(p_a2) and all(p.get("status") == "Cancelled" for p in p_a2),
          str([p.get("status") for p in p_a2]))

    # Cancel the other pending ₹120 order too, so a credit for ₹120 now has NO
    # live candidate — it must be refused rather than quietly paying a dead order.
    cancel2 = await client.post(f"/api/v1/local/orders/{a1['id']}/cancel", headers=auth(stu))
    check("the remaining ₹120 order cancels too", cancel2.status_code == 200, str(cancel2.status_code))
    dead = await client.post("/api/v1/local/sms/match", headers=AGENT,
                             json={"phone": shop["phone"], "utr": "CANCEL0000001", "amount": 120})
    check("with every ₹120 order cancelled, a credit is refused (nothing to settle)",
          dead.status_code == 409, f"{dead.status_code} {dead.text[:140]}")
    st_now = (await client.get(f"/api/v1/local/orders/{a1['id']}", headers=auth(stu))).json()["status"]
    check("  …and the cancelled order stayed Cancelled", st_now == "Cancelled", st_now)

    await client.aclose()
    return _report()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
