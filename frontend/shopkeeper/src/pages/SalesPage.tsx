import React from 'react'
import {
  TrendingUp,
  ShoppingBag,
  Calendar,
  Phone,
  Clock,
  ArrowUpRight,
  Filter,
} from 'lucide-react'
import { HistoryData, Order } from '../types'
import { StatCard } from '../components/ui/StatCard'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { fmtTime, fmtCurrency } from '../utils/formatters'
import { formatOrderItemsDisplay } from '../utils/helpers'

interface SalesPageProps {
  history: HistoryData
  historyRange: string
  onSelectRange: (range: string) => void
  onCallStudent: (phone?: string) => void
}

const RANGES = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'Last 7 Days' },
  { id: 'all', label: 'All Time' },
]

export function SalesPage({
  history,
  historyRange,
  onSelectRange,
  onCallStudent,
}: SalesPageProps) {
  const totalOrders = history.count || (history.orders ? history.orders.length : 0)
  const totalRevenue = history.revenue || 0

  return (
    <div className="space-y-4">
      {/* ─── Header ─── */}
      <div className="border-b border-[var(--border-main)] pb-3">
        <h1 className="text-lg sm:text-xl font-black text-[var(--text-heading)] flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-emerald-600" />
          Sales & Earnings
        </h1>
        <p className="text-xs text-[var(--text-muted)]">
          Every day starts fresh. Track orders, daily revenue, and historical logs.
        </p>
      </div>

      {/* ─── Range Selector Chips ─── */}
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
        {RANGES.map((r) => {
          const active = historyRange === r.id
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => onSelectRange(r.id)}
              className={`px-3.5 py-1.5 text-xs font-bold whitespace-nowrap rounded-full transition-colors border ${
                active
                  ? 'bg-emerald-700 text-white border-emerald-600 shadow-xs'
                  : 'bg-[var(--bg-surface)] text-[var(--text-muted)] border-[var(--border-main)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-heading)]'
              }`}
            >
              {r.label}
            </button>
          )
        })}
      </div>

      {/* ─── Summary StatCards ─── */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <StatCard
          title="Orders Completed"
          value={totalOrders}
          subtitle={`In selected period (${historyRange})`}
          icon={<ShoppingBag className="w-5 h-5" />}
          variant="emerald"
        />

        <StatCard
          title="Total Earnings"
          value={fmtCurrency(totalRevenue)}
          subtitle="Direct student collections"
          icon={<TrendingUp className="w-5 h-5" />}
          variant="emerald"
        />
      </div>

      {/* ─── Day-by-Day Breakdown (if multiple days) ─── */}
      {history.daily && history.daily.length > 0 && (
        <Card
          title={
            <span className="flex items-center gap-2 text-sm font-bold text-[var(--text-heading)]">
              <Calendar className="w-4 h-4 text-emerald-600" />
              Day-by-Day Breakdown
            </span>
          }
          subtitle="Daily sales volume and totals"
        >
          <div className="space-y-1.5">
            {history.daily.map((d) => (
              <div
                key={d.date}
                className="flex items-center justify-between p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-subtle)] text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="font-bold text-[var(--text-heading)]">{d.date}</span>
                  <span className="text-[var(--text-dim)]">·</span>
                  <span className="text-[var(--text-muted)]">{d.count} orders</span>
                </div>
                <span className="font-black text-emerald-700 dark:text-emerald-400 tabular-nums text-sm">
                  {fmtCurrency(d.revenue)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ─── Orders List in Selected Range ─── */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold text-[var(--text-heading)] uppercase tracking-wider px-0.5">
          Orders in this period ({history.orders?.length || 0})
        </h2>

        {!history.orders || history.orders.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--border-main)] p-12 text-center bg-[var(--bg-surface-subtle)] space-y-1">
            <Clock className="w-8 h-8 text-[var(--text-dim)] mx-auto opacity-70 mb-2" />
            <h3 className="font-bold text-sm text-[var(--text-heading)]">No orders in this range</h3>
            <p className="text-xs text-[var(--text-muted)]">
              Select another date range or check back later
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {history.orders.map((o) => (
              <div
                key={o.id}
                className="rounded-2xl border border-[var(--border-main)] bg-[var(--bg-surface)] p-4 space-y-2 shadow-xs hover:border-emerald-600/40 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-black text-emerald-700 dark:text-emerald-400 tabular-nums">
                      #{o.token}
                    </span>
                    <span className="text-xs text-[var(--text-dim)] tabular-nums">
                      {fmtTime(o.created_at) || o._day || String(o.created_at || '').slice(0, 10)}
                    </span>
                  </div>

                  <span className="text-sm font-black text-[var(--text-heading)] tabular-nums">
                    {fmtCurrency(o.total)}
                  </span>
                </div>

                <p className="text-xs font-medium text-[var(--text-body)] line-clamp-2">
                  {formatOrderItemsDisplay(o.items)}
                </p>

                <div className="flex items-center justify-between text-xs text-[var(--text-muted)] pt-1 border-t border-[var(--border-subtle)]">
                  <div className="flex items-center gap-2 truncate">
                    <span>{o.student_name}</span>
                    {o.student_phone && (
                      <button
                        type="button"
                        onClick={() => onCallStudent(o.student_phone)}
                        className="text-emerald-600 hover:text-emerald-700 font-bold flex items-center gap-1"
                      >
                        <Phone className="w-3 h-3" />
                        <span>Call</span>
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant={o.payment_method === 'COD' ? 'gold' : 'cyan'} size="xs">
                      {o.payment_method === 'COD' ? 'COD' : 'UPI'}
                    </Badge>
                    <Badge
                      variant={
                        o.status === 'Completed'
                          ? 'success'
                          : o.status === 'Cancelled'
                          ? 'error'
                          : 'default'
                      }
                      size="xs"
                    >
                      {o.status}
                    </Badge>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
