import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import QRCode from 'qrcode'
import api from '../services/api'
import { LocalPaymentSettings, LocalProduct, LocalShop, LocalParentOrder } from '../types/localApi'
import { clearCart, getCartByShop, toPaymentGroup } from '../utils/cart'
import { getCheckoutProfile, getLocalSession } from '../utils/session'

const DEFAULT_LOC = 'VIT-AP Main Gate'

/* Build a minimal UPI deep link that does not trip the bank's risk engine: keep
   ONLY pa (exact VPA) + pn (the exact bank account-holder name) + am + cu + a
   short tn. Extra params, or a `pn` that is the shop's display name rather than
   the account holder, are what make GPay show "THIS PAYMENT MAY FAIL AS PER UPI
   RISK POLICY". */
function buildUpiUri(pa: string, pn: string, amount: number, note: string) {
  const payee = String(pa || '').trim()
  const name = String(pn || '').trim()
  return `upi://pay?pa=${encodeURIComponent(payee)}&pn=${encodeURIComponent(name)}&am=${(Math.round(amount * 100) / 100).toFixed(2)}&cu=INR&tn=${encodeURIComponent(String(note || '').trim().slice(0, 40))}`
}

/* ─── Pay (page 3 of 3) ───
 * Cart → Checkout → THIS PAGE → Orders. The student sees the QR and the exact
 * amount before anything is committed; "Place Order" is the one button that
 * creates the real order, so an abandoned checkout never reaches a vendor.
 *
 * The amount is priced from the LIVE product list rather than from the prices the
 * cart captured: the server re-prices every order from the product table and
 * ignores whatever total the client sends, so a stale cart price would otherwise
 * encode the wrong amount in the QR and the admin could not match the real
 * payment against the bill. Server fees are all zero, so the live product-price
 * sum IS the order total. If a vendor changed a price, the student is stopped
 * here and told rather than charged the difference after the fact. */
