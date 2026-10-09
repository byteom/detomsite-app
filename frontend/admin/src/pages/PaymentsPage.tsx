import React, { useState, useEffect } from 'react'
import {
  CreditCard,
  CheckCircle,
  AlertCircle,
  Clock,
  ExternalLink,
  DollarSign,
  TrendingUp,
  RefreshCw,
  Search,
  XCircle,
} from 'lucide-react'
import api from '../services/api'
import { apiError, fmtTime, fmtCurrency } from '../utils/formatters'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { StatCard } from '../components/ui/StatCard'
import { DataTable, Column } from '../components/ui/DataTable'

function monthLabel(dateStr?: string) {
  if (!dateStr) return 'Current Month'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
}

export function PaymentsPage() {
  const [shares, setShares] = useState<any>({ vendors: [], summary: {} })
  const [payments, setPayments] = useState<any[]>([])
  const [sharePayments, setSharePayments] = useState<any[]>([])
  const [proofQueue, setProofQueue] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [activeTab, setActiveTab] = useState<'queue' | 'shares' | 'records' | 'orders'>('queue')
  const [shareErr, setShareErr] = useState('')
  const [msg, setMsg] = useState('')

  const loadData = async (silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    setShareErr('')

    try {
      const [sharesRes, paymentsRes, sharePayRes, queueRes] = await Promise.all([
        api.get('/admin/payments/monthly-shares').catch(() => ({ data: { vendors: [], summary: {} } })),
        api.get('/admin/payments').catch(() => ({ data: [] })),
        api.get('/admin/payments/share-records').catch(() => ({ data: [] })),
        api.get('/local/payments/verification-queue').catch(() => ({ data: [] })),
      ])

      setShares(sharesRes.data || { vendors: [], summary: {} })
      setPayments(paymentsRes.data || [])
      setSharePayments(sharePayRes.data || [])
      setProofQueue(Array.isArray(queueRes.data) ? queueRes.data : [])
    } catch (e: any) {
      setShareErr(apiError(e, 'Could not load payment records'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const markReceived = async (id: string) => {
    setMsg('')
    setShareErr('')
    try {
      await api.patch(`/admin/payments/shares/${id}/received`)
      setMsg('Share payment marked as Received and verified!')
      loadData(true)
    } catch (err: any) {
      setShareErr(apiError(err, 'Failed to update share payment status'))
    }
  }

  const markRejected = async (id: string) => {
    setMsg('')
    setShareErr('')
    try {
      await api.patch(`/admin/payments/shares/${id}/reject`)
      setMsg('Share payment marked as Rejected.')
      loadData(true)
    } catch (err: any) {
      setShareErr(apiError(err, 'Failed to reject payment'))
    }
  }

  const summary = shares?.summary || {}
  const vendorList = shares?.vendors || []

  // Vendor Share Status Columns
  const vendorColumns: Column<any>[] = [
    {
      key: 'shop_name',
      header: 'Restaurant & Owner',
      sortable: true,
      render: (v: any) => (
        <div>
          <p className="font-bold text-[var(--text-heading)]">{v.shop_name}</p>
          <p className="text-[11px] text-[var(--text-muted)]">{v.shopkeeper_name}</p>
        </div>
      ),
    },
    {
      key: 'month_orders',
      header: 'Month Orders',
      sortable: true,
      align: 'center',
      render: (v: any) => (
        <span className="font-mono font-bold text-[var(--text-body)]">
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
        <span className="font-mono font-bold text-[var(--text-heading)]">
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
        <span className="text-[var(--text-muted)] font-mono text-xs">
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
        <span className="font-semibold text-[var(--text-heading)]">{p.shop_name}</span>
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
        <span className="text-[var(--text-muted)] font-mono text-xs">{fmtTime(p.created_at)}</span>
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
            <span className="text-[var(--text-dim)] text-xs italic">Settled</span>
          )}
        </div>
      ),
    },
  ]

  // Manual UPI proof verification queue (UTR + screenshot, admin-verified).
  const queueColumns: Column<any>[] = [
    {
      key: 'order_token',
      header: 'Order',
      sortable: true,
      render: (q: any) => (
        <a
          href="/orders"
          title="Open Orders desk — click the order to verify & confirm or reject"
          className="font-mono font-black text-xs text-emerald-700 dark:text-emerald-400 hover:underline"
        >
          #{q.order_token || q.order_id}
        </a>
      ),
    },
    {
      key: 'customer_name',
      header: 'Customer',
      sortable: true,
      render: (q: any) => (
        <div>
          <p className="font-bold text-[var(--text-heading)]">{q.customer_name || '—'}</p>
          <p className="text-[11px] text-[var(--text-muted)]">{q.customer_phone || ''}</p>
        </div>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      sortable: true,
      align: 'right',
      render: (q: any) => (
        <span className="font-mono font-black text-[var(--text-heading)]">₹{q.amount}</span>
      ),
    },
    {
      key: 'utr_number',
      header: 'UTR / Txn Ref',
      render: (q: any) => (
        <span className="font-mono text-xs text-[var(--text-body)]">{q.utr_number || '—'}</span>
      ),
    },
    {
      key: 'payment_screenshot_url',
      header: 'Screenshot',
      render: (q: any) =>
        q.payment_screenshot_url ? (
          <a href={q.payment_screenshot_url} target="_blank" rel="noreferrer" title="Open full screenshot">
            <img
              src={q.payment_screenshot_url}
              alt="Payment screenshot"
              className="h-12 w-12 rounded border border-[var(--border-main)] object-cover"
            />
          </a>
        ) : (
          <span className="text-xs text-[var(--text-dim)] italic">—</span>
        ),
    },
    {
      key: 'payment_submitted_at',
      header: 'Submitted',
      sortable: true,
      render: (q: any) => (
        <span className="text-[var(--text-muted)] text-xs">{fmtTime(q.payment_submitted_at)}</span>
      ),
    },
    {
      key: 'actions',
      header: 'Order',
      align: 'right',
      render: (q: any) => (
        <a
          href="/orders"
          title="Open Orders desk — click the order to verify & confirm or reject"
          className="inline-flex items-center gap-1 bg-emerald-700 dark:bg-emerald-600 text-white px-2.5 py-1 text-[11px] font-bold hover:bg-emerald-800"
        >
          Open <ExternalLink className="w-3 h-3" />
        </a>
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
        <span className="font-mono font-bold text-[var(--text-heading)]">#{p.order_id}</span>
      ),
    },
    {
      key: 'amount',
      header: 'Order Amount',
      sortable: true,
      align: 'right',
      render: (p: any) => (
        <span className="font-mono font-bold text-[var(--text-heading)]">₹{p.amount}</span>
      ),
    },
    {
      key: 'method',
      header: 'Method',
      sortable: true,
      align: 'center',
      render: (p: any) => (
        <Badge variant={p.method === 'COD' ? 'gold' : 'cyan'} size="xs">
          {p.method}
        </Badge>
      ),
    },
    {
      key: 'utr_number',
      header: 'UTR / Txn Ref',
      render: (p: any) => (
        <span className="font-mono text-xs text-[var(--text-body)]">
          {p.utr_number || '—'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Payment Status',
      sortable: true,
      align: 'center',
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
      render: (p: any) => <span className="text-[var(--text-muted)] text-xs">{fmtTime(p.created_at)}</span>,
    },
  ]

  return (
    <div className="space-y-6 text-[var(--text-body)]">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--border-main)] pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-black text-[var(--text-heading)] tracking-tight">
              Payments & Vendor Settlements
            </h1>
            <Badge variant="success" size="sm" dot>
              Live Monitor
            </Badge>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
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
          className="p-3.5 bg-emerald-500/10 border border-emerald-500/30 text-xs font-semibold text-emerald-800 dark:text-emerald-300"
          style={{ borderRadius: 0 }}
        >
          {msg}
        </div>
      )}

      {shareErr && (
        <div
          className="p-3.5 bg-red-500/10 border border-red-500/30 text-xs font-semibold text-red-800 dark:text-red-300"
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
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--border-main)] pb-2">
        <button
          onClick={() => setActiveTab('queue')}
          className={`px-3 py-1.5 text-xs font-bold transition-colors ${
            activeTab === 'queue'
              ? 'bg-emerald-700 dark:bg-emerald-600 text-white'
              : 'bg-[var(--bg-surface-subtle)] text-[var(--text-body)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-main)]'
          }`}
          style={{ borderRadius: 0 }}
        >
          Verify Proofs ({proofQueue.length})
        </button>
        <button
          onClick={() => setActiveTab('shares')}
          className={`px-3 py-1.5 text-xs font-bold transition-colors ${
            activeTab === 'shares'
              ? 'bg-emerald-700 dark:bg-emerald-600 text-white'
              : 'bg-[var(--bg-surface-subtle)] text-[var(--text-body)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-main)]'
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
              : 'bg-[var(--bg-surface-subtle)] text-[var(--text-body)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-main)]'
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
              : 'bg-[var(--bg-surface-subtle)] text-[var(--text-body)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-main)]'
          }`}
          style={{ borderRadius: 0 }}
        >
          Customer Order Payments ({payments.length})
        </button>
      </div>

      {/* Tab Panels */}
      {activeTab === 'queue' && (
        <DataTable
          columns={queueColumns}
          data={proofQueue}
          loading={loading}
          searchPlaceholder="Search by customer, order or UTR..."
          searchableKeys={['customer_name', 'customer_phone', 'order_id', 'utr_number']}
          emptyTitle="No proofs awaiting verification"
          emptyDescription="When a student submits a UTR + payment screenshot, it appears here — and the admin gets a Telegram notification with a direct link."
        />
      )}

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
