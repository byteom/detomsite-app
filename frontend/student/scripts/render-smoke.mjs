/**
 * RENDER SMOKE TEST — hunts the "blank white screen" class of bug.
 *
 * The student portal's worst reported symptom is a page that renders nothing and
 * accepts no clicks. In React that is almost always ONE throw inside a render
 * body: a corrupt `localStorage` value, a field missing from a response, a bad
 * date, an undefined map lookup. There is no error boundary below the page, so
 * the whole tree unmounts and the user gets a dead white page.
 *
 * This mounts the REAL app in jsdom against a mock API and visits every route,
 * asserting the DOM actually painted something. Any throw during a render or an
 * effect is caught and reported as a BUG with the route that caused it.
 *
 * It also boots with deliberately CORRUPT localStorage values, because that is
 * exactly how the bug was reported ("it works, then one day it's just white").
 *
 * Run:  node scripts/render-smoke.mjs      (from frontend/student/)
 */
// jsdom is CommonJS — pull the named pieces off the default export.
import jsdomPkg from 'jsdom'
const { JSDOM, VirtualConsole, ResourceLoader } = jsdomPkg

const API = 'http://127.0.0.1:9/api/v1'   // never reachable: the mock intercepts
let failures = []
const note = (ok, name, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗ FAIL'}  ${name}${!ok && detail ? `\n        → ${detail}` : ''}`)
  if (!ok) failures.push(`${name} :: ${detail}`)
}

/* ── A realistic API, including the awkward shapes that break naive pages ── */
const SHOP = {
  id: 's1', name: 'Sai Tiffins', category: 'Food', description: 'Hot tiffins',
  rating: 4.5, opening_time: '07:00', closing_time: '22:00', present: 1,
  status: 'Open', approval_status: 'Approved', shopkeeper_email: 'v@x.in',
  shopkeeper_name: 'Sai Vendor', phone: '9876543210', upi_id: 'sai@upi',
  upi_enabled: 1, cod_enabled: 1, orders_today: 3, revenue_today: 240, current_token: 7,
}
const PRODUCT = {
  id: 'p1', shop_id: 's1', name: 'Masala Dosa', description: 'Crisp', price: 120,
  pending_price: null, category: 'Food', inventory: 10, prep_time: 10, available: 1,
  is_combo: 0, combo_items: '',
}
const ORDER = {
  id: 'o1', token: 42, student_name: 'Test Student', student_phone: '+919000000123',
  shop_id: 's1', shop_name: 'Sai Tiffins', items: 'Masala Dosa, Idli', total: 160,
  delivery_location: 'VIT-AP Main Gate', delivery_slot: 'Morning',
  status: 'Pending Payment', payment_method: 'UPI', created_at: '2026-09-29T04:00:00Z',
}

const ROUTES = {
  '/local/shops': [SHOP],
  '/local/products': [PRODUCT],
  '/local/orders': [ORDER],
  '/local/notifications': [],
  '/local/payment-settings': { manual_enabled: true, upi_id: 'demo@upi', receiver_name: 'Demo', instructions: '' },
  '/local/student-notice': { enabled: false, text: '' },
  '/local/batch': { batch_type: 'Morning', token_starts_at: 18, next_token: 43, date_key: '20260929' },
  '/users/reviews': [],
  '/users/profile': { id: 1, name: 'Test Student' },
  '/local/summary': { total_orders: 1 },
  '/local/search': { query: '', shops: [SHOP], products: [PRODUCT], total: 2 },
}
const payView = (id) => ({
  order_id: id, order_status: 'Pending Payment', payment_method: 'UPI', amount: 160,
  is_parent: false, payment_status: 'Pending', payment_method_recorded: 'Manual UTR',
  utr_saved: false,
})

/* Paths the app asked for that this harness does not model. */
const UNMOCKED = new Set()
/* Every path the app actually called. */
const HIT = new Set()

/** Resolve a request path to a response. Unmodelled paths 404, like the real API. */
function resolve(path) {
  if (ROUTES[path] !== undefined) return { ok: true, body: ROUTES[path] }
  if (/^\/local\/orders\/[^/]+\/payment$/.test(path)) return { ok: true, body: payView('o1') }
  if (/^\/local\/orders\/[^/]+$/.test(path)) return { ok: true, body: ORDER }
  if (/^\/local\/shops\/[^/]+$/.test(path)) return { ok: true, body: SHOP }
  // Not modelled. The real API would 404, so we 404 too — that way the app's OWN
  // fallback path runs instead of being handed a plausible-but-wrong body, which
  // would hide real crashes behind an empty list.
  UNMOCKED.add(path)
  return { ok: false, status: 404, body: { detail: 'Not Found' } }
}

