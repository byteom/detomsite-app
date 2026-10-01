import { useState, useEffect, FormEvent, useMemo, useCallback, useRef } from 'react'
import { BrowserRouter as Router, Routes, Route, Link, Navigate, useNavigate, useSearchParams, useParams, useLocation } from 'react-router-dom'
import api, { dedupeGet } from './services/api'
import ErrorBoundary from './components/ErrorBoundary'
import { usePolling } from './hooks/usePolling'
import { QRCodeSVG } from 'qrcode.react'

function apiError(e: any, fb = 'Request failed') {
  const d = e?.response?.data?.detail
  if (typeof d === 'string' && d.trim()) return d
  if (Array.isArray(d)) {
    const msgs = d.map((x: any) => (x?.msg || x?.message)).filter(Boolean)
    if (msgs.length) return msgs.join(' - ')
  }
  const m = e?.response?.data?.message
  if (typeof m === 'string' && m.trim()) return m
  // Network / 5xx / 429 / 503 — the interceptor attaches a human sentence so
  // the student sees "could not reach the server" rather than "Network Error".
  if (e?.userMessage) return e.userMessage as string
  return (e?.message as string) || fb
}

/* ─── Resilient localStorage ───
 * Every page used to do `JSON.parse(localStorage.getItem('user_data') || '{}')`
 * straight inside the render body. One truncated write, a half-cleared value or
 * a stray "undefined" is enough to make `JSON.parse` throw *during render*,
 * which React cannot recover from — the result is the blank white screen with
 * nothing clickable. These helpers can never throw, and `readUser` also
 * self-heals by clearing the bad value so it cannot break the next load. */
function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw)
    return (parsed ?? fallback) as T
  } catch { return fallback }
}
function readUser(): { id?: number; name?: string; username?: string; email?: string; phone?: string; role?: string } {
  const raw = localStorage.getItem('user_data')
  const user = safeParse<Record<string, any>>(raw, {})
  if (raw && (!user || typeof user !== 'object')) {
    try { localStorage.removeItem('user_data') } catch { /* private mode */ }
    return {}
  }
  return user
}


/* ─── Auth guard: blocks every protected page unless the token is valid ─── */
/* Last-validated token check. Skips the /users/profile round-trip on every
   navigation so clicking around the portal feels instant; re-validates when
   the check is 10+ minutes old or the token changes.

   RELIABILITY FIX: a failed request used to be treated as "token invalid" and
   the session was wiped. On a flaky campus connection that logs the student out
   every time the network hiccups — and because this guard sits above every
   page, the portal silently dumps them on the login screen with no
   explanation. Now ONLY a real 401/403 from the server clears the session; a
   network error or a 5xx shows a "can't reach the server — Retry" panel and
   keeps the token, so a refresh recovers instantly. */
const AUTH_CHECK_KEY = 'detomsite-auth-check'
/* The session check gates EVERY page, so it gets a short, single-shot budget.
 * A reachable server answers /users/profile in well under a second; anything
 * approaching this ceiling is a genuinely unreachable server, and showing
 * "Retry" is far kinder than a spinner the student cannot escape. */
const AUTH_CHECK_TIMEOUT_MS = 8000
/* Hard ceiling on the "Loading..." screen, independent of any request. If the
 * session check has not concluded by now — for ANY reason — stop waiting and
 * offer Retry. This is what makes a permanently stuck page impossible. */
const AUTH_CHECK_WATCHDOG_MS = 12000
function RequireAuth({ children }: { children: React.ReactNode }) {
  const [checked, setChecked] = useState(false)
  const [ok, setOk] = useState(false)
  const [offline, setOffline] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      setChecked(true)
      setOk(false)
      return
    }
    let cancelled = false

    /* WATCHDOG — the last line of defence against a page that never leaves
     * "Loading...".
     *
     * Whatever the cause (a request that never settles, a tab restored from the
     * back/forward cache mid-flight, a browser quirk), the student used to be
     * left staring at a spinner with no way forward except reloading — and a
     * reload just ran the same code again. This gives up waiting after a fixed
     * budget and shows the "Retry" panel instead, so the page ALWAYS ends up
     * with something the student can act on. */
    const watchdog = setTimeout(() => {
      if (cancelled) return
      setOffline(true)
      setChecked(true)
      setOk(false)
    }, AUTH_CHECK_WATCHDOG_MS)

    // Validated this same token recently? Go straight in — no network call.
    try {
      const cached = JSON.parse(localStorage.getItem(AUTH_CHECK_KEY) || 'null')
      if (cached && cached.token === token && Date.now() - cached.t < 10 * 60 * 1000) {
        clearTimeout(watchdog)
        setChecked(true); setOk(true)
        return
      }
    } catch { /* fall through to the real check */ }
    setOffline(false)
    // Validate the token against the backend — a stale/leftover token fails here.
    //
    // This runs ABOVE every page, so it must fail FAST. It used to share the
    // global read timeout AND the automatic GET retry, which meant a single
    // unreachable server left the entire portal on "Loading..." for the sum of
    // both (over two minutes at the previous 45 s default) with nothing to tap.
    // A student on a weak connection simply reloaded, over and over, and the
    // page never recovered on its own.
    //
    // So the session check gets ONE short attempt and no retry: the real 401 /
    // 403 answer is instant when the server is reachable, so a slow response
    // genuinely means unreachable, and the "Retry" panel is the right answer
    // within a few seconds rather than after minutes of nothing.
    dedupeGet('/users/profile', undefined, { timeout: AUTH_CHECK_TIMEOUT_MS, noRetry: true })
      .then(() => {
        clearTimeout(watchdog)
        if (cancelled) return
        try { localStorage.setItem(AUTH_CHECK_KEY, JSON.stringify({ token, t: Date.now() })) } catch { /* ignore */ }
        setChecked(true); setOk(true)
      })
      .catch((err: any) => {
        clearTimeout(watchdog)
        if (cancelled) return
        const status = err?.response?.status
        if (status === 401 || status === 403) {
          // The server genuinely rejected the token — log out for real.
          localStorage.removeItem('access_token')
          localStorage.removeItem('user_data')
          localStorage.removeItem(AUTH_CHECK_KEY)
          setChecked(true); setOk(false)
        } else {
          // Server unreachable / down. Keep the session, offer a retry.
          setOffline(true); setChecked(true); setOk(false)
        }
      })
    return () => { cancelled = true; clearTimeout(watchdog) }
  }, [attempt])

  if (!checked) {
    return <div className="flex min-h-screen items-center justify-center bg-gray-50 text-sm font-medium text-gray-400">Loading...</div>
  }
  if (offline) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-50 p-6 text-center">
        <p className="max-w-sm text-sm font-semibold text-gray-600">Could not reach the server. Your session is saved — check your connection and try again.</p>
        <button onClick={() => { setChecked(false); setAttempt(a => a + 1) }}
          className="rounded-btn bg-primary px-5 py-2.5 text-sm font-bold text-white hover:bg-primary-dark">Retry</button>
      </div>
    )
  }
  if (!ok) return <Navigate to="/login" replace />
  return <>{children}</>
}

/* ─── Types ─── */
interface Shop { id: string; name: string; category: string; description: string; rating: number; opening_time: string; closing_time: string; present: number; status: string; approval_status: string; shopkeeper_email: string; shopkeeper_name: string; phone: string; upi_id: string; upi_enabled: number; cod_enabled: number; orders_today: number; revenue_today: number; current_token: number }
interface Product { id: string; shop_id: string; name: string; description: string; price: number; pending_price: number | null; category: string; inventory: number; prep_time: number; available: number; is_combo?: number; combo_items?: string }
interface Order { id: string; token: number; student_name: string; student_phone: string; shop_id: string; shop_name: string; items: string; total: number; delivery_location: string; delivery_slot: string; status: string; payment_method?: string; created_at: string }
interface Payment { id: string; order_id: string; amount: number; method: string; status: string; utr_number: string | null; created_at: string }
interface CartItem { product_id: string; shop_id: string; shop_name: string; name: string; price: number; category: string; quantity: number }
interface Notification { id: string; title: string; message: string; order_id: string | null; status: string | null; is_read: number; created_at: string }
interface PaymentSettings { manual_enabled: boolean; upi_id: string; receiver_name: string; instructions: string }
/* Site-wide info block the admin writes in the Admin Centre → Settings and every
   student sees at the top of their home page. */
interface StudentNotice { enabled: boolean; text: string }

/* Combo items are stored as free text (one item per line, commas also work) —
   split them for display without ever rendering an empty bullet. */
function comboItemList(comboItems?: string): string[] {
  return (comboItems || '').split(/[\n,]+/).map(i => i.trim()).filter(Boolean)
}

/* ─── Helpers ─── */
const CART_KEY = 'detomsite-cart'
function getCart(): CartItem[] { try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]') } catch { return [] } }
function saveCart(items: CartItem[]) { localStorage.setItem(CART_KEY, JSON.stringify(items)); window.dispatchEvent(new Event('cart-updated')) }
function clearCart() { saveCart([]) }

/* UPI transaction limit — Indian banks cap UPI at ₹1,00,000 per transaction.
   Above that the bank rejects the payment (money is NOT debited) with the
   "exceeded the bank limit … retry with a smaller amount" error. The limit is
   no longer surfaced at checkout (payment moved to its own page) but the
   constant is kept here so the warning can be re-added there if wanted. */
const UPI_LIMIT = 100000
void UPI_LIMIT

/* Client-side cache for the shops list (60s TTL) so the dashboard and shops
   pages render instantly instead of waiting on the network every click. */
const SHOPS_CACHE_KEY = 'detomsite-shops-cache'
function cachedShops(): Shop[] | null {
  try {
    const raw = localStorage.getItem(SHOPS_CACHE_KEY)
    if (!raw) return null
    const { t, data } = JSON.parse(raw)
    if (Date.now() - t > 60000) return null
    return data
  } catch { return null }
}
function fetchShopsCached() {
  const hit = cachedShops()
  if (hit) return Promise.resolve(hit)
  return api.get<Shop[]>('/local/shops', { params: { public_only: true } })
    .then(r => { try { localStorage.setItem(SHOPS_CACHE_KEY, JSON.stringify({ t: Date.now(), data: r.data })) } catch { /* storage full — ignore */ } return r.data })
    .catch(() => cachedShops() || [])
}

/* Same idea for the user's order list — a 30s TTL keeps the dashboard and the
   orders page snappy without going stale mid-session. */
const ORDERS_CACHE_KEY = 'detomsite-orders-cache'
function cachedOrders(): Order[] | null {
  try {
    const raw = localStorage.getItem(ORDERS_CACHE_KEY)
    if (!raw) return null
    const { t, data } = JSON.parse(raw)
    if (Date.now() - t > 30000) return null
    return data
  } catch { return null }
}
function fetchOrdersCached() {
  const hit = cachedOrders()
  if (hit) return Promise.resolve(hit)
  return api.get<Order[]>('/local/orders')
    .then(r => { try { localStorage.setItem(ORDERS_CACHE_KEY, JSON.stringify({ t: Date.now(), data: r.data })) } catch { /* ignore */ } return r.data })
    .catch(() => cachedOrders() || [])
}
/* Drop the cached orders list — call after an order changes (e.g. a student
   cancels an order) so the next view always shows the fresh state. */
function invalidateOrdersCache() { try { localStorage.removeItem(ORDERS_CACHE_KEY) } catch { /* ignore */ } }

/* ─── Inline SVG icons (no emoji, no icon library — tiny & consistent) ─── */
type IconProps = { className?: string }
const iconSvg = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, viewBox: '0 0 24 24' }
const Icon = {
  home: (p: IconProps) => <svg {...iconSvg} className={p.className || 'h-4 w-4'}><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5.5v-6h-5v6H4a1 1 0 0 1-1-1v-9.5Z" /></svg>,
  store: (p: IconProps) => <svg {...iconSvg} className={p.className || 'h-4 w-4'}><path d="M4 10v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V10M3 6l1.2-3h15.6L21 6a2.4 2.4 0 0 1-4.8 0 2.4 2.4 0 0 1-4.8 0A2.4 2.4 0 0 1 6.6 6 2.4 2.4 0 0 1 3 6Z" /><path d="M9 21v-6h6v6" /></svg>,
  package: (p: IconProps) => <svg {...iconSvg} className={p.className || 'h-4 w-4'}><path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" /><path d="M3 8l9 5 9-5M12 13v8" /></svg>,
  cart: (p: IconProps) => <svg {...iconSvg} className={p.className || 'h-4 w-4'}><circle cx="9" cy="20" r="1.5" /><circle cx="17" cy="20" r="1.5" /><path d="M3 3h2l2.6 12.4a1 1 0 0 0 1 .8h7.9a1 1 0 0 0 1-.8L20 8H6" /></svg>,
  star: (p: IconProps) => <svg {...iconSvg} className={p.className || 'h-4 w-4'}><path d="m12 3 2.7 5.6 6.1.8-4.5 4.3 1.1 6-5.4-2.9-5.4 2.9 1.1-6L3.2 9.4l6.1-.8L12 3Z" /></svg>,
  user: (p: IconProps) => <svg {...iconSvg} className={p.className || 'h-4 w-4'}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" /></svg>,
  support: (p: IconProps) => <svg {...iconSvg} className={p.className || 'h-4 w-4'}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /></svg>,
  bell: (p: IconProps) => <svg {...iconSvg} className={p.className || 'h-4 w-4'}><path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" /><path d="M10 20a2.2 2.2 0 0 0 4 0" /></svg>,
  phone: (p: IconProps) => <svg {...iconSvg} className={p.className || 'h-4 w-4'}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.4 2.1L8.1 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.6 2Z" /></svg>,
  lock: (p: IconProps) => <svg {...iconSvg} className={p.className || 'h-4 w-4'}><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>,
  graduation: (p: IconProps) => <svg {...iconSvg} className={p.className || 'h-4 w-4'}><path d="m2 9 10-5 10 5-10 5L2 9Z" /><path d="M6 11.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5M22 9v5" /></svg>,
  search: (p: IconProps) => <svg {...iconSvg} className={p.className || 'h-4 w-4'}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>,
  alert: (p: IconProps) => <svg {...iconSvg} className={p.className || 'h-4 w-4'}><path d="M12 3 2 20h20L12 3Z" /><path d="M12 10v4M12 17.5v.5" /></svg>,
  mapPin: (p: IconProps) => <svg {...iconSvg} className={p.className || 'h-4 w-4'}><path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11Z" /><circle cx="12" cy="10" r="2.5" /></svg>,
  check: (p: IconProps) => <svg {...iconSvg} className={p.className || 'h-4 w-4'}><path d="m4 12.5 5 5L20 6.5" /></svg>,
  chevronRight: (p: IconProps) => <svg {...iconSvg} className={p.className || 'h-4 w-4'}><path d="m9 6 6 6-6 6" /></svg>,
  card: (p: IconProps) => <svg {...iconSvg} className={p.className || 'h-4 w-4'}><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></svg>,
  cash: (p: IconProps) => <svg {...iconSvg} className={p.className || 'h-4 w-4'}><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" /></svg>,
  eye: (p: IconProps) => <svg {...iconSvg} className={p.className || 'h-4 w-4'}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>,
  eyeOff: (p: IconProps) => <svg {...iconSvg} className={p.className || 'h-4 w-4'}><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><path d="m1 1 22 22" /></svg>,
  sun: (p: IconProps) => <svg {...iconSvg} className={p.className || 'h-4 w-4'}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>,
  moon: (p: IconProps) => <svg {...iconSvg} className={p.className || 'h-4 w-4'}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></svg>,
  clock: (p: IconProps) => <svg {...iconSvg} className={p.className || 'h-4 w-4'}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>,
}
const IconH = { user: Icon.user, lock: Icon.lock, graduation: Icon.graduation, bell: Icon.bell, cart: Icon.cart, store: Icon.store, package: Icon.package, home: Icon.home, star: Icon.star, support: Icon.support, search: Icon.search, alert: Icon.alert, phone: Icon.phone, mapPin: Icon.mapPin, check: Icon.check, chevronRight: Icon.chevronRight, card: Icon.card, cash: Icon.cash, eye: Icon.eye, eyeOff: Icon.eyeOff, sun: Icon.sun, moon: Icon.moon, clock: Icon.clock }
/* Quantity system removed — one copy of each product, no +/− counting.
   Adding an item that is already in the cart is a no-op (returns False). */
/* MAX matches the backend's own per-line cap (MAX_LINE_QUANTITY) so the cart can
 * never build a line the server will reject at checkout. */
const MAX_ITEM_QTY = 20

/* How many times to try creating the payable UPI draft before giving up. A
 * single attempt made a slow server response look like a permanent failure. */
const DRAFT_ATTEMPTS = 4

/* Budget for the order POST, measured against production rather than guessed.
 *
 * The shared client timeout is 20 s, but this write legitimately runs longer on
 * a cold serverless instance (measured 7-14 s here, and it also opens the
 * payment intent). At the shared budget the client abandoned the request and
 * showed "the server is taking too long to respond" for an order the server
 * had ALREADY created — so the student retried, and a slow host turned into
 * duplicate orders and duplicate shop messages. Writes that cannot be safely
 * repeated get a budget that outlasts the server's own work.
 *
 * Reads deliberately keep the shorter default: a read that has not answered in
 * 20 s is worth retrying, and nothing has been committed. */
const ORDER_WRITE_TIMEOUT_MS = 60000

