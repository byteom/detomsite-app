import React, { useState, useEffect, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Order, Shop } from '../types'
import {
  fetchOrdersCached,
  invalidateOrdersCache,
  readUser,
  formatPlacedAt,
  canCancelOrder,
  apiError,
  addToCart,
} from '../utils/helpers'
import api from '../services/api'
import { OrderCardSkeleton } from '../components/ui/Skeleton'
import { EmptyState } from '../components/ui/EmptyState'
import { TokenBadge } from '../components/ui/Icons'
import {
  Package,
  Clock,
  CheckCircle2,
  CreditCard,
  Banknote,
  AlertCircle,
  Search,
  ArrowRight,
  RotateCcw,
} from '../components/ui/Icons'

export function OrdersPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialTab = searchParams.get('tab') === 'past' ? 'past' : 'active'
  const [tab, setTab] = useState<'active' | 'past'>(initialTab)

  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const user = readUser()

  useEffect(() => {
    fetchOrdersCached()
      .then((list) => {
        const myOrders = list.filter(
          (o) => o.student_name.toLowerCase() === (user.name || '').toLowerCase()
        )
        setOrders(myOrders)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [user.name])

  // Sync tab with URL
  useEffect(() => {
    const currentParam = searchParams.get('tab')
    if (currentParam === 'past' && tab !== 'past') setTab('past')
    if (!currentParam && tab !== 'active') setTab('active')
  }, [searchParams])

  const handleTabChange = (nextTab: 'active' | 'past') => {
    setTab(nextTab)
    if (nextTab === 'past') {
      setSearchParams({ tab: 'past' })
    } else {
      setSearchParams({})
    }
  }

  // Active vs Past lists
  const activeOrders = useMemo(
    () =>
      orders.filter(
        (o) => o.status !== 'Completed' && o.status !== 'Cancelled' && o.status !== 'Failed'
      ),
    [orders]
  )

  const pastOrders = useMemo(
    () =>
      orders.filter(
        (o) => o.status === 'Completed' || o.status === 'Cancelled' || o.status === 'Failed'
      ),
    [orders]
  )

  // Filtered past orders
  const q = search.toLowerCase().trim()
  const filteredPast = useMemo(() => {
    if (!q) return pastOrders
    return pastOrders.filter((o) =>
      `${o.shop_name} #${o.token} ${o.items} ${o.status}`.toLowerCase().includes(q)
    )
  }, [pastOrders, q])

  // Cancel order handler
  const handleCancelOrder = async (o: Order) => {
    if (
      !window.confirm(
        `Cancel order #${o.token} from ${o.shop_name}? You can cancel until the delivery batch window closes.`
      )
    )
      return

    try {
      await api.post(`/local/orders/${o.id}/cancel`)
      invalidateOrdersCache()
      setOrders((prev) =>
        prev.map((x) => (x.id === o.id ? { ...x, status: 'Cancelled' } : x))
      )
    } catch (err: any) {
      window.alert(apiError(err, 'Could not cancel this order'))
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8 space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
            My Orders
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-slate-500">
            Track current deliveries and view your past order receipts.
          </p>
        </div>

        {/* Segmented Tab Switcher */}
        <div className="inline-flex rounded-panel bg-slate-200/70 p-1 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => handleTabChange('active')}
            className={`flex items-center gap-1.5 rounded-btn px-4 py-2 text-xs font-bold transition-all ${
              tab === 'active'
                ? 'bg-white text-emerald-800 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span>Active Orders</span>
            {activeOrders.length > 0 && (
              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-emerald-600 px-1 text-[10px] font-black text-white">
                {activeOrders.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('past')}
            className={`flex items-center gap-1.5 rounded-btn px-4 py-2 text-xs font-bold transition-all ${
              tab === 'past'
                ? 'bg-white text-emerald-800 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Clock className="h-3.5 w-3.5 text-slate-400" />
            <span>Order History ({pastOrders.length})</span>
          </button>
        </div>
      </div>

      {/* Search Input for Past Orders */}
      {tab === 'past' && pastOrders.length > 0 && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search past orders by kitchen, food items, or token..."
            className="w-full rounded-btn border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm outline-none focus:border-emerald-600"
          />
        </div>
      )}

      {/* Orders List Content */}
      {loading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <OrderCardSkeleton key={i} />
          ))}
        </div>
      ) : tab === 'active' ? (
        /* Active Orders Tab */
        activeOrders.length > 0 ? (
          <div className="space-y-4">
            {activeOrders.map((o) => (
              <div
                key={o.id}
                className="overflow-hidden rounded-panel border border-slate-200 bg-white shadow-card hover:shadow-card-hover transition-all"
              >
                {/* Header */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/60 p-4 sm:px-6">
                  <div>
                    <h3 className="font-extrabold text-base text-slate-900">
                      {o.shop_name}
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Placed {formatPlacedAt(o.created_at)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <TokenBadge token={o.token} />
                    <span
                      className={`text-xs font-bold px-2.5 py-1 rounded-pill ${
                        o.payment_method === 'COD'
                          ? 'bg-amber-100 text-amber-900 border border-amber-300'
                          : 'bg-blue-100 text-blue-900 border border-blue-300'
                      }`}
                    >
                      {o.payment_method === 'COD' ? 'COD' : 'UPI Online'}
                    </span>
                    <span className="text-xs font-extrabold px-2.5 py-1 rounded-pill bg-emerald-100 text-emerald-900 border border-emerald-300">
                      {o.status}
                    </span>
                  </div>
                </div>

                {/* Items & Location */}
                <div className="p-4 sm:px-6 space-y-3">
                  <ul className="space-y-1 text-sm text-slate-700 font-medium">
                    {o.items
                      .split(', ')
                      .filter(Boolean)
                      .map((it, idx) => (
                        <li key={idx} className="flex items-center gap-2">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                          <span>{it}</span>
                        </li>
                      ))}
                  </ul>

                  <p className="text-xs text-slate-400">
                    📍 {o.delivery_location} · {o.delivery_slot} Slot
                  </p>

                  {o.payment_method !== 'COD' &&
                    ['Pending Payment', 'Pending Acceptance'].includes(o.status) && (
                      <p className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-btn px-2.5 py-1.5">
                        Awaiting UTR + screenshot — your order joins the kitchen queue
                        only after proof is submitted and verified.
                      </p>
                    )}
                </div>

                {/* Footer with Actions */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/40 p-4 sm:px-6">
                  <div className="font-black text-slate-900 text-base">
                    Total: <span className="text-emerald-700">₹{o.total}</span>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Pay / proof button for unpaid UPI — kitchen queue starts
                        only after UTR + screenshot are submitted */}
                    {o.payment_method !== 'COD' &&
                      ['Pending Payment', 'Pending Acceptance'].includes(o.status) && (
                        <Link
                          to={`/pay/${o.id}`}
                          className="inline-flex items-center gap-1.5 rounded-btn bg-emerald-700 px-3.5 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-800 transition-colors"
                          title="Submit your UTR + payment screenshot — the kitchen starts only after proof is verified"
                        >
                          <CreditCard className="h-3.5 w-3.5" />
                          <span>Pay ₹{o.total} · Submit Proof</span>
                        </Link>
                      )}

                    {/* Cancel Order (window checked) */}
                    {canCancelOrder(o) && (
                      <button
                        type="button"
                        onClick={() => handleCancelOrder(o)}
                        className="rounded-btn border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-50 transition-colors"
                      >
                        Cancel Order
                      </button>
                    )}

                    {/* View Details */}
                    <Link
                      to={`/order/${o.id}`}
                      className="inline-flex items-center gap-1 text-xs font-bold text-slate-700 hover:text-emerald-700 p-2"
                    >
                      <span>Track Details</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            type="orders"
            title="No Active Orders"
            description="You don't have any ongoing orders right now. Craving a hot snack or meal?"
            actionLabel="Explore Campus Kitchens"
            actionLink="/shops"
          />
        )
      ) : (
        /* Past Orders Tab */
        filteredPast.length > 0 ? (
          <div className="space-y-4">
            {filteredPast.map((o) => (
              <div
                key={o.id}
                className="overflow-hidden rounded-panel border border-slate-200 bg-white shadow-card p-5 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="font-extrabold text-base text-slate-900">
                      {o.shop_name}
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      #{o.token} · Placed {formatPlacedAt(o.created_at)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs font-bold px-2.5 py-1 rounded-pill ${
                        o.status === 'Completed'
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : 'bg-red-50 text-red-700 border border-red-200'
                      }`}
                    >
                      {o.status}
                    </span>
                    <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-sm">
                      {o.payment_method === 'COD' ? 'COD' : 'UPI'}
                    </span>
                  </div>
                </div>

                <ul className="space-y-1 text-xs sm:text-sm text-slate-600 font-medium">
                  {o.items
                    .split(', ')
                    .filter(Boolean)
                    .map((it, idx) => (
                      <li key={idx} className="flex items-center gap-2">
                        <span className="h-1 w-1 rounded-full bg-slate-400" />
                        <span>{it}</span>
                      </li>
                    ))}
                </ul>

                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="font-black text-sm text-slate-900">
                    Total: ₹{o.total}
                  </span>

                  <div className="flex items-center gap-3">
                    <Link
                      to={`/shop/${o.shop_id}`}
                      className="inline-flex items-center gap-1 font-bold text-emerald-700 hover:underline"
                    >
                      <RotateCcw className="h-3 w-3" />
                      <span>Reorder</span>
                    </Link>

                    <Link
                      to={`/order/${o.id}`}
                      className="font-bold text-slate-600 hover:text-slate-900"
                    >
                      Receipt Details →
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            type="orders"
            title={search ? `No past orders match "${search}"` : 'No Order History'}
            description={
              search
                ? 'Try a different search keyword.'
                : 'Completed and cancelled orders will show up here.'
            }
            actionLabel="Browse Kitchens"
            actionLink="/shops"
          />
        )
      )}
    </div>
  )
}