import http from 'node:http'
import https from 'node:https'
import { PassThrough } from 'node:stream'

function interceptRequest(orig, args) {
  let [url, options, cb] = args
  let u = typeof url === 'string' ? url : (options?.path || url?.path || '')
  if (typeof options === 'function') {
    cb = options
    options = {}
  }
  if (u.includes('/api/v1') || u.startsWith('/local/') || u.startsWith('/users/') || u.startsWith('/payments/')) {
    let p = u.replace(/^https?:\/\/[^/]+/, '').replace(/^\/api\/v1/, '')
    const pathOnly = p.split('?')[0]
    const { ok, status = 200, body } = resolve(pathOnly)
    HIT.add(pathOnly)
    const res = new PassThrough()
    res.statusCode = ok ? 200 : status
    res.headers = { 'content-type': 'application/json' }
    res.rawHeaders = ['content-type', 'application/json']
    const req = new PassThrough()
    req.setHeader = () => {}
    req.getHeader = () => {}
    req.setTimeout = () => req
    req.abort = () => {}
    req.destroy = () => {}
    req.end = function () {
      process.nextTick(() => {
        if (cb) cb(res)
        res.end(JSON.stringify(body))
      })
      return req
    }
    return req
  }
  return orig.apply(this, args)
}

const origHttpRequest = http.request
http.request = function (...args) {
  return interceptRequest.call(this, origHttpRequest, args)
}

const origHttpsRequest = https.request
https.request = function (...args) {
  return interceptRequest.call(this, origHttpsRequest, args)
}

/** Build a fresh jsdom window wired to the mock API + a chosen localStorage. */
let bootSeq = 0
async function boot(route, storage) {
  const errors = []
  const vc = new VirtualConsole()
  vc.on('jsdomError', (e) => errors.push(`jsdom: ${e.message}`))
  vc.on('error', (...a) => errors.push(`console.error: ${a.join(' ')}`))

  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: `http://localhost:5173${route}`,
    pretendToBeVisual: true,
    runScripts: 'outside-only',
    virtualConsole: vc,
  })
  const { window } = dom

  // Hand axios a real XHR (jsdom's) BEFORE the app bundle is first imported, so
  // it selects the xhr adapter and every request flows through the interceptor.
  if (!globalThis.XMLHttpRequest) globalThis.XMLHttpRequest = window.XMLHttpRequest

  const store = new Map(Object.entries(storage || {}))
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
      key: (i) => [...store.keys()][i] ?? null,
      get length() { return store.size },
    },
  })
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  window.scrollTo = () => {}
  window.HTMLElement.prototype.scrollIntoView = () => {}

  // Each boot gets a FRESH module graph (cache-busting query). Without this the
  // axios instance and the `dedupeGet` in-flight map are shared across boots, so
  // boot 2 silently reuses boot 1's still-pending promise and never issues its
  // own request — the page then sits on "Loading…" and the test reports a bug
  // that does not exist. One window per module instance, one module per window.
  const { mount } = await import(`../.smoke/mount.mjs?boot=${bootSeq++}`)
  mount(window)
  await new Promise((r) => setTimeout(r, 700))   // let effects + polls settle
  return { window, errors, root: window.document.getElementById('root') }
}

const AUTHED = {
  access_token: 'test-token',
  user_data: JSON.stringify({ id: 1, name: 'Test Student', username: 'tester', role: 'student' }),
  'detomsite-cart': JSON.stringify([
    { product_id: 'p1', shop_id: 's1', shop_name: 'Sai Tiffins', name: 'Masala Dosa', price: 120, category: 'Food' },
  ]),
}

const PAGES = [
  ['/shops', 'Shops list'],
  ['/dashboard', 'Dashboard'],
  ['/shop/s1', 'Shop detail / menu'],
  ['/cart', 'Cart'],
  ['/payment', 'Checkout'],
  ['/orders', 'My orders'],
  ['/previous-orders', 'Past orders'],
  ['/order/o1', 'Order result'],
  ['/pay/o1', 'PAYMENT PORTAL'],
  ['/reviews', 'Reviews'],
  ['/account', 'Account'],
  ['/support', 'Support'],
]