export default function PayPage() {
  const navigate = useNavigate()
  const session = getLocalSession()
  const [ps, setPs] = useState<LocalPaymentSettings | null>(null)
  const [shop, setShop] = useState<LocalShop | null>(null)
  const [live, setLive] = useState<Record<string, number> | null>(null)
  const [loading, setLoading] = useState(true)
  const [placing, setPlacing] = useState(false)
  const [error, setError] = useState('')

  const groups = getCartByShop()
  const cartTotal = groups.reduce((sum, g) => sum + g.subtotal, 0)

  /* Details captured on the checkout page. Reading them back from storage (rather
     than router state) means a refresh, or a trip back to the cart, never loses
     the phone number the student already typed. */
  const profile = getCheckoutProfile()
  const phone = profile.phone || session?.phone || ''
  const loc = profile.location || DEFAULT_LOC
  const slot = profile.slot || 'Afternoon'

  useEffect(() => {
    api.get<LocalPaymentSettings>('/local/payment-settings').then(r => setPs(r.data)).catch(() => {})
  }, [])

  /* Price every line of the cart from the live product list, and pull the first
     shop for the UPI target and its open/closed state. */
  const groupKey = groups.map(g => `${g.shop_id}:${g.items.map(i => i.product_id).join('|')}`).join('~')
  useEffect(() => {
    if (!groups.length) { setLoading(false); return }
    // ONE aggregated request (shops + per-shop products + payment settings)
    // instead of 1 + 2N. Falls back to the old fan-out on old backends.
    const ids = groups.map(g => g.shop_id).filter(Boolean).join(',')
    setLoading(true)
    api.get<{
      shops: LocalShop[]; products: Record<string, LocalProduct[]>;
      payment_settings: LocalPaymentSettings;
    }>(`/local/checkout-data?shop_ids=${encodeURIComponent(ids)}`).then(r => {
      if (r.data.payment_settings) setPs(r.data.payment_settings)
      const results = (r.data.shops || []).map(s => ({
        shopId: s.id, shop: s,
        products: (r.data.products || {})[s.id] || [],
      }))
      const prices: Record<string, number> = {}
      let anyMissing = false
      for (const g of groups) {
        const result = results.find(rr => rr.shopId === g.shop_id)
        for (const item of g.items) {
          const product = result?.products.find(p => p.id === item.product_id)
          if (!product || !product.available) { anyMissing = true; continue }
          prices[item.product_id] = Number(product.price) * item.quantity
        }
      }
      if (anyMissing) setError('Something in your cart is no longer available. Go back to the cart and remove it, then try again.')
      setLive(prices)
      setShop(results[0]?.shop ?? null)
      setLoading(false)
    }).catch(() => {
      Promise.all(groups.map(g =>
        Promise.all([
          api.get<LocalProduct[]>('/local/products', { params: { shop_id: g.shop_id } }),
          api.get<LocalShop>(`/local/shops/${g.shop_id}`),
        ]).then(([pr, sr]) => ({ shopId: g.shop_id, products: pr.data, shop: sr.data })),
      ))
        .then(results => {
          const prices: Record<string, number> = {}
          let anyMissing = false
          for (const g of groups) {
            const result = results.find(r => r.shopId === g.shop_id)
            for (const item of g.items) {
              const product = result?.products.find(p => p.id === item.product_id)
              if (!product || !product.available) { anyMissing = true; continue }
              prices[item.product_id] = Number(product.price) * item.quantity
            }
          }
          if (anyMissing) setError('Something in your cart is no longer available. Go back to the cart and remove it, then try again.')
          setLive(prices)
          setShop(results[0]?.shop ?? null)
        })
        .catch(() => setError('Could not load the live prices for your cart. Check your connection and try again.'))
        .finally(() => setLoading(false))
    })
  }, [groupKey])

  const amount = useMemo(
    () => (live
      ? groups.reduce((sum, g) => sum + g.items.reduce((a, i) => a + (live[i.product_id] ?? 0), 0), 0)
      : cartTotal),
    [live, cartTotal, groups],
  )
  const priceChanged = live !== null && amount !== cartTotal

  /* The platform UPI the order is paid to. The main portal's shop records do not
     carry a per-shop UPI ID (the student app resolves one per shop), so this page
     uses the admin's global UPI exactly as the order-result page always has. */
  const globalUpi = ps?.upi_id?.trim() || ''
  const upiAvailable = Boolean(ps?.manual_enabled && globalUpi)
  const method: 'manual' | 'cod' = upiAvailable ? 'manual' : 'cod'
  const receiver = ps?.receiver_name || 'DETOMSITE'

  const shopOpen = shop
    ? (!!shop.present && shop.status === 'Open' && shop.approval_status === 'Approved')
    : false
  const payable = groups.length > 0 && live !== null && !priceChanged && !error && upiAvailable && shopOpen
  const qrUri = upiAvailable ? buildUpiUri(globalUpi, receiver, amount, `Detomsite ${amount}`) : ''

  const [qrImage, setQrImage] = useState('')
  useEffect(() => {
    let active = true
    if (!qrUri) { setQrImage(''); return () => { active = false } }
    QRCode.toDataURL(qrUri, { width: 260, margin: 2, errorCorrectionLevel: 'M' })
      .then(url => { if (active) setQrImage(url) })
      .catch(() => { if (active) setQrImage('') })
    return () => { active = false }
  }, [qrUri])

  const placeOrder = async () => {
    if (!payable || placing) return
    setPlacing(true); setError('')
    try {
      /* One parent order for the whole basket (ONE token across all shops), which
         is what the multi-shop checkout has always created. */
      const order = await api.post<LocalParentOrder>('/local/orders/multi', {
        shops: groups.map(g => toPaymentGroup(g)),
        student_name: session?.name || 'Student',
        student_phone: phone,
        student_email: session?.email || '',
        delivery_location: loc,
        delivery_slot: slot,
        payment_method: method === 'cod' ? 'COD' : 'UTR',
      })
      /* Record the payment row so the admin has an amount to verify the manual
         UPI proof against. A failure here does NOT mean the order failed — the
         order already exists, so it is never re-submitted (that produced
         duplicate orders). After placing the order the student submits the UTR
         + screenshot on the order page for manual admin verification. */
      try {
        await api.post('/local/payments', {
          order_id: order.data.id,
          amount,
          method: method === 'cod' ? 'COD' : 'Manual UTR',
          utr_number: '',
        })
      } catch (err: any) {
        sessionStorage.setItem('payment_pending', '1')
        const detail = err?.response?.data?.detail || ''
        if (detail) sessionStorage.setItem('payment_pending_detail', String(detail))
      }
      clearCart()
      /* The order now exists — hand the student to its result page. */
      navigate(`/order-result/${order.data.id}`)
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Order could not be placed')
    } finally {
      setPlacing(false)
    }
  }

  if (!groups.length) {
    return (
      <div className="min-h-screen bg-white">
        <div className="mx-auto max-w-2xl px-4 py-10 text-center">
          <h2 className="text-xl font-bold text-gray-600">Your cart is empty</h2>
          <Link to="/shops" className="mt-4 inline-flex rounded-btn bg-primary px-5 py-2.5 text-sm font-bold text-white">Browse shops →</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-lg px-4 py-6">
        <h1 className="text-2xl font-bold text-primary-dark">Payment</h1>
        <p className="mt-1 text-sm font-medium text-gray-500">Scan the QR to pay, then tap Place Order.</p>

        <div className="mt-6 rounded-btn bg-white p-5 shadow-card">
          <div className="mb-4 flex items-baseline justify-between border-b border-gray-100 pb-4">
            <span className="text-sm font-medium text-gray-500">Amount to pay</span>
            <span className="text-2xl font-black text-primary-dark">₹{amount}</span>
          </div>

          {loading ? (
            <p className="py-8 text-center text-sm text-gray-500">Loading the live price…</p>
          ) : upiAvailable && qrImage ? (
            <>
              <div className="flex flex-col items-center">
                <img src={qrImage} alt="UPI payment QR"
                  className="h-60 w-60 rounded-btn border border-gray-200 bg-white p-2" />
                <p className="mt-2 text-xs font-bold text-primary-dark">₹{amount}</p>
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-gray-500">
                Download this QR and scan it with GPay / PhonePe / Paytm. The amount is
                pre-filled, so you cannot overpay by accident.
                <b> Do not scan any other QR</b> — one scan, one payment.
              </p>
              {/* Download is the ONLY QR action. The deep link that used to open a
                  UPI app directly is gone on purpose: two ways to pay is two ways
                  to pay twice, and the amount can only ever be settled once. The
                  downloaded file is the same data URL shown on screen, so it can
                  never encode a different amount than the one displayed. */}
              <a href={qrImage} download="Detomsite-QR.png"
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-btn bg-primary px-4 py-2.5 text-sm font-bold text-white transition-all hover:bg-primary-dark">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>
                Download QR
              </a>
            </>
          ) : (
            <div className="rounded-btn border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-700">
              💵 Pay ₹{amount} in cash when your order is delivered. No COD fee.
              <p className="mt-1 text-xs text-amber-600/80">This shop has no UPI ID set up, so there is no QR to scan.</p>
            </div>
          )}

          {priceChanged && (
            <p className="mt-4 rounded-btn border-2 border-amber-300 bg-amber-50 px-4 py-3 text-xs font-semibold text-gold-dark">
              The price changed since you added this to your cart (now ₹{amount}). Go back to the cart to review before ordering.
            </p>
          )}

          {error && <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-600">{error}</p>}

          <button type="button" onClick={placeOrder} disabled={!payable || placing}
            className="mt-5 w-full rounded-btn bg-primary px-5 py-3 text-sm font-bold text-white shadow-gold transition-all hover:bg-primary-dark disabled:opacity-40">
            {placing ? 'Placing order…' : `Place Order · ₹${amount}`}
          </button>
          <p className="mt-2 text-center text-[11px] font-medium text-gray-400">
            Your order is sent to the shop only when you tap this.
          </p>
        </div>
      </div>
    </div>
  )
}
