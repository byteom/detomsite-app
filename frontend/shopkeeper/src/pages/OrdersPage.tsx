import React, { useState, useMemo } from 'react'
import {
  ShoppingBag,
  Search,
  Phone,
  Clock,
  CheckCircle2,
  AlertCircle,
  Filter,
  X,
  CreditCard,
  Banknote,
} from 'lucide-react'
import { Order } from '../types'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { fmtTime, fmtCurrency } from '../utils/formatters'
import { slotBucket, istDay, formatOrderItemsDisplay } from '../utils/helpers'

interface OrdersPageProps {
  orders: Order[]
  onUpdateOrderStatus: (orderId: string, status: string) => Promise<void>
  onConfirmPayment: (orderId: string) => Promise<void>
  onCallStudent: (phone?: string) => void
}

const SLOT_FILTERS = [
  { id: 'All', label: 'All Slots' },
  { id: 'before-1230', label: 'Before 12:30 PM' },
  { id: 'before-1830', label: 'Before 6:00 PM' },
]

const STATUS_FILTERS = [
  { id: 'all', label: 'All Orders' },
  { id: 'pending', label: 'Pending Action' },
  { id: 'accepted', label: 'In Kitchen / Active' },
  { id: 'ready', label: 'Ready for Pickup' },
  { id: 'completed', label: 'Completed' },
]

