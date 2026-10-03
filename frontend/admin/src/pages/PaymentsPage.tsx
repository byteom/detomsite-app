import React, { useState, useEffect } from 'react'
import {
  CreditCard,
  CheckCircle,
  XCircle,
  AlertCircle,
  DollarSign,
  TrendingUp,
  RefreshCw,
} from 'lucide-react'
import api from '../services/api'
import { apiError, fmtTime, fmtCurrency } from '../utils/formatters'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { StatCard } from '../components/ui/StatCard'
import { DataTable, Column } from '../components/ui/DataTable'
import { Card } from '../components/ui/Card'

export function PaymentsPage() {
  const [payments, setPayments] = useState<any[]>([])
  const [shares, setShares] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [msg, setMsg] = useState('')
  const [shareErr, setShareErr] = useState('')
  const [activeTab, setActiveTab] = useState<'shares' | 'records' | 'orders'>('shares')

  const loadData = async (silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)

    try {
      const [sharesRes, paymentsRes] = await Promise.all([
        api.get('/admin/shares').catch(() => ({ data: null })),
        api.get('/admin/payments').catch(() => ({ data: [] })),
      ])

      setShares(sharesRes.data || null)
      setPayments(paymentsRes.data || [])
      setShareErr('')
    } catch (e: any) {
      if (!silent) setShareErr('Could not load payment records')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    loadData()
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') loadData(true)
    }, 30000)
    return () => clearInterval(t)
  }, [])

  const markReceived = async (id: string) => {
    try {
      await api.patch(`/admin/shares/${id}`, { status: 'Completed' })
      setMsg('Share payment marked as Received and collected.')
      loadData(true)
    } catch (err: any) {
      setShareErr(apiError(err, 'Failed to update share payment status'))
    }
  }

  const markRejected = async (id: string) => {
    try {
      await api.patch(`/admin/shares/${id}`, { status: 'Rejected' })
      setMsg('Share payment marked as Rejected.')
      loadData(true)
    } catch (err: any) {
      setShareErr(apiError(err, 'Failed to reject payment'))
    }
  }

  const summary = shares?.summary || {}
  const vendorList: any[] = shares?.vendors || []
  const sharePayments: any[] = shares?.payments || []

  const monthLabel = (s: any) => {
    const m = String(s || '').slice(0, 7)
    if (m.length !== 7) return '—'
    const [y, mo] = m.split('-')
    const names = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ]
    return `${names[Number(mo) - 1] || mo} ${y}`
  }

  // Vendor Share Status Columns
  const vendorColumns: Column<any>[] = [
    {
      key: 'shop_name',
      header: 'Restaurant & Owner',
      sortable: true,
      render: (v: any) => (
        <div>
          <p className="font-bold text-gray-900 dark:text-white">{v.shop_name}</p>
          <p className="text-[11px] text-gray-500">{v.shopkeeper_name}</p>
        </div>
      ),
    },
    {
      key: 'month_orders',
      header: 'Month Orders',
      sortable: true,
      align: 'center',
      render: (v: any) => (
        <span className="font-mono font-bold text-gray-800 dark:text-gray-200">
          {v.month_orders}
        </span>
      ),
    },
    {
      key: 'month_revenue',
      header: 'Gross Volume',
      sortable: true,
      align: 'right',
      render: (v: any) => (
        <span className="font-mono font-bold text-gray-900 dark:text-white">
          ₹{v.month_revenue}
        </span>
      ),
    },
    {
      key: 'month_fee',
      header: 'Admin ₹10 Share',
      sortable: true,
      align: 'right',
      render: (v: any) => (
        <span className="font-mono font-black text-emerald-700 dark:text-emerald-400">
          ₹{v.month_fee}
        </span>
      ),
    },
    {
      key: 'paid_month',
      header: 'Status',
      sortable: true,
      align: 'center',
      render: (v: any) => (
        <Badge variant={v.paid_month ? 'success' : 'gold'} size="xs">
          {v.paid_month ? 'Settled' : 'Pending Settlement'}
        </Badge>
      ),
    },
    {
      key: 'last_paid_at',
      header: 'Last Settled',
      sortable: true,
      render: (v: any) => (
        <span className="text-gray-500 font-mono text-xs">
          {v.last_paid_at ? String(v.last_paid_at).slice(0, 16) : '—'}
        </span>
      ),
    },
  ]

  // Share Payments Records Columns
  const recordColumns: Column<any>[] = [
    {
      key: 'shop_name',
      header: 'Vendor Name',
      sortable: true,
      render: (p: any) => (
        <span className="font-semibold text-gray-900 dark:text-white">{p.shop_name}</span>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      sortable: true,
      align: 'right',
      render: (p: any) => (
        <span className="font-mono font-black text-emerald-700 dark:text-emerald-400">
          ₹{p.amount}
        </span>
      ),
    },
    {
      key: 'created_at',
      header: 'Billing Month',
      render: (p: any) => (
        <Badge variant="gold" size="xs">
          {monthLabel(p.created_at)}
        </Badge>
      ),
    },
    {
      key: 'created_at_time',
      header: 'Initiated At',
      sortable: true,
      render: (p: any) => (
        <span className="text-gray-500 font-mono text-xs">{fmtTime(p.created_at)}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      align: 'center',
      render: (p: any) => {
        const variant =
          p.status === 'Completed' ? 'success' : p.status === 'Rejected' ? 'error' : 'gold'
        return (
          <Badge variant={variant} size="xs">
            {p.status === 'Completed' ? 'Received' : p.status}
          </Badge>
        )
      },
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (p: any) => (
        <div>
          {p.status === 'Pending' ? (
            <div className="flex items-center justify-end gap-1.5">
              <Button
                variant="primary"
                size="xs"
                onClick={() => markReceived(p.id)}
                icon={<CheckCircle className="w-3.5 h-3.5" />}
              >
                Mark Received
              </Button>
              <Button
                variant="danger"
                size="xs"
                onClick={() => markRejected(p.id)}
                icon={<XCircle className="w-3.5 h-3.5" />}
              >
                Reject
              </Button>
            </div>
          ) : (
            <span className="text-gray-400 text-xs italic">Settled</span>
          )}
        </div>
      ),
    },
  ]

  // Order Payments Columns
  const orderPaymentColumns: Column<any>[] = [
    {
      key: 'order_id',
      header: 'Order Reference',
      sortable: true,
      render: (p: any) => (
        <span className="font-mono font-bold text-gray-900 dark:text-white">#{p.order_id}</span>
      ),
    },
    {
      key: 'amount',
      header: 'Order Amount',
      sortable: true,
      align: 'right',
      render: (p: any) => (
        <span className="font-mono font-bold text-gray-900 dark:text-white">₹{p.amount}</span>
      ),
    },
    {
      key: 'method',
      header: 'Method',
      sortable: true,
      align: 'center',
      render: (p: any) => (
        <Badge variant={p.method === 'COD' ? 'gold' : 'info'} size="xs">
          {p.method}
        </Badge>
      ),
    },
    {
      key: 'utr_number',
      header: 'UTR / Transaction ID',
      render: (p: any) => (
        <span className="font-mono text-gray-500 text-xs">{p.utr_number || '—'}</span>
      ),
    },
    {
      key: 'status',
      header: 'Confirmation Status',
      sortable: true,
      render: (p: any) => {
        const s = p.status
        const variant =
          s === 'Success' ? 'success' : s === 'Failed' ? 'error' : 'warning'
        return <Badge variant={variant} size="xs">{s}</Badge>
      },
    },
    {
      key: 'created_at',
      header: 'Timestamp',
      sortable: true,
      render: (p: any) => <span className="text-gray-500 text-xs">{fmtTime(p.created_at)}</span>,
    },
  ]

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-200 dark:border-admin-border-dark pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">
              Payments & Vendor Settlements
            </h1>
            <Badge variant="success" size="sm" dot>
              Live Monitor
            </Badge>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Track student order payments and verify vendor monthly ₹10-per-order platform share
          </p>
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={() => loadData(true)}
          loading={refreshing}
          icon={<RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />}
        >
          Refresh Feeds
        </Button>
      </div>

      {/* Messages */}
      {msg && (
        <div
          className="p-3.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-xs font-semibold text-emerald-800 dark:text-emerald-300"
          style={{ borderRadius: 0 }}
        >
          {msg}
        </div>
      )}

      {shareErr && (
        <div
          className="p-3.5 bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-800 text-xs font-semibold text-red-800 dark:text-red-300"
          style={{ borderRadius: 0 }}
        >
          {shareErr}
        </div>
      )}

      {/* Monthly KPI Overview */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <StatCard
          title="Expected This Month"
          value={fmtCurrency(summary.expected_month || 0)}
          subtitle={shares?.month_label || 'Current monthly cycle'}
          icon={<TrendingUp className="w-5 h-5" />}
          variant="gold"
        />

        <StatCard
          title="Collected This Month"
          value={fmtCurrency(summary.collected_month || 0)}
          subtitle={`Total all time: ${fmtCurrency(summary.collected_total || 0)}`}
          icon={<CheckCircle className="w-5 h-5" />}
          variant="emerald"
        />

        <StatCard
          title="Pending Collection"
          value={fmtCurrency(summary.pending_month || 0)}
          subtitle={`${summary.pending_month_count || 0} payments awaiting receipt`}
          icon={<AlertCircle className="w-5 h-5" />}
          variant="warning"
        />

        <StatCard
          title="Settlement Rate"
          value={`${summary.paid_month_count || 0} / ${vendorList.length}`}
          subtitle={`${(
            ((summary.paid_month_count || 0) / Math.max(1, vendorList.length)) *
            100
          ).toFixed(0)}% vendors settled this month`}
          icon={<CreditCard className="w-5 h-5" />}
          variant="default"
        />
      </div>

      {/* View Switcher Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-200 dark:border-admin-border-dark pb-2">
        <button
          onClick={() => setActiveTab('shares')}
          className={`px-3 py-1.5 text-xs font-bold transition-colors ${
            activeTab === 'shares'
              ? 'bg-emerald-700 dark:bg-emerald-600 text-white'
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
          }`}
          style={{ borderRadius: 0 }}
        >
          Vendor Monthly Share Status ({vendorList.length})
        </button>

        <button
          onClick={() => setActiveTab('records')}
          className={`px-3 py-1.5 text-xs font-bold transition-colors ${
            activeTab === 'records'
              ? 'bg-emerald-700 dark:bg-emerald-600 text-white'
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
          }`}
          style={{ borderRadius: 0 }}
        >
          Settlement Transfer Records ({sharePayments.length})
        </button>

        <button
          onClick={() => setActiveTab('orders')}
          className={`px-3 py-1.5 text-xs font-bold transition-colors ${
            activeTab === 'orders'
              ? 'bg-emerald-700 dark:bg-emerald-600 text-white'
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
          }`}
          style={{ borderRadius: 0 }}
        >
          Customer Order Payments ({payments.length})
        </button>
      </div>

      {/* Tab Panels */}
      {activeTab === 'shares' && (
        <DataTable
          columns={vendorColumns}
          data={vendorList}
          loading={loading}
          searchPlaceholder="Search vendor by name..."
          searchableKeys={['shop_name', 'shopkeeper_name']}
          emptyTitle="No approved vendors found"
          emptyDescription="Vendor monthly share tracking begins once vendors are approved."
        />
      )}

      {activeTab === 'records' && (
        <DataTable
          columns={recordColumns}
          data={sharePayments}
          loading={loading}
          searchPlaceholder="Search settlement by vendor..."
          searchableKeys={['shop_name']}
          emptyTitle="No settlement records recorded"
          emptyDescription="When vendors tap 'Pay Share' in the vendor application, the transaction appears here for verification."
        />
      )}

      {activeTab === 'orders' && (
        <DataTable
          columns={orderPaymentColumns}
          data={payments}
          loading={loading}
          searchPlaceholder="Search by order reference or UTR..."
          searchableKeys={['order_id', 'utr_number', 'method']}
          emptyTitle="No customer payments recorded"
          emptyDescription="Order payments verified by vendors or students appear here."
        />
      )}
    </div>
  )
}