/* Is this a TIMEOUT rather than a real rejection?
 *
 * The distinction decides whether a write is safe to repeat. A timeout means
 * the server may have already committed the row and simply failed to answer in
 * time, so the honest response is to ask again (idempotently), not to tell the
 * student it failed. A 4xx is a genuine refusal and repeating it would only
 * produce the same answer. */
function isTimeout(err: any): boolean {
  if (!err) return false
  if (err.response) return false
  const code = String(err.code || '')
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || code === 'ERR_NETWORK') return true
  return /timeout|network error/i.test(String(err.message || ''))
}

/* A stable idempotency key for ONE checkout attempt.
 *
 * The serverless host is slow enough on a cold start that the order POST can
 * time out even though the order was created. The retry then created a SECOND
 * order for the same basket, and two same-amount unpaid orders at one shop is
 * precisely the ambiguity the bank-credit matcher refuses to guess at — so the
 * student, having paid, could never unlock "Place Order".
 *
 * The server de-duplicates on this value, so every retry returns the FIRST
 * order. It is derived from the basket, so a genuinely new cart (or a changed
 * quantity) gets a new key and still creates a new order. */
function checkoutRef(items: CartItem[], method: string): string {
  const basis = items
    .map(i => `${i.product_id}x${i.quantity || 1}`)
    .sort()
    .join('-')
  let hash = 5381
  const key = `${basis}|${method}`
  for (let i = 0; i < key.length; i++) hash = ((hash << 5) + hash + key.charCodeAt(i)) >>> 0
  return `co-${hash.toString(36)}`
}

function addToCart(p: Product, s: Shop): boolean {
  const c = getCart()
  const existing = c.find(i => i.product_id === p.id)
  if (existing) {
    // Adding the same product again means "one more", not "already in cart".
    // Previously this returned false and the tap did nothing visible, which is
    // exactly the bug: there was no way to order two of the same thing.
    if ((existing.quantity || 1) >= MAX_ITEM_QTY) return false
    saveCart(c.map(i => i.product_id === p.id ? { ...i, quantity: (i.quantity || 1) + 1 } : i))
    return true
  }
  saveCart([...c, { product_id: p.id, shop_id: s.id, shop_name: s.name, name: p.name, price: p.price, category: p.category, quantity: 1 }])
  return true
}

/** Set a line's quantity; 0 or less removes the row entirely. */
function setItemQty(productId: string, qty: number): void {
  const c = getCart()
  if (qty <= 0) { saveCart(c.filter(i => i.product_id !== productId)); return }
  const next = Math.min(MAX_ITEM_QTY, qty)
  saveCart(c.map(i => i.product_id === productId ? { ...i, quantity: next } : i))
}

function billBreakdown(items: CartItem[]) { const total = items.reduce((a, i) => a + i.price * (i.quantity || 1), 0); return { subtotal: total, tax: 0, platformFee: 0, delivery: 0, total: total } }
/* UPI amounts MUST be clean numbers with at most 2 decimal places. Raw float
   totals (e.g. 99.5 * 3 = 298.50000000000006 from decimal product prices)
   make banks reject the payment — often with a confusing "exceeded bank
   limit" message — while the same order via QR (no amount) goes through fine.
   Round before putting the amount into the upi:// URI. */
function upiAmount(am: number) { const n = Number(am); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0 }
/* Build a minimal UPI deep link that does NOT trigger the bank risk engine.
   Keep ONLY pa (exact VPA) + pn (EXACT bank account-holder name, e.g. the
   receiver name shown in the UPI app) + am + cu + short tn. Extra params
   like mode=04 / tr=<random-uuid> and a pn that does NOT match the VPA
   holder (e.g. shop name / "DETOMSITE") make GPay/PhonePe show
   "THIS PAYMENT MAY FAIL AS PER UPI RISK POLICY". */
function buildUpiUri(pa: string, pn: string, am: number, tn: string) {
  const payee = String(pa || '').trim()
  const name = String(pn || '').trim()
  const note = String(tn || '').trim().slice(0, 40)
  return `upi://pay?pa=${encodeURIComponent(payee)}&pn=${encodeURIComponent(name)}&am=${upiAmount(am).toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`
}

/* ─── Download the payment QR as a PNG ───
   A student often wants the QR in their gallery, not on this page: to open it on
   another device, send it to a sibling who is paying, or scan it from a laptop /
   a printed copy. The QR the portal draws is an inline <svg>, so it is
   serialized, painted onto a canvas at 2× and handed to the browser as a PNG —
   no new dependency, and the file is a real image any scanner can read. */
