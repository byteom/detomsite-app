import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import {
  Shop,
  Product,
  PaymentSettings,
  CartItem,
  Order,
} from '../types'
import {
  getCart,
  clearCart,
  saveCart,
  billBreakdown,
  MAIN_GATE,
  toE164,
  readUser,
  buildUpiUri,
  downloadQrPng,
  checkoutRef,
  isShopOrderable,
  safeParse,
} from '../utils/helpers'
import api from '../services/api'
import {
  CreditCard,
  Banknote,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Clock,
  ArrowRight,
  ChevronLeft,
} from '../components/ui/Icons'

const DRAFT_ATTEMPTS = 4
const ORDER_WRITE_TIMEOUT_MS = 60000
// Explicit HTTP timeout for the order POST. Writes are never retried, and a
// client_ref makes them idempotent — so a slow-but-successful order must not
// be reported as failed (that is what used to create "paid but no order"
// panic). 30 s bounds the hang while surviving cold-start slowness.
const ORDER_HTTP_TIMEOUT_MS = 30000

interface CheckoutData {
  shops: Shop[]
  products: Record<string, Product[]>
  payment_settings: PaymentSettings
}

// Short module-level cache for checkout-data, keyed by cart contents.
// Remounts (back-navigation, auth re-checks) within 30 s reuse the quote
// instead of re-paying a full checkout-data read. The backend re-prices
// authoritatively at submit, so a seconds-old quote can never mis-charge —
// and any cart change busts the key and refetches.
const checkoutCache = new Map<string, { t: number; data: CheckoutData }>()
const CHECKOUT_TTL_MS = 30000

