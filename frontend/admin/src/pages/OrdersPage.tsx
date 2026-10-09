import React, { useState, useRef, useCallback, useEffect } from 'react'
import {
  ShoppingBag,
  Search,
  Calendar,
  MessageSquare,
  Check,
  Eye,
  Filter,
  RefreshCw,
  X,
  XCircle,
  ShieldAlert,
  AlertCircle,
  CheckCircle2,
  User,
  Store,
} from 'lucide-react'
import api, { dedupeGet } from '../services/api'
import { usePolling } from '../hooks/usePolling'
import { apiError, fmtTime, fmtCurrency } from '../utils/formatters'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { DataTable, Column } from '../components/ui/DataTable'
import { Modal } from '../components/ui/Modal'
import { OrderItemsCell } from '../components/common/OrderItemsCell'

export function OrdersPage() {
  const [orders, setOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [fStatus, setFStatus] = useState('all')
  const [fMethod, setFMethod] = useState('all')
  const [fDate, setFDate] = useState('')
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null)
  const [actionMsg, setActionMsg] = useState('')
  const [actionErr, setActionErr] = useState('')
  const [confirmingId, setConfirmingId] = useState<string>('')
  const [proof, setProof] = useState<any | null>(null)
  const [proofLoading, setProofLoading] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [rejecting, setRejecting] = useState(false)

  const handleOpenOrder = (o: any) => {
    setActionMsg('')
    setActionErr('')
    setRejectReason('')
    setSelectedOrder(o)
  }

  const handleCloseOrder = () => {
    setSelectedOrder(null)
    setRejectReason('')
  }

  const pendingRef = useRef(0)

  const loadOrders = useCallback(() => {
    if (document.visibilityState !== 'visible') return
    return dedupeGet('/admin/orders')
      .then((r: any) => {
        const list = r.data || []
        setOrders(list)
        const pending = list.filter((o: any) => o.status === 'Pending Payment').length
        pendingRef.current = pending
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  usePolling(loadOrders, () => (pendingRef.current > 0 ? 10000 : 30000), [])

  const statuses = [
    'Pending Acceptance',
    'Pending Payment',
    'Placed',
    'Accepted',
    'Completed',
    'Cancelled',
  ]

  const filteredOrders = orders.filter((o: any) => {
    if (fStatus !== 'all' && o.status !== fStatus) return false
    if (fMethod !== 'all' && (o.payment_method || 'UPI') !== fMethod) return false
    if (fDate && !String(o.created_at || '').startsWith(fDate)) return false
    return true
  })

  const handleConfirmOrder = async (orderId: string) => {
    if (!window.confirm('Verify & confirm this order? For UPI this also approves the submitted payment proof.')) return
    setConfirmingId(orderId)
    setActionMsg('')
    setActionErr('')
    try {
      const r = await api.post(`/admin/orders/${orderId}/confirm`)
      setActionMsg(r.data?.message || 'Order marked as Confirmed.')
      setOrders(list =>
        list.map(x => (x.id === orderId ? { ...x, status: r.data?.order?.status || 'Confirmed' } : x))
      )
      if (selectedOrder?.id === orderId) {
        setSelectedOrder((prev: any) => ({ ...prev, status: 'Confirmed' }))
      }
    } catch (e: any) {
      setActionErr(apiError(e, 'Could not confirm this order'))
    } finally {
      setConfirmingId('')
    }
  }

  const handleRejectOrder = async (orderId: string, mode: 'resubmit' | 'cancel') => {
    const trimmed = rejectReason.trim()
    if (!trimmed) {
      setActionErr('A reason is required so the student knows what to fix.')
      return
    }
    const label = mode === 'cancel'
      ? 'Reject & cancel this order? The student will be told why and the order will close.'
      : 'Reject proof & ask for resubmit? The student can send a fresh UTR + screenshot.'
    if (!window.confirm(label)) return
    setRejecting(true)
    setActionMsg('')
    setActionErr('')
    try {
      const r = await api.post(`/admin/orders/${orderId}/reject`, { mode, reason: trimmed })
      setActionMsg(r.data?.message || (mode === 'cancel' ? 'Order cancelled.' : 'Proof rejected — student asked to resubmit.'))
      const nextStatus = mode === 'cancel' ? 'Cancelled' : selectedOrder?.status
      setOrders(list =>
        list.map(x => (x.id === orderId ? { ...x, status: r.data?.order?.status || nextStatus } : x))
      )
      if (selectedOrder?.id === orderId) {
        if (mode === 'cancel') {
          setSelectedOrder((prev: any) => ({ ...prev, status: 'Cancelled' }))
        } else {
          loadProof(orderId)
        }
      }
      setRejectReason('')
    } catch (e: any) {
      setActionErr(apiError(e, 'Could not reject this order'))
    } finally {
      setRejecting(false)
    }
  }

  const loadProof = useCallback((orderId: string) => {
    setProof(null)
    setProofLoading(true)
    api
      .get(`/local/payments/proof/${orderId}`)
      .then((r: any) => setProof(r.data))
      .catch(() => setProof(null))
      .finally(() => setProofLoading(false))
  }, [])

  // Load UPI payment proof whenever a detail modal opens — the table itself
  // stays action-free; Verify & Confirm / Reject live only here.
  useEffect(() => {
    if (!selectedOrder) {
      setProof(null)
      setRejectReason('')
      return
    }
    if (String(selectedOrder.payment_method || 'UPI').toUpperCase() === 'COD') {
      setProof(null)
      return
    }
    loadProof(selectedOrder.id)
  }, [selectedOrder, loadProof])

  const handleOpenWhatsApp = async (orderId: string) => {
    try {
      const r = await api.get(`/admin/orders/${orderId}/whatsapp-link`)
      if (r.data?.url) {
        window.open(r.data.url, '_blank')
      }
    } catch (e: any) {
      alert(apiError(e, 'Could not build WhatsApp dispatch link for this shop'))
    }
  }

  const columns: Column<any>[] = [
    {
      key: 'token',
      header: 'Token',
      sortable: true,
      width: '75px',
      render: (o: any) => (
        <span className="font-mono font-black text-xs text-[var(--text-heading)]">
          #{o.token}
        </span>
      ),
    },
    {
      key: 'shop_name',
      header: 'Shop',
      sortable: true,
      className: 'min-w-[120px]',
      render: (o: any) => (
        <span className="font-semibold text-[var(--text-body)] leading-snug line-clamp-2" title={o.shop_name}>
          {o.shop_name}
        </span>
      ),
    },
    {
      key: 'student_name',
      header: 'Customer',
      sortable: true,
      className: 'min-w-[120px]',
      render: (o: any) => (
        <div>
          <p className="font-semibold text-[var(--text-heading)] leading-snug truncate" title={o.student_name}>
            {o.student_name}
          </p>
          {o.student_phone && (
            <p className="text-[11px] text-[var(--text-muted)] font-mono">{o.student_phone}</p>
          )}
        </div>
      ),
    },
    {
      key: 'items',
      header: 'Items Ordered',
      className: 'min-w-[130px]',
      render: (o: any) => <OrderItemsCell items={o.items} />,
    },
    {
      key: 'total',
      header: 'Total',
      sortable: true,
      align: 'right',
      width: '75px',
      render: (o: any) => (
        <span className="font-mono font-bold text-[var(--text-heading)]">
          ₹{o.total}
        </span>
      ),
    },
    {
      key: 'payment_method',
      header: 'Method',
      sortable: true,
      align: 'center',
      width: '75px',
      render: (o: any) => {
        const m = (o.payment_method || 'UPI').toUpperCase()
        const variant = m === 'COD' ? 'gold' : 'cyan'
        return (
          <Badge variant={variant} size="xs">
            {m}
          </Badge>
        )
      },
    },
    {
      key: 'delivery_location',
      header: 'Location & Slot',
      className: 'min-w-[110px]',
      render: (o: any) => (
        <div className="text-xs leading-tight">
          <p className="text-[var(--text-body)] font-medium truncate" title={o.delivery_location || 'Campus'}>
            {o.delivery_location || 'Campus'}
          </p>
          {o.delivery_slot && <p className="text-[11px] text-[var(--text-muted)] font-mono">{o.delivery_slot}</p>}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      width: '125px',
      render: (o: any) => {
        const s = o.status || 'Placed'
        const sLower = s.toLowerCase()
        let variant: 'success' | 'warning' | 'error' | 'info' | 'purple' = 'info'
        if (sLower === 'completed' || sLower === 'delivered') {
          variant = 'success'
        } else if (sLower === 'cancelled' || sLower === 'rejected' || sLower === 'failed') {
          variant = 'error'
        } else if (sLower.includes('pending') || sLower === 'placed') {
          variant = 'warning'
        } else if (sLower === 'ready' || sLower.includes('delivery') || sLower.includes('out')) {
          variant = 'purple'
        } else {
          variant = 'info'
        }
        return <Badge variant={variant} size="xs">{s}</Badge>
      },
    },
    {
      key: 'created_at',
      header: 'Placed',
      sortable: true,
      width: '110px',
      render: (o: any) => (
        <span className="text-[var(--text-muted)] whitespace-nowrap text-xs">
          {fmtTime(o.created_at)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      width: '85px',
      render: (o: any) => (
        <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="secondary"
            size="xs"
            onClick={(e) => {
              e.stopPropagation()
              handleOpenWhatsApp(o.id)
            }}
            title="Dispatch order details to shopkeeper via WhatsApp"
            icon={<MessageSquare className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />}
          >
            WA
          </Button>

          <Button
            variant="ghost"
            size="xs"
            onClick={(e) => {
              e.stopPropagation()
              handleOpenOrder(o)
            }}
            title="Open order detail — verify & confirm or reject there"
            icon={<Eye className="w-3.5 h-3.5 text-[var(--text-dim)]" />}
          />
        </div>
      ),
    },
  ]

  const hasActiveFilters = fStatus !== 'all' || fMethod !== 'all' || Boolean(fDate)

  // Detail-modal derived state: UPI proof gate for the single Verify & Confirm.
  const detailIsCod = String(selectedOrder?.payment_method || 'UPI').toUpperCase() === 'COD'
  const detailProofStatus: string = proof?.proof_status || ''
  const isUpiWithoutProof =
    !!selectedOrder &&
    !detailIsCod &&
    detailProofStatus !== 'PAYMENT_PROOF_SUBMITTED' &&
    detailProofStatus !== 'PAYMENT_APPROVED'
  const detailActionable =
    !!selectedOrder &&
    ['Pending Payment', 'Pending Acceptance', 'Pending', 'Placed', 'Accepted'].includes(
      selectedOrder.status
    )

  return (
    <div className="space-y-6 text-[var(--text-body)]">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--border-main)] pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-black text-[var(--text-heading)] tracking-tight">
              Orders Operations Desk
            </h1>
            <Badge variant="default" size="md">
              {filteredOrders.length} {filteredOrders.length === 1 ? 'Order' : 'Orders'}
            </Badge>
          </div>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Open an order to verify payment proof and confirm it, or reject with a reason
            </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setLoading(true)
              loadOrders()
            }}
            icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* Action Messages on Page (when modal is closed) */}
      {!selectedOrder && actionMsg && (
        <div
          className="p-3.5 bg-emerald-500/10 border border-emerald-500/30 text-xs font-semibold text-emerald-800 dark:text-emerald-300 flex items-center justify-between gap-2"
          style={{ borderRadius: 0 }}
        >
          <span>{actionMsg}</span>
          <button type="button" onClick={() => setActionMsg('')} className="p-0.5 hover:opacity-75">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {!selectedOrder && actionErr && (
        <div
          className="p-3.5 bg-red-500/10 border border-red-500/30 text-xs font-semibold text-red-800 dark:text-red-300 flex items-center justify-between gap-2"
          style={{ borderRadius: 0 }}
        >
          <span>{actionErr}</span>
          <button type="button" onClick={() => setActionErr('')} className="p-0.5 hover:opacity-75">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Table */}
      <DataTable
        dense
        columns={columns}
        data={filteredOrders}
        loading={loading}
        onRowClick={(order) => handleOpenOrder(order)}
        searchPlaceholder="Search shop, student, token (#)..."
        searchableKeys={['shop_name', 'student_name', 'token', 'student_phone', 'items']}
        filterSlot={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={fStatus}
              onChange={e => setFStatus(e.target.value)}
              className="bg-[var(--bg-surface)] text-[var(--text-heading)] border border-[var(--border-main)] px-2.5 py-1.5 text-xs outline-none focus:border-emerald-600 transition-colors"
              style={{ borderRadius: 0 }}
            >
              <option value="all" className="bg-[var(--bg-surface)] text-[var(--text-heading)]">All Statuses</option>
              {statuses.map(s => (
                <option key={s} value={s} className="bg-[var(--bg-surface)] text-[var(--text-heading)]">
                  {s}
                </option>
              ))}
            </select>

            <select
              value={fMethod}
              onChange={e => setFMethod(e.target.value)}
              className="bg-[var(--bg-surface)] text-[var(--text-heading)] border border-[var(--border-main)] px-2.5 py-1.5 text-xs outline-none focus:border-emerald-600 transition-colors"
              style={{ borderRadius: 0 }}
            >
              <option value="all" className="bg-[var(--bg-surface)] text-[var(--text-heading)]">All Payment Methods</option>
              <option value="UPI" className="bg-[var(--bg-surface)] text-[var(--text-heading)]">UPI Online</option>
              <option value="COD" className="bg-[var(--bg-surface)] text-[var(--text-heading)]">Cash on Delivery</option>
            </select>

            <div className="flex items-center gap-1.5 bg-[var(--bg-surface)] border border-[var(--border-main)] px-2 py-1">
              <Calendar className="w-3.5 h-3.5 text-[var(--text-dim)] shrink-0" />
              <input
                type="date"
                value={fDate}
                onChange={e => setFDate(e.target.value)}
                className="bg-transparent text-xs text-[var(--text-heading)] outline-none"
              />
            </div>

            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  setFStatus('all')
                  setFMethod('all')
                  setFDate('')
                }}
                icon={<X className="w-3 h-3" />}
              >
                Reset Filters
              </Button>
            )}
          </div>
        }
        emptyTitle="No orders found"
        emptyDescription="There are currently no student orders matching your status, payment method, or date filters."
      />

      {/* Order Detail Modal — the single Verify & Confirm / Reject place */}
      {selectedOrder && (
        <Modal
          open={Boolean(selectedOrder)}
          onClose={handleCloseOrder}
          title={`Order #${selectedOrder.token} Breakdown`}
          description={`Placed on ${fmtTime(selectedOrder.created_at)}`}
          maxWidth="3xl"
          footer={
            <div className="flex items-center justify-between w-full flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleOpenWhatsApp(selectedOrder.id)}
                  icon={<MessageSquare className="w-3.5 h-3.5 text-emerald-600" />}
                >
                  WhatsApp Dispatch
                </Button>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {['Pending Payment', 'Pending Acceptance', 'Pending', 'Placed', 'Accepted'].includes(
                  selectedOrder.status
                ) && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleConfirmOrder(selectedOrder.id)}
                    loading={confirmingId === selectedOrder.id}
                    disabled={confirmingId === selectedOrder.id || rejecting}
                    icon={<Check className="w-3.5 h-3.5" />}
                    title={
                      isUpiWithoutProof
                        ? 'Waiting for student UTR + screenshot — cannot confirm yet'
                        : 'Verify payment (UPI) & confirm order in one click'
                    }
                  >
                    Verify & Confirm
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={handleCloseOrder}>
                  Close
                </Button>
              </div>
            </div>
          }
        >
          <div className="space-y-4 text-[var(--text-body)]">
            {/* Modal Top Validation & Action Warnings */}
            {actionErr && (
              <div
                className="p-3.5 bg-red-500/10 border border-red-500/30 text-xs font-semibold text-red-800 dark:text-red-300 flex items-start justify-between gap-2.5 animate-fade-in"
                style={{ borderRadius: 0 }}
              >
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-600 dark:text-red-400" />
                  <span>{actionErr}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setActionErr('')}
                  className="text-red-600 dark:text-red-400 hover:opacity-70 p-0.5"
                  title="Dismiss alert"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {actionMsg && (
              <div
                className="p-3.5 bg-emerald-500/10 border border-emerald-500/30 text-xs font-semibold text-emerald-800 dark:text-emerald-300 flex items-start justify-between gap-2.5 animate-fade-in"
                style={{ borderRadius: 0 }}
              >
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span>{actionMsg}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setActionMsg('')}
                  className="text-emerald-600 dark:text-emerald-400 hover:opacity-70 p-0.5"
                  title="Dismiss alert"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            {/* Meta stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div
                className="p-3 border border-[var(--border-main)] bg-[var(--bg-surface-subtle)]"
                style={{ borderRadius: 0 }}
              >
                <p className="text-[10px] uppercase font-bold text-[var(--text-dim)]">Total Amount</p>
                <p className="text-lg font-black text-[var(--text-heading)] font-mono mt-0.5">
                  ₹{selectedOrder.total}
                </p>
              </div>

              <div
                className="p-3 border border-[var(--border-main)] bg-[var(--bg-surface-subtle)]"
                style={{ borderRadius: 0 }}
              >
                <p className="text-[10px] uppercase font-bold text-[var(--text-dim)]">Status</p>
                <div className="mt-1">
                  <Badge
                    variant={
                      String(selectedOrder.status || '').toLowerCase().includes('completed') ||
                      String(selectedOrder.status || '').toLowerCase().includes('delivered')
                        ? 'success'
                        : String(selectedOrder.status || '').toLowerCase().includes('cancelled') ||
                          String(selectedOrder.status || '').toLowerCase().includes('rejected')
                        ? 'error'
                        : String(selectedOrder.status || '').toLowerCase().includes('pending') ||
                          String(selectedOrder.status || '').toLowerCase() === 'placed'
                        ? 'warning'
                        : 'info'
                    }
                    size="xs"
                  >
                    {selectedOrder.status}
                  </Badge>
                </div>
              </div>

              <div
                className="p-3 border border-[var(--border-main)] bg-[var(--bg-surface-subtle)]"
                style={{ borderRadius: 0 }}
              >
                <p className="text-[10px] uppercase font-bold text-[var(--text-dim)]">Payment</p>
                <div className="mt-1">
                  <Badge
                    variant={selectedOrder.payment_method === 'COD' ? 'gold' : 'cyan'}
                    size="xs"
                  >
                    {selectedOrder.payment_method === 'COD' ? 'Cash on Delivery' : 'UPI Online'}
                  </Badge>
                </div>
              </div>

              <div
                className="p-3 border border-[var(--border-main)] bg-[var(--bg-surface-subtle)]"
                style={{ borderRadius: 0 }}
              >
                <p className="text-[10px] uppercase font-bold text-[var(--text-dim)]">Admin Share</p>
                <p className="text-base font-black text-emerald-600 dark:text-emerald-400 font-mono mt-0.5">
                  ₹10
                </p>
              </div>
            </div>

            {/* Customer & Shop Details */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div
                className="p-3.5 border border-[var(--border-main)] bg-[var(--bg-surface)]"
                style={{ borderRadius: 0 }}
              >
                <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-[var(--border-subtle)]">
                  <User className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <p className="font-bold text-[var(--text-heading)] uppercase tracking-wider text-[11px]">
                    Customer Information
                  </p>
                </div>
                <p className="font-bold text-[var(--text-heading)] text-sm">
                  {selectedOrder.student_name}
                </p>
                <p className="text-[var(--text-muted)] font-mono mt-1">
                  Phone: <span className="text-[var(--text-heading)] font-semibold">{selectedOrder.student_phone || '—'}</span>
                </p>
                <p className="text-[var(--text-muted)] mt-1">
                  Delivery Point: <span className="text-[var(--text-body)] font-medium">{selectedOrder.delivery_location || 'Campus Delivery'}</span>
                </p>
                {selectedOrder.delivery_slot && (
                  <p className="text-[var(--text-muted)] mt-0.5">
                    Slot: <span className="text-[var(--text-body)] font-medium">{selectedOrder.delivery_slot}</span>
                  </p>
                )}
              </div>

              <div
                className="p-3.5 border border-[var(--border-main)] bg-[var(--bg-surface)]"
                style={{ borderRadius: 0 }}
              >
                <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-[var(--border-subtle)]">
                  <Store className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <p className="font-bold text-[var(--text-heading)] uppercase tracking-wider text-[11px]">
                    Shop Information
                  </p>
                </div>
                <p className="font-bold text-[var(--text-heading)] text-sm">
                  {selectedOrder.shop_name}
                </p>
                <p className="text-[var(--text-muted)] font-mono mt-1">
                  Vendor Phone: <span className="text-[var(--text-heading)] font-semibold">{selectedOrder.shop_phone || '—'}</span>
                </p>
                <p className="text-[var(--text-muted)] mt-1">
                  Order Token: <span className="font-mono font-bold text-[var(--text-heading)]">#{selectedOrder.token}</span>
                </p>
              </div>
            </div>

            {/* Items Breakdown */}
            <div
              className="p-4 border border-[var(--border-main)] bg-[var(--bg-surface)]"
              style={{ borderRadius: 0 }}
            >
              <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-[var(--border-subtle)]">
                <div className="flex items-center gap-2">
                  <ShoppingBag className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <p className="font-bold text-[var(--text-heading)] uppercase tracking-wider text-[11px]">
                    Order Items
                  </p>
                </div>
                <Badge variant="default" size="xs">
                  {String(selectedOrder.items || '').split(',').filter(Boolean).length} items
                </Badge>
              </div>
              <div className="divide-y divide-[var(--border-subtle)] text-xs">
                {String(selectedOrder.items || '')
                  .split(',')
                  .map((item, idx) => (
                    <div key={idx} className="py-2 flex items-center justify-between">
                      <span className="font-medium text-[var(--text-heading)]">
                        {item.trim()}
                      </span>
                    </div>
                  ))}
              </div>
            </div>

            {/* Payment proof (UPI only) — inspected here, no separate page */}
            {!detailIsCod && (
              <div
                className="p-4 border border-[var(--border-main)] bg-[var(--bg-surface)]"
                style={{ borderRadius: 0 }}
              >
                <p className="font-bold text-[var(--text-heading)] uppercase tracking-wider text-[11px] mb-2">
                  UPI Payment Proof
                </p>
                {proofLoading ? (
                  <p className="text-xs text-[var(--text-muted)]">Loading proof…</p>
                ) : proof?.payment_screenshot_url || proof?.utr_number ? (
                  <div className="space-y-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[var(--text-muted)]">
                        UTR:{' '}
                        <span className="font-mono font-bold text-[var(--text-heading)]">
                          {proof.utr_number || '—'}
                        </span>
                      </span>
                      <Badge
                        variant={
                          detailProofStatus === 'PAYMENT_APPROVED'
                            ? 'success'
                            : detailProofStatus === 'PAYMENT_REJECTED'
                            ? 'error'
                            : detailProofStatus === 'PAYMENT_PROOF_SUBMITTED'
                            ? 'warning'
                            : 'default'
                        }
                        size="xs"
                      >
                        {detailProofStatus.replace(/_/g, ' ') || 'PENDING PAYMENT'}
                      </Badge>
                    </div>
                    {proof.payment_screenshot_url && (
                      <a
                        href={proof.payment_screenshot_url}
                        target="_blank"
                        rel="noreferrer"
                        title="Open full screenshot"
                      >
                        <img
                          src={proof.payment_screenshot_url}
                          alt="Payment screenshot"
                          className="max-h-64 w-full rounded border border-[var(--border-main)] object-contain bg-white"
                        />
                      </a>
                    )}
                    {proof.payment_rejection_reason && (
                      <p className="text-red-600 font-semibold">
                        Last rejection: {proof.payment_rejection_reason}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400 font-semibold">
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>
                      No UTR + screenshot submitted yet. This UPI order cannot be
                      confirmed until the student submits proof.
                    </span>
                  </p>
                )}
              </div>
            )}

            {/* Reject block — reason required, admin picks resubmit or cancel */}
            {detailActionable && (
              <div
                className={`p-4 border ${
                  actionErr && !rejectReason.trim()
                    ? 'border-red-500 bg-red-500/10 ring-1 ring-red-500/30'
                    : 'border-red-500/30 bg-red-500/5'
                }`}
                style={{ borderRadius: 0 }}
              >
                <div className="flex items-center justify-between mb-2">
                  <p className="font-bold text-[var(--text-heading)] uppercase tracking-wider text-[11px]">
                    Reject this order
                  </p>
                  {actionErr && !rejectReason.trim() && (
                    <span className="text-[11px] font-bold text-red-600 dark:text-red-400">
                      * Reason is required
                    </span>
                  )}
                </div>
                <label className="text-[11px] font-bold text-[var(--text-muted)]">
                  Reason (required — student sees this)
                </label>
                <input
                  type="text"
                  value={rejectReason}
                  onChange={(e) => {
                    setRejectReason(e.target.value)
                    if (actionErr) setActionErr('')
                  }}
                  placeholder={
                    detailIsCod
                      ? 'e.g. Kitchen closed — order cancelled'
                      : 'e.g. Screenshot is blurry — send a clearer one'
                  }
                  maxLength={500}
                  className={`mt-1 w-full border ${
                    actionErr && !rejectReason.trim()
                      ? 'border-red-500 ring-1 ring-red-500'
                      : 'border-[var(--border-main)]'
                  } bg-[var(--bg-input)] px-3 py-2 text-xs outline-none focus:border-red-500`}
                />
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {!detailIsCod && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleRejectOrder(selectedOrder.id, 'resubmit')}
                      disabled={rejecting || confirmingId === selectedOrder.id}
                      loading={rejecting}
                      icon={<RefreshCw className="w-3.5 h-3.5" />}
                      title="Reject proof — order stays open, student submits fresh UTR + screenshot"
                    >
                      Ask for Resubmit
                    </Button>
                  )}
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => handleRejectOrder(selectedOrder.id, 'cancel')}
                    disabled={rejecting || confirmingId === selectedOrder.id}
                    loading={rejecting}
                    icon={<XCircle className="w-3.5 h-3.5" />}
                    title="Reject & cancel — order closes, student is told why"
                  >
                    Reject & Cancel Order
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