function downloadQrPng(svg: SVGSVGElement | null, filename: string) {
  if (!svg) return
  try {
    // Clone so the on-screen QR keeps its styling, and give the standalone copy
    // an explicit white background (scanners need the quiet zone to be white).
    const clone = svg.cloneNode(true) as SVGSVGElement
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    const size = Number(svg.getAttribute('width')) || 180
    clone.setAttribute('width', String(size))
    clone.setAttribute('height', String(size))
    const xml = new XMLSerializer().serializeToString(clone)
    const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`
    const img = new Image()
    img.onload = () => {
      // 2× so the saved file is crisp when a payment app zooms in on it.
      const scale = 2
      const canvas = document.createElement('canvas')
      canvas.width = size * scale
      canvas.height = size * scale
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(blob => {
        if (!blob) return
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        a.remove()
        // Release the object URL once the download has been handed over.
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }, 'image/png')
    }
    img.src = src
  } catch { /* a failed download must never break the payment page */ }
}

/* Delivery is the VIT-AP MAIN GATE only — a single fixed drop point, enforced
   server-side as well. The old presets (Hostel A/B, Academic Block, Food Court,
   Library) and free text are gone: one place means one place, so a student
   cannot quietly pick a spot the shop does not deliver to. */
const MAIN_GATE = 'VIT-AP Main Gate'
const QUICK_LOCATIONS = [MAIN_GATE]
function isVitApLocation(v: string) {
  return /vit[\s-]*ap/i.test(v || '') && /main[\s-]*gate/i.test(v || '')
}

  /* Indian mobile input — the user types their 10-digit number; the value is
     stored with the +91 country code (E.164) so the backend receives +91 + number. */
  function isValidMobile(v: string) { const d = v.replace(/\D/g, ''); return d.length === 10 || (d.length === 12 && d.startsWith('91')) }
  function toE164(v: string) {
    let d = v.replace(/\D/g, '')
    if (d.length > 10 && d.startsWith('91')) d = d.slice(2)   // drop a pasted country code
    d = d.slice(-10)
    return d ? `+91${d}` : ''
  }
  /* Show only the user's 10 digits — never the +91 prefix. The stored value is
     E.164 ("+919…"), so strip the prefix back off before echoing it into the
     field, otherwise the 91 leaks into the display on every keystroke. */
  function displayDigits(v: string) {
    let d = v.replace(/\D/g, '')
    const raw = String(v || '')
    if (d.startsWith('91') && (raw.startsWith('+91') || d.length > 10)) d = d.slice(2)
    return d.slice(-10)
  }
  function PhoneField({ value, onChange, placeholder = '98765 43210' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
    const digits = displayDigits(value)
    // No maxLength — a browser would truncate a pasted "+91…" number before
    // toE164 can strip the country code. toE164 clamps to the last 10 digits.
    return (
      <input type="tel" inputMode="numeric" autoComplete="off" value={digits} required
        onChange={e => onChange(toE164(e.target.value))}
        placeholder={placeholder}
        className="w-full rounded-btn border-2 border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none focus:border-primary-light/200" />
    )
  }
  /* Password input with a show/hide toggle — every login/signup form uses it. */
  function PasswordField({ value, onChange, placeholder = '••••••', autoComplete, required = true, className = '' }: { value: string; onChange: (v: string) => void; placeholder?: string; autoComplete?: string; required?: boolean; className?: string }) {
    const [show, setShow] = useState(false)
    return (
      <div className="relative">
        <input type={show ? 'text' : 'password'} value={value} onChange={e => onChange(e.target.value)}
          placeholder={placeholder} autoComplete={autoComplete} required={required}
          className={`w-full rounded-btn border-2 border-gray-200 bg-white px-4 py-3 pr-11 text-sm text-gray-900 placeholder-gray-400 outline-none transition-all focus:border-primary-light/200 focus:shadow-card ${className}`} />
        <button type="button" onClick={() => setShow(!show)} tabIndex={-1} aria-label={show ? 'Hide password' : 'Show password'}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-sm p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-primary">
          {show ? IconH.eyeOff({ className: 'h-5 w-5' }) : IconH.eye({ className: 'h-5 w-5' })}
        </button>
      </div>
    )
  }

/* Mirrors the backend's orderability check (approved + present + open). The
   vendor's Start/Stop toggle is the source of truth — shop hours are shown to
   students as information only and do not block ordering.
   NOTE: use Boolean(present) — Supabase returns present as true/false while
   SQLite returned 1/0, so a strict `=== 1` check would always be false. */
/* The vendor's Start/Stop toggle is the single source of truth for whether a
   shop accepts orders — once started it stays open until the vendor stops it.
   Opening/closing hours are shown to students as information only and do NOT
   block ordering. NOTE: use Boolean(present) — Supabase returns present as
   true/false while SQLite returned 1/0, so a strict `=== 1` check would always
   be false. */
function isShopOrderable(s: Shop) {
  return s.approval_status === 'Approved' && Boolean(s.present) && s.status === 'Open'
}
function shopStatusReason(s: Shop): string {
  if (s.approval_status !== 'Approved') return 'Waiting for admin approval'
  if (!Boolean(s.present) || s.status !== 'Open') return 'Not accepting orders right now'
  return 'Open now'
}

/* Parse a stored timestamp into a Date. SQLite stores IST wall-clock time
   without an offset; Supabase stores UTC ISO. Both become a real Date. */
function toDate(createdAt?: string): Date | null {
  const raw = String(createdAt || '').trim()
  if (!raw) return null
  let iso = raw
  if (!/T/.test(raw) && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(raw)) iso = raw.replace(' ', 'T') + '+05:30'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : d
}
function formatPlacedAt(createdAt?: string): string {
  const d = toDate(createdAt)
  if (!d) return String(createdAt || '').slice(0, 16)
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d)
}

/* The day is split into two delivery windows — Morning until 12:30 PM and
   Afternoon until 6:00 PM (IST). Orders placed inside a window are accepted
   automatically, and the student can cancel one until that window closes.
   Orders placed after 6:00 PM (or already completed/cancelled) are locked. */
function istClock(d: Date): { h: number; m: number } {
  const s = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  return { h: s.getHours(), m: s.getMinutes() }
}
function canCancelOrder(o: Order | null): boolean {
  if (!o || ['Completed', 'Cancelled', 'Failed'].includes(o.status)) return false
  const placed = toDate(o.created_at)
  if (!placed) return false
  const placedMin = istClock(placed).h * 60 + istClock(placed).m
  const nowMin = istClock(new Date()).h * 60 + istClock(new Date()).m
  const cutoff = placedMin < 12 * 60 + 30 ? 12 * 60 + 30 : placedMin < 18 * 60 + 30 ? 18 * 60 + 30 : -1
  return cutoff !== -1 && nowMin < cutoff
}

/* ─── Layout ─── */
function Layout({ children }: { children: React.ReactNode }) {
  const [menu, setMenu] = useState(false)
  const [cartCount, setCartCount] = useState(getCart().length)
  const [notifs, setNotifs] = useState<Notification[]>([])
  const [notifOpen, setNotifOpen] = useState(false)
  const notifRef = useRef<HTMLDivElement>(null)
  const user = readUser()
  const path = useLocation().pathname

  /* Close the notification dropdown when clicking outside it */
  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [])

  useEffect(() => {
    const sync = () => setCartCount(getCart().length)
    window.addEventListener('cart-updated', sync)
    return () => window.removeEventListener('cart-updated', sync)
  }, [])

  /* Students only see order notifications — vendor/product alerts go to the admin.
     Visibility-aware and de-duplicated: the bell used to run a raw interval that
     kept firing behind a locked phone, and a screen that also polls its own data
     could end up with two identical requests in the air at once. */
  usePolling(
    useCallback(() => {
      if (document.visibilityState !== 'visible') return
      return dedupeGet<Notification[]>('/local/notifications', { role: 'student' })
        .then(r => setNotifs(r.data || []))
        .catch(() => { /* keep the last known bell through a blip */ })
    }, []),
    30000,
    [],
  )

  const logout = () => { localStorage.removeItem('access_token'); localStorage.removeItem('user_data'); window.location.href = '/login' }

  /* A nav item is active on its own page and every page below it, so
     /shop/:id lights up "Shops" and /order/:id lights up "Orders". */
  const onShops = path === '/' || path.startsWith('/shop')
  const isActive = (p: string) => (p === '/shops' && onShops) || (p !== '/dashboard' && path.startsWith(p)) || (p === '/orders' && path.startsWith('/order'))
  const nav = [
    { p: '/shops', l: 'Shops', i: IconH.store },
    { p: '/dashboard', l: 'Dashboard', i: IconH.home },
    { p: '/orders', l: 'Orders', i: IconH.package },
    { p: '/previous-orders', l: 'Past Orders', i: IconH.clock },
    { p: '/cart', l: `Cart${cartCount ? ` (${cartCount})` : ''}`, i: IconH.cart },
    { p: '/reviews', l: 'Reviews', i: IconH.star },
    { p: '/account', l: 'Account', i: IconH.user },
    { p: '/support', l: 'Support', i: IconH.support },
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="sticky top-0 z-50 border-b border-gray-200 bg-white/90 backdrop-blur-lg">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <Link to="/shops" className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-btn bg-primary text-sm font-black text-gold">D</span>
            <span className="text-lg font-black text-primary-dark max-sm:hidden">Student Portal</span>
          </Link>
          <div className="hidden items-center gap-1 md:flex">
            {nav.map(item => (
              <Link key={item.p} to={item.p} className={`flex items-center gap-1.5 rounded-pill px-3 py-2 text-sm font-semibold transition-all ${isActive(item.p) ? 'bg-primary text-white shadow-sm' : 'text-gray-600 hover:bg-primary-light/30 hover:text-primary'}`}>{item.i({ className: 'h-4 w-4' })}{item.l}</Link>
            ))}
            <div ref={notifRef} className="relative">
            <button onClick={() => setNotifOpen(!notifOpen)} className="relative rounded-pill px-2 py-2 text-sm text-gray-600 hover:bg-primary-light/30">
              {IconH.bell({ className: 'h-5 w-5' })}
              {notifs.length > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-pill bg-gold px-1 text-[10px] font-black text-white">{notifs.length}</span>}
            </button>
            {notifOpen && (
              <div className="absolute right-0 top-14 z-50 w-80 rounded-card border bg-white p-3 shadow-2xl">
                <h3 className="mb-2 px-1 text-sm font-bold text-primary">Notifications</h3>
                <div className="max-h-72 space-y-1 overflow-y-auto">
                  {notifs.map(n => (
                    <Link key={n.id} to={n.order_id ? `/order/${n.order_id}` : '/shops'} onClick={() => setNotifOpen(false)} className="block rounded-btn bg-primary-light/30 px-3 py-2.5 text-sm hover:bg-primary-light">
                      <p className="font-semibold text-primary">{n.title}</p>
                      <p className="text-xs text-gray-500">{n.message}</p>
                    </Link>
                  ))}
                  {notifs.length === 0 && <p className="px-3 py-2 text-sm text-gray-400">No notifications</p>}
                </div>
              </div>
            )}
            </div>
            {user?.name && (
              <button onClick={logout} className="ml-2 rounded-pill bg-red-50 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-100">
                Logout
              </button>
            )}
          </div>
          <button className="rounded-pill p-2 text-gray-600 md:hidden" onClick={() => setMenu(!menu)}>{menu ? '✕' : '☰'}</button>
        </div>
        {menu && (
          <div className="border-t px-4 py-3 md:hidden">
            {nav.map(item => (
              <Link key={item.p} to={item.p} onClick={() => setMenu(false)} className={`flex items-center gap-2.5 rounded-btn px-4 py-2.5 text-sm font-semibold ${isActive(item.p) ? 'bg-primary text-white' : 'text-gray-600'}`}>{item.i({ className: 'h-4 w-4' })}{item.l}</Link>
            ))}
            <button onClick={logout} className="block w-full rounded-btn px-4 py-2.5 text-left text-sm font-semibold text-red-600">Logout</button>
          </div>
        )}
      </nav>
      <main>{children}</main>
      {/* Floating cart button — always one tap away on mobile */}
      <Link to="/cart" aria-label="Open cart"
        className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-pill bg-primary text-white shadow-xl transition-all hover:bg-primary-dark active:scale-95 md:hidden">
        {IconH.cart({ className: 'h-6 w-6' })}
        {cartCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-6 min-w-6 items-center justify-center rounded-pill bg-gold px-1.5 text-xs font-black text-white shadow">{cartCount}</span>
        )}
      </Link>
      <footer className="mt-16 border-t border-gray-200 bg-white py-8 text-center text-sm text-gray-400">© 2026 DETOMSITE · Student Portal</footer>
    </div>
  )
}

/* ─── Pages ─── */

/* Register */
function Register() {
  const navigate = useNavigate()
  const [f, setF] = useState({ username: '', email: '', phone: '', password: '', confirm: '' })
  const [err, setErr] = useState(''); const [loading, setLoading] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr('')
    if (f.password !== f.confirm) { setErr('Passwords do not match'); return }
    if (!isValidMobile(f.phone)) { setErr('Please enter a valid 10-digit mobile number'); return }
    setLoading(true)
    try {
      await api.post('/users/register', { username: f.username, email: f.email, password: f.password, name: f.username, phone: f.phone })
      navigate('/login?registered=true')
    } catch (err: any) { setErr(apiError(err, 'Registration failed')) }
    finally { setLoading(false) }
  }
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 to-white px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-card bg-primary text-white shadow-lg">{IconH.graduation({ className: 'h-8 w-8' })}</span>
          <h1 className="mt-4 text-2xl font-bold text-primary-dark">Student Registration</h1>
          <p className="text-sm text-gray-500">Create your campus food account</p>
        </div>
        <div className="rounded-card bg-white p-8 shadow-lg border">
          {err && <div className="mb-4 rounded-btn bg-red-50 border border-red-200 px-4 py-3 text-sm font-medium text-red-600">{err}</div>}
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-500">{IconH.user({ className: 'h-3.5 w-3.5' })}Username</label>
              <input type="text" value={f.username} onChange={e => setF({...f, username: e.target.value})} className="w-full rounded-btn border-2 border-gray-200 px-4 py-3 text-sm outline-none transition-all focus:border-primary-light/200 focus:shadow-card" placeholder="Your username" required />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-gray-500">Email</label>
              <input type="email" value={f.email} onChange={e => setF({...f, email: e.target.value})} className="w-full rounded-btn border-2 border-gray-200 px-4 py-3 text-sm outline-none transition-all focus:border-primary-light/200 focus:shadow-card" placeholder="you@campus.edu" required />
              <p className="mt-1 text-[11px] text-gray-400">Use your campus email — you may need it to recover your password later.</p>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-gray-500">{IconH.phone({ className: 'h-3.5 w-3.5 inline' })} Mobile Number</label>
              <PhoneField value={f.phone} onChange={v => setF({...f, phone: v})} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-gray-500">{IconH.lock({ className: 'h-3.5 w-3.5 inline' })} Password</label>
                <PasswordField value={f.password} onChange={v => setF({...f, password: v})} placeholder="Min 4 characters" autoComplete="new-password" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-gray-500">Confirm</label>
                <PasswordField value={f.confirm} onChange={v => setF({...f, confirm: v})} placeholder="Repeat" autoComplete="new-password" />
              </div>
            </div>
            <button type="submit" disabled={loading} className="w-full rounded-btn bg-primary px-6 py-3.5 text-base font-bold text-white transition-all hover:bg-primary-dark active:scale-[0.99] disabled:opacity-40">{loading ? 'Creating...' : 'Create Account'}</button>
          </form>
          <p className="mt-6 text-center text-sm text-gray-400">Already have an account? <Link to="/login" className="font-bold text-primary">Sign In</Link></p>
        </div>
      </div>
    </div>
  )
}

/* Login */
function Login() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [err, setErr] = useState(''); const [loading, setLoading] = useState(false)
  const registered = params.get('registered') === 'true'
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setLoading(true)
    try {
      const res = await api.post('/users/login', { username, password })
      localStorage.setItem('access_token', res.data.access_token)
      localStorage.setItem('user_data', JSON.stringify(res.data.user))
      navigate('/shops')
    } catch (err: any) { setErr(apiError(err, 'Login failed')) }
    finally { setLoading(false) }
  }
  return (
    <div className="relative min-h-screen lg:grid lg:grid-cols-2">
      {/* Mobile background — faded food photo (visible below lg only) */}
      <div className="absolute inset-0 overflow-hidden lg:hidden">
        <img
          src="https://images.unsplash.com/photo-1589302168068-964664d93dc0?auto=format&fit=crop&w=1000&q=80"
          alt=""
          loading="lazy"
          onError={e => { e.currentTarget.style.display = 'none' }}
          className="h-full w-full object-cover opacity-40"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-emerald-50/80 via-white/60 to-white/80" />
      </div>
      {/* Left — brand panel with campus-food photo (desktop only) */}
      <div className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-gradient-to-br from-emerald-950 via-emerald-800 to-emerald-900 p-12 text-white">
        <img
          src="https://images.unsplash.com/photo-1589302168068-964664d93dc0?auto=format&fit=crop&w=1000&q=80"
          alt="Fresh campus food"
          loading="lazy"
          onError={e => { e.currentTarget.style.display = 'none' }}
          className="absolute inset-0 h-full w-full object-cover opacity-40"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-emerald-950/95 via-emerald-900/50 to-emerald-950/20" />
        <div className="relative">
          <span className="inline-flex items-center gap-2 rounded-pill border border-white/15 bg-white/10 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-primary/50 backdrop-blur-sm">{IconH.graduation({ className: 'h-4 w-4' })} DETOMSITE</span>
          <h2 className="mt-8 max-w-md text-4xl font-black leading-tight">Campus food,<br />delivered to your hostel.</h2>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-primary/50/90">Order from the shops on your campus, track your order live, and pay by scanning a QR or on delivery.</p>
          <ul className="mt-8 space-y-4 text-sm text-primary-light">
            {[
              ['Order in seconds', 'Browse live menus from your campus shops'],
              ['Track your order live', 'Know exactly when your food arrives'],
              ['Pay your way', 'Scan the UPI QR or pay cash on delivery'],
            ].map(([t, s]) => (
              <li key={t} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-pill bg-emerald-400/20 text-primary/80">{IconH.check({ className: 'h-3.5 w-3.5' })}</span>
                <span><b>{t}</b><span className="block text-xs font-normal text-primary/50/70">{s}</span></span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-primary/60/60">© {new Date().getFullYear()} DETOMSITE · Student Portal</p>
      </div>
      {/* Right — login form (sits above the faded mobile photo) */}
      <div className="relative flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-50/90 to-white/95 px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-card bg-primary text-white shadow-lg">{IconH.graduation({ className: 'h-8 w-8' })}</span>
            <h1 className="mt-4 text-2xl font-bold text-primary-dark">Student Login</h1>
            <p className="text-sm text-gray-500">Sign in to browse and order</p>
          </div>
          <div className="rounded-card bg-white p-8 shadow-lg border">
            {registered && <div className="mb-4 flex items-center gap-2 rounded-btn bg-primary-light/30 border border-primary-light/50 px-4 py-3 text-sm font-semibold text-primary">{IconH.check({ className: 'h-4 w-4' })}Account created! Please sign in.</div>}
            {err && <div className="mb-4 rounded-btn bg-red-50 border border-red-200 px-4 py-3 text-sm font-medium text-red-600">{err}</div>}
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-500">{IconH.user({ className: 'h-3.5 w-3.5' })}Username</label>
                <input type="text" value={username} onChange={e => setUsername(e.target.value)} className="w-full rounded-btn border-2 border-gray-200 px-4 py-3 text-sm outline-none transition-all focus:border-primary-light/200 focus:shadow-card" placeholder="Your username" required />
              </div>
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-500">{IconH.lock({ className: 'h-3.5 w-3.5' })}Password</label>
                <PasswordField value={password} onChange={setPassword} placeholder="Your password" autoComplete="current-password" />
              </div>
              <button type="submit" disabled={loading} className="w-full rounded-btn bg-primary px-6 py-3.5 text-base font-bold text-white transition-all hover:bg-primary-dark active:scale-[0.99] disabled:opacity-40">{loading ? 'Signing in...' : 'Sign In'}</button>
              <div className="text-center space-y-1.5">
                <Link to="/forgot-password" className="block text-xs font-bold text-primary transition-colors hover:text-primary">Forgot password?</Link>
                <Link to="/forgot-username" className="block text-xs font-bold text-primary transition-colors hover:text-primary">Forgot username?</Link>
              </div>
            </form>
            <p className="mt-6 text-center text-sm text-gray-400">Don't have an account? <Link to="/register" className="font-bold text-primary">Register</Link></p>
          </div>
        </div>
      </div>
    </div>
  )
}

/* Forgot Password — DOUBLE email verification: a first OTP proves you own the
   email, then a SECOND OTP (emailed after the first is accepted) unlocks the
   password change. */
function ForgotPassword() {
  const [step, setStep] = useState<'request' | 'otp'>('request')
  const [identifier, setIdentifier] = useState('')
  const [otp, setOtp] = useState('')
  const [pw, setPw] = useState(''); const [confirm, setConfirm] = useState('')
  const [err, setErr] = useState(''); const [info, setInfo] = useState(''); const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)

  /* Step 1 — send ONE 6-digit code to the registered email. The code is never
     shown in the app; it arrives only by email. */
  const requestOtp = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setInfo(''); setLoading(true)
    try {
      const res = await api.post('/users/forgot-password', { identifier })
      setInfo(res.data?.message || 'A 6-digit code was sent to your registered email.')
      setStep('otp')
    } catch (err: any) { setErr(apiError(err, 'Request failed')) }
    finally { setLoading(false) }
  }

  /* Step 2 — the backend verifies the code and updates the password in the DB. */
  const resetPw = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setInfo('')
    if (pw !== confirm) { setErr('Passwords do not match'); return }
    if (pw.length < 4) { setErr('Password must be at least 4 characters'); return }
    setLoading(true)
    try {
      await api.post('/users/reset-password', { identifier, otp, new_password: pw })
      setDone(true)
    } catch (err: any) { setErr(apiError(err, 'Reset failed')) }
    finally { setLoading(false) }
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 to-white px-4">
        <div className="w-full max-w-sm rounded-card bg-white p-8 shadow-lg border text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-pill bg-primary-light text-primary">{IconH.check({ className: 'h-7 w-7' })}</span>
          <h1 className="mt-4 text-2xl font-bold text-primary-dark">Password Updated!</h1>
          <p className="mt-2 text-sm text-gray-500">You can now sign in with your new password.</p>
          <Link to="/login" className="mt-6 block w-full rounded-btn bg-primary px-6 py-3 text-sm font-bold text-white hover:bg-primary-dark">Go to Login</Link>
        </div>
      </div>
    )
  }

  const inputCls = "w-full rounded-btn border-2 border-gray-200 px-4 py-3 text-sm outline-none transition-all focus:border-primary-light/200 focus:shadow-card"
  const stepTitle = step === 'request' ? 'Reset your password' : 'Enter the code & set a new password'

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 to-white px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-card bg-primary text-white shadow-lg">{IconH.lock({ className: 'h-8 w-8' })}</span>
          <h1 className="mt-4 text-2xl font-bold text-primary-dark">Forgot Password</h1>
          <p className="text-sm text-gray-500">Step {step === 'request' ? 1 : 2} of 2 · {stepTitle}</p>
        </div>
        <div className="rounded-card bg-white p-8 shadow-lg border">
          {err && <div className="mb-4 rounded-btn bg-red-50 border border-red-200 px-4 py-3 text-sm font-medium text-red-600">{err}</div>}
          {info && <div className="mb-4 rounded-btn bg-primary-light/30 border border-primary-light/50 px-4 py-3 text-sm font-semibold text-primary">{info}</div>}
          {step === 'request' && (
            <form onSubmit={requestOtp} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-gray-500">Email Address</label>
                {/* EMAIL ONLY. The field used to say "Username or Email", but the
                    code is delivered by email to the address on the account — a
                    username alone gives the user nothing to check, so they wait
                    for a mail that can never arrive at an address they never
                    typed. Now that the label matches what is actually sent. */}
                <input
                  type="email"
                  autoComplete="email"
                  value={identifier}
                  onChange={e => setIdentifier(e.target.value)}
                  onInvalid={e => { if (!identifier.includes('@')) e.currentTarget.setCustomValidity('Enter the email address on your account') }}
                  className={inputCls}
                  placeholder="you@example.com"
                  required
                />
              </div>
              <button type="submit" disabled={loading} className="w-full rounded-btn bg-primary px-6 py-3.5 text-base font-bold text-white transition-all hover:bg-primary-dark active:scale-[0.99] disabled:opacity-40">{loading ? 'Sending...' : 'Send Code'}</button>
            </form>
          )}
          {step === 'otp' && (
            <form onSubmit={resetPw} className="space-y-4">
              <p className="text-xs leading-relaxed text-gray-500">We emailed a <b>6-digit code</b> to the email on your account. Enter it with your new password below — the code expires in 15 minutes.</p>
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-gray-500">6-Digit Code (from your email)</label>
                <input type="text" inputMode="numeric" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} className={`${inputCls} text-center text-2xl font-black tracking-[0.4em]`} placeholder="••••••" required />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-gray-500">New Password</label>
                <PasswordField value={pw} onChange={setPw} placeholder="Min 4 characters" autoComplete="new-password" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-gray-500">Confirm Password</label>
                <PasswordField value={confirm} onChange={setConfirm} placeholder="Repeat password" autoComplete="new-password" />
              </div>
              <button type="submit" disabled={loading} className="w-full rounded-btn bg-primary px-6 py-3.5 text-base font-bold text-white transition-all hover:bg-primary-dark active:scale-[0.99] disabled:opacity-40">{loading ? 'Saving...' : 'Verify Code & Update Password'}</button>
            </form>
          )}
          {step !== 'request' && (
            <p className="mt-5 text-center">
              <button type="button" onClick={() => { setStep('request'); setErr(''); setInfo(''); }} className="text-xs font-bold text-primary hover:text-primary">← Start over</button>
            </p>
          )}
          <p className="mt-5 text-center text-sm text-gray-400">Remembered it? <Link to="/login" className="font-bold text-primary">Sign In</Link></p>
        </div>
      </div>
    </div>
  )
}

/* Forgot Username — enter your registered email and we email the username.
   Same single-step pattern as forgot-password, for students AND shopkeepers. */
function ForgotUsername() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [info, setInfo] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const inputCls = 'w-full rounded-btn border-2 border-gray-200 px-4 py-3 text-sm outline-none transition-all focus:border-primary'

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setInfo(''); setLoading(true)
    try {
      const res = await api.post('/users/forgot-username', { email })
      setInfo(res.data?.message || 'If that email is registered, your username has been sent to it.')
      setSent(true)
    } catch (error: any) { setErr(apiError(error, 'Could not send the reminder — please try again')) }
    finally { setLoading(false) }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-900 via-emerald-800 to-emerald-700 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="rounded-card bg-white p-8 shadow-lg border">
          <div className="mb-6 text-center">
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-card bg-primary text-white shadow-lg">🎓</span>
            <h1 className="mt-4 text-2xl font-bold text-primary-dark">Forgot Username</h1>
            <p className="text-sm text-gray-500">We'll email your username to you</p>
          </div>
          {err && <div className="mb-4 rounded-btn bg-red-50 border border-red-200 px-4 py-3 text-sm font-medium text-red-600">{err}</div>}
          {info && <div className="mb-4 rounded-btn bg-primary-light/30 border border-primary-light/50 px-4 py-3 text-sm font-semibold text-primary">{info}</div>}
          {!sent ? (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-gray-500">Registered Email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputCls} placeholder="you@campus.edu" required />
              </div>
              <button type="submit" disabled={loading} className="w-full rounded-btn bg-primary px-6 py-3.5 text-base font-bold text-white transition-all hover:bg-primary-dark active:scale-[0.99] disabled:opacity-40">{loading ? 'Sending...' : 'Email My Username'}</button>
            </form>
          ) : (
            <p className="text-center text-sm text-gray-500">Check your inbox — it may take a minute to arrive.</p>
          )}
          <p className="mt-5 text-center text-sm text-gray-400">Remembered it? <Link to="/login" className="font-bold text-primary">Sign In</Link></p>
        </div>
      </div>
    </div>
  )
}

/* Dashboard */
function Dashboard() {
  const [shops, setShops] = useState<Shop[]>([]); const [orders, setOrders] = useState<Order[]>([]); const [loading, setLoading] = useState(true)
  const user = readUser()
  useEffect(() => {
    Promise.all([
      fetchShopsCached(),
      fetchOrdersCached(),
    ]).then(([s, o]) => { setShops(s); setOrders(o) }).finally(() => setLoading(false))
  }, [])
  const myOrders = orders.filter(o => o.student_name.toLowerCase() === (user.name || '').toLowerCase())
  const active = myOrders.filter(o => o.status !== 'Completed' && o.status !== 'Cancelled')
  const total = myOrders.reduce((s, o) => s + o.total, 0)

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400">Loading...</div>

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-6"><h1 className="text-2xl font-bold text-primary-dark">Dashboard</h1><p className="text-sm text-gray-500">Welcome, {user.name || 'Student'}</p></div>
      {/* 2×2 grid on phones so all four stats sit on one screen */}
      <div className="mb-6 grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
        {[['Total Orders', myOrders.length], ['Active Orders', active.length], ['Total Spent', `₹${total}`], ['Shops Available', shops.length]].map(([l, v]) => (
          <div key={l} className="rounded-btn bg-white p-3.5 shadow-sm border sm:p-4">
            <p className="text-[11px] font-semibold text-gray-500 sm:text-xs">{l}</p>
            <p className="mt-0.5 text-xl font-bold text-primary-dark sm:mt-1 sm:text-2xl">{v}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-btn bg-white p-5 shadow-sm border">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-primary">{IconH.store({ className: 'h-5 w-5' })}Shops</h2>
          <div className="space-y-3">
            {shops.slice(0, 6).map(s => (
              <Link key={s.id} to={`/shop/${s.id}`} className="flex items-center justify-between rounded-btn border p-4 transition-all hover:bg-primary-light/30">
                <div><p className="font-bold text-primary-dark">{s.name}</p><p className="text-xs text-gray-500">{s.category} · {s.rating.toFixed(1)} {IconH.star({ className: 'h-3 w-3 inline text-gold-dark' })}</p></div>
                <span className={`shrink-0 rounded-pill px-2.5 py-1 text-xs font-bold ${isShopOrderable(s) ? 'bg-primary-light text-primary' : 'bg-gray-100 text-gray-500'}`}>
                  <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-pill ${isShopOrderable(s) ? 'bg-primary' : 'bg-gray-400'}`} />{isShopOrderable(s) ? 'Open' : 'Closed'}
                </span>
              </Link>
            ))}
          </div>
        </section>
        <section className="rounded-btn bg-white p-5 shadow-sm border">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-primary">{IconH.package({ className: 'h-5 w-5' })}Recent Orders</h2>
          <div className="space-y-3">
            {myOrders.slice(0, 5).map(o => (
              <Link key={o.id} to={`/order/${o.id}`} className="flex items-center justify-between rounded-btn border p-4 transition-all hover:bg-primary-light/30">
                <div><p className="font-bold text-primary-dark">{o.shop_name}</p><p className="text-xs text-gray-500">{o.items.slice(0, 40)}</p></div>
                <span className={`rounded-sm px-2 py-0.5 text-xs font-bold ${o.status === 'Completed' ? 'bg-primary-light text-primary' : 'bg-gold-light text-gold-dark'}`}>{o.status}</span>
              </Link>
            ))}
            {myOrders.length === 0 && <p className="text-sm text-gray-400">No orders yet. <Link to="/shops" className="text-primary font-semibold">Start ordering!</Link></p>}
          </div>
        </section>
      </div>
    </div>
  )
}