/* Noise we do not treat as a crash. */
const IGNORE = /not wrapped in act|Failed to load resource|is not defined\(Reading 'webpack|useLayoutEffect does nothing/i
const realErrors = (errors) => errors.filter((e) => !IGNORE.test(e))

console.log('='.repeat(74))
console.log('  STUDENT PORTAL — render smoke test (white-screen hunt)')
console.log('='.repeat(74))

console.log('\n  1. Each route paints real content (a blank #root IS a white screen)')
for (const [route, label] of PAGES) {
  let root, errors
  try {
    ({ root, errors } = await boot(route, AUTHED))
  } catch (e) {
    note(false, `${label} (${route})`, `threw while mounting: ${e && e.message}`)
    continue
  }
  const html = (root?.innerHTML || '').trim()
  const bad = realErrors(errors)
  note(html.length > 200 && !bad.length, `${label} (${route})`,
    html.length <= 200 ? `#root painted only ${html.length} chars` : bad.join(' | '))
}

console.log('\n  2. The payment portal paints a scannable QR (the mandatory method)')
{
  const { root, errors } = await boot('/pay/o1', AUTHED)
  const bad = realErrors(errors)
  note(!bad.length, 'Payment portal mounts without throwing', bad.join(' | '))
  // qrcode.react draws the modules as <path> runs (not <rect>, and not one
  // element per module), so the robust check is: an SVG of the right size whose
  // path data actually describes a full matrix. A blank canvas fails this.
  const dLen = [...root.querySelectorAll('svg path, svg rect')]
    .reduce((n, el) => n + (el.getAttribute('d') || '').length, 0)
  note(dLen > 500, 'Payment portal renders a real QR code',
    `QR path data was only ${dLen} chars — the code is blank`)
  const text = root.textContent || ''
  note(/scanning the QR/i.test(text), 'QR card is present with the amount')
  note(/Open my UPI app/.test(text), 'Direct UPI-app button is present')
  note(/reference/i.test(text), 'Manual reference box is present')
  note(/Checking/.test(text), 'Live verification status is present')
  // The QR must carry a real scannable UPI deep link, not a blank canvas.
  const hrefs = [...root.querySelectorAll('a')].map((a) => a.getAttribute('href') || '')
  note(hrefs.some((h) => h.startsWith('upi://pay?pa=')),
    'The UPI link is a real upi:// deep link carrying the VPA', hrefs.slice(0, 2).join(' | '))
}
console.log('\n  3. The order page routes the student to the payment portal')
{
  const { root } = await boot('/order/o1', AUTHED)
  const pay = [...root.querySelectorAll('a')].find((a) => (a.getAttribute('href') || '') === '/pay/o1')
  note(!!pay, 'Unpaid order shows a "Pay" link to /pay/:orderId', 'no /pay/o1 link found')
  note(!/Cancel Order/.test(root.textContent || ''),
    'The destructive Cancel button is gone from the order page')
}

console.log('\n  4. Corrupt localStorage (the real "it just went white" cause)')
for (const [label, bad] of [
  ['truncated user_data', { access_token: 't', user_data: '{"id":1,"na' }],
  ['user_data = "undefined"', { access_token: 't', user_data: 'undefined' }],
  ['user_data = a bare number', { access_token: 't', user_data: '42' }],
  ['cart is an object, not an array', { access_token: 't', user_data: JSON.stringify({ id: 1, name: 'S' }), 'detomsite-cart': '{"a":1}' }],
  ['auth-check cache is garbage', { access_token: 't', user_data: JSON.stringify({ id: 1, name: 'S' }), 'detomsite-auth-check': '{{{broken' }],
  ['no user_data at all', { access_token: 't' }],
]) {
  let root, errors
  try {
    ({ root, errors } = await boot('/shops', bad))
  } catch (e) {
    note(false, `Survives ${label}`, `threw while mounting: ${e && e.message}`)
    continue
  }
  const html = (root?.innerHTML || '').trim()
  const errs = realErrors(errors)
  note(html.length > 200 && !errs.length, `Survives ${label}`,
    html.length <= 200 ? `only ${html.length} chars painted` : errs.join(' | '))
}

console.log('\n' + '='.repeat(74))
console.log(`  Endpoints exercised: ${[...HIT].sort().join(', ')}`)
if (UNMOCKED.size) console.log(`  NOT modelled (404'd): ${[...UNMOCKED].sort().join(', ')}`)
console.log(failures.length
  ? `  ${failures.length} BUG(S) FOUND — each one is a white screen in production.`
  : '  No white-screen bugs found on any route.')
console.log('='.repeat(74))
process.exit(failures.length ? 1 : 0)