export function OrdersPage({
  orders,
  onUpdateOrderStatus,
  onConfirmPayment,
  onCallStudent,
}: OrdersPageProps) {
  const [slotFilter, setSlotFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState('all')
  const [todayOnly, setTodayOnly] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  const todayStr = istDay(new Date())

  // Filter pipeline
  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      // 1. Today only filter
      if (todayOnly) {
        const orderDate = String(o.created_at || '').slice(0, 10)
        if (orderDate !== todayStr) return false
      }

      // 2. Slot filter
      if (slotFilter !== 'All' && slotBucket(o.created_at) !== slotFilter) {
        return false
      }

      // 3. Status filter
      if (statusFilter === 'pending') {
        if (o.status !== 'Pending Acceptance' && o.status !== 'Pending Payment') return false
      } else if (statusFilter === 'accepted') {
        if (!['Confirmed', 'Accepted', 'Preparing'].includes(o.status)) return false
      } else if (statusFilter === 'ready') {
        if (o.status !== 'Ready') return false
      } else if (statusFilter === 'completed') {
        if (o.status !== 'Completed' && o.status !== 'Cancelled') return false
      }

      // 4. Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const matchesToken = String(o.token).includes(q)
        const matchesName = (o.student_name || '').toLowerCase().includes(q)
        const matchesPhone = (o.student_phone || '').includes(q)
        const displayItems = formatOrderItemsDisplay(o.items)
        const matchesItems =
          (displayItems || '').toLowerCase().includes(q) ||
          (o.items || '').toLowerCase().includes(q)
        if (!matchesToken && !matchesName && !matchesPhone && !matchesItems) return false
      }

      return true
    })
  }, [orders, todayOnly, slotFilter, statusFilter, searchQuery, todayStr])

  const pendingCount = orders.filter(
    (o) => o.status === 'Pending Acceptance' || o.status === 'Pending Payment'
  ).length

  return (
    <div className="space-y-4">
      {/* ─── Header & Search Toolbar ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--border-main)] pb-3">
        <div>
          <h1 className="text-lg sm:text-xl font-black text-[var(--text-heading)] flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-emerald-600" />
            Orders Desk
          </h1>
          <p className="text-xs text-[var(--text-muted)]">
            Manage live prep queue, acceptance, and student collections
          </p>
        </div>

        {/* Today Only Switch */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTodayOnly(!todayOnly)}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-full transition-all border ${
              todayOnly
                ? 'bg-emerald-700 text-white border-emerald-600 shadow-xs'
                : 'bg-[var(--bg-surface)] text-[var(--text-muted)] border-[var(--border-main)] hover:bg-[var(--bg-surface-hover)]'
            }`}
          >
            {todayOnly ? 'Showing Today ✓' : 'All Dates'}
          </button>

          {pendingCount > 0 && (
            <span className="badge-solid-base badge-solid-warning px-2.5 py-1 text-xs font-bold rounded-full">
              {pendingCount} PENDING
            </span>
          )}
        </div>
      </div>

      {/* ─── Search Bar ─── */}
      <div className="relative">
        <Search className="w-4 h-4 text-[var(--text-dim)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by token #, student name, phone, or dish..."
          className="w-full pl-9 pr-9 py-2.5 text-xs rounded-xl border border-[var(--border-main)] bg-[var(--bg-surface)] text-[var(--text-heading)] placeholder:text-[var(--text-dim)] outline-none focus:border-emerald-600 transition-colors shadow-xs"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-full text-[var(--text-dim)] hover:text-[var(--text-heading)]"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* ─── Filters Row (Slot + Status) ─── */}
      <div className="space-y-2">
        {/* Status Filter Chips */}
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
          {STATUS_FILTERS.map((st) => {
            const active = statusFilter === st.id
            return (
              <button
                key={st.id}
                type="button"
                onClick={() => setStatusFilter(st.id)}
                className={`px-3.5 py-1.5 text-xs font-bold whitespace-nowrap rounded-full transition-colors border ${
                  active
                    ? 'bg-emerald-700 text-white border-emerald-600 shadow-xs'
                    : 'bg-[var(--bg-surface)] text-[var(--text-muted)] border-[var(--border-main)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-heading)]'
                }`}
              >
                {st.label}
              </button>
            )
          })}
        </div>

        {/* Slot Filter Chips */}
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
          {SLOT_FILTERS.map((s) => {
            const active = slotFilter === s.id
            const count =
              s.id === 'All'
                ? orders.length
                : orders.filter((o) => slotBucket(o.created_at) === s.id).length

            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSlotFilter(s.id)}
                className={`px-3 py-1 text-[11px] font-semibold whitespace-nowrap rounded-full transition-colors border ${
                  active
                    ? 'bg-[var(--text-heading)] text-[var(--bg-surface)] border-[var(--text-heading)]'
                    : 'bg-[var(--bg-surface-subtle)] text-[var(--text-dim)] border-[var(--border-subtle)] hover:text-[var(--text-body)]'
                }`}
              >
                {s.label} ({count})
              </button>
            )
          })}
        </div>
      </div>

      {/* ─── Orders Grid / List ─── */}
      {filteredOrders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border-main)] p-12 text-center bg-[var(--bg-surface-subtle)] space-y-2">
          <Filter className="w-8 h-8 text-[var(--text-dim)] mx-auto opacity-70" />
          <h3 className="font-bold text-sm text-[var(--text-heading)]">No orders match filters</h3>
          <p className="text-xs text-[var(--text-muted)]">
            Try adjusting slot or status filters, or turn off "Showing Today"
          </p>
          {(slotFilter !== 'All' || statusFilter !== 'all' || !todayOnly || searchQuery) && (
            <div className="pt-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setSlotFilter('All')
                  setStatusFilter('all')
                  setTodayOnly(true)
                  setSearchQuery('')
                }}
              >
                Reset All Filters
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredOrders.map((o) => {
            const isCod = o.payment_method === 'COD'
            const isPendingPayment = o.status === 'Pending Payment'
            const isPendingAcceptance = o.status === 'Pending Acceptance'
            const isConfirmed = o.status === 'Confirmed'
            const isAccepted = o.status === 'Accepted' || isConfirmed
            const isPreparing = o.status === 'Preparing'
            const isReady = o.status === 'Ready'
            const isCompleted = o.status === 'Completed'
            const isCancelled = o.status === 'Cancelled' || o.status === 'Rejected'

            // Color-code card border
            const cardBorder = isReady
              ? 'border-l-4 border-l-emerald-600'
              : isPreparing
              ? 'border-l-4 border-l-amber-500'
              : isPendingPayment || isPendingAcceptance
              ? 'border-l-4 border-l-orange-500'
              : isCompleted
              ? 'border-l-4 border-l-slate-400'
              : 'border-[var(--border-main)]'

            return (
              <div
                key={o.id}
                className={`rounded-2xl border bg-[var(--bg-surface)] border-[var(--border-main)] p-4 sm:p-5 space-y-3.5 shadow-xs transition-colors ${cardBorder}`}
              >
                {/* Header row: Token, Payment Method, Status Badge, Time */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xl sm:text-2xl font-black text-emerald-700 dark:text-emerald-400 tabular-nums">
                      #{o.token}
                    </span>

                    <Badge variant={isCod ? 'gold' : 'cyan'} size="sm">
                      {isCod ? (
                        <>
                          <Banknote className="w-3 h-3" /> COD
                        </>
                      ) : (
                        <>
                          <CreditCard className="w-3 h-3" /> UPI
                        </>
                      )}
                    </Badge>

                    {/* Operational Status Badge */}
                    <Badge
                      variant={
                        isReady
                          ? 'success'
                          : isPreparing
                          ? 'warning'
                          : isAccepted
                          ? 'info'
                          : isCompleted
                          ? 'default'
                          : isCancelled
                          ? 'error'
                          : 'orange'
                      }
                      size="sm"
                      dot
                    >
                      {o.status}
                    </Badge>
                  </div>

                  <div className="flex items-center gap-2 text-xs">
                    {o.delivery_slot && (
                      <span className="px-2.5 py-0.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface-subtle)] font-medium text-[var(--text-muted)]">
                        {o.delivery_slot}
                      </span>
                    )}
                    <span className="font-mono text-[var(--text-dim)] tabular-nums">
                      {fmtTime(o.created_at)}
                    </span>
                  </div>
                </div>

                {/* Items breakdown */}
                <div className="p-3.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-subtle)] text-xs text-[var(--text-body)]">
                  <p className="font-semibold leading-relaxed">{formatOrderItemsDisplay(o.items)}</p>
                </div>

                {/* Student info, location & total amount */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-[var(--text-muted)] pt-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-[var(--text-heading)]">
                      {o.student_name}
                    </span>
                    <span className="text-[var(--text-dim)]">·</span>
                    <span>📍 {o.delivery_location}</span>
                    {o.student_phone && (
                      <button
                        type="button"
                        onClick={() => onCallStudent(o.student_phone)}
                        className="text-emerald-600 hover:text-emerald-700 font-bold flex items-center gap-1 ml-1"
                      >
                        <Phone className="w-3 h-3" />
                        <span>{o.student_phone}</span>
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs uppercase font-bold text-[var(--text-dim)]">Total:</span>
                    <span className="text-base font-black text-[var(--text-heading)] tabular-nums">
                      ₹{o.total}
                    </span>
                  </div>
                </div>

                {/* UPI Student UTR card if present */}
                {isPendingPayment && o.payment?.utr_number && (
                  <div className="p-3 rounded-xl border border-blue-300 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 text-xs text-blue-900 dark:text-blue-100 flex items-center justify-between gap-2">
                    <div>
                      <p className="font-bold uppercase tracking-wider text-[10px]">
                        Student Submitted UTR
                      </p>
                      <p className="font-mono font-bold mt-0.5">{o.payment.utr_number}</p>
                    </div>
                    <span className="text-[11px] text-blue-700 dark:text-blue-300">
                      Match against bank credit SMS
                    </span>
                  </div>
                )}

                {/* ─── Operational Action Bar ─── */}
                {!isCompleted && !isCancelled && (
                  <div className="pt-2 border-t border-[var(--border-subtle)] flex flex-wrap gap-2">
                    {/* Pending Acceptance (COD) */}
                    {(isPendingAcceptance || (isPendingPayment && isCod)) && (
                      <>
                        <Button
                          variant="primary"
                          size="md"
                          onClick={() => onUpdateOrderStatus(o.id, 'Accepted')}
                          className="flex-1"
                        >
                          Accept Order
                        </Button>
                        <Button
                          variant="danger"
                          size="md"
                          onClick={() => onUpdateOrderStatus(o.id, 'Cancelled')}
                        >
                          Reject
                        </Button>
                      </>
                    )}

                    {/* Pending Payment (UPI) */}
                    {isPendingPayment && !isCod && (
                      <>
                        <Button
                          variant="primary"
                          size="md"
                          onClick={() => onConfirmPayment(o.id)}
                          className="flex-1"
                        >
                          Payment Received ✓
                        </Button>
                        <Button
                          variant="danger"
                          size="md"
                          onClick={() => onUpdateOrderStatus(o.id, 'Cancelled')}
                        >
                          Reject
                        </Button>
                      </>
                    )}

                    {/* Accepted / Confirmed -> Start Preparing */}
                    {isAccepted && !isPreparing && !isReady && (
                      <>
                        <Button
                          variant="gold"
                          size="md"
                          onClick={() => onUpdateOrderStatus(o.id, 'Preparing')}
                          className="flex-1"
                        >
                          Start Preparing Food
                        </Button>
                        <Button
                          variant="danger"
                          size="md"
                          onClick={() => onUpdateOrderStatus(o.id, 'Cancelled')}
                        >
                          Cancel
                        </Button>
                      </>
                    )}

                    {/* Preparing -> Mark Ready */}
                    {isPreparing && (
                      <>
                        <Button
                          variant="success"
                          size="md"
                          onClick={() => onUpdateOrderStatus(o.id, 'Ready')}
                          className="flex-1"
                        >
                          Mark Ready for Delivery / Pickup ✓
                        </Button>
                        <Button
                          variant="danger"
                          size="md"
                          onClick={() => onUpdateOrderStatus(o.id, 'Cancelled')}
                        >
                          Cancel
                        </Button>
                      </>
                    )}

                    {/* Ready -> Complete Order */}
                    {isReady && (
                      <Button
                        variant="primary"
                        size="md"
                        onClick={() => onUpdateOrderStatus(o.id, 'Completed')}
                        className="w-full"
                      >
                        {isCod
                          ? `Collect ₹${o.total} Cash & Complete Order ✓`
                          : 'Order Collected — Mark Completed ✓'}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
