import React, { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Order, Shop } from '../types'
import { formatPlacedAt, MAIN_GATE } from '../utils/helpers'
import api, { dedupeGet } from '../services/api'
import { usePolling } from '../hooks/usePolling'
import { TokenBadge } from '../components/ui/Icons'
import {
  Store,
  MapPin,
  Clock,
  Phone,
  CreditCard,
  Banknote,
  CheckCircle2,
  ArrowRight,
  ChevronRight,
  Package,
} from '../components/ui/Icons'

const STATUS_STEPS = ['Pending Acceptance', 'Accepted', 'Preparing', 'Ready', 'Completed']

export function OrderResultPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const [order, setOrder] = useState<Order | null>(null)
  const [shop, setShop] = useState<Shop | null>(null)
  const [loading, setLoading] = useState(true)

  // Poll order status
  usePolling(
    useCallback(() => {
      if (!orderId) return
      return dedupeGet<Order>(`/local/orders/${orderId}`)
        .then((r) => setOrder(r.data))
        .catch(() => {})
    }, [orderId]),
    6000,
    [orderId]
  )

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
  }, [orderId])

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center space-y-3">
        <div className="h-44 rounded-card skeleton-shimmer bg-slate-200" />
        <p className="text-xs text-slate-400">Loading order details...</p>
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

  const isCancelled = order.status === 'Cancelled' || order.status === 'Failed'
  const isCompleted = order.status === 'Completed'
  const isUnpaid =
    order.payment_method !== 'COD' &&
    ['Pending Payment', 'Pending Verification'].includes(order.status)

  // Determine current step index
  const currentStepIdx = isCancelled
    ? -1
    : isCompleted
    ? 4
    : STATUS_STEPS.indexOf(order.status) >= 0
    ? STATUS_STEPS.indexOf(order.status)
    : 1

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8 space-y-6">
      <div className="rounded-panel border border-slate-200 bg-white p-6 sm:p-8 shadow-card space-y-6 text-center">
        {/* Top Tag & Status */}
        <div className="space-y-1">
          <span className="text-[11px] font-extrabold uppercase tracking-widest text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-pill border border-emerald-200">
            Order Confirmation
          </span>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight pt-2">
            {isCancelled ? 'Order Cancelled' : isCompleted ? 'Order Completed' : 'Order Placed!'}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium">
            {order.shop_name} · Placed {formatPlacedAt(order.created_at)}
          </p>
        </div>

        {/* Counter Pickup Token Card */}
        {!isCancelled && (
          <div className="rounded-card border-2 border-dashed border-emerald-300 bg-emerald-50/70 p-5 text-center space-y-1">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">
              Your Counter Pickup Token
            </span>
            <div className="text-4xl font-black text-emerald-900 tracking-tight py-1">
              Token #{order.token}
            </div>
            <p className="text-xs text-emerald-700">
              Show this token number when collecting your food at the Main Gate.
            </p>
          </div>
        )}

        {/* Visual Progress Stepper */}
        {!isCancelled && (
          <div className="pt-2 pb-4">
            <div className="flex items-center justify-between text-xs font-bold text-slate-400">
              {['Placed', 'Accepted', 'Preparing', 'Ready', 'Done'].map(
                (stepName, idx) => {
                  const done = idx <= currentStepIdx
                  const active = idx === currentStepIdx

                  return (
                    <div
                      key={stepName}
                      className={`flex flex-col items-center flex-1 ${
                        done ? 'text-emerald-700' : 'text-slate-400'
                      }`}
                    >
                      <div
                        className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-black mb-1 transition-all ${
                          active
                            ? 'bg-emerald-600 text-white ring-4 ring-emerald-100 scale-110'
                            : done
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-100 text-slate-400'
                        }`}
                      >
                        {done ? '✓' : idx + 1}
                      </div>
                      <span className="text-[10px] sm:text-xs font-semibold">
                        {stepName}
                      </span>
                    </div>
                  )
                }
              )}
            </div>
          </div>
        )}

        {/* Payment Alert if Unpaid */}
        {isUnpaid && (
          <div className="rounded-card border border-amber-300 bg-amber-50 p-4 text-left flex items-start gap-3">
            <CreditCard className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
            <div className="flex-1 space-y-2">
              <p className="text-xs sm:text-sm font-bold text-amber-900">
                Payment Pending for this Order
              </p>
              <p className="text-xs text-amber-800">
                Please complete your UPI payment of ₹{order.total} so the kitchen can confirm and begin preparing your food.
              </p>
              <Link
                to={`/pay/${order.id}`}
                className="inline-flex items-center gap-1.5 rounded-btn bg-emerald-700 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-800 transition-colors shadow-sm"
              >
                <span>Pay ₹{order.total} with UPI</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        )}

        {/* Items and Destination Details Card */}
        <div className="rounded-card border border-slate-200 bg-slate-50/70 p-5 text-left space-y-4">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
              Items Ordered
            </h3>
            <ul className="space-y-1.5 text-sm text-slate-800 font-medium">
              {order.items
                .split(', ')
                .filter(Boolean)
                .map((it, idx) => (
                  <li key={idx} className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                    <span>{it}</span>
                  </li>
                ))}
            </ul>
          </div>

          <div className="pt-3 border-t border-slate-200/80 flex flex-wrap items-center justify-between text-xs text-slate-500 gap-2">
            <span className="flex items-center gap-1">
              <MapPin className="h-4 w-4 text-emerald-600" />
              <span>{order.delivery_location} · {order.delivery_slot} Slot</span>
            </span>

            <span className="flex items-center gap-1 font-bold text-slate-800">
              Payment: {order.payment_method === 'COD' ? 'Cash on Delivery' : 'UPI Online'}
            </span>
          </div>

          <div className="pt-3 border-t border-slate-200/80 flex justify-between items-baseline font-black text-slate-900">
            <span className="text-sm">Total Paid / Due:</span>
            <span className="text-xl text-emerald-700">₹{order.total}</span>
          </div>

          {shop && (
            <div className="pt-3 border-t border-slate-200/80 text-xs text-slate-600 space-y-1">
              <p className="font-bold text-slate-900">
                Kitchen: {shop.name} ({shop.shopkeeper_name})
              </p>
              {shop.phone && (
                <p className="flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5 text-emerald-600" />
                  <span>{shop.phone}</span>
                </p>
              )}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          <Link
            to="/orders"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-btn bg-emerald-700 px-6 py-3 text-sm font-bold text-white shadow-sm hover:bg-emerald-800 transition-colors"
          >
            <Package className="h-4 w-4" />
            <span>Track All Orders</span>
          </Link>

          <Link
            to="/shops"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-btn border border-slate-200 bg-white px-6 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <Store className="h-4 w-4 text-emerald-600" />
            <span>Order from Another Kitchen</span>
          </Link>
        </div>
      </div>
    </div>
  )
}