export function PayPage() {
  const navigate = useNavigate()
  const user = readUser()
  const [ps, setPs] = useState<PaymentSettings | null>(null)
  const [shop, setShop] = useState<Shop | null>(null)
  const [live, setLive] = useState<Record<string, number> | null>(null)
  const [placing, setPlacing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const items = getCart()
  const cartBill = billBreakdown(items)

  const saved = useMemo(
    () =>
      safeParse<{
        phone?: string
        location?: string
        slot?: string
        method?: 'qr' | 'cod'
      }>(localStorage.getItem('detomsite_checkout'), {}),
    []
  )
  const phone = String(saved.phone || '')
  const loc = saved.location || MAIN_GATE
  const slot = saved.slot || 'Evening'
  const chosenMethod = saved.method || null

  const cartKey = items.map((i) => i.product_id).join(',')

  // Load live prices & shop payment details in one call.
  // Served from the short cart-scoped cache on remounts (see above).
  useEffect(() => {
    if (!items.length) {
      setLoading(false)
      return
    }
    const apply = (data: CheckoutData) => {
      setPs(data?.payment_settings || null)
      const list = Array.isArray(data?.shops) ? data.shops : []
      const byId =
        data?.products && typeof data.products === 'object' ? data.products : {}
      const results = shopIds.map((id) => ({
        id,
        products: Array.isArray(byId[id]) ? byId[id] : [],
        shop: list.find((s) => s.id === id) as Shop,
      }))

      const prices: Record<string, number> = {}
      let anyMissing = false
      for (const item of items) {
        const group = results.find((r) => r.id === item.shop_id)
        const product = group?.products.find((p) => p.id === item.product_id)
        if (!product || !product.available) {
          anyMissing = true
          continue
        }
        prices[item.product_id] = Number(product.price) * (item.quantity || 1)
      }
      if (anyMissing) {
        setErr(
          'An item in your cart is no longer available. Please return to your cart and remove it.'
        )
      }
      setLive(prices)
      setShop(results[0]?.shop ?? null)
    }

    const shopIds = Array.from(new Set(items.map((i) => i.shop_id)))
    const hit = checkoutCache.get(cartKey)
    if (hit && Date.now() - hit.t < CHECKOUT_TTL_MS) {
      apply(hit.data)
      setLoading(false)
      return
    }
    api
      .get<CheckoutData>('/local/checkout-data', { params: { shop_ids: shopIds.join(',') } })
      .then(({ data }) => {
        checkoutCache.set(cartKey, { t: Date.now(), data })
        apply(data)
      })
      .catch(() =>
        setErr(
          'Could not load current prices for your cart. Please check your connection and retry.'
        )
      )
      .finally(() => setLoading(false))
  }, [cartKey])

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

  const method: 'qr' | 'cod' =
    chosenMethod === 'cod' ? 'cod' : upiAvailable ? 'qr' : 'cod'
  const receiver =
    (shopUpi ? shop?.shopkeeper_name || ps?.receiver_name : ps?.receiver_name) ||
    'DETOMSITE'

  const isUpi = method === 'qr' && upiAvailable
  const [draft, setDraft] = useState<{ id: string; token: number } | null>(null)
  const [drafting, setDrafting] = useState(false)
  // Draft-creation diagnostics: attempt counter for the status line, a latched
  // failure flag (stops the silent infinite retry the old effect had — its
  // `tries` reset on every re-run so the button could stay dead forever with
  // no message), and a nonce the Retry button bumps to start over.
  const [draftAttempt, setDraftAttempt] = useState(0)
  const [draftFailed, setDraftFailed] = useState(false)
  const [draftNonce, setDraftNonce] = useState(0)
  // Bumped after rewriting cart prices so this render reads the fresh cart.
  const [, setCartTick] = useState(0)

  const draftInFlight = useRef(false)
  const placeInFlight = useRef(false)
  const placeAttempt = useRef(0)

  const canTakePayment =
    items.length > 0 &&
    live !== null &&
    !priceChanged &&
    !err &&
    (method === 'cod' ? codOn : upiAvailable) &&
    (shop ? isShopOrderable(shop) : false)

  // The button enables as soon as the ORDER is valid (prices fresh, shop
  // open). It never waits on the up-front draft: tapping Continue creates the
  // order on the spot when no draft exists (duplicate-safe via client_ref).
  const payable = canTakePayment

  const qrUri = isUpi
    ? buildUpiUri(upiTarget, receiver, quotedTotal, `Detomsite ${quotedTotal}`)
    : ''

  const createOrder = async (): Promise<Order[]> => {
    const shopGroups: Record<string, CartItem[]> = {}
    for (const item of items) {
      if (!shopGroups[item.shop_id]) shopGroups[item.shop_id] = []
      shopGroups[item.shop_id].push(item)
    }
    // One POST per shop, all in flight together. The old sequential
    // for-await multiplied a multi-shop submit by N server round trips.
    // Parallel is safe: every group carries its own client_ref, so the
    // server's idempotency guard still dedupes per-shop retries.
    const postOne = async ([shopId, shopItems]: [string, CartItem[]]) => {
      const shopTotal = shopItems.reduce(
        (a, i) => a + (live?.[i.product_id] ?? i.price * (i.quantity || 1)),
        0
      )
      const order = await api.post<Order>(
        '/local/orders',
        {
          shop_id: shopId,
          items: shopItems.map((i) => ({
            product_id: i.product_id,
            quantity: i.quantity || 1,
          })),
          student_name: user.name || 'Student',
          student_phone: toE164(phone),
          delivery_location: loc,
          delivery_slot: slot,
          payment_method: method === 'cod' ? 'COD' : 'UPI',
          total: shopTotal,
          client_ref: checkoutRef(shopItems, method),
          timeout: ORDER_WRITE_TIMEOUT_MS,
        },
        { timeout: ORDER_HTTP_TIMEOUT_MS }
      )
      return { shopId, order: order.data }
    }
    const settled = await Promise.all(
      Object.entries(shopGroups).map(postOne)
    )
    // Keep the original deterministic order (first shop group first) so the
    // post-submit navigation lands on the same order as before.
    settled.sort(
      (a, b) =>
        Object.keys(shopGroups).indexOf(a.shopId) -
        Object.keys(shopGroups).indexOf(b.shopId)
    )
    return settled.map((s) => s.order)
  }

  // Create UPI draft order up-front. The attempt counter + failure latch live
  // in state (not just refs) so the UI can say what's happening and offer a
  // retry — previously a failing draft retried silently forever and the
  // Continue button stayed grey with no explanation.
  useEffect(() => {
    if (!isUpi || !canTakePayment || draft || draftFailed || draftInFlight.current)
      return
    draftInFlight.current = true
    setDrafting(true)
    let tries = 0
    let cancelled = false

    const attempt = () => {
      if (cancelled) return
      tries++
      setDraftAttempt(tries)
      createOrder()
        .then((orders) => {
          if (cancelled) return
          const first = orders[0]
          if (!first) throw new Error('empty order response')
          setDraft({ id: first.id, token: first.token })
          setDrafting(false)
          draftInFlight.current = false
        })
        .catch(() => {
          if (cancelled) return
          if (tries < DRAFT_ATTEMPTS) {
            setTimeout(attempt, 2000)
          } else {
            setDraftFailed(true)
            setDrafting(false)
            draftInFlight.current = false
            setErr(
              'Could not initialize the payment order. Please check your network and retry.'
            )
          }
        })
    }
    attempt()
    return () => {
      cancelled = true
    }
    // NOTE: `drafting` is intentionally NOT a dep — flipping it mid-cycle
    // would restart the attempt counter and retry forever.
  }, [isUpi, canTakePayment, draft, draftFailed, draftNonce])

  const retryDraft = () => {
    setErr('')
    setDraftFailed(false)
    setDraftAttempt(0)
    setDraftNonce((n) => n + 1)
  }

  // Bring stale cart prices in line with the live quote (fixes `priceChanged`
  // without sending the student back to the cart).
  const syncCartPrices = () => {
    if (!live) return
    const itemsNow = getCart()
    const synced = itemsNow.map((i) =>
      live[i.product_id] != null
        ? { ...i, price: live[i.product_id] / (i.quantity || 1) }
        : i
    )
    saveCart(synced)
    setCartTick((t) => t + 1)
  }

  // The exact reason Continue is disabled — rendered under the CTA so a grey
  // button always explains itself instead of looking "stuck".
  const blockReason: string = loading
    ? 'Loading live prices…'
    : err
    ? ''
    : live === null
    ? 'Waiting for live prices…'
    : priceChanged
    ? `Cart total ₹${cartBill.total} no longer matches live prices ₹${quotedTotal}.`
    : !upiAvailable && method !== 'cod'
    ? 'UPI is not set up for this shop right now.'
    : shop && !isShopOrderable(shop)
    ? `${shop.name} is not accepting orders right now.`
    : drafting
    ? `Creating your order… (attempt ${Math.max(draftAttempt, 1)} of ${DRAFT_ATTEMPTS})`
    : isUpi && !draft && !draftFailed
    ? 'Preparing your order…'
    : ''

  // Verification is MANUAL: nothing here waits for an automatic bank
  // confirmation. The draft order exists so the student can pay the exact QR
  // amount; tapping continue takes them to the payment page where they submit
  // the UTR + screenshot proof for admin verification.

  const handlePlaceOrder = async () => {
    if (!payable || placing || placeInFlight.current) return
    placeInFlight.current = true
    setPlacing(true)
    setErr('')

    try {
      if (isUpi) {
        // Prefer the up-front draft, but never strand the student on it: if
        // the draft never materialized, create the order right here (the
        // deterministic client_ref keeps this duplicate-safe) and continue to
        // payment-proof submission.
        const target = draft ?? (await createOrder())[0]
        clearCart()
        if (target) {
          navigate(`/pay/${target.id}`, { replace: true })
        } else {
          setErr('Could not create your order. Please retry.')
        }
      } else {
        const orders = await createOrder()
        clearCart()
        const first = orders[0]
        navigate(first ? `/order/${first.id}` : '/orders', { replace: true })
      }
    } catch (e: any) {
      setErr(
        'Could not complete your order. If money was deducted, your order is safely preserved under My Orders.'
      )
    } finally {
      placeInFlight.current = false
      setPlacing(false)
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center space-y-4">
        <div className="h-44 rounded-card skeleton-shimmer bg-slate-200" />
        <p className="text-xs font-semibold text-slate-400">Loading order totals...</p>
      </div>
    )
  }

  if (!items.length) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-base font-bold text-slate-700">No active checkout session</p>
        <Link
          to="/shops"
          className="mt-4 inline-flex items-center gap-2 rounded-btn bg-emerald-700 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-800"
        >
          <span>Return to Kitchens</span>
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
      {/* Back button */}
      <Link
        to="/payment"
        className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-emerald-700 transition-colors mb-4"
      >
        <ChevronLeft className="h-4 w-4" />
        <span>Back to Delivery Details</span>
      </Link>

      <div className="rounded-panel border border-slate-200 bg-white p-6 sm:p-8 shadow-card space-y-6">
        {/* Header */}
        <div className="text-center space-y-1">
          <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">
            Final Step
          </p>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
            {isUpi ? 'Complete UPI Payment' : 'Confirm Cash on Delivery'}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500">
            Ordering from <b className="text-slate-800">{shop?.name}</b> · {loc}
          </p>
        </div>

        {/* Amount Due Card */}
        <div className="rounded-card bg-emerald-50 border border-emerald-200 p-5 text-center">
          <span className="text-xs font-bold text-emerald-800 uppercase tracking-wide">
            Total Amount Due
          </span>
          <p className="text-3xl sm:text-4xl font-black text-emerald-800 mt-1">
            ₹{quotedTotal}
          </p>
          <p className="text-[11px] text-emerald-700 mt-1 font-medium">
            Zero delivery fee · Campus fixed price
          </p>
        </div>

        {/* UPI Payment Flow */}
        {isUpi && (
          <div className="space-y-5">
            {/* Scannable QR Code */}
            <div className="flex flex-col items-center justify-center p-6 rounded-card border-2 border-dashed border-emerald-200 bg-slate-50">
              <div className="rounded-card bg-white p-3.5 shadow-sm border border-slate-200">
                <QRCodeSVG
                  id="detomsite-pay-qr"
                  value={qrUri}
                  size={190}
                  level="M"
                  includeMargin={true}
                />
              </div>

              <div className="mt-4 text-center space-y-1">
                <p className="text-xs font-bold text-slate-900">
                  Scan with any UPI App (GPay, PhonePe, Paytm)
                </p>
                <p className="text-[11px] text-slate-500">
                  Payee: <b className="text-slate-800">{receiver}</b> ({upiTarget})
                </p>
              </div>

              {/* Action: Open in UPI App */}
              <a
                href={qrUri}
                className="mt-4 inline-flex items-center justify-center gap-2 rounded-btn bg-emerald-700 w-full max-w-xs py-3 text-sm font-bold text-white shadow-sm hover:bg-emerald-800 transition-colors"
              >
                <CreditCard className="h-4 w-4" />
                <span>Open my UPI App · Pay ₹{quotedTotal}</span>
              </a>

              {/* Action: Download QR PNG */}
              <button
                type="button"
                onClick={() =>
                  downloadQrPng(
                    document.getElementById('detomsite-pay-qr') as SVGSVGElement | null,
                    `detomsite-order-${draft?.token || 'payment'}-qr.png`
                  )
                }
                className="mt-2 text-xs font-bold text-emerald-800 hover:underline"
              >
                Download QR Code to Phone Gallery
              </button>
            </div>

            {/* Anti-fraud warning */}
            <div className="flex items-start gap-2.5 rounded-btn bg-slate-100 p-3 text-xs text-slate-600 border border-slate-200">
              <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>
                Please verify that the name in your payment app shows <b>{receiver}</b>. Do not scan any external personal codes.
              </span>
            </div>

            {/* What happens next (manual verification — nothing automatic) */}
            <div className="flex items-center justify-between p-4 rounded-btn border text-xs font-bold bg-emerald-50 border-emerald-200 text-emerald-900">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-700" />
                <span>
                  {draft
                    ? 'Order ready. Continue to submit your UTR + payment screenshot for admin verification.'
                    : draftFailed
                    ? 'Order setup hit a snag — you can retry, or just tap Continue and it will be created.'
                    : 'Pay the QR in your UPI app, then tap Continue to submit your payment proof.'}
                </span>
              </div>
              {draft?.token && (
                <span className="font-extrabold text-slate-700">
                  Token #{draft.token}
                </span>
              )}
            </div>
            {draftFailed && (
              <button
                type="button"
                onClick={retryDraft}
                className="w-full rounded-btn border border-emerald-300 bg-white px-4 py-2.5 text-xs font-bold text-emerald-800 hover:bg-emerald-50"
              >
                Retry order setup
              </button>
            )}
          </div>
        )}

        {/* Cash on Delivery Flow */}
        {!isUpi && (
          <div className="rounded-card border border-amber-200 bg-amber-50/70 p-5 space-y-2">
            <div className="flex items-center gap-2 text-amber-900 font-bold text-sm">
              <Banknote className="h-5 w-5 text-amber-700" />
              <span>Cash on Delivery Selected</span>
            </div>
            <p className="text-xs text-amber-800 leading-relaxed">
              Please keep exact change of <b>₹{quotedTotal}</b> ready. You will pay the delivery partner directly at the VIT-AP Main Gate.
            </p>
          </div>
        )}

        {priceChanged && (
          <div className="rounded-btn border-2 border-amber-300 bg-amber-50 px-4 py-3 space-y-2">
            <p className="text-xs font-semibold text-amber-800">
              Prices changed since you added these to your cart (cart ₹{cartBill.total}, now ₹{quotedTotal}).
            </p>
            <button
              type="button"
              onClick={syncCartPrices}
              className="w-full rounded-btn bg-amber-600 px-4 py-2 text-xs font-bold text-white hover:bg-amber-700"
            >
              Update cart to latest prices (₹{quotedTotal})
            </button>
          </div>
        )}

        {err && (
          <div className="flex items-center gap-2 rounded-btn bg-red-50 border border-red-200 p-3 text-xs font-bold text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{err}</span>
          </div>
        )}

        {/* Primary CTA */}
        <button
          type="button"
          disabled={!payable || placing}
          onClick={handlePlaceOrder}
          className={`w-full inline-flex items-center justify-center gap-2 rounded-btn py-4 text-base font-black text-white shadow-modal transition-all ${
            payable && !placing
              ? 'bg-emerald-700 hover:bg-emerald-800 active:scale-[0.98]'
              : 'bg-slate-300 cursor-not-allowed opacity-75'
          }`}
        >
          <span>{placing ? 'Submitting Order...' : isUpi ? 'Continue · Submit Payment Proof' : 'Place Order'}</span>
          <ArrowRight className="h-4 w-4" />
        </button>
        {/* A grey button must always say why — never look "stuck". */}
        {!payable && !placing && blockReason !== '' && (
          <p className="text-center text-[11px] font-bold text-amber-700">{blockReason}</p>
        )}
      </div>
    </div>
  )
}
