import React, { useState, useRef, useCallback } from 'react'
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
      width: '90px',
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
      render: (o: any) => (
        <span className="font-semibold text-[var(--text-body)]">{o.shop_name}</span>
      ),
    },
    {
      key: 'student_name',
      header: 'Customer',
      sortable: true,
      render: (o: any) => (
        <div>
          <p className="font-semibold text-[var(--text-heading)]">{o.student_name}</p>
          {o.student_phone && (
            <p className="text-[11px] text-[var(--text-muted)] font-mono">{o.student_phone}</p>
          )}
        </div>
      ),
    },
    {
      key: 'items',
      header: 'Items Ordered',
      render: (o: any) => <OrderItemsCell items={o.items} />,
    },
    {
      key: 'total',
      header: 'Total',
      sortable: true,
      align: 'right',
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
      render: (o: any) => (
        <div className="text-xs">
          <p className="text-[var(--text-body)] font-medium">{o.delivery_location || 'Campus'}</p>
          {o.delivery_slot && <p className="text-[11px] text-[var(--text-muted)] font-mono">{o.delivery_slot}</p>}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
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
        return <Badge variant={variant}>{s}</Badge>
      },
    },
    {
      key: 'created_at',
      header: 'Placed',
      sortable: true,
      render: (o: any) => (
        <span className="text-[var(--text-muted)] whitespace-nowrap">
          {fmtTime(o.created_at)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (o: any) => (
        <div className="flex items-center justify-end gap-1.5">
          {(o.payment_method || 'UPI').toUpperCase() !== 'COD' && (
            <a
              href={`/orders/${o.id}`}
              title="Open payment verification"
              className="inline-flex items-center gap-1 border border-emerald-600/40 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300 px-2 py-1 text-[11px] font-bold hover:bg-emerald-100"
            >
              Verify
            </a>
          )}
          {['Pending Payment', 'Pending Acceptance', 'Pending', 'Placed', 'Accepted'].includes(
            o.status
          ) && (
            <Button
              variant="primary"
              size="xs"
              onClick={() => handleConfirmOrder(o.id)}
              disabled={confirmingId === o.id}
              loading={confirmingId === o.id}
              title="Confirm this order"
            >
              Confirm
            </Button>
          )}

          <Button
            variant="secondary"
            size="xs"
            onClick={() => handleOpenWhatsApp(o.id)}
            title="Dispatch order details to shopkeeper via WhatsApp"
            icon={<MessageSquare className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />}
          >
            WA
          </Button>

          <Button
            variant="ghost"
            size="xs"
            onClick={() => setSelectedOrder(o)}
            title="Inspect full order details"
            icon={<Eye className="w-3.5 h-3.5 text-[var(--text-dim)]" />}
          />
        </div>
      ),
    },
  ]

  const hasActiveFilters = fStatus !== 'all' || fMethod !== 'all' || Boolean(fDate)

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
            Live order tracking, customer information, status management, and WhatsApp dispatch
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

      {/* Action Messages */}
      {actionMsg && (
        <div
          className="p-3.5 bg-emerald-500/10 border border-emerald-500/30 text-xs font-semibold text-emerald-800 dark:text-emerald-300"
          style={{ borderRadius: 0 }}
        >
          {actionMsg}
        </div>
      )}

      {actionErr && (
        <div
          className="p-3.5 bg-red-500/10 border border-red-500/30 text-xs font-semibold text-red-800 dark:text-red-300"
          style={{ borderRadius: 0 }}
        >
          {actionErr}
        </div>
      )}

      {/* Main Table */}
      <DataTable
        columns={columns}
        data={filteredOrders}
        loading={loading}
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

      {/* Order Detail Modal */}
      {selectedOrder && (
        <Modal
          open={Boolean(selectedOrder)}
          onClose={() => setSelectedOrder(null)}
          title={`Order #${selectedOrder.token} Breakdown`}
          description={`Placed on ${fmtTime(selectedOrder.created_at)}`}
          maxWidth="lg"
          footer={
            <div className="flex items-center justify-between w-full">
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

              <div className="flex items-center gap-2">
                {['Pending Payment', 'Pending Acceptance', 'Pending', 'Placed'].includes(
                  selectedOrder.status
                ) && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleConfirmOrder(selectedOrder.id)}
                    loading={confirmingId === selectedOrder.id}
                    icon={<Check className="w-3.5 h-3.5" />}
                  >
                    Confirm Order
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => setSelectedOrder(null)}>
                  Close
                </Button>
              </div>
            </div>
          }
        >
          <div className="space-y-4 text-[var(--text-body)]">
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
                className="p-3 border border-[var(--border-main)] bg-[var(--bg-surface)]"
                style={{ borderRadius: 0 }}
              >
                <p className="font-bold text-[var(--text-heading)] uppercase tracking-wider text-[11px] mb-2">
                  Customer Information
                </p>
                <p className="font-semibold text-[var(--text-heading)]">
                  {selectedOrder.student_name}
                </p>
                <p className="text-[var(--text-muted)] font-mono mt-0.5">
                  Phone: {selectedOrder.student_phone || '—'}
                </p>
                <p className="text-[var(--text-muted)] mt-1">
                  Delivery Point: {selectedOrder.delivery_location || 'Campus Delivery'}
                </p>
                {selectedOrder.delivery_slot && (
                  <p className="text-[var(--text-muted)]">Slot: {selectedOrder.delivery_slot}</p>
                )}
              </div>

              <div
                className="p-3 border border-[var(--border-main)] bg-[var(--bg-surface)]"
                style={{ borderRadius: 0 }}
              >
                <p className="font-bold text-[var(--text-heading)] uppercase tracking-wider text-[11px] mb-2">
                  Shop Information
                </p>
                <p className="font-semibold text-[var(--text-heading)]">
                  {selectedOrder.shop_name}
                </p>
                <p className="text-[var(--text-muted)] font-mono mt-0.5">
                  Vendor Phone: {selectedOrder.shop_phone || '—'}
                </p>
                <p className="text-[var(--text-muted)] mt-1">Order Token: #{selectedOrder.token}</p>
              </div>
            </div>

            {/* Items Breakdown */}
            <div
              className="p-4 border border-[var(--border-main)] bg-[var(--bg-surface)]"
              style={{ borderRadius: 0 }}
            >
              <p className="font-bold text-[var(--text-heading)] uppercase tracking-wider text-[11px] mb-2">
                Order Items
              </p>
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
          </div>
        </Modal>
      )}
    </div>
  )
}