/* Shops listing — search covers shop names, categories, AND food items */
function ShopsPage() {
  const [shops, setShops] = useState<Shop[]>([]); const [search, setSearch] = useState(''); const [loading, setLoading] = useState(true)
  const [allProducts, setAllProducts] = useState<Product[]>([])
  /* Admin-written info block — shown as a green banner above the shop list. The
     backend already reports enabled=false for blank text, so we only need to
     check the flag here. */
  const [notice, setNotice] = useState<StudentNotice | null>(null)
  useEffect(() => {
    fetchShopsCached().then(s => setShops(s)).finally(() => setLoading(false))
    /* Pre-fetch products from all shops so item search works instantly */
    api.get<Product[]>('/local/products').then(r => setAllProducts(r.data || [])).catch(() => {})
    api.get<StudentNotice>('/local/student-notice').then(r => setNotice(r.data)).catch(() => {})
  }, [])
  /* If the search query matches any product name/description/category, include
     the parent shop in the results — students can search "biryani" and see every
     shop that sells it. */
  const q = search.toLowerCase().trim()
  const shopIdsWithMatchingProduct = q ? [...new Set(allProducts.filter(p =>
    `${p.name} ${p.description || ''} ${p.category || ''}`.toLowerCase().includes(q)
  ).map(p => p.shop_id))] : []
  const filtered = shops.filter(s => {
    if (!q) return true
    /* Match on shop name or category first */
    if (`${s.name} ${s.category}`.toLowerCase().includes(q)) return true
    /* Match on any food item belonging to this shop */
    if (shopIdsWithMatchingProduct.includes(s.id)) return true
    return false
  })
  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400">Loading...</div>
  const user = readUser()
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-primary-dark">Shops on Campus</h1>
        <p className="mt-1 text-sm text-gray-500">{user.name ? `Hi ${user.name.split(' ')[0]}, ` : ''}order from a campus shop — live menu, fast delivery.</p>
        <div className="relative mt-4 w-full max-w-md">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">{IconH.search({ className: 'h-4 w-4' })}</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search shops, or food like 'dosa'..." className="w-full rounded-btn border-2 border-gray-200 py-3 pl-10 pr-4 text-sm outline-none transition-all focus:border-primary-light/200 focus:shadow-card" />
        </div>
      </div>
      {/* Admin info block — green banner, written in the Admin Centre → Settings.
          Hidden entirely when the admin switches it off or clears the text. */}
      {notice?.enabled && notice.text && (
        <div className="mb-6 flex items-start gap-2.5 rounded-btn border border-primary-light/50 bg-primary-light/30 px-4 py-3.5 text-sm font-semibold text-primary-dark">
          {IconH.alert({ className: 'h-4 w-4 mt-0.5 shrink-0 text-primary' })}
          <span className="whitespace-pre-line leading-relaxed">{notice.text}</span>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
        {filtered.map(s => (
          <Link key={s.id} to={`/shop/${s.id}`} className="group rounded-card border bg-white p-5 shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg sm:p-6">
            {/* min-w-0 + truncate keep long shop names from overflowing the card */}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><h3 className="truncate font-bold text-primary-dark text-lg" title={s.name}>{s.name}</h3><p className="truncate text-sm text-gray-500">{s.category}</p></div>
              <span className="flex shrink-0 items-center gap-1 rounded-pill bg-primary-light/30 px-2.5 py-1 text-xs font-bold text-primary">{IconH.star({ className: 'h-3.5 w-3.5 text-gold-dark' })}{s.rating.toFixed(1)}</span>
            </div>
            <p className="mt-2.5 line-clamp-2 text-sm text-gray-500">{s.description}</p>
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="font-semibold text-primary">{s.opening_time} - {s.closing_time}</span>
              <div className="flex items-center gap-2">
                <span className={`rounded-pill px-2.5 py-1 text-xs font-bold ${isShopOrderable(s) ? 'bg-primary-light text-primary' : 'bg-gray-100 text-gray-500'}`}>
                  <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-pill ${isShopOrderable(s) ? 'bg-primary' : 'bg-gray-400'}`} />{isShopOrderable(s) ? 'Open' : 'Closed'}
                </span>
                <span className="flex items-center gap-0.5 font-bold text-primary group-hover:underline">Menu{IconH.chevronRight({ className: 'h-4 w-4' })}</span>
              </div>
            </div>
          </Link>
        ))}
        {filtered.length === 0 && (
          <div className="sm:col-span-2 lg:col-span-3 rounded-btn border border-dashed border-gray-300 bg-white p-10 text-center">
            <p className="text-sm text-gray-500">No shops match "{search}". Try a different name — or check back later.</p>
          </div>
        )}
      </div>
    </div>
  )
}

/* Shop Detail */
function ShopDetailPage() {
  const { shopId } = useParams()
  const [shop, setShop] = useState<Shop | null>(null); const [products, setProducts] = useState<Product[]>([]); const [msg, setMsg] = useState('')
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<CartItem[]>(() => getCart())
  useEffect(() => { const sync = () => setCart(getCart()); window.addEventListener('cart-updated', sync); return () => window.removeEventListener('cart-updated', sync) }, [])
  useEffect(() => {
    if (!shopId) return
    Promise.all([api.get<Shop>(`/local/shops/${shopId}`), api.get<Product[]>('/local/products', { params: { shop_id: shopId } })])
      .then(([s, p]) => { setShop(s.data); setProducts(p.data) }).catch(() => {})
  }, [shopId])
  if (!shop) return <div className="flex items-center justify-center py-20 text-gray-400">Loading...</div>
  const orderable = isShopOrderable(shop)
  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-6 rounded-card bg-gradient-to-br from-emerald-800 to-emerald-700 p-6 text-white">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {/* break-words stops long shop names overflowing the header on phones */}
            <h1 className="break-words text-2xl font-black leading-tight sm:text-3xl">{shop.name}</h1>
            <p className="mt-1 flex items-center gap-1 text-primary/50">{shop.category} · {shop.rating.toFixed(1)} {IconH.star({ className: 'h-3.5 w-3.5 text-gold' })}</p>
            <p className="mt-2 text-sm text-primary/50/80">{shop.description}</p>
            <p className="mt-2 flex items-center gap-1.5 text-sm">{IconH.phone({ className: 'h-3.5 w-3.5' })}{shop.opening_time} - {shop.closing_time} · {shop.phone}</p>
          </div>
          <span className={`shrink-0 rounded-pill px-3 py-1.5 text-xs font-bold ${orderable ? 'bg-white/20 text-white' : 'bg-white/10 text-primary/50'}`}>
            <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-pill ${orderable ? 'bg-emerald-300' : 'bg-gray-300'}`} />{orderable ? 'Open Now' : 'Closed'}
          </span>
        </div>
      </div>
      {!orderable && (
        <div className="mb-4 flex items-start gap-2 rounded-btn border border-gold-light/60 bg-amber-50 px-4 py-3 text-sm font-semibold text-gold-dark">
          {IconH.alert({ className: 'h-4 w-4 mt-0.5 shrink-0' })}<span>{shopStatusReason(shop)}. You can still browse the menu — ordering opens when the shop is accepting.</span>
        </div>
      )}
      {msg && <div className="mb-4 rounded-btn bg-primary-light/30 border border-primary-light/50 px-4 py-3 text-sm font-semibold text-primary">{msg}</div>}
      <div className="mb-4 relative">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">{IconH.search({ className: 'h-4 w-4' })}</span>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products..." className="w-full rounded-btn border-2 border-gray-200 py-3 pl-10 pr-4 text-sm outline-none transition-all focus:border-primary-light/200 focus:shadow-card" />
      </div>
      <div className="space-y-3">
        {products.filter(p => p.available && (!search || `${p.name} ${p.description} ${p.category} ${p.combo_items || ''}`.toLowerCase().includes(search.toLowerCase()))).map(p => (
          <div key={p.id} className="rounded-btn border bg-white p-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="flex flex-wrap items-center gap-1.5 font-bold text-primary-dark">
                <span className="truncate">{p.name}</span>
                {!!p.is_combo && <span className="shrink-0 rounded-pill bg-gold-light/40 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-gold-dark">Combo</span>}
              </h3>
              {p.description && <p className="text-sm text-gray-500">{p.description}</p>}
              {/* Combo contents — every item is listed so the student knows
                  exactly what the ONE combo price includes. */}
              {!!p.is_combo && comboItemList(p.combo_items).length > 0 && (
                <ul className="mt-1 space-y-0.5 text-xs text-gray-600">
                  {comboItemList(p.combo_items).map((item, i) => <li key={i}>• {item}</li>)}
                </ul>
              )}
              <p className="mt-1 font-bold text-primary">₹{p.price}{!!p.is_combo && <span className="ml-1 text-xs font-semibold text-gray-500">for the full combo</span>}</p>
            </div>
            <button onClick={() => { const added = addToCart(p, shop); setMsg(added ? `${p.name} added to cart!` : `${p.name} is already in your cart`) }} disabled={!orderable} className={`shrink-0 rounded-btn px-4 py-2 text-sm font-bold text-white ${orderable ? 'bg-primary hover:bg-primary-dark' : 'cursor-not-allowed bg-gray-300'}`}>{orderable ? (cart.some(c => c.product_id === p.id) ? 'In Cart ✓' : 'Add +') : 'Unavailable'}</button>
          </div>
        ))}
        {products.filter(p => p.available && (!search || `${p.name} ${p.description} ${p.category} ${p.combo_items || ''}`.toLowerCase().includes(search.toLowerCase()))).length === 0 && <p className="text-center text-gray-400 py-8">{search ? 'No products match your search' : 'No products available yet'}</p>}
      </div>
    </div>
  )
}

/* Cart */
function CartPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<CartItem[]>(() => getCart())
  useEffect(() => { const sync = () => setItems(getCart()); window.addEventListener('cart-updated', sync); return () => window.removeEventListener('cart-updated', sync) }, [])
  const bill = billBreakdown(items)
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="mb-6 text-2xl font-bold text-primary-dark">Your Cart</h1>
      {items.length === 0 ? (
        <div className="rounded-btn bg-white p-8 text-center shadow-sm border">
          <p className="mb-4 text-lg font-semibold text-gray-600">Your cart is empty</p>
          <Link to="/shops" className="inline-flex rounded-btn bg-primary px-5 py-2.5 text-sm font-bold text-white hover:bg-primary-dark">Browse Shops →</Link>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="space-y-4">
            {/* Group cart items by shop */}
            {(() => {
              const grouped: Record<string, CartItem[]> = {}
              for (const item of items) {
                if (!grouped[item.shop_name]) grouped[item.shop_name] = []
                grouped[item.shop_name].push(item)
              }
              return Object.entries(grouped).map(([shopName, shopItems]) => {
                const shopSubtotal = shopItems.reduce((a, i) => a + i.price * (i.quantity || 1), 0)
                return (
                  <div key={shopName} className="rounded-btn bg-white p-4 shadow-sm border">
                    <div className="mb-3 flex items-center justify-between border-b border-gray-100 pb-2">
                      <h3 className="flex items-center gap-2 font-bold text-primary-dark">{IconH.store({ className: 'h-4 w-4 text-primary' })}{shopName}</h3>
                      <span className="text-xs font-semibold text-primary">Subtotal ₹{shopSubtotal}</span>
                    </div>
                    <div className="space-y-2">
                      {shopItems.map(item => (
                        <div key={item.product_id} className="flex items-center justify-between rounded-sm bg-gray-50 px-3 py-2.5">
                          <div className="min-w-0"><h4 className="truncate font-semibold text-primary-dark">{item.name}</h4><p className="text-xs text-gray-500">₹{item.price} each</p></div>
                          {/* Quantity stepper. "Add" on a product already in the cart
                              increments the line, so ordering two of something is
                              possible instead of the tap being ignored. */}
                          <div className="flex items-center gap-3">
                            <div className="flex items-center rounded-sm border border-gray-200">
                              <button
                                aria-label={`Decrease ${item.name}`}
                                onClick={() => { setItemQty(item.product_id, (item.quantity || 1) - 1); setItems(getCart()) }}
                                className="px-2.5 py-1 text-sm font-bold text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40"
                                disabled={(item.quantity || 1) <= 1}
                              >−</button>
                              <span className="min-w-[2rem] text-center text-sm font-bold text-primary-dark">{item.quantity || 1}</span>
                              <button
                                aria-label={`Increase ${item.name}`}
                                onClick={() => { setItemQty(item.product_id, (item.quantity || 1) + 1); setItems(getCart()) }}
                                className="px-2.5 py-1 text-sm font-bold text-primary transition-colors hover:bg-primary-light/30 disabled:opacity-40"
                                disabled={(item.quantity || 1) >= MAX_ITEM_QTY}
                              >+</button>
                            </div>
                            <span className="min-w-[4.5rem] text-right font-bold text-primary">
                              ₹{item.price * (item.quantity || 1)}
                            </span>
                            <button onClick={() => { setItemQty(item.product_id, 0); setItems(getCart()) }} className="rounded-sm border border-red-200 px-2.5 py-1 text-xs font-bold text-red-500 transition-colors hover:bg-red-50">Remove</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })
            })()}
          </div>
          <div className="h-fit rounded-btn bg-white p-5 shadow-sm border">
            <h2 className="mb-4 text-lg font-bold text-primary-dark">Bill Details</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span>Subtotal</span><span className="font-semibold">₹{bill.subtotal}</span></div>
              <div className="flex justify-between border-t pt-3 text-lg font-bold">Total<span>₹{bill.total}</span></div>
            </div>
            <button onClick={() => navigate('/payment')} className="mt-5 w-full rounded-btn bg-primary px-5 py-3 text-sm font-bold text-white hover:bg-primary-dark">Proceed to Checkout →</button>
          </div>
        </div>
      )}
    </div>
  )
}

/* Orders */
function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const user = readUser()
  useEffect(() => { fetchOrdersCached().then(list => setOrders(list.filter(o => o.student_name.toLowerCase() === (user.name || '').toLowerCase()))).catch(() => {}) }, [user.name])
  /* A student can cancel an order while its delivery window is still open
     (morning orders by 12:30 PM, afternoon orders by 6:00 PM) — orders are
     auto-accepted inside the windows, so the window is the cancel rule. */
  const cancelOrder = async (o: Order) => {
    if (!window.confirm(`Cancel order #${o.token} from ${o.shop_name}? You can cancel until this delivery window closes.`)) return
    try {
      await api.post(`/local/orders/${o.id}/cancel`)
      invalidateOrdersCache()
      setOrders(prev => prev.map(x => x.id === o.id ? { ...x, status: 'Cancelled' } : x))
    } catch (err: any) { window.alert(apiError(err, 'Could not cancel the order')) }
  }
  const grouped = { pending: orders.filter(o => o.status === 'Pending Acceptance'), active: orders.filter(o => ['Accepted', 'Confirmed', 'Preparing', 'Ready'].includes(o.status)), completed: orders.filter(o => ['Completed', 'Cancelled'].includes(o.status)) }
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-primary-dark">My Orders</h1>
        <Link to="/previous-orders" className="flex items-center gap-1.5 rounded-pill bg-primary-light/30 px-3.5 py-2 text-sm font-bold text-primary transition-colors hover:bg-primary-light">{IconH.clock({ className: 'h-4 w-4' })}Past Orders</Link>
      </div>
      {['pending', 'active', 'completed'].map(key => {
        const items = grouped[key as keyof typeof grouped]
        if (!items.length) return null
        return (
          <section key={key} className="mb-6">
            <h2 className="mb-3 text-lg font-bold capitalize text-primary">{key} ({items.length})</h2>
            <div className="space-y-3">
              {items.map(o => (
                <Link key={o.id} to={`/order/${o.id}`} className="block rounded-btn border bg-white p-4 transition-all hover:bg-gray-50">
                  <div className="flex items-start justify-between">
                    <span className="text-lg font-bold text-primary-dark">{o.shop_name}</span>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-sm px-2 py-0.5 text-xs font-bold ${o.payment_method === 'COD' ? 'bg-gold-light text-gold-dark' : 'bg-blue-100 text-blue-700'}`}>{o.payment_method === 'COD' ? 'COD' : 'UPI'}</span>
                      <span className="rounded-sm bg-gray-100 px-2 py-0.5 text-xs font-bold">{o.status}</span>
                    </div>
                  </div>
                  <ul className="mt-1 space-y-1">
                    {o.items.split(', ').filter(Boolean).map((it, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm text-gray-600"><span className="inline-block h-1.5 w-1.5 rounded-pill bg-primary" />{it}</li>
                    ))}
                  </ul>
                  <p className="mt-1 text-sm text-gray-400">{o.delivery_location} · {o.delivery_slot} · Placed {formatPlacedAt(o.created_at)}</p>
                  <p className="mt-1 font-bold text-primary">₹{o.total}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {/* An unpaid UPI order leads straight to the payment portal —
                        one tap to the QR, no hunting for the order first. */}
                    {o.payment_method !== 'COD' && ['Pending Payment', 'Pending Acceptance', 'Accepted', 'Confirmed', 'Preparing', 'Ready'].includes(o.status) && (
                      <Link to={`/pay/${o.id}`} onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1.5 rounded-sm bg-primary px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-primary-dark">
                        {IconH.card({ className: 'h-3.5 w-3.5' })}Pay ₹{o.total}
                      </Link>
                    )}
                    {canCancelOrder(o) && (
                      <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); void cancelOrder(o) }}
                        className="rounded-sm border border-red-200 px-3 py-1.5 text-xs font-bold text-red-600 transition-colors hover:bg-red-50">
                        Cancel Order
                      </button>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )
      })}
      {orders.length === 0 && <div className="rounded-btn bg-white p-8 text-center border"><p className="text-gray-500">No orders yet</p></div>}
    </div>
  )
}

/* Payment */

/* Previous Orders — the student's completed/cancelled history with search.
   Live orders stay on the Orders page; this is the "see my past orders" view. */
function PreviousOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [search, setSearch] = useState('')
  const user = readUser()
  useEffect(() => { fetchOrdersCached().then(list => setOrders(list.filter(o => o.student_name.toLowerCase() === (user.name || '').toLowerCase()))).catch(() => {}) }, [user.name])
  const past = orders
    .filter(o => ['Completed', 'Cancelled'].includes(o.status))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
  const q = search.toLowerCase().trim()
  const filtered = q ? past.filter(o => `${o.shop_name} #${o.token} ${o.items} ${o.status}`.toLowerCase().includes(q)) : past
  const completed = past.filter(o => o.status === 'Completed').length
  const spent = past.filter(o => o.status === 'Completed').reduce((s, o) => s + o.total, 0)
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="mb-6 text-2xl font-bold text-primary-dark">Previous Orders</h1>
      <div className="mb-6 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {[['Past Orders', past.length], ['Completed', completed], ['Total Spent', `₹${spent}`]].map(([l, v]) => (
          <div key={l} className="rounded-btn bg-white p-3.5 shadow-sm border">
            <p className="text-[11px] font-semibold text-gray-500 sm:text-xs">{l}</p>
            <p className="mt-0.5 text-xl font-bold text-primary-dark">{v}</p>
          </div>
        ))}
      </div>
      <div className="relative mb-5">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">{IconH.search({ className: 'h-4 w-4' })}</span>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search past orders by shop, item or token…" className="w-full rounded-btn border-2 border-gray-200 py-3 pl-10 pr-4 text-sm outline-none transition-all focus:border-primary-light/200 focus:shadow-card" />
      </div>
      <div className="space-y-3">
        {filtered.map(o => (
          <Link key={o.id} to={`/order/${o.id}`} className="block rounded-btn border bg-white p-4 transition-all hover:bg-gray-50">
            <div className="flex items-start justify-between">
              <span className="text-lg font-bold text-primary-dark">{o.shop_name}</span>
              <div className="flex items-center gap-2">
                <span className={`rounded-sm px-2 py-0.5 text-xs font-bold ${o.status === 'Completed' ? 'bg-primary-light text-primary' : 'bg-red-100 text-red-600'}`}>{o.status}</span>
                <span className={`rounded-sm px-2 py-0.5 text-xs font-bold ${o.payment_method === 'COD' ? 'bg-gold-light text-gold-dark' : 'bg-blue-100 text-blue-700'}`}>{o.payment_method === 'COD' ? 'COD' : 'UPI'}</span>
              </div>
            </div>
            <ul className="mt-1 space-y-1">
              {o.items.split(', ').filter(Boolean).map((it, i) => (
                <li key={i} className="flex items-center gap-2 text-sm text-gray-600"><span className="inline-block h-1.5 w-1.5 rounded-pill bg-primary" />{it}</li>
              ))}
            </ul>
            <p className="mt-1 text-sm text-gray-400">#{o.token} · {o.delivery_location} · {o.delivery_slot} · Placed {formatPlacedAt(o.created_at)}</p>
            <p className="mt-1 font-bold text-primary">₹{o.total}</p>
          </Link>
        ))}
      </div>
      {past.length === 0 ? (
        <div className="rounded-btn bg-white p-8 text-center border"><p className="text-gray-500">No past orders yet — your completed and cancelled orders will appear here.</p></div>
      ) : filtered.length === 0 ? (
        <div className="rounded-btn bg-white p-8 text-center border"><p className="text-gray-500">No past orders match "{search}".</p></div>
      ) : null}
    </div>
  )
}


function PaymentPage() {
  const navigate = useNavigate()
  const [ps, setPs] = useState<PaymentSettings | null>(null); const [shop, setShop] = useState<Shop | null>(null)
  /* Payment is no longer chosen here. The student places the order and the QR
     appears on the NEXT page, so the method is DERIVED from what the shop
     accepts: UPI (pay by QR) whenever it is available, Cash on Delivery only
     when the shop has no working UPI. There is no toggle to get wrong and no
     second QR anywhere in the flow. */
  const [manualMethod, setManualMethod] = useState<'qr' | 'cod' | null>(null)
  /* Remembered checkout details: the phone number and the (single) delivery gate
     are restored from localStorage so a student who logs out and comes back does
     not have to retype their number — the "get out and come back" problem. */
  const [loc, setLoc] = useState(MAIN_GATE); const [slot, setSlot] = useState('Evening')
  const [phone, setPhone] = useState(() => {
    try { return String(JSON.parse(localStorage.getItem('detomsite_checkout') || '{}').phone || '') } catch { return '' }
  })
  const [loading, setLoading] = useState(false); const [err, setErr] = useState('')
  const user = readUser()
  const items = getCart(); const bill = billBreakdown(items)
  /* A cart can span several shops. Checkout then creates one order PER shop, so
     a single combined QR would show a total that matches no payment record — the
     student is sent to the payment page of the FIRST order and pays the rest from
     "My orders", one shop at a time. */
  const shopCount = useMemo(() => new Set(items.map(i => i.shop_id)).size, [items])

  // Resolve the UPI target: the shop's own UPI ID first, then the global
  // (admin) UPI ID as a fallback. Money goes to the shop the order is from.
  const shopUpi = shop?.upi_id?.trim() || ''
  const globalUpi = ps?.upi_id?.trim() || ''
  const upi = shopUpi || globalUpi
  /* UPI is only offered when THIS shop has a UPI ID (or the admin enabled the
     global fallback). Vendors without a UPI ID → Cash on Delivery only. */
  /* The shop's Settings decide which payment methods are offered: UPI only
     when the vendor has it enabled AND a UPI target exists (the shop's own
     UPI ID, or the admin's global fallback). COD only when enabled. */
  /* !! handles both DB representations: SQLite returns 0/1 integers while
     Supabase (Postgres) returns real booleans. The old `!== 0` check broke on
     Supabase — `false !== 0` is `true` — which made a shop that turned UPI
     off still show UPI at checkout. */
  const upiOn = shop ? !!shop.upi_enabled : true
  const codOn = shop ? !!shop.cod_enabled : true
  const upiAvailable = upiOn && (Boolean(shopUpi) || Boolean(ps?.manual_enabled && globalUpi))
  const codAvailable = codOn
  const payOn = upiAvailable || codAvailable
  /* Only fall back to COD once BOTH the shop and the payment settings have
     loaded — before that we can't know if UPI/QR is really unavailable, and
     flipping early would silently force every checkout onto COD even for
     shops that accept UPI. QR stays the default whenever it's available. */
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [shopLoaded, setShopLoaded] = useState(false)
  /* The shop may have been stopped/closed AFTER the items were added to the
     cart (vendor pressed Stop, or the shop got removed) — check orderability
     before letting the student pay, so they never hit a confusing backend
     rejection mid-payment. */
  const orderable = shopLoaded ? (shop ? isShopOrderable(shop) : true) : true
  /* Payment method is CHOSEN here and is COMPULSORY.
   *
   * It used to be derived silently (UPI whenever the shop had it, COD otherwise).
   * The student never saw a choice, so a shop with both enabled always got UPI —
   * and a student who genuinely wanted to pay cash was forced onto a QR with no
   * way out. `method` is now null until the student picks, and "Proceed to Pay"
   * refuses to continue without one.
   *
   * A shop that accepts only ONE method is pre-selected (and shown read-only):
   * asking them to "choose" between one option is just a dead end. */
  const [chosen, setChosen] = useState<'qr' | 'cod' | null>(null)
  const onlyUpi = upiAvailable && !codAvailable
  const onlyCod = codAvailable && !upiAvailable
  const method: 'qr' | 'cod' | null =
    chosen ?? (onlyUpi ? 'qr' : onlyCod ? 'cod' : null)
  void manualMethod; void setManualMethod

  /* The QR and its amount are built on the PAYMENT page, not here — checkout only
     collects delivery details. The UPI target is still resolved here so the page
     can refuse to continue when the shop accepts no payment method at all. */
  void buildUpiUri

  useEffect(() => { api.get<PaymentSettings>('/local/payment-settings').then(r => setPs(r.data)).catch(() => {}).finally(() => setSettingsLoaded(true)) }, [])
  useEffect(() => {
    if (!items.length) return
    api.get<Shop>(`/local/shops/${items[0].shop_id}`).then(r => setShop(r.data)).catch(() => {}).finally(() => setShopLoaded(true))
  }, [items[0]?.shop_id])

  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(''); if (!items.length) { setErr('Cart empty'); return }
    if (!isValidMobile(phone)) { setErr('Please enter a valid 10-digit mobile number'); return }
    if (!isVitApLocation(loc)) { setErr('Delivery is VIT-AP main gate only.'); return }
    /* Persist the number + gate BEFORE moving on, so a failed payment page or a
       dropped connection never costs the student their retyping it. */
    /* Persist the choice so the payment page knows whether to show a QR at all.
       Without it the page has to re-derive the method, which is exactly the
       silent behaviour this replaced. */
    try { localStorage.setItem('detomsite_checkout', JSON.stringify({ phone: String(phone).replace(/\s/g, ''), location: loc, slot, method })) } catch {}
    if (shopLoaded && shop && !isShopOrderable(shop)) { setErr('This shop is currently closed — the vendor hasn\'t started accepting orders right now. Please try again later.'); return }
    if (!payOn) { setErr('This shop is not accepting any payments right now — the vendor has turned off UPI and Cash on Delivery. Please try again later.'); return }
    if (method === 'qr' && !upiAvailable) { setErr(upiOn ? 'This shop has not set up UPI payments yet — ask the vendor to add their UPI ID' : 'This shop has turned off UPI payments — choose Cash on Delivery instead'); return }
    if (method === 'cod' && !codAvailable) { setErr('This shop has turned off Cash on Delivery — please pay via UPI instead'); return }
    /* COMPULSORY: no method chosen, no payment page. */
    if (!method) { setErr('Please choose how you want to pay — UPI or Cash on Delivery.'); return }
    /* Checkout only COLLECTS the details — it places no order. The order is
       created on the payment page, where the student can see the QR and the
       exact amount first and then commit with "Place Order". Nothing is sent to
       the vendor until that final tap, so an abandoned checkout never produces a
       real order. */
    navigate('/pay')
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="mb-6 text-2xl font-bold text-primary-dark">Checkout</h1>
      {items.length === 0 ? (
        <div className="rounded-btn bg-white p-8 text-center border"><p className="text-lg text-gray-500">Cart empty</p><Link to="/shops" className="mt-3 inline-flex rounded-btn bg-primary px-5 py-2.5 text-sm font-bold text-white">Browse →</Link></div>
      ) : (
        <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1fr_360px] lg:items-start">
          {/* Left column — shop banner + delivery details + payment. The
              summary card sits to the right on desktop (sticky) and stacks
              below on phones. */}
          <div className="min-w-0 space-y-6">
          {shop && (
            <div className="relative overflow-hidden rounded-card bg-gradient-to-br from-emerald-800 via-emerald-700 to-teal-600 p-5 text-white shadow-lg sm:p-6">
              <span className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-pill bg-white/10 blur-2xl" />
              <span className="pointer-events-none absolute -bottom-14 left-1/3 h-32 w-32 rounded-pill bg-teal-300/10 blur-xl" />
              <div className="relative flex flex-wrap items-center gap-4">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-card bg-white/15 text-white ring-1 ring-white/20">{IconH.store({ className: 'h-7 w-7' })}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary/50/90">Ordering from</p>
                  <p className="truncate text-xl font-black sm:text-2xl">{shop.name}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-primary/50/85">
                    <span>{shop.category}</span>
                    <span className="inline-block h-1 w-1 rounded-pill bg-primary-light/60" />
                    <span className="inline-flex items-center gap-0.5">⭐ {Number(shop.rating || 0).toFixed(1)}</span>
                  </p>
                </div>
                <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-pill px-3 py-1.5 text-xs font-bold ${isShopOrderable(shop) ? 'bg-primary-dark/40 text-primary-light ring-1 ring-emerald-200/40' : 'bg-white/15 text-white/80 ring-1 ring-white/20'}`}>
                  <span className={`h-2 w-2 rounded-pill ${isShopOrderable(shop) ? 'animate-pulse bg-emerald-300' : 'bg-white/50'}`} />
                  {isShopOrderable(shop) ? 'Open' : 'Closed'}
                </span>
              </div>
            </div>
          )}
          <div className="rounded-btn bg-white p-5 shadow-sm border">
            <h2 className="mb-4 text-lg font-bold">Delivery Details · VIT-AP only</h2>
            <div className="space-y-4 mb-6">
              <div>
                <label className="mb-1 block text-xs font-bold text-gray-500">Delivery location (VIT-AP main gate)</label>
                {/* One fixed drop point, so this is a read-only field rather than a
                    picker: there is nothing to choose, and a free-text box here
                    could only produce a value the server rejects. */}
                <div className="flex w-full items-center justify-between rounded-btn border-2 border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-900">
                  <span className="font-semibold">{MAIN_GATE}</span>
                  <span className="text-[11px] font-bold text-gray-500">Collect at the gate</span>
                </div>
                <p className="mt-1.5 text-[11px] font-semibold text-primary">📍 Every order is collected at the VIT-AP main gate.</p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-gray-500">Phone (10-digit mobile)</label>
                <PhoneField value={phone} onChange={setPhone} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-gray-500">Delivery slot</label>
                <select value={slot} onChange={e => setSlot(e.target.value)} className="w-full rounded-btn border-2 px-4 py-2.5 text-sm outline-none focus:border-primary-light/200">{['Morning', 'Afternoon', 'Evening', 'Night'].map(s => <option key={s}>{s}</option>)}</select>
              </div>
            </div>
            <h2 className="mb-1 text-lg font-bold">How do you want to pay?</h2>
            <p className="mb-3 text-xs text-gray-500">
              {onlyUpi
                ? 'This shop only accepts UPI.'
                : onlyCod
                  ? 'This shop has no UPI set up, so it only accepts cash on delivery.'
                  : 'Choose one to continue.'}
            </p>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row">
              {upiAvailable && (
                <button type="button" onClick={() => setChosen('qr')} disabled={onlyUpi}
                  className={`flex-1 rounded-btn border-2 p-4 text-center transition-all ${method === 'qr' ? 'border-emerald-500 bg-primary-light/30' : 'border-gray-200 hover:border-emerald-300'} ${onlyUpi ? 'opacity-70' : ''}`}>
                  <span className="mx-auto flex h-9 w-9 items-center justify-center rounded-pill bg-primary-light text-primary"><svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h-3zM18 18h3v3h-3z" /></svg></span>
                  <span className="mt-1.5 block text-sm font-bold">UPI (QR)</span>
                  <span className="block text-[11px] text-gray-500">Pay now by scanning the QR</span>
                </button>
              )}
              {codAvailable && (
                <button type="button" onClick={() => setChosen('cod')} disabled={onlyCod}
                  className={`flex-1 rounded-btn border-2 p-4 text-center transition-all ${method === 'cod' ? 'border-amber-500 bg-amber-50' : 'border-gray-200 hover:border-gold/40'} ${onlyCod ? 'opacity-70' : ''}`}>
                  <span className="mx-auto flex h-9 w-9 items-center justify-center rounded-pill bg-gold-light text-gold-dark">{IconH.cash({ className: 'h-5 w-5' })}</span>
                  <span className="mt-1.5 block text-sm font-bold">Cash on Delivery</span>
                  <span className="block text-[11px] text-gray-500">Pay when your order arrives</span>
                </button>
              )}
            </div>
            {!method && (
              <p className="mb-4 rounded-btn border-2 border-dashed border-amber-300 bg-amber-50 px-4 py-3 text-xs font-semibold text-gold-dark">
                Select a payment method to continue.
              </p>
            )}
            {err && <p className="mt-4 text-sm font-medium text-red-600">{err}</p>}
          </div>
          </div>
          <div className="h-fit rounded-btn bg-white p-5 shadow-sm border lg:sticky lg:top-6">
            <h2 className="mb-4 text-lg font-bold">Summary</h2>
            <div className="space-y-2 text-sm"><div className="flex justify-between"><span>Subtotal</span><span className="font-semibold">₹{bill.subtotal}</span></div><div className="flex justify-between border-t pt-3 text-lg font-bold">Total<span>₹{bill.total}</span></div></div>
            <button type="submit" className="mt-5 w-full rounded-btn bg-primary px-5 py-3 text-sm font-bold text-white hover:bg-primary-dark">
              Proceed to Pay →
            </button>
            <p className="mt-2 text-center text-[11px] font-medium text-gray-400">
              Next page shows the QR and the amount. Your order is placed only when you tap Place Order.
            </p>
          </div>
        </form>
      )}
    </div>
  )
}

/* ─── Pay (page 3 of 3) ───
 * Cart → Checkout → THIS PAGE → Orders. The student arrives here after filling in
 * their delivery details and sees the QR plus the exact amount BEFORE anything is
 * committed. "Place Order" is the single button that creates the real order, so an
 * abandoned checkout never notifies a vendor.
 *
 * The amount shown is priced from the LIVE product list, not from the prices the
 * cart happened to capture: the server re-prices every order from the product
 * table and ignores whatever total the client sends, so a stale cart price would
 * otherwise produce a QR for the wrong amount and the bank-SMS matcher would
 * reject the real payment as ambiguous. Server fees are all zero, so the live
 * product-price sum IS the order total. If the cart and the live prices disagree
 * the student is stopped here and told, rather than being charged the difference
 * after the fact. */
function PayPage() {
  const navigate = useNavigate()
  const user = readUser()
  const [ps, setPs] = useState<PaymentSettings | null>(null)
  const [shop, setShop] = useState<Shop | null>(null)
  const [live, setLive] = useState<Record<string, number> | null>(null)
  const [placing, setPlacing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const svgRef = useRef<SVGSVGElement | null>(null)

  const items = getCart()
  const cartBill = billBreakdown(items)

  /* Details captured on the checkout page. Reading them back here (rather than
     passing through router state) means a refresh, or a back-and-forth with the
     cart, never loses the phone number the student already typed. */
  const saved = useMemo(() => safeParse<{ phone?: string; location?: string; slot?: string; method?: 'qr' | 'cod' }>(
    localStorage.getItem('detomsite_checkout'), {},
  ), [])
  const phone = String(saved.phone || '')
  const loc = saved.location || MAIN_GATE
  const slot = saved.slot || 'Evening'
  /* The method the student CHOSE at checkout. A shop with no UPI (off, or never
     set up) lands here as 'cod' and the page shows no QR and no payment gate —
     the student goes straight to Place Order. */
  const chosenMethod = saved.method || null

  useEffect(() => { api.get<PaymentSettings>('/local/payment-settings').then(r => setPs(r.data)).catch(() => {}) }, [])

  /* Price the cart from the live product list, and pull the first shop for the
     UPI target + open/closed state. Every shop in the basket is priced, not just
     the first, so a price edit at any one shop is caught before the order. */
  const cartKey = items.map(i => i.product_id).join(',')
  useEffect(() => {
    if (!items.length) { setLoading(false); return }
    const shopIds = Array.from(new Set(items.map(i => i.shop_id)))
    Promise.all(shopIds.map(id =>
      Promise.all([
        api.get<Product[]>('/local/products', { params: { shop_id: id } }),
        api.get<Shop>(`/local/shops/${id}`),
      ]).then(([pr, sr]) => ({ id, products: pr.data, shop: sr.data })),
    ))
      .then(results => {
        // Values are the price of the WHOLE LINE (unit price x quantity), not
        // the unit price. Storing the unit price here and summing it directly
        // would quote a 3-vada order as the price of one vada.
        const prices: Record<string, number> = {}
        let anyMissing = false
        for (const item of items) {
          const group = results.find(r => r.id === item.shop_id)
          const product = group?.products.find(p => p.id === item.product_id)
          if (!product || !product.available) { anyMissing = true; continue }
          prices[item.product_id] = Number(product.price) * (item.quantity || 1)
        }
        if (anyMissing) {
          setErr('Something in your cart is no longer available. Go back to the cart and remove it, then try again.')
        }
        setLive(prices)
        setShop(results[0]?.shop ?? null)
      })
      .catch(() => setErr('Could not load the live prices for your cart. Check your connection and try again.'))
      .finally(() => setLoading(false))
  }, [cartKey])

  /* The amount due = live price sum, matching the server's own zero-fee total. */
  const quotedTotal = live
    ? items.reduce((sum, i) => sum + (live[i.product_id] ?? 0), 0)
    : cartBill.total
  const priceChanged = live !== null && quotedTotal !== cartBill.total

  const shopUpi = shop?.upi_id?.trim() || ''
  const globalUpi = ps?.upi_id?.trim() || ''
  const upiTarget = shopUpi || (ps?.manual_enabled ? globalUpi : '')
  const upiOn = shop ? !!shop.upi_enabled : true
  const codOn = shop ? !!shop.cod_enabled : true
  const upiAvailable = upiOn && Boolean(upiTarget)
  /* Honour the student's CHOICE from checkout. A shop with no UPI (disabled, or
     never given a UPI ID) can only be COD, so the page shows no QR and no
     payment gate — straight to Place Order, as required. */
  const method: 'qr' | 'cod' = chosenMethod === 'cod' ? 'cod' : (upiAvailable ? 'qr' : 'cod')
  const receiver = (shopUpi ? (shop?.shopkeeper_name || ps?.receiver_name) : ps?.receiver_name) || 'DETOMSITE'

  /* ─── Payment gate (UPI only) ───
   *
   * The bank SMS is matched by shop + amount + a RECENT UNPAID ORDER. With no
   * order there is nothing to match, so a "pay first, order after" flow that
   * creates the order only on the final tap can never confirm: the button would
   * stay disabled forever.
   *
   * So for UPI the order is created up-front as a Pending Payment draft. The
   * shop never sees it (prepaid orders are withheld until paid), which is what
   * makes the QR amount real and matchable. The student pays, the SMS matches,
   * and ONLY THEN does "Place Order" become tappable.
   *
   * COD has no gate: cash is collected on delivery, so requiring payment first
   * would be impossible. */
  const isUpi = method === 'qr' && upiAvailable
  const [draft, setDraft] = useState<{ id: string; token: number } | null>(null)
  const [paid, setPaid] = useState(false)
  const [drafting, setDrafting] = useState(false)
  /* Guards the order POST against a retry storm.
   *
   * This is a REF, not the `drafting` state on purpose. `drafting` is a
   * dependency of the effect that creates the draft, so clearing it re-runs
   * that effect. An earlier version cleared it in a `.finally()` on every
   * attempt — including attempts that were about to be retried — which started
   * a second chain while the first was still counting down. Each failure
   * doubled the concurrent order POSTs until the backend's connection pool was
   * saturated and every request became slow: the retry added to fix a timeout
   * became the cause of them. A ref changes without re-triggering the effect,
   * so exactly one chain can ever be in flight. */
  const draftInFlight = useRef(false)
  /* The same guard for the COD "Place Order" tap, plus its retry counter. */
  const placeInFlight = useRef(false)
  const placeAttempt = useRef(0)

  /* Everything that must be true before we can ask for money, EXCLUDING the
     payment itself. The draft order is created up-front so the bank SMS has
     something to match, and that creation must NOT wait on payment — doing so
     deadlocks: the draft is what makes payment confirmable, so gating the
     draft on "already paid" means it is never created and the button can never
     unlock. */
  const canTakePayment = items.length > 0 && live !== null && !priceChanged && !err
    && (method === 'cod' ? codOn : upiAvailable)
    && (shop ? isShopOrderable(shop) : false)

  /* The button additionally requires a confirmed payment (UPI only). */
  const payable = canTakePayment && (isUpi ? paid : true)

  const qrUri = isUpi
    ? buildUpiUri(upiTarget, receiver, quotedTotal, `Detomsite ${quotedTotal}`)
    : ''

  const createOrder = async (): Promise<Order[]> => {
    /* One order per shop, exactly as before: each shop needs its own payment
       record and its own amount, or the bank credit can never be matched to a
       single order. */
    const shopGroups: Record<string, CartItem[]> = {}
    for (const item of items) {
      if (!shopGroups[item.shop_id]) shopGroups[item.shop_id] = []
      shopGroups[item.shop_id].push(item)
    }
    const created: Order[] = []
    for (const [shopId, shopItems] of Object.entries(shopGroups)) {
      // `live` already holds the line total (unit x quantity); the fallback must
      // do the same, or a shop whose price failed to load would be charged for
      // one unit of everything.
      const shopTotal = shopItems.reduce((a, i) => a + (live?.[i.product_id] ?? i.price * (i.quantity || 1)), 0)
      const order = await api.post<Order>('/local/orders', {
        shop_id: shopId,
        // Send the cart's real quantity. It used to be hardcoded to 1, so
        // raising the stepper in the cart changed the total the student was
        // shown but the order was still created for one of each.
        items: shopItems.map(i => ({ product_id: i.product_id, quantity: i.quantity || 1 })),
        student_name: user.name || 'Student',
        student_phone: toE164(phone),
        delivery_location: loc,
        delivery_slot: slot,
        payment_method: method === 'cod' ? 'COD' : 'UPI',
        total: shopTotal,
        // Same basket + same method = same key, so a retried POST returns the
        // order the first attempt created instead of forking a duplicate.
        client_ref: checkoutRef(shopItems, method),
        // The order POST is the one write that genuinely takes time on a cold
        // serverless instance (measured 7-14 s), and it also opens the payment
        // intent server-side. It gets its own generous budget so a slow host
        // is never reported to the student as a failure for an order that was
        // in fact created.
        timeout: ORDER_WRITE_TIMEOUT_MS,
      })
      created.push(order.data)
      /* The payment row is opened by the server as part of this same request.
         It used to be a second POST here, and that call alone measured 12-27 s
         in production — a second cold start for one INSERT. The client hit its
         20 s ceiling and showed "the server is taking too long" for an order
         that had already succeeded, so students retried a completed order. */
    }
    return created
  }

  /* Create the payable draft as soon as a UPI payment page is ready. Gated on
     ``canTakePayment``, NOT ``payable`` — see the note above: this is the step
     that MAKES payment confirmable, so it must not itself require payment.
     Only a single-shop basket can be matched reliably by the SMS agent (it
     matches on shop + amount), so a multi-shop basket waits for the button. */
  useEffect(() => {
    if (!isUpi || !canTakePayment || draft) return
    const shopIds = new Set(items.map(i => i.shop_id))
    if (shopIds.size > 1) return

    let cancelled = false
    setDrafting(true)

    /* RETRY, because a single slow response used to strand the student forever:
       the first attempt raised "the server is taking too long to respond", and
       since that landed in the SAME `err` state the button is gated on,
       `canTakePayment` went false, this effect stopped re-running, and the
       button stayed disabled with no way forward -- the draft was never
       created, so the bank SMS had nothing to match. A timeout is a transient
       server condition, not a permanent failure.

       The in-flight guard is a REF, not the `drafting` state, and that matters.
       An earlier version cleared `drafting` in a `.finally()` on every attempt
       — including ones that were about to be retried. `drafting` is a
       dependency of this effect, so clearing it re-ran the effect and started a
       SECOND chain while the first was still counting down. Every failure
       doubled the number of concurrent order POSTs, which saturated the
       backend's connection pool and made every subsequent request slower — the
       retry meant to help was the thing causing the timeouts. */
    if (draftInFlight.current) return
    draftInFlight.current = true

    const release = () => { draftInFlight.current = false; setDrafting(false) }

    const giveUp = (e: any) => {
      if (cancelled) return
      release()
      setErr(apiError(e, 'Could not start your payment'))
    }

    const attempt = (n: number) => {
      createOrder()
        .then(list => {
          if (cancelled) return
          if (list && list[0]) {
            release()
            setDraft({ id: list[0].id, token: list[0].token })
          } else {
            giveUp(new Error('no order returned'))
          }
        })
        .catch(e => {
          if (cancelled) return
          // A retry is still pending, so the guard is deliberately KEPT here —
          // releasing it would let this effect start a second, parallel chain.
          if (n < DRAFT_ATTEMPTS) {
            setTimeout(() => { if (!cancelled) attempt(n + 1) }, 1500 * n)
            return
          }
          giveUp(e)
        })
    }

    attempt(1)
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUpi, canTakePayment, draft, cartKey])

  /* Poll the draft's payment state. The bank SMS is matched by the shop's agent;
     this is how the page learns it landed, and unlocks the button.
     Either signal counts: the payment row turning "Success", or the order itself
     turning "Completed" (the bot sets both in the same settle). Checking only
     the payment row would leave the button locked whenever that row is missing
     or lagging behind. */
  useEffect(() => {
    if (!isUpi || !draft?.id) return
    let cancelled = false
    const check = () => {
      api.get<{ payment_status?: string; order_status?: string }>(
        `/local/orders/${draft.id}/payment`,
      )
        .then(r => {
          if (cancelled) return
          const pay = String(r.data?.payment_status || '').toUpperCase()
          const ord = String(r.data?.order_status || '').toUpperCase()
          if (pay === 'SUCCESS' || ord === 'COMPLETED') setPaid(true)
        })
        .catch(() => { /* keep polling; a blip must not reset the gate */ })
    }
    check()
    const timer = setInterval(check, 4000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [isUpi, draft?.id])

  /* ─── Manual fallback: "I have paid" ───
   *
   * The automatic unlock depends on the shop's SMS agent forwarding the bank
   * credit. If that agent is not installed, its key is wrong, or the bank sends
   * no SMS, the student had NO way forward — the button simply stayed locked on
   * a payment they had genuinely made. Typing the UTR their own UPI app shows
   * gives the matcher an exact reference to settle against, turning a
   * best-guess amount match into a precise one.
   *
   * This records proof only; it never marks an order paid by itself. */
  const [utrInput, setUtrInput] = useState('')
  const [utrBusy, setUtrBusy] = useState(false)
  const [utrMsg, setUtrMsg] = useState('')
  const submitUtr = async (e: FormEvent) => {
    e.preventDefault()
    const value = utrInput.replace(/\s/g, '')
    if (!draft?.id || !/^[A-Za-z0-9]{6,24}$/.test(value)) {
      setUtrMsg('Enter the UTR / reference number from your UPI app (12 digits).')
      return
    }
    setUtrBusy(true); setUtrMsg('')
    try {
      const res = await api.post(`/local/orders/${draft.id}/confirm-payment`, { utr_number: value })
      setUtrMsg(res.data?.message || 'Reference saved — waiting for the shop to confirm the payment.')
      setUtrInput('')
    } catch (e: any) {
      setUtrMsg(apiError(e, 'Could not save that reference'))
    } finally { setUtrBusy(false) }
  }

  const placeOrder = async () => {
    if (!payable || placing) return
    /* A UPI draft already exists (created for matching). Releasing it is just
       finishing the job; a COD order is created here for the first time. */
    if (draft) { clearCart(); navigate('/orders'); return }
    /* Same guard the UPI draft uses. A double tap must never fire two order
       POSTs — and on COD each one notifies the shop immediately, so a duplicate
       here means the kitchen is told about an order the student never placed. */
    if (placeInFlight.current) return
    placeInFlight.current = true
    setPlacing(true); setErr('')
    try {
      await createOrder()
      clearCart()
      navigate('/orders')
    } catch (err: any) {
      /* A timeout here is genuinely ambiguous: the order may have been created
         and simply not answered in time. `client_ref` makes the POST
         idempotent, so retrying cannot duplicate the order — it returns the one
         that already exists. Retrying is therefore safe, and giving up after one
         slow response is what left students stuck on a placed order. */
      if (isTimeout(err) && placeAttempt.current < DRAFT_ATTEMPTS) {
        placeAttempt.current += 1
        setPlacing(false)
        setErr('Still placing your order — the connection is slow. Retrying…')
        setTimeout(() => { placeOrder() }, 1500 * placeAttempt.current)
        return
      }
      setErr(apiError(err, 'Failed'))
    }
    finally { placeInFlight.current = false; setPlacing(false) }
  }

  if (!items.length) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 text-center">
        <h1 className="text-xl font-bold text-gray-600">Your cart is empty</h1>
        <Link to="/shops" className="mt-4 inline-flex rounded-btn bg-primary px-5 py-2.5 text-sm font-bold text-white">Browse shops →</Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <h1 className="mb-1 text-2xl font-bold text-primary-dark">Payment</h1>
      <p className="mb-6 text-sm text-gray-500">
        {isUpi
          ? 'Scan the QR and pay the exact amount. Place Order unlocks after your payment is confirmed.'
          : 'No payment needed now — your order is confirmed on delivery.'}
      </p>

      {loading ? (
        <div className="rounded-btn bg-white p-8 text-center border shadow-sm">
          <p className="text-sm text-gray-500">Loading the live price…</p>
        </div>
      ) : (
        <div className="rounded-btn bg-white p-5 border shadow-sm">
          <div className="mb-4 flex items-baseline justify-between border-b border-gray-100 pb-4">
            <span className="text-sm font-semibold text-gray-500">Amount to pay</span>
            <span className="text-2xl font-black text-primary-dark">₹{quotedTotal}</span>
          </div>

          {method === 'qr' ? (
            <>
              <div className="flex flex-col items-center">
                <QRCodeSVG
                  ref={svgRef}
                  value={qrUri}
                  size={224}
                  level="M"
                  marginSize={2}
                  bgColor="#ffffff"
                  fgColor="#000000"
                />
                <p className="mt-2 text-xs font-semibold text-primary-dark">₹{quotedTotal} · {shop?.name}</p>
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-gray-500">
                Download this QR and scan it with GPay / PhonePe / Paytm. The amount is
                pre-filled, so you cannot overpay by accident.
                <b> Do not scan any other QR</b> — one scan, one payment.
              </p>
              {/* Download is the ONLY QR action. The deep link that used to open a
                  UPI app directly is gone on purpose: two ways to pay is two ways
                  to pay twice, and the amount can only ever be settled once. */}
              <button
                type="button"
                onClick={() => downloadQrPng(svgRef.current, 'Detomsite-QR.png')}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-btn bg-primary px-4 py-2.5 text-sm font-bold text-white hover:bg-primary-dark"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>
                Download QR
              </button>
            </>
          ) : (
            <div className="rounded-btn border-2 border-gold-light/60 bg-amber-50 p-4">
              <p className="flex items-center gap-2 text-sm font-bold text-gold-dark">
                {IconH.cash({ className: 'h-4 w-4' })} Pay ₹{quotedTotal} on delivery
              </p>
              <p className="mt-1 text-xs text-gold-dark">
                {upiOn
                  ? "This shop hasn't set up a UPI ID, so there is no QR to scan. Pay the delivery person in cash."
                  : 'This shop has turned off UPI payments, so there is no QR to scan. Pay in cash on delivery.'}
              </p>
            </div>
          )}

          {priceChanged && (
            <p className="mt-4 flex items-start gap-2 rounded-btn border-2 border-amber-300 bg-amber-50 px-4 py-3 text-xs font-semibold text-gold-dark">
              {IconH.alert({ className: 'h-4 w-4 mt-0.5 shrink-0' })}
              <span>The price changed since you added this to your cart (now ₹{quotedTotal}). Go back to the cart to review before ordering.</span>
            </p>
          )}

          {/* The gate. Until the bank credit is matched by the shop's SMS agent,
              the button stays disabled and the reason is stated — a greyed-out
              button with no explanation reads as a broken app. */}
          {isUpi && (
            <div className={`mt-4 flex items-start gap-2 rounded-btn border-2 px-4 py-3 text-xs font-semibold ${
              paid ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-300 bg-amber-50 text-gold-dark'}`}>
              {paid ? <IconH.check className='h-4 w-4 mt-0.5 shrink-0' />
                : <svg className="h-4 w-4 mt-0.5 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" strokeLinecap="round" /></svg>}
              <span>
                {paid
                  ? `Payment received — ₹${quotedTotal} confirmed. Tap Place Order to send it to the shop.`
                  : drafting
                    ? 'Setting up your order for payment…'
                    : 'Place Order is locked until your payment is confirmed. Pay the exact amount above, then this unlocks automatically (usually within a few seconds).'}
              </span>
            </div>
          )}

          {err && <p className="mt-4 rounded-btn border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-600">{err}</p>}

          {/* The escape hatch. Normally the shop's SMS agent confirms the
              payment and the button unlocks on its own. If that confirmation
              never arrives (agent not installed, key mismatch, or the bank
              sends no SMS) the student would otherwise be stuck forever on a
              payment they really made — so they can hand us the reference from
              their own UPI app instead. */}
          {isUpi && !paid && draft?.id && (
            <form onSubmit={submitUtr} className="mt-4 rounded-btn border border-gray-200 bg-gray-50 p-4">
              <p className="text-xs font-bold text-gray-700">Already paid? Confirm it here</p>
              <p className="mt-1 text-[11px] font-medium text-gray-500">
                If the button is still locked after a minute or two, enter the UTR / reference
                number from your UPI app. It matches your payment exactly.
              </p>
              <div className="mt-2 flex gap-2">
                <input
                  value={utrInput}
                  onChange={e => setUtrInput(e.target.value)}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="e.g. 412233445500"
                  className="min-w-0 flex-1 rounded-btn border border-gray-300 px-3 py-2 text-sm"
                />
                <button
                  type="submit"
                  disabled={utrBusy}
                  className="shrink-0 rounded-btn bg-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  {utrBusy ? 'Saving…' : 'Confirm'}
                </button>
              </div>
              {utrMsg && <p className="mt-2 text-[11px] font-semibold text-gray-600">{utrMsg}</p>}
            </form>
          )}

          <button
            type="button"
            onClick={placeOrder}
            disabled={!payable || placing}
            className="mt-5 w-full rounded-btn bg-primary px-5 py-3 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-40"
          >
            {placing ? 'Placing order…' : `Place Order · ₹${quotedTotal}`}
          </button>
          <p className="mt-2 text-center text-[11px] font-medium text-gray-400">
            {isUpi
              ? paid
                ? 'Your order goes to the shop when you tap this.'
                : 'The button unlocks once your payment is confirmed.'
              : 'Your order is sent to the shop only when you tap this.'}
          </p>
        </div>
      )}
    </div>
  )
}

/* ─── Payment Portal ───
 * The dedicated "pay for this order" screen, reached from the order page by
 * tapping the Pay button. The QR is the primary, mandatory way to pay — it is
 * ALWAYS rendered whenever UPI is available and is never swapped out for
 * something else. Alongside it the student can open their own UPI app with the
 * amount pre-filled, or record the transaction reference by hand.
 *
 * Why the manual reference box matters: the shop's phone bot settles an order
 * by matching the bank's credit SMS against a saved UTR (backend
 * `_sms_match_core`, tier 1). With nothing on file the bot falls back to
 * matching the credit by amount, which only works when exactly ONE unpaid
 * order at that shop has the same amount. Typing the reference makes the match
 * exact, so the order confirms itself in seconds instead of waiting for manual
 * review — this is the link that connects the website to the bot.
 *
 * The page polls while the payment is in flight and flips to "verified ✓" on
 * its own, so nobody has to keep refreshing. */
interface OrderPaymentState {
  order_id: string
  order_status: string
  payment_method?: string
  amount?: number
  is_parent?: boolean
  payment_status?: string | null
  payment_method_recorded?: string | null
  utr_saved: boolean
}

function PaymentPortalPage() {
  const { orderId } = useParams()
  const [order, setOrder] = useState<Order | null>(null)
  const [shop, setShop] = useState<Shop | null>(null)
  const [ps, setPs] = useState<PaymentSettings | null>(null)
  const [pay, setPay] = useState<OrderPaymentState | null>(null)
  const [utr, setUtr] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [okMsg, setOkMsg] = useState('')
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  // Shop + payment settings are fetched once; only the status is polled.
  useEffect(() => {
    if (!orderId) return
    api.get<PaymentSettings>('/local/payment-settings').then(r => setPs(r.data)).catch(() => {})
  }, [orderId])

  useEffect(() => {
    if (!orderId) return
    let cancelled = false
    api.get<Order>(`/local/orders/${orderId}`)
      .then(r => {
        if (cancelled) return
        setOrder(r.data)
        // One shop lookup per order — not one per poll tick.
        return api.get<Shop>(`/local/shops/${r.data.shop_id}`)
          .then(s => { if (!cancelled) setShop(s.data) }).catch(() => null)
      })
      .catch((e: any) => { if (!cancelled && e?.response?.status === 404) setNotFound(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [orderId])

  /* Live status. A settled (or dead) order stops polling — there is nothing
     left to watch, and a permanent timer is what drains a phone during a
     lunch rush.

     `usePolling` also stops a tick from starting while the previous one is still
     in flight. On a weak campus connection a 4 s interval with a slow response
     used to stack requests on top of each other, which is exactly the
     "the page keeps reloading / freezes" behaviour students reported. */
  const settled = pay?.order_status === 'Completed' || pay?.payment_status === 'Success'
  const closed = pay?.order_status === 'Cancelled' || pay?.order_status === 'Failed'
  /* The admin confirming the order is what the Approvals queue exists for, so
     the page reflects it explicitly instead of leaving the student guessing
     between "placed" and "confirmed". */
  const adminConfirmed = ['Confirmed', 'Preparing', 'Ready', 'Delivered', 'Accepted'].includes(
    String(pay?.order_status || ''),
  )
  const loadPay = useCallback(() => {
    if (!orderId || settled || closed) return
    return dedupeGet(`/local/orders/${orderId}/payment`)
      .then(r => setPay(r.data))
      .catch(() => { /* keep the last known state; the next tick retries */ })
  }, [orderId, settled, closed])
  usePolling(loadPay, 4000, [orderId, settled, closed])

  /* The UPI target and the exact receiver name — identical rules to checkout:
     the shop's own UPI first, the admin's global UPI as the fallback. A wrong
     ``pn`` is what makes GPay refuse with "THIS PAYMENT MAY FAIL AS PER UPI
     RISK POLICY", so the receiver is never the shop's display name. */
  const shopUpi = shop?.upi_id?.trim() || ''
  const globalUpi = ps?.upi_id?.trim() || ''
  const upiTarget = shopUpi || (ps?.manual_enabled ? globalUpi : '')
  const receiver = (shopUpi ? (shop?.shopkeeper_name || ps?.receiver_name) : ps?.receiver_name) || 'DETOMSITE'
  const upiOn = shop ? !!shop.upi_enabled : true
  const upiAvailable = upiOn && Boolean(upiTarget)
  const isCod = order?.payment_method === 'COD'
  const amount = Number(order?.total ?? pay?.amount ?? 0)
  const qrUri = upiAvailable && amount > 0
    ? buildUpiUri(upiTarget, receiver, amount, `Detomsite ${order?.token ?? ''}`.trim())
    : ''

  const submitUtr = async (e: FormEvent) => {
    e.preventDefault()
    setErr(''); setOkMsg('')
    const clean = utr.trim().toUpperCase()
    // Mirrors the server's own rule (alphanumeric, 6-40) so an obvious typo is
    // caught here instead of costing a round-trip and a confusing 422.
    if (!/^[A-Z0-9]{6,40}$/.test(clean)) {
      setErr('Enter the reference exactly as your UPI app shows it — usually 12 digits, letters and numbers only.')
      return
    }
    setSaving(true)
    try {
      await api.post('/local/payments/utr', { order_id: orderId, utr_number: clean })
      setUtr('')
      setOkMsg('Reference saved. Your order is confirming automatically — this page updates on its own.')
      // Reflect the new state at once instead of waiting for the next tick.
      dedupeGet(`/local/orders/${orderId}/payment`).then(r => setPay(r.data)).catch(() => {})
    } catch (e: any) { setErr(apiError(e, 'Could not save the reference')) }
    finally { setSaving(false) }
  }

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400">Loading…</div>
  if (notFound || !order) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 text-center">
        <div className="rounded-btn bg-white p-8 border">
          <p className="text-lg font-bold text-gray-700">Order not found</p>
          <p className="mt-2 text-sm text-gray-500">This order does not exist, or it belongs to another account.</p>
          <Link to="/orders" className="mt-5 inline-flex rounded-btn bg-primary px-5 py-2.5 text-sm font-bold text-white">Back to my orders</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-primary-dark">Payment</h1>
          <p className="truncate text-sm text-gray-500">{order.shop_name} · Order #{order.token} · {formatPlacedAt(order.created_at)}</p>
        </div>
        <span className={`shrink-0 rounded-btn px-3 py-1.5 text-xs font-bold border ${settled ? 'bg-primary-light/30 text-primary border-primary-light/50' : isCod ? 'bg-amber-50 text-gold-dark border-gold-light/60' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>
          {settled ? 'Paid ✓' : isCod ? 'Cash on Delivery' : 'Payment due'}
        </span>
      </div>

      {settled && (
        <div className="mb-5 flex items-start gap-2.5 rounded-btn border-2 border-primary-light/50 bg-primary-light/30 p-4 text-sm text-primary">
          {IconH.check({ className: 'h-5 w-5 shrink-0' })}
          <span><b>Payment verified ✓</b> — ₹{amount} received and order #{order.token} is marked <b>Completed</b>. Nothing more to do; collect it from the counter with your token.</span>
        </div>
      )}

      {isCod && (
        <div className="mb-5 flex items-start gap-2.5 rounded-btn border-2 border-gold-light/60 bg-amber-50 p-4 text-sm text-gold-dark">
          {IconH.cash({ className: 'h-5 w-5 shrink-0' })}
          <span><b>This is a Cash on Delivery order.</b> Nothing to pay online — keep <b>₹{amount}</b> ready and hand it over at the VIT-AP main gate.</span>
        </div>
      )}

      {/* The admin confirming the order is the point the whole queue exists for —
          say so plainly, and point at the QR the student can now download. */}
      {!settled && !closed && adminConfirmed && (
        <div className="mb-5 flex items-start gap-2.5 rounded-btn border-2 border-primary-light/50 bg-primary-light/30 p-4 text-sm text-primary">
          {IconH.check({ className: 'h-5 w-5 shrink-0' })}
          <span>
            <b>Order confirmed by the admin ✓</b> — {order.shop_name} has your order and is preparing it.
            {upiAvailable
              ? <> Download the QR below and pay <b>₹{amount}</b> from your own UPI app (GPay / PhonePe / Paytm).</>
              : <> Keep <b>₹{amount}</b> ready for delivery.</>}
          </span>
        </div>
      )}

      {!isCod && !settled && !adminConfirmed && !closed && (
        <div className="mb-5 flex items-start gap-2.5 rounded-btn border-2 border-dashed border-gray-200 bg-gray-50 p-4 text-xs text-gray-600">
          {IconH.clock({ className: 'h-4 w-4 mt-0.5 shrink-0' })}
          <span>
            <b>Waiting for the admin to confirm your order.</b> The QR below is ready and you can
            download it now — but the shop starts preparing only after the order is confirmed.
            This page updates by itself; you do not need to refresh.
          </span>
        </div>
      )}

      {!isCod && !settled && closed && (
        <div className="mb-5 rounded-btn border-2 border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-600">
          This order was {String(order.status).toLowerCase()}, so there is nothing left to pay. If you were still charged, contact support with your token #{order.token}.
        </div>
      )}

      {!isCod && !settled && !closed && (
        <div className="mb-5 flex items-start gap-2.5 rounded-btn border-2 border-gold-light/60 bg-amber-50 p-4 text-sm text-gold-dark">
          {IconH.alert({ className: 'h-5 w-5 shrink-0' })}
          <span>
            Pay <b>this shop only</b> — ₹{amount} is this order's total, and it is the
            exact amount the shop's bank will receive. If you also ordered from another
            shop, each shop has its own order and its own payment: pay each one from
            <Link to="/orders" className="font-bold underline"> My orders</Link>.
          </span>
        </div>
      )}

      {isCod || settled || closed ? (
        <div className="rounded-btn bg-white p-5 border shadow-sm">
          <p className="text-sm font-bold text-primary-dark">Order summary</p>
          <ul className="mt-2 space-y-1.5">
            {order.items.split(', ').filter(Boolean).map((it, i) => (
              <li key={i} className="flex items-center gap-2 text-sm text-gray-600"><span className="inline-block h-1.5 w-1.5 rounded-pill bg-primary" />{it}</li>
            ))}
          </ul>
          <p className="mt-3 font-bold text-primary">Total ₹{amount}</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link to={`/order/${order.id}`} className="rounded-btn bg-primary px-5 py-2.5 text-sm font-bold text-white hover:bg-primary-dark">View order</Link>
            <Link to="/orders" className="rounded-btn border px-5 py-2.5 text-sm font-bold text-gray-600 hover:bg-gray-50">My orders</Link>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {/* ── 1. The QR — mandatory, always shown whenever UPI is available ── */}
          <div className="rounded-btn bg-white p-5 border shadow-sm">
            <h2 className="text-lg font-bold text-primary-dark">Pay ₹{amount} by scanning the QR</h2>
            {upiAvailable && qrUri ? (
              <>
                <p className="mt-1 text-xs text-gray-500">Pay exactly once, to <b>{upiTarget}</b>, using GPay / PhonePe / Paytm / any UPI app.</p>
                <div className="mt-4 flex w-full flex-col items-center gap-4 rounded-card border-2 border-dashed border-emerald-300 bg-white p-4 sm:flex-row sm:justify-center sm:gap-6">
                  <QRCodeSVG
                    id="detomsite-pay-qr"
                    value={qrUri}
                    size={180}
                    level="M"
                    bgColor="#ffffff"
                    fgColor="#065F46"
                    className="h-auto w-full max-w-[190px] shrink-0"
                  />
                  <p className="flex items-start gap-1.5 text-center text-xs font-bold text-primary sm:max-w-[240px] sm:text-left">
                    {IconH.phone({ className: 'h-3.5 w-3.5 shrink-0' })}
                    <span>The receiver name in your app must read <b>{receiver}</b>. If it shows a different name, stop and pay via the shop's mobile number instead.</span>
                  </p>
                </div>
                {/* Direct app pay — same amount, same receiver, no camera needed. */}
                <a href={qrUri} className="mt-4 flex w-full items-center justify-center gap-2 rounded-btn bg-primary px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-primary-dark">
                  {IconH.card({ className: 'h-4 w-4 shrink-0' })}
                  Open my UPI app · Pay ₹{amount}
                </a>
                {/* Save the QR to the phone gallery — for paying from another
                    device, sharing it, or scanning it from a laptop screen. */}
                <button
                  type="button"
                  onClick={() => downloadQrPng(document.getElementById('detomsite-pay-qr') as SVGSVGElement | null, `detomsite-order-${order?.token ?? 'payment'}-upi-qr.png`)}
                  className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-btn border border-primary-light/60 bg-white px-4 py-2.5 text-sm font-bold text-primary transition-colors hover:bg-primary-light/30"
                >
                  <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>
                  Download QR · pay in my UPI app
                </button>
                <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
                  The amount is pre-filled, so you cannot overpay by accident. <b>Do not scan any other QR</b> — one scan, one payment.
                </p>
              </>
            ) : (
              <p className="mt-2 flex items-start gap-2 rounded-btn border-2 border-gold-light/60 bg-amber-50 px-4 py-3 text-sm text-gold-dark">
                {IconH.alert({ className: 'h-4 w-4 mt-0.5 shrink-0' })}
                <span>{upiOn
                  ? 'This shop has not set up a UPI ID yet, so the QR cannot be shown. Pay in cash at the counter, or ask the shop to add their UPI ID.'
                  : 'This shop has turned off UPI payments. Please pay in cash at the counter.'}</span>
              </p>
            )}
          </div>

        </div>
      )}
    </div>
  )
}

/* Order Result — status only. Paying happens on its own dedicated page
   (/pay/:orderId) so the QR lives in exactly one place and the student is
   never asked to pay twice. */
function OrderResultPage() {
  const { orderId } = useParams()
  const [order, setOrder] = useState<Order | null>(null); const [shop, setShop] = useState<Shop | null>(null)
  // Poll only while the tab is visible, and never overlap a tick. The shop is
  // fetched ONCE (it cannot change mid-order) instead of on every tick — the old
  // code refetched it each time, doubling the requests on the busiest page.
  usePolling(
    useCallback(() => {
      if (!orderId) return
      return dedupeGet<Order>(`/local/orders/${orderId}`).then(r => setOrder(r.data)).catch(() => {})
    }, [orderId]),
    8000,
    [orderId],
  )
  useEffect(() => {
    if (!order?.shop_id) return
    let cancelled = false
    api.get<Shop>(`/local/shops/${order.shop_id}`).then(r => { if (!cancelled) setShop(r.data) }).catch(() => null)
    return () => { cancelled = true }
  }, [order?.shop_id])
  if (!order) return <div className="flex items-center justify-center py-20 text-gray-400">Loading...</div>
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="rounded-btn bg-white p-6 shadow-lg border text-center">
        <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Order Result</p>
        <h1 className="mt-3 text-4xl font-black text-primary-dark">Order Placed</h1>
        <p className="mt-2 text-lg font-semibold text-gray-600">{order.shop_name}</p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <span className="inline-flex rounded-btn px-4 py-2 text-sm font-bold bg-primary-light/30 text-primary border border-primary-light/50">{order.status}</span>
          <span className={`inline-flex rounded-btn px-3 py-2 text-xs font-bold border ${order.payment_method === 'COD' ? 'bg-amber-50 text-gold-dark border-gold-light/60' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>
            {order.payment_method === 'COD' ? 'Cash on Delivery' : 'UPI Payment'}
          </span>
        </div>
        <p className="mt-3 text-xs text-gray-400">Order #{order.token} · Placed {formatPlacedAt(order.created_at)}</p>
        {/* The ONE action on an unpaid order is "Pay" — tapping it opens the
            payment portal (/pay/:orderId) where the QR, the UPI-app button and
            the manual reference all live. The destructive Cancel button used to
            sit here; it now lives in the orders list, so a student who
            accidentally taps the big button is sent to pay rather than to a
            confirm dialog. */}
        {order.payment_method !== 'COD' && !['Completed', 'Cancelled', 'Failed'].includes(order.status) && (
          <div className="mt-5">
            <Link to={`/pay/${order.id}`}
              className="inline-flex w-full items-center justify-center gap-2 rounded-btn bg-primary px-6 py-3.5 text-base font-bold text-white shadow-sm transition-colors hover:bg-primary-dark sm:w-auto">
              {IconH.card({ className: 'h-5 w-5' })}
              Pay ₹{order.total} now →
            </Link>
            <p className="mt-2 text-xs text-gray-400">Opens the payment portal — scan the QR or pay with your own UPI app.</p>
          </div>
        )}
        {order.payment_method !== 'COD' && order.status === 'Completed' && (
          <p className="mt-4 inline-flex items-center gap-1.5 rounded-btn bg-primary-light/30 px-4 py-2 text-sm font-bold text-primary">
            {IconH.check({ className: 'h-4 w-4' })}Payment verified — collect your order
          </p>
        )}
        <div className="mt-6 rounded-btn bg-gray-50 p-5 text-left text-sm">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Your items</p>
          <ul className="space-y-1.5">
            {order.items.split(', ').filter(Boolean).map((it, i) => (
              <li key={i} className="flex items-center gap-2 text-gray-700"><span className="inline-block h-1.5 w-1.5 rounded-pill bg-primary" />{it}</li>
            ))}
          </ul>
          <p className="mt-3 flex items-center gap-1.5 text-gray-500">{IconH.mapPin({ className: 'h-4 w-4' })}{order.delivery_location} · {order.delivery_slot}</p>
          <p className="mt-2 font-bold text-primary">Total ₹{order.total}</p>
          {shop && <div className="mt-3 rounded-sm bg-white border p-3"><p className="font-semibold text-primary">Shop: {shop.shopkeeper_name}</p><p className="mt-0.5 flex items-center gap-1.5 text-gray-500">{IconH.phone({ className: 'h-3.5 w-3.5' })}{shop.phone}</p></div>}
        </div>
        {order.payment_method === 'COD' && (
          <div className="mt-6 flex items-start gap-2 rounded-btn border-2 border-gold-light/60 bg-amber-50 p-4 text-left text-sm text-gold-dark">
            {IconH.cash({ className: 'h-4 w-4 mt-0.5 shrink-0' })}<span><b>Cash on Delivery.</b> Keep <b>₹{order.total}</b> ready — you pay the shop when your order is delivered.</span>
          </div>
        )}
        {(order.status === 'Pending Payment' || order.status === 'Pending Verification') && order.payment_method !== 'COD' && (
            <div className="mt-6 rounded-btn border-2 border-emerald-200 bg-emerald-50/60 p-4 text-left text-sm text-primary">
              <div className="flex items-start gap-2">
                {IconH.check({ className: 'h-4 w-4 mt-0.5 shrink-0' })}<span><b>Payment pending.</b> Pay ₹{order.total} from the payment portal — the shop's bot confirms it automatically. <b>Do NOT scan any other QR.</b></span>
              </div>
              <Link to={`/pay/${order.id}`} className="mt-3 flex w-full items-center justify-center gap-2 rounded-btn bg-primary px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-primary-dark">
                {IconH.card({ className: 'h-4 w-4 shrink-0' })}
                Open the payment portal
              </Link>
            </div>
        )}
        {/* Order pickup — show token number for counter pickup */}
        {order.status !== 'Cancelled' && order.status !== 'Failed' && (
          <div className="mt-6 rounded-btn border-2 border-dashed border-emerald-300 bg-primary-light/30/60 p-4">
            <p className="text-sm font-bold text-primary">Pickup from the counter</p>
            <p className="mt-2 text-center text-2xl font-black text-primary-dark">Token #{order.token}</p>
            <p className="mt-2 text-center text-xs leading-relaxed text-primary">Tell the shop your token number when collecting your order.</p>
          </div>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link to="/orders" className="rounded-btn bg-primary px-5 py-2.5 text-sm font-bold text-white hover:bg-primary-dark">Track Orders →</Link>
          <Link to="/shops" className="rounded-btn border px-5 py-2.5 text-sm font-bold text-gray-600 hover:bg-gray-50">Order More</Link>
        </div>
      </div>
    </div>
  )
}

/* Reviews */
function ReviewsPage() {
  const [reviews, setReviews] = useState<any[]>([]); const [loading, setLoading] = useState(true); const [f, setF] = useState({ shop_id: '', rating: 5, comment: '' }); const [msg, setMsg] = useState('')
  const [shops, setShops] = useState<Shop[]>([])
  useEffect(() => {
    Promise.all([
      api.get('/users/reviews').catch(() => ({ data: [] })),
      fetchShopsCached(),
    ]).then(([r, s]) => { setReviews(r.data || []); setShops(s) }).finally(() => setLoading(false))
  }, [])
  const submitReview = async (e: FormEvent) => {
    e.preventDefault(); setMsg('')
    try { await api.post('/users/reviews', f); setMsg('Review submitted!'); setF({ shop_id: '', rating: 5, comment: '' }) }
    catch (err: any) { setMsg(apiError(err, 'Failed')) }
  }
  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="mb-6 text-2xl font-bold text-primary-dark">My Reviews</h1>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          <h2 className="mb-3 text-lg font-bold text-primary">Your Reviews</h2>
          {loading ? <p className="text-gray-400">Loading...</p> : reviews.length > 0 ? (
            <div className="space-y-3">
              {reviews.map((r: any, i: number) => (
                <div key={i} className="rounded-btn border bg-white p-4">
                  <div className="flex items-center justify-between">
                    <p className="font-bold text-gold-dark">{'★'.repeat(r.rating || 5)}</p>
                    {r.shop_name && <span className="text-xs font-semibold text-primary bg-primary-light/30 rounded-sm px-2 py-0.5">{r.shop_name}</span>}
                  </div>
                  <p className="text-sm text-gray-600 mt-1">{r.comment || 'No comment'}</p>
                  {r.created_at && <p className="text-xs text-gray-400 mt-1">{r.created_at}</p>}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-btn bg-white p-8 text-center border"><p className="text-gray-500">No reviews yet. Submit your first review!</p></div>
          )}
        </div>
        <div className="rounded-btn bg-white p-5 shadow-sm border h-fit">
          <h2 className="mb-3 text-lg font-bold text-primary">Write a Review</h2>
          {msg && <div className="mb-3 rounded-sm bg-primary-light/30 border px-3 py-2 text-sm text-primary">{msg}</div>}
          <form onSubmit={submitReview} className="space-y-3">
            <select value={f.shop_id} onChange={e => setF({...f, shop_id: e.target.value})} className="w-full rounded-btn border-2 px-4 py-2.5 text-sm outline-none" required>
              <option value="">Select Shop</option>
              {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select value={f.rating} onChange={e => setF({...f, rating: parseInt(e.target.value)})} className="w-full rounded-btn border-2 px-4 py-2.5 text-sm outline-none">
              {[5,4,3,2,1].map(r => <option key={r} value={r}>{'★'.repeat(r)}</option>)}
            </select>
            <textarea value={f.comment} onChange={e => setF({...f, comment: e.target.value})} className="w-full rounded-btn border-2 px-4 py-2.5 text-sm outline-none" placeholder="Your review..." rows={2} />
            <button type="submit" className="w-full rounded-btn bg-primary px-4 py-2.5 text-sm font-bold text-white hover:bg-primary-dark">Submit Review</button>
          </form>
        </div>
      </div>
    </div>
  )
}

/* Account */
function AccountPage() {
  const user = readUser()
  const [orders, setOrders] = useState<Order[]>([])
  useEffect(() => { fetchOrdersCached().then(list => setOrders(list.filter(o => o.student_name.toLowerCase() === (user.name || '').toLowerCase()))).catch(() => {}) }, [user.name])
  const totalSpent = orders.reduce((s, o) => s + o.total, 0)
  const active = orders.filter(o => o.status !== 'Completed' && o.status !== 'Cancelled').length

  const detail = [
    { l: 'Username', v: user.username || '—' },
    { l: 'Name', v: user.name || '—' },
    { l: 'Email', v: user.email || '—' },
    { l: 'Phone', v: user.phone || '—' },
    { l: 'Role', v: 'Student' },
    { l: 'Orders Placed', v: String(orders.length) },
    { l: 'Active Orders', v: String(active) },
    { l: 'Total Spent', v: `₹${totalSpent}` },
  ]

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="mb-6 text-2xl font-bold text-primary-dark">My Account</h1>
      <div className="mb-6 rounded-card bg-gradient-to-br from-emerald-800 to-emerald-700 p-6 text-white">
        <div className="flex items-center gap-4">
          <span className="flex h-16 w-16 items-center justify-center rounded-card bg-white/15 text-2xl font-black">{(user.name || 'U').charAt(0).toUpperCase()}</span>
          <div>
            <h2 className="text-2xl font-black">{user.name || 'Student'}</h2>
            <p className="text-primary/50">@{user.username || 'student'}</p>
          </div>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {detail.map(d => (
          <div key={d.l} className="rounded-btn border bg-white p-4">
            <p className="text-xs font-semibold text-gray-500">{d.l}</p>
            <p className="mt-1 font-bold text-primary-dark">{d.v}</p>
          </div>
        ))}
      </div>
      <p className="mt-6 rounded-btn bg-primary-light/30 border border-primary-light/50 px-4 py-3 text-sm text-primary">
        💡 Your account is private to you — orders are linked to your name and only you can see them here.
      </p>
    </div>
  )
}

/* Support */
const HELP_DESK_PHONE = '+916382603607'
function SupportPage() {
  const [f, setF] = useState({ category: 'Order Issue', title: '', description: '' }); const [msg, setMsg] = useState(''); const [err, setErr] = useState('')
  const user = readUser()
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setMsg('')
    try { await api.post('/local/tickets', { ...f, name: user.name || 'Student', email: user.email || '', phone_number: user.phone || '' }); setMsg('Ticket submitted!'); setF({ category: 'Order Issue', title: '', description: '' }) }
    catch (err: any) { setErr(apiError(err, 'Failed')) }
  }
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="mb-6 text-2xl font-bold text-primary-dark">Support</h1>

      {/* Help Desk — direct call button */}
      <div className="mb-6 rounded-btn bg-primary-light/30 border border-primary-light/50 p-5">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-pill bg-primary text-white">
            <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.4 2.1L8.1 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.6 2Z" /></svg>
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-primary-dark">Help Desk</p>
            <p className="text-xs text-primary">Need urgent help? Call us directly — we're available to assist you.</p>
            <a href={`tel:${HELP_DESK_PHONE}`} className="mt-2 inline-flex items-center gap-2 rounded-btn bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-primary active:scale-[0.98]">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.4 2.1L8.1 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.6 2Z" /></svg>
              Call +91 63826 03607
            </a>
          </div>
        </div>
      </div>

      <div className="rounded-btn bg-white p-6 shadow-sm border">
        {msg && <div className="mb-4 rounded-btn bg-primary-light/30 border px-4 py-3 text-sm text-primary">{msg}</div>}
        {err && <div className="mb-4 rounded-btn bg-red-50 border px-4 py-3 text-sm text-red-600">{err}</div>}
        <form onSubmit={submit} className="space-y-4">
          <select value={f.category} onChange={e => setF({...f, category: e.target.value})} className="w-full rounded-btn border-2 px-4 py-3 text-sm outline-none focus:border-primary-light/200">
            {['Order Issue', 'Payment Issue', 'Technical Issue', 'Other'].map(c => <option key={c}>{c}</option>)}
          </select>
          <input value={f.title} onChange={e => setF({...f, title: e.target.value})} className="w-full rounded-btn border-2 px-4 py-3 text-sm outline-none focus:border-primary-light/200" placeholder="Title" required />
          <textarea value={f.description} onChange={e => setF({...f, description: e.target.value})} className="w-full rounded-btn border-2 px-4 py-3 text-sm outline-none focus:border-primary-light/200" placeholder="Describe your issue..." rows={3} required />
          <button type="submit" className="rounded-btn bg-primary px-6 py-3 text-sm font-bold text-white hover:bg-primary-dark">Submit Ticket →</button>
        </form>
      </div>
    </div>
  )
}

/* ─── App ─── */
export default function App() {
  return (
    <Router>
      <Routes>
        {/* Public pages — no login needed */}
        <Route path="/register" element={<Register />} />
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/forgot-username" element={<ForgotUsername />} />

        {/* Everything else requires a valid login */}
        <Route path="/*" element={
          <RequireAuth>
            <Layout>
              <Routes>
                <Route path="/" element={<ShopsPage />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/shops" element={<ShopsPage />} />
                <Route path="/shop/:shopId" element={<ShopDetailPage />} />
                <Route path="/cart" element={<CartPage />} />
                <Route path="/orders" element={<OrdersPage />} />
                <Route path="/previous-orders" element={<PreviousOrdersPage />} />
                <Route path="/payment" element={<PaymentPage />} />
                <Route path="/pay" element={<PayPage />} />
                <Route path="/pay/:orderId" element={<PaymentPortalPage />} />
                <Route path="/order/:orderId" element={<OrderResultPage />} />
                <Route path="/reviews" element={<ReviewsPage />} />
                <Route path="/account" element={<AccountPage />} />
                <Route path="/support" element={<SupportPage />} />
                <Route path="*" element={<NavigateToLogin />} />
              </Routes>
            </Layout>
          </RequireAuth>
        } />
      </Routes>
    </Router>
  )
}

function NavigateToLogin() {
  const navigate = useNavigate(); const user = localStorage.getItem('access_token')
  useEffect(() => { navigate(user ? '/shops' : '/login') }, [])
  return null
}
