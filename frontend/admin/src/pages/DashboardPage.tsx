import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Store,
  CheckSquare,
  Clock,
  ShoppingBag,
  TrendingUp,
  CreditCard,
  AlertCircle,
  ExternalLink,
  ArrowRight,
  ShieldCheck,
  RefreshCw,
} from 'lucide-react'
import api from '../services/api'
import { StatCard } from '../components/ui/StatCard'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { DataTable, Column } from '../components/ui/DataTable'
import { OrderItemsCell } from '../components/common/OrderItemsCell'
import { fmtTime, fmtCurrency } from '../utils/formatters'

const ADMIN_DASH_CACHE_KEY = 'detomsite-admin-dash-cache'

export function DashboardPage() {
  const [stats, setStats] = useState<any>({})
  const [orders, setOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const loadData = async (silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)

    try {
      const [dashRes, ordersRes] = await Promise.all([
        api.get('/admin/dashboard').catch(() => ({ data: { stats: {} } })),
        api.get('/admin/orders').catch(() => ({ data: [] })),
      ])

      const s = dashRes.data?.stats || {}
      const o = ordersRes.data || []
      setStats(s)
      setOrders(o)

      try {
        localStorage.setItem(
          ADMIN_DASH_CACHE_KEY,
          JSON.stringify({ t: Date.now(), stats: s, orders: o })
        )
      } catch {}
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    try {
      const cached = JSON.parse(localStorage.getItem(ADMIN_DASH_CACHE_KEY) || 'null')
      if (cached && Date.now() - cached.t < 30000) {
        setStats(cached.stats || {})
        setOrders(cached.orders || [])
        setLoading(false)
      }
    } catch {}

    loadData()
  }, [])

  const orderColumns: Column<any>[] = [
    {
      key: 'token',
      header: 'Token',
      sortable: true,
      width: '100px',
      render: (o: any) => (
        <span className="font-mono font-black text-xs text-gray-900 dark:text-white">
          #{o.token}
        </span>
      ),
    },
    {
      key: 'shop_name',
      header: 'Shop',
      sortable: true,
      render: (o: any) => (
        <span className="font-semibold text-gray-800 dark:text-gray-200">{o.shop_name}</span>
      ),
    },
    {
      key: 'student_name',
      header: 'Customer',
      sortable: true,
      render: (o: any) => (
        <div>
          <p className="font-medium text-gray-900 dark:text-gray-100">{o.student_name}</p>
          {o.student_phone && (
            <p className="text-[11px] text-gray-400 font-mono">{o.student_phone}</p>
          )}
        </div>
      ),
    },
    {
      key: 'items',
      header: 'Items',
      render: (o: any) => <OrderItemsCell items={o.items} />,
    },
    {
      key: 'total',
      header: 'Total',
      sortable: true,
      align: 'right',
      render: (o: any) => (
        <span className="font-mono font-bold text-gray-900 dark:text-white">
          ₹{o.total}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (o: any) => {
        const s = o.status
        const variant =
          s === 'Completed' || s === 'Delivered'
            ? 'success'
            : s === 'Cancelled'
            ? 'error'
            : s === 'Pending Payment' || s === 'Placed'
            ? 'warning'
            : 'info'
        return <Badge variant={variant}>{s}</Badge>
      },
    },
    {
      key: 'created_at',
      header: 'Placed',
      sortable: true,
      render: (o: any) => (
        <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap">
          {fmtTime(o.created_at)}
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      {/* Top Banner / Operational Status */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-200 dark:border-admin-border-dark pb-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight flex items-center gap-2.5">
            Operations Command Center
          </h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Real-time campus order flow, store statuses, and platform share reconciliation
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => loadData(true)}
            loading={refreshing}
            icon={<RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />}
          >
            Refresh
          </Button>

          <Link to="/orders">
            <Button variant="primary" size="sm" iconRight={<ArrowRight className="w-3.5 h-3.5" />}>
              Live Orders Desk
            </Button>
          </Link>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <StatCard
          title="Today's Orders"
          value={stats.today_orders || 0}
          subtitle={`Total: ${stats.total_orders || 0} all time`}
          icon={<ShoppingBag className="w-5 h-5" />}
          variant="emerald"
        />

        <StatCard
          title="Platform Revenue"
          value={fmtCurrency(stats.total_revenue || 0)}
          subtitle="Gross volume processed"
          icon={<TrendingUp className="w-5 h-5" />}
          variant="default"
        />

        <StatCard
          title="Admin ₹10 Share"
          value={fmtCurrency(stats.total_service_fee || 0)}
          subtitle="Fixed ₹10/order collected"
          icon={<CreditCard className="w-5 h-5" />}
          variant="gold"
        />

        <StatCard
          title="Active Shops"
          value={`${stats.approved_shops || 0} / ${stats.total_shops || 0}`}
          subtitle={
            stats.pending_approvals > 0
              ? `${stats.pending_approvals} pending approval`
              : 'All vendors verified'
          }
          icon={<Store className="w-5 h-5" />}
          variant={stats.pending_approvals > 0 ? 'warning' : 'default'}
        />
      </div>

      {/* Quick Action Alerts */}
      {stats.pending_approvals > 0 && (
        <div
          className="flex items-center justify-between p-4 border border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200"
          style={{ borderRadius: 0 }}
        >
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
            <div>
              <p className="text-xs font-bold uppercase tracking-wider">Vendor Approvals Pending</p>
              <p className="text-xs mt-0.5 text-amber-700 dark:text-amber-300">
                There are {stats.pending_approvals} new shop registrations awaiting administrator verification.
              </p>
            </div>
          </div>
          <Link to="/vendors">
            <Button variant="gold" size="xs">
              Review Vendors
            </Button>
          </Link>
        </div>
      )}

      {/* Operational Highlights */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Quick Operations panel */}
        <Card title="Quick Operational Actions" subtitle="One-click tasks" className="lg:col-span-1">
          <div className="space-y-2.5">
            <Link
              to="/approvals"
              className="flex items-center justify-between p-3 border border-gray-200 dark:border-admin-border-dark bg-gray-50/50 dark:bg-admin-surface-darkSubtle/30 hover:border-emerald-600 transition-colors"
              style={{ borderRadius: 0 }}
            >
              <div className="flex items-center gap-2.5">
                <CheckSquare className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">
                  Pending Order Approvals
                </span>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-gray-400" />
            </Link>

            <Link
              to="/whatsapp"
              className="flex items-center justify-between p-3 border border-gray-200 dark:border-admin-border-dark bg-gray-50/50 dark:bg-admin-surface-darkSubtle/30 hover:border-emerald-600 transition-colors"
              style={{ borderRadius: 0 }}
            >
              <div className="flex items-center gap-2.5">
                <Store className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">
                  WhatsApp Dispatch Center
                </span>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-gray-400" />
            </Link>

            <Link
              to="/payments"
              className="flex items-center justify-between p-3 border border-gray-200 dark:border-admin-border-dark bg-gray-50/50 dark:bg-admin-surface-darkSubtle/30 hover:border-emerald-600 transition-colors"
              style={{ borderRadius: 0 }}
            >
              <div className="flex items-center gap-2.5">
                <CreditCard className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">
                  Vendor ₹10 Share Settlement
                </span>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-gray-400" />
            </Link>

            <Link
              to="/settings"
              className="flex items-center justify-between p-3 border border-gray-200 dark:border-admin-border-dark bg-gray-50/50 dark:bg-admin-surface-darkSubtle/30 hover:border-emerald-600 transition-colors"
              style={{ borderRadius: 0 }}
            >
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">
                  Campus Notice Banner
                </span>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-gray-400" />
            </Link>
          </div>
        </Card>

        {/* Recent Orders Table */}
        <div className="lg:col-span-2">
          <Card
            title="Recent Activity Feed"
            subtitle={`Displaying latest ${orders.slice(0, 10).length} campus transactions`}
            action={
              <Link to="/orders">
                <Button variant="ghost" size="xs" iconRight={<ExternalLink className="w-3 h-3" />}>
                  View All Orders
                </Button>
              </Link>
            }
            noPadding
          >
            <DataTable
              columns={orderColumns}
              data={orders.slice(0, 10)}
              loading={loading}
              pageSize={10}
              searchPlaceholder=""
              emptyTitle="No recent transactions"
              emptyDescription="Orders placed by students will appear in real time here."
            />
          </Card>
        </div>
      </div>
    </div>
  )
}
