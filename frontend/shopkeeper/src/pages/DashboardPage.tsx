import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ShoppingBag,
  Clock,
  CheckCircle2,
  TrendingUp,
  AlertTriangle,
  Plus,
  QrCode,
  Layers,
  Settings,
  Utensils,
  Phone,
  Power,
  CreditCard,
  ChefHat,
  ChevronRight,
} from 'lucide-react'
import { Shop, Order, Product, ShopStats } from '../types'
import { StatCard } from '../components/ui/StatCard'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { fmtTime, fmtCurrency } from '../utils/formatters'
import { buildItemSummary, formatOrderItemsDisplay } from '../utils/helpers'

interface DashboardPageProps {
  shop: Shop | null
  stats: ShopStats
  orders: Order[]
  products: Product[]
  approvalStatus: string
  onTogglePresent: () => void
  onUpdateOrderStatus: (orderId: string, status: string) => Promise<void>
  onConfirmPayment: (orderId: string) => Promise<void>
  onOpenAddProduct: () => void
  onOpenDuesPay: () => void
  onCallStudent: (phone?: string) => void
}

export function DashboardPage({
  shop,
  stats,
  orders,
  products,
  approvalStatus,
  onTogglePresent,
  onUpdateOrderStatus,
  onConfirmPayment,
  onOpenAddProduct,
  onOpenDuesPay,
  onCallStudent,
}: DashboardPageProps) {
  const [showStatusConfirm, setShowStatusConfirm] = useState(false)
  const isPresent = Boolean(shop && shop.present)

  // Calculate live operational metrics
  const todayOrdersCount = stats.today_orders ?? shop?.orders_today ?? orders.length
  const todayRevenue = stats.today_revenue ?? shop?.revenue_today ?? 0
  const pendingOrders = orders.filter(
    (o) => o.status === 'Pending Acceptance' || o.status === 'Pending Payment'
  )
  const activeOrders = orders.filter((o) =>
    ['Confirmed', 'Accepted', 'Preparing', 'Ready'].includes(o.status)
  )
  const completedTodayCount = orders.filter((o) => o.status === 'Completed').length
  const lowStockCount = products.filter((p) => Number(p.inventory) <= 5).length

  // Cook summary across all live orders (pending + accepted + preparing + ready)
  const liveOrders = orders.filter(
    (o) => !['Completed', 'Cancelled', 'Failed', 'Rejected'].includes(o.status)
  )
  const cookSummary = buildItemSummary(liveOrders)

  const duesAmount = stats.platform_fee_due ?? 0
  const duesPaid = stats.share_paid_month ?? stats.share_paid_today

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* ─── 1. Shop Status Hero Card ─── */}
      <div
        className={`border rounded-2xl shadow-xs p-4 sm:p-5 transition-all bg-[var(--bg-surface)] ${
          isPresent ? 'border-emerald-600/50' : 'border-red-500/50'
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3.5">
            <div
              className={`flex h-12 w-12 shrink-0 items-center justify-center font-bold text-white rounded-xl shadow-xs ${
                isPresent ? 'bg-emerald-700' : 'bg-red-600'
              }`}
            >
              <ChefHat className="w-6 h-6" />
            </div>

            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg sm:text-xl font-black text-[var(--text-heading)]">
                  {shop?.name || 'My Kitchen'}
                </h1>
                <Badge variant={isPresent ? 'success' : 'error'} dot size="sm">
                  {isPresent ? 'Accepting Orders' : 'Shop Closed'}
                </Badge>
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-1 flex items-center gap-2">
                <span>
                  Hours: {shop?.opening_time || '08:00'} – {shop?.closing_time || '22:00'}
                </span>
                <span className="text-[var(--text-dim)]">·</span>
                <span className="font-medium">
                  {isPresent ? 'Orders arrive automatically' : 'Students see shop as closed'}
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <Button
              variant={isPresent ? 'danger' : 'primary'}
              size="md"
              icon={<Power className="w-4 h-4" />}
              onClick={() => setShowStatusConfirm(true)}
              className="w-full sm:w-auto"
            >
              {isPresent ? 'Pause Orders' : 'Open Shop Now'}
            </Button>
          </div>
        </div>
      </div>

      {/* ─── 2. Key Operational Metrics (StatCards) ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
        <StatCard
          title="Today's Orders"
          value={todayOrdersCount}
          subtitle={`${pendingOrders.length} urgent pending`}
          icon={<ShoppingBag className="w-5 h-5" />}
          variant="emerald"
        />

        <StatCard
          title="Pending Action"
          value={pendingOrders.length}
          subtitle={pendingOrders.length > 0 ? 'Requires your tap' : 'All caught up'}
          icon={<Clock className="w-5 h-5" />}
          variant={pendingOrders.length > 0 ? 'gold' : 'default'}
          badge={
            pendingOrders.length > 0 ? (
              <Badge variant="warning" size="xs">
                ACTION
              </Badge>
            ) : undefined
          }
        />

        <StatCard
          title="Today's Sales"
          value={fmtCurrency(todayRevenue)}
          subtitle={`${completedTodayCount} completed`}
          icon={<TrendingUp className="w-5 h-5" />}
          variant="emerald"
        />

        <StatCard
          title="Low Stock Items"
          value={lowStockCount}
          subtitle={lowStockCount > 0 ? 'Replenish inventory' : 'Healthy inventory'}
          icon={<AlertTriangle className="w-5 h-5" />}
          variant={lowStockCount > 0 ? 'warning' : 'default'}
        />
      </div>

      {/* ─── 3. Quick Actions Toolbar ─── */}
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-[var(--text-dim)] mb-2 px-0.5">
          Quick Actions
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3">
          <button
            type="button"
            onClick={onOpenAddProduct}
            className="flex items-center gap-2.5 p-3 sm:p-3.5 rounded-xl border border-[var(--border-main)] bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] hover:border-emerald-600/50 text-xs font-bold text-[var(--text-heading)] transition-all shadow-xs"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-600/10 text-emerald-600">
              <Plus className="w-4 h-4" />
            </div>
            <span className="truncate">+ Add Product</span>
          </button>

          <Link
            to="/mobile/orders"
            className="flex items-center gap-2.5 p-3 sm:p-3.5 rounded-xl border border-[var(--border-main)] bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] hover:border-blue-600/50 text-xs font-bold text-[var(--text-heading)] transition-all shadow-xs"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-600/10 text-blue-600">
              <ShoppingBag className="w-4 h-4" />
            </div>
            <span className="truncate">View Orders</span>
          </Link>

          <Link
            to="/mobile/inventory"
            className="flex items-center gap-2.5 p-3 sm:p-3.5 rounded-xl border border-[var(--border-main)] bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] hover:border-amber-600/50 text-xs font-bold text-[var(--text-heading)] transition-all shadow-xs"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-600/10 text-amber-600">
              <Layers className="w-4 h-4" />
            </div>
            <span className="truncate">Inventory</span>
          </Link>

          <Link
            to="/scan"
            className="flex items-center gap-2.5 p-3 sm:p-3.5 rounded-xl border border-[var(--border-main)] bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] hover:border-purple-600/50 text-xs font-bold text-[var(--text-heading)] transition-all shadow-xs"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-purple-600/10 text-purple-600">
              <QrCode className="w-4 h-4" />
            </div>
            <span className="truncate">Scan QR</span>
          </Link>

          <Link
            to="/mobile/settings"
            className="col-span-2 sm:col-span-1 flex items-center gap-2.5 p-3 sm:p-3.5 rounded-xl border border-[var(--border-main)] bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] text-xs font-bold text-[var(--text-heading)] transition-all shadow-xs"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-600/10 text-slate-600">
              <Settings className="w-4 h-4" />
            </div>
            <span className="truncate">Settings</span>
          </Link>
        </div>
      </div>

      {/* ─── 4. Admin Dues Banner (Flat ₹10 per order) ─── */}
      {shop && approvalStatus === 'Approved' && (
        <Card
          className="border-l-4 border-l-amber-500"
          title={
            <span className="flex items-center gap-2 text-sm font-bold text-[var(--text-heading)]">
              <CreditCard className="w-4 h-4 text-amber-600" />
              Admin Share (₹10 flat fee per order)
            </span>
          }
          action={
            <Button
              variant={duesPaid ? 'secondary' : 'gold'}
              size="sm"
              onClick={onOpenDuesPay}
              disabled={Boolean(duesPaid)}
            >
              {duesPaid ? 'Paid for Month ✓' : `Pay ₹${duesAmount} via UPI`}
            </Button>
          }
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <p className="text-[var(--text-muted)]">
              The platform charges ₹10 per completed order. This fee is never added to the student's bill.
              Monthly fee due:{' '}
              <strong className="text-[var(--text-heading)] tabular-nums">
                ₹{duesAmount}
              </strong>
            </p>
            <span className="text-[11px] font-semibold text-[var(--text-dim)] shrink-0">
              {duesPaid ? 'Current month dues settled' : 'Tap Pay to scan Admin UPI QR'}
            </span>
          </div>
        </Card>
      )}

      {/* ─── 5. Cook Summary (Everything to prepare across live orders) ─── */}
      {cookSummary.length > 0 && (
        <Card
          title={
            <span className="flex items-center gap-2 text-sm font-bold text-[var(--text-heading)]">
              <Utensils className="w-4 h-4 text-emerald-600" />
              Kitchen Cook Summary
            </span>
          }
          subtitle={`Aggregated dishes to prepare across ${liveOrders.length} active orders`}
          action={
            <span className="badge-solid-base badge-solid-success px-2 py-0.5 text-xs font-bold">
              {cookSummary.length} UNIQUE DISHES
            </span>
          }
        >
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
            {cookSummary.map((item) => (
              <div
                key={item.name}
                className="flex items-center justify-between p-2.5 rounded-xl border border-[var(--border-main)] bg-[var(--bg-surface-subtle)] shadow-2xs"
              >
                <span className="text-xs font-semibold text-[var(--text-heading)] truncate mr-2">
                  {item.name}
                </span>
                <span
                  className="px-2 py-0.5 text-xs font-black rounded-full bg-amber-500 text-gray-950 tabular-nums shrink-0"
                >
                  × {item.qty}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ─── 6. Urgent Pending Orders Section ─── */}
      <div>
        <div className="flex items-center justify-between mb-3 px-0.5">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-[var(--text-heading)] uppercase tracking-wider">
              Urgent Orders Pending Action
            </h2>
            <Badge variant={pendingOrders.length > 0 ? 'warning' : 'neutral'} size="xs">
              {pendingOrders.length}
            </Badge>
          </div>
          <Link
            to="/mobile/orders"
            className="text-xs font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1"
          >
            <span>View Orders Desk</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {pendingOrders.length === 0 ? (
          <div
            className="border border-dashed border-[var(--border-main)] rounded-2xl p-8 text-center bg-[var(--bg-surface-subtle)]"
          >
            <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto mb-2 opacity-80" />
            <p className="text-sm font-bold text-[var(--text-heading)]">No pending orders right now</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              New orders will appear here automatically the moment a student places them.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {pendingOrders.map((o) => {
              const isCod = o.payment_method === 'COD'
              const isPendingPayment = o.status === 'Pending Payment'

              return (
                <div
                  key={o.id}
                  className="border rounded-2xl border-[var(--border-main)] bg-[var(--bg-surface)] p-4 space-y-3 shadow-xs hover:border-emerald-600/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-black text-emerald-700 dark:text-emerald-400 tabular-nums">
                        #{o.token}
                      </span>
                      <Badge variant={isCod ? 'gold' : 'cyan'} size="xs">
                        {isCod ? 'COD' : 'UPI Online'}
                      </Badge>
                      <span className="text-xs text-[var(--text-dim)] tabular-nums">
                        {fmtTime(o.created_at)}
                      </span>
                    </div>

                    <span className="text-sm font-black text-[var(--text-heading)] tabular-nums">
                      ₹{o.total}
                    </span>
                  </div>

                  <p className="text-xs font-medium text-[var(--text-body)] line-clamp-2">
                    {formatOrderItemsDisplay(o.items)}
                  </p>

                  <div className="flex items-center justify-between text-xs text-[var(--text-muted)] pt-1 border-t border-[var(--border-subtle)]">
                    <span className="truncate">
                      {o.student_name} · {o.delivery_location}
                    </span>
                    {o.student_phone && (
                      <button
                        type="button"
                        onClick={() => onCallStudent(o.student_phone)}
                        className="text-emerald-600 hover:text-emerald-700 font-bold flex items-center gap-1 shrink-0 ml-2"
                      >
                        <Phone className="w-3 h-3" />
                        <span>Call</span>
                      </button>
                    )}
                  </div>

                  {/* Actions for this pending order */}
                  <div className="pt-2 flex gap-2">
                    {isPendingPayment && !isCod ? (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => onConfirmPayment(o.id)}
                        className="flex-1"
                      >
                        Payment Received
                      </Button>
                    ) : (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => onUpdateOrderStatus(o.id, 'Accepted')}
                        className="flex-1"
                      >
                        Accept Order
                      </Button>
                    )}

                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => onUpdateOrderStatus(o.id, 'Cancelled')}
                      className="px-3"
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Confirmation Dialog for Shop Status Toggle */}
      <ConfirmDialog
        open={showStatusConfirm}
        onClose={() => setShowStatusConfirm(false)}
        onConfirm={() => {
          setShowStatusConfirm(false)
          onTogglePresent()
        }}
        title={isPresent ? 'Pause Incoming Orders?' : 'Start Accepting Orders?'}
        description={
          isPresent
            ? 'Your shop will be shown as Closed on the campus portal. Existing orders must still be fulfilled, but students will not be able to place new orders.'
            : 'Your shop will immediately appear as Open on the campus portal, and students will be able to order.'
        }
        confirmText={isPresent ? 'Pause Orders' : 'Open Shop Now'}
        cancelText="Cancel"
        variant={isPresent ? 'warning' : 'primary'}
      />
    </div>
  )
}
