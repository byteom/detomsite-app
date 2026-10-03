import React, { useState, useEffect, useMemo, FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Shop, PaymentSettings, CartItem } from '../types'
import {
  getCart,
  billBreakdown,
  MAIN_GATE,
  isVitApLocation,
  isValidMobile,
  toE164,
  displayDigits,
  isShopOrderable,
  safeParse,
} from '../utils/helpers'
import api from '../services/api'
import {
  Store,
  MapPin,
  Phone,
  Clock,
  CreditCard,
  Banknote,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
} from '../components/ui/Icons'

export function PaymentPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<CartItem[]>(() => getCart())
  const bill = billBreakdown(items)

  const [ps, setPs] = useState<PaymentSettings | null>(null)
  const [shop, setShop] = useState<Shop | null>(null)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [shopLoaded, setShopLoaded] = useState(false)

  // Saved checkout values from localStorage
  const [loc] = useState(MAIN_GATE)
  const [slot, setSlot] = useState('Evening')
  const [phone, setPhone] = useState(() => {
    try {
      return String(
        safeParse<any>(localStorage.getItem('detomsite_checkout'), {}).phone || ''
      )
    } catch {
      return ''
    }
  })

  const [chosen, setChosen] = useState<'qr' | 'cod' | null>(null)
  const [err, setErr] = useState('')

  // Load checkout data (one aggregated cached call)
  useEffect(() => {
    const shopId = items[0]?.shop_id
    const finish = () => {
      setSettingsLoaded(true)
      setShopLoaded(true)
    }
    if (!items.length) {
      finish()
      return
    }
    api
      .get<{
        shops: Shop[]
        payment_settings: PaymentSettings
      }>('/local/checkout-data', { params: shopId ? { shop_ids: shopId } : {} })
      .then(({ data }) => {
        if (data?.payment_settings) setPs(data.payment_settings)
        const list = Array.isArray(data?.shops) ? data.shops : []
        const found = list.find((s) => s.id === shopId)
        if (found) setShop(found)
      })
      .catch(() => {})
      .finally(finish)
  }, [items[0]?.shop_id])

  // Payment availability resolution
  const shopUpi = shop?.upi_id?.trim() || ''
  const globalUpi = ps?.upi_id?.trim() || ''
  const upiOn = shop ? !!shop.upi_enabled : true
  const codOn = shop ? !!shop.cod_enabled : true
  const upiAvailable = upiOn && (Boolean(shopUpi) || Boolean(ps?.manual_enabled && globalUpi))
  const codAvailable = codOn
  const payOn = upiAvailable || codAvailable

  const onlyUpi = upiAvailable && !codAvailable
  const onlyCod = codAvailable && !upiAvailable
  const method: 'qr' | 'cod' | null =
    chosen ?? (onlyUpi ? 'qr' : onlyCod ? 'cod' : null)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    if (!items.length) {
      setErr('Your cart is empty.')
      return
    }
    if (!isValidMobile(phone)) {
      setErr('Please enter a valid 10-digit Indian mobile number.')
      return
    }
    if (!isVitApLocation(loc)) {
      setErr('Delivery is available at the VIT-AP Main Gate only.')
      return
    }
    if (shopLoaded && shop && !isShopOrderable(shop)) {
      setErr(
        "This kitchen is currently closed and not accepting orders. Please try again later."
      )
      return
    }
    if (!payOn) {
      setErr(
        'This kitchen is currently not accepting any payments. Please check back later.'
      )
      return
    }
    if (method === 'qr' && !upiAvailable) {
      setErr(
        upiOn
          ? 'UPI is not configured for this kitchen. Please choose Cash on Delivery.'
          : 'This kitchen has disabled UPI payments. Please choose Cash on Delivery.'
      )
      return
    }
    if (method === 'cod' && !codAvailable) {
      setErr('Cash on Delivery is turned off by this shop. Please pay via UPI.')
      return
    }
    if (!method) {
      setErr('Please select your payment method (UPI or Cash on Delivery).')
      return
    }

    // Persist details for the payment screen
    try {
      localStorage.setItem(
        'detomsite_checkout',
        JSON.stringify({
          phone: String(phone).replace(/\s/g, ''),
          location: loc,
          slot,
          method,
        })
      )
    } catch {}

    navigate('/pay')
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 text-center">
        <p className="text-lg font-bold text-slate-700">Your cart is empty</p>
        <Link
          to="/shops"
          className="mt-4 inline-flex items-center gap-2 rounded-btn bg-emerald-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-800"
        >
          <span>Browse Campus Kitchens</span>
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      {/* Back button */}
      <Link
        to="/cart"
        className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-emerald-700 transition-colors mb-4"
      >
        <ChevronLeft className="h-4 w-4" />
        <span>Back to Cart</span>
      </Link>

      <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight mb-6">
        Checkout & Delivery
      </h1>

      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1fr_360px] lg:items-start">
        {/* Left Column: Delivery Details & Payment Choice */}
        <div className="space-y-6">
          {/* Shop Card Overview */}
          {shop && (
            <div className="rounded-card border border-slate-200 bg-white p-4 shadow-sm flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-btn bg-emerald-100 text-emerald-800 font-bold">
                <Store className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Fulfilling Kitchen
                </p>
                <h3 className="font-bold text-base text-slate-900 truncate">
                  {shop.name}
                </h3>
              </div>
              <span
                className={`text-xs font-bold px-2.5 py-1 rounded-pill ${
                  isShopOrderable(shop)
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-slate-100 text-slate-500'
                }`}
              >
                {isShopOrderable(shop) ? 'Accepting Orders' : 'Kitchen Closed'}
              </span>
            </div>
          )}

          {/* Step 1: Delivery Details */}
          <div className="rounded-panel border border-slate-200 bg-white p-5 sm:p-6 shadow-card space-y-4">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
              <MapPin className="h-5 w-5 text-emerald-600" />
              <span>1. Delivery Destination</span>
            </h2>

            {/* Readonly Campus Gate */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                Collection Point (Campus Gate)
              </label>
              <div className="flex items-center justify-between rounded-btn border-2 border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800">
                <span>{MAIN_GATE}</span>
                <span className="text-xs font-bold text-emerald-700 bg-emerald-100/60 px-2 py-0.5 rounded-sm">
                  Fixed Location
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                All food parcels are collected at the main gate for campus security.
              </p>
            </div>

            {/* Student Phone Number */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                Mobile Number (for delivery SMS/Call)
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">
                  +91
                </span>
                <input
                  type="tel"
                  inputMode="numeric"
                  value={displayDigits(phone)}
                  onChange={(e) => setPhone(toE164(e.target.value))}
                  placeholder="98765 43210"
                  required
                  className="w-full rounded-btn border-2 border-slate-200 bg-white py-3 pl-14 pr-4 text-sm font-semibold text-slate-900 outline-none transition-all focus:border-emerald-600 focus:shadow-sm"
                />
              </div>
            </div>

            {/* Delivery Slot */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                Preferred Delivery Slot
              </label>
              <select
                value={slot}
                onChange={(e) => setSlot(e.target.value)}
                className="w-full rounded-btn border-2 border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 outline-none transition-all focus:border-emerald-600"
              >
                {['Morning', 'Afternoon', 'Evening', 'Night'].map((s) => (
                  <option key={s} value={s}>
                    {s} Batch
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Step 2: Payment Method Choice */}
          <div className="rounded-panel border border-slate-200 bg-white p-5 sm:p-6 shadow-card space-y-4">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-emerald-600" />
              <span>2. Payment Option</span>
            </h2>

            <p className="text-xs text-slate-500">
              {onlyUpi
                ? 'This kitchen only accepts UPI payments.'
                : onlyCod
                ? 'This kitchen currently accepts Cash on Delivery only.'
                : 'Select your preferred payment method below:'}
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              {/* UPI Option */}
              {upiAvailable && (
                <button
                  type="button"
                  onClick={() => setChosen('qr')}
                  className={`flex flex-col p-4 rounded-card border-2 text-left transition-all active:scale-[0.99] ${
                    method === 'qr'
                      ? 'border-emerald-600 bg-emerald-50/60 shadow-sm ring-2 ring-emerald-600/20'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <div className="flex h-9 w-9 items-center justify-center rounded-btn bg-emerald-100 text-emerald-800">
                      <CreditCard className="h-5 w-5" />
                    </div>
                    {method === 'qr' && (
                      <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                    )}
                  </div>
                  <span className="font-bold text-sm text-slate-900 mt-2">
                    UPI / QR Code
                  </span>
                  <span className="text-xs text-slate-500 mt-0.5">
                    Scan via GPay, PhonePe, Paytm, or UPI app
                  </span>
                </button>
              )}

              {/* COD Option */}
              {codAvailable && (
                <button
                  type="button"
                  onClick={() => setChosen('cod')}
                  className={`flex flex-col p-4 rounded-card border-2 text-left transition-all active:scale-[0.99] ${
                    method === 'cod'
                      ? 'border-amber-600 bg-amber-50/60 shadow-sm ring-2 ring-amber-600/20'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <div className="flex h-9 w-9 items-center justify-center rounded-btn bg-amber-100 text-amber-800">
                      <Banknote className="h-5 w-5" />
                    </div>
                    {method === 'cod' && (
                      <CheckCircle2 className="h-5 w-5 text-amber-600" />
                    )}
                  </div>
                  <span className="font-bold text-sm text-slate-900 mt-2">
                    Cash on Delivery
                  </span>
                  <span className="text-xs text-slate-500 mt-0.5">
                    Pay in exact cash when order arrives at gate
                  </span>
                </button>
              )}
            </div>

            {err && (
              <div className="flex items-center gap-2 rounded-btn bg-red-50 border border-red-200 p-3 text-xs font-bold text-red-700">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{err}</span>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Order Summary & Place Order */}
        <div className="sticky top-20 rounded-panel border border-slate-200 bg-white p-5 shadow-card space-y-4">
          <h2 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3">
            Payment Summary
          </h2>

          <div className="space-y-2.5 text-xs sm:text-sm text-slate-600">
            <div className="flex justify-between">
              <span>Items Total ({items.length})</span>
              <span className="font-bold text-slate-900">₹{bill.subtotal}</span>
            </div>

            <div className="flex justify-between text-emerald-700">
              <span>Delivery Fee</span>
              <span className="font-bold uppercase">FREE</span>
            </div>

            <div className="flex justify-between text-slate-500">
              <span>Platform Fee</span>
              <span>₹0</span>
            </div>

            <div className="pt-3 border-t border-slate-200 flex justify-between items-baseline font-black text-slate-900">
              <span className="text-base">Total Due</span>
              <span className="text-2xl text-emerald-700">₹{bill.total}</span>
            </div>
          </div>

          <button
            type="submit"
            className="w-full inline-flex items-center justify-center gap-2 rounded-btn bg-emerald-700 py-3.5 px-5 text-sm sm:text-base font-black text-white shadow-modal hover:bg-emerald-800 transition-all active:scale-[0.98]"
          >
            <span>Continue to Payment</span>
            <ArrowRight className="h-4 w-4" />
          </button>

          <p className="text-[11px] text-center text-slate-400 font-medium leading-relaxed">
            {method === 'qr'
              ? 'Next screen presents the UPI QR and exact payment details.'
              : 'Next screen confirms your Cash on Delivery order.'}
          </p>
        </div>
      </form>
    </div>
  )
}
