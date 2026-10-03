import React, { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { Order, Shop, PaymentSettings } from '../types'
import {
  buildUpiUri,
  downloadQrPng,
  formatPlacedAt,
  HELP_DESK_PHONE,
} from '../utils/helpers'
import api, { dedupeGet } from '../services/api'
import { usePolling } from '../hooks/usePolling'
import {
  CreditCard,
  ShieldCheck,
  Clock,
  CheckCircle2,
  AlertCircle,
  ChevronLeft,
  ArrowRight,
  Phone,
} from '../components/ui/Icons'

export function PaymentPortalPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const [order, setOrder] = useState<Order | null>(null)
  const [shop, setShop] = useState<Shop | null>(null)
  const [ps, setPs] = useState<PaymentSettings | null>(null)
  const [utr, setUtr] = useState('')
  const [utrMsg, setUtrMsg] = useState('')
  const [loading, setLoading] = useState(true)

  // Load Order, Shop, and Payment settings
  useEffect(() => {
    if (!orderId) return
    dedupeGet<Order>(`/local/orders/${orderId}`)
      .then((r) => {
        setOrder(r.data)
        if (r.data?.shop_id) {
          api.get<Shop>(`/local/shops/${r.data.shop_id}`).then((res) => setShop(res.data)).catch(() => {})
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))

    api.get<PaymentSettings>('/local/payment-settings')
      .then((r) => setPs(r.data))
      .catch(() => {})
  }, [orderId])

  // Poll order status
  usePolling(
    React.useCallback(() => {
      if (!orderId || !order) return
      if (['Completed', 'Accepted', 'Confirmed', 'Preparing', 'Ready'].includes(order.status)) return
      return dedupeGet<Order>(`/local/orders/${orderId}`).then((r) => {
        if (r.data) setOrder(r.data)
      })
    }, [orderId, order?.status]),
    4000,
    [orderId, order?.status]
  )

  const isPaid =
    order &&
    ['Accepted', 'Confirmed', 'Preparing', 'Ready', 'Completed'].includes(
      order.status
    )

  const shopUpi = shop?.upi_id?.trim() || ''
  const globalUpi = ps?.upi_id?.trim() || ''
  const upiTarget = shopUpi || (ps?.manual_enabled ? globalUpi : '')
  const receiver =
    (shopUpi ? shop?.shopkeeper_name || ps?.receiver_name : ps?.receiver_name) ||
    'DETOMSITE'

  const amount = Number(order?.total || 0)
  const qrUri = upiTarget
    ? buildUpiUri(upiTarget, receiver, amount, `Detomsite #${order?.token || ''}`)
    : ''

  const submitUtr = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!utr.trim()) return
    setUtrMsg('')
    try {
      await api.post('/payments/utr', {
        order_id: orderId,
        utr_number: utr.trim(),
      })
      setUtrMsg('UTR reference submitted! The kitchen is verifying it.')
      setUtr('')
    } catch {
      setUtrMsg('Could not submit UTR. Please ensure you entered a valid 12-digit number.')
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center space-y-3">
        <div className="h-40 rounded-card skeleton-shimmer bg-slate-200" />
        <p className="text-xs text-slate-400">Loading payment portal...</p>
      </div>
    )
  }

  if (!order) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-base font-bold text-slate-700">Order not found</p>
        <Link
          to="/orders"
          className="mt-4 inline-flex items-center gap-1.5 rounded-btn bg-emerald-700 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-800"
        >
          <span>View My Orders</span>
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
      <Link
        to={`/order/${order.id}`}
        className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-emerald-700 transition-colors mb-4"
      >
        <ChevronLeft className="h-4 w-4" />
        <span>Back to Order Details</span>
      </Link>

      <div className="rounded-panel border border-slate-200 bg-white p-6 sm:p-8 shadow-card space-y-6">
        <div className="text-center space-y-1">
          <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">
            Payment Portal
          </p>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
            Order #{order.token}
          </h1>
          <p className="text-xs text-slate-500">
            {order.shop_name} · Placed {formatPlacedAt(order.created_at)}
          </p>
        </div>

        {/* Status Alert */}
        <div
          className={`flex items-center justify-between p-4 rounded-card border ${
            isPaid
              ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
              : 'bg-amber-50 border-amber-200 text-amber-900'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {isPaid ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-700" />
            ) : (
              <Clock className="h-5 w-5 text-amber-600 animate-spin" />
            )}
            <span className="font-bold text-sm">
              {isPaid
                ? 'Payment Verified! Your kitchen is preparing this order.'
                : 'Payment Pending · Checking live verification status...'}
            </span>
          </div>
          <span className="font-black text-base">₹{order.total}</span>
        </div>

        {/* QR Code and UPI Intent */}
        {!isPaid && upiTarget && (
          <div className="space-y-5">
            <div className="flex flex-col items-center justify-center p-6 rounded-card border-2 border-dashed border-emerald-200 bg-slate-50">
              <div className="rounded-card bg-white p-3.5 shadow-sm border border-slate-200">
                <QRCodeSVG
                  id="detomsite-order-qr"
                  value={qrUri}
                  size={190}
                  level="M"
                  includeMargin={true}
                />
              </div>

              <div className="mt-4 text-center space-y-1">
                <p className="text-xs font-bold text-slate-900">
                  Pay ₹{order.total} by scanning the QR code with GPay, PhonePe, Paytm, or BHIM
                </p>
                <p className="text-[11px] text-slate-500">
                  Receiver: <b>{receiver}</b> ({upiTarget})
                </p>
              </div>

              <a
                href={qrUri}
                className="mt-4 inline-flex items-center justify-center gap-2 rounded-btn bg-emerald-700 w-full max-w-xs py-3 text-sm font-bold text-white shadow-sm hover:bg-emerald-800 transition-colors"
              >
                <CreditCard className="h-4 w-4" />
                <span>Open my UPI app · Pay ₹{order.total}</span>
              </a>

              <button
                type="button"
                onClick={() =>
                  downloadQrPng(
                    document.getElementById('detomsite-order-qr') as SVGSVGElement | null,
                    `detomsite-order-${order.token}-qr.png`
                  )
                }
                className="mt-2 text-xs font-bold text-emerald-800 hover:underline"
              >
                Download QR Code Image
              </button>
            </div>

            {/* Manual UTR Reference Input */}
            <div className="rounded-card border border-slate-200 bg-slate-50 p-4 space-y-2">
              <p className="font-bold text-xs text-slate-800">
                Already paid? Enter UPI Reference / UTR Number
              </p>
              <form onSubmit={submitUtr} className="flex gap-2">
                <input
                  type="text"
                  value={utr}
                  onChange={(e) => setUtr(e.target.value)}
                  placeholder="12-digit UTR (e.g. 423456789012)"
                  className="flex-1 rounded-btn border border-slate-200 bg-white px-3 py-2 text-xs font-mono outline-none focus:border-emerald-600"
                />
                <button
                  type="submit"
                  className="rounded-btn bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 transition-colors"
                >
                  Verify
                </button>
              </form>
              {utrMsg && (
                <p className="text-xs font-medium text-emerald-700 mt-1">
                  {utrMsg}
                </p>
              )}
            </div>
          </div>
        )}

        {isPaid && (
          <div className="text-center pt-2">
            <Link
              to={`/order/${order.id}`}
              className="inline-flex items-center gap-2 rounded-btn bg-emerald-700 px-6 py-3 text-sm font-bold text-white shadow-sm hover:bg-emerald-800"
            >
              <span>Track Order #{order.token}</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
