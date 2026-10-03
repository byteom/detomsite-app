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
          <p className="font-semibold text-gray-900 dark:text-gray-100">{o.student_name}</p>
          {o.student_phone && (
            <p className="text-[11px] text-gray-400 font-mono">{o.student_phone}</p>
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
        <span className="font-mono font-bold text-gray-900 dark:text-white">
          ₹{o.total}
        </span>
      ),
    },
    {
      key: 'payment_method',
      header: 'Method',
      sortable: true,
      align: 'center',
      render: (o: any) => (
        <Badge variant={o.payment_method === 'COD' ? 'gold' : 'info'} size="xs">
          {o.payment_method || 'UPI'}
        </Badge>
      ),
    },
    {
      key: 'delivery_location',
      header: 'Location & Slot',
      render: (o: any) => (
        <div className="text-xs">
          <p className="text-gray-800 dark:text-gray-200">{o.delivery_location || 'Campus'}</p>
          {o.delivery_slot && <p className="text-[11px] text-gray-400">{o.delivery_slot}</p>}
        </div>
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
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (o: any) => (
        <div className="flex items-center justify-end gap-1.5">
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
            icon={<Eye className="w-3.5 h-3.5 text-gray-500" />}
          />
        </div>
      ),
    },
  ]

  const hasActiveFilters = fStatus !== 'all' || fMethod !== 'all' || Boolean(fDate)

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-200 dark:border-admin-border-dark pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">
              Orders Operations Desk
            </h1>
            <Badge variant="default" size="md">
              {filteredOrders.length} {filteredOrders.length === 1 ? 'Order' : 'Orders'}
            </Badge>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
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
          className="p-3.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-xs font-semibold text-emerald-800 dark:text-emerald-300"
          style={{ borderRadius: 0 }}
        >
          {actionMsg}
        </div>
      )}

      {actionErr && (
        <div
          className="p-3.5 bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-800 text-xs font-semibold text-red-800 dark:text-red-300"
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
              className="bg-white dark:bg-admin-surface-dark border border-gray-300 dark:border-admin-border-dark px-2.5 py-1.5 text-xs text-gray-800 dark:text-gray-200 outline-none focus:border-emerald-600"
              style={{ borderRadius: 0 }}
            >
              <option value="all">All Statuses</option>
              {statuses.map(s => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            <select
              value={fMethod}
              onChange={e => setFMethod(e.target.value)}
              className="bg-white dark:bg-admin-surface-dark border border-gray-300 dark:border-admin-border-dark px-2.5 py-1.5 text-xs text-gray-800 dark:text-gray-200 outline-none focus:border-emerald-600"
              style={{ borderRadius: 0 }}
            >
              <option value="all">All Payment Methods</option>
              <option value="UPI">UPI</option>
              <option value="COD">COD</option>
            </select>

            <input
              type="date"
              value={fDate}
              onChange={e => setFDate(e.target.value)}
              className="bg-white dark:bg-admin-surface-dark border border-gray-300 dark:border-admin-border-dark px-2.5 py-1 text-xs text-gray-800 dark:text-gray-200 outline-none focus:border-emerald-600"
              style={{ borderRadius: 0 }}
            />

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
                Clear Filters
              </Button>
            )}
          </div>
        }
        emptyTitle="No orders found"
        emptyDescription={
          hasActiveFilters
            ? 'No orders match your filter criteria. Try clearing filters to view all records.'
            : 'No orders have been recorded in the system yet.'
        }
      />

      {/* Order Detail Modal */}
      {selectedOrder && (
        <Modal
          open={Boolean(selectedOrder)}
          onClose={() => setSelectedOrder(null)}
          title={`Order #${selectedOrder.token} Details`}
          description={`Placed by ${selectedOrder.student_name} at ${fmtTime(selectedOrder.created_at)}`}
          maxWidth="lg"
          footer={
            <div className="flex items-center justify-between w-full">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleOpenWhatsApp(selectedOrder.id)}
                icon={<MessageSquare className="w-3.5 h-3.5 text-emerald-600" />}
              >
                Open Shop WhatsApp
              </Button>

              <div className="flex items-center gap-2">
                {['Pending Payment', 'Pending Acceptance', 'Pending', 'Placed', 'Accepted'].includes(
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
          <div className="space-y-4">
            {/* Meta stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div
                className="p-3 border border-gray-200 dark:border-admin-border-dark bg-gray-50/50 dark:bg-admin-surface-darkSubtle/40"
                style={{ borderRadius: 0 }}
              >
                <p className="text-[10px] uppercase font-bold text-gray-400">Total Amount</p>
                <p className="text-lg font-black text-gray-900 dark:text-white font-mono mt-0.5">
                  ₹{selectedOrder.total}
                </p>
              </div>

              <div
                className="p-3 border border-gray-200 dark:border-admin-border-dark bg-gray-50/50 dark:bg-admin-surface-darkSubtle/40"
                style={{ borderRadius: 0 }}
              >
                <p className="text-[10px] uppercase font-bold text-gray-400">Status</p>
                <div className="mt-1">
                  <Badge variant="default" size="xs">
                    {selectedOrder.status}
                  </Badge>
                </div>
              </div>

              <div
                className="p-3 border border-gray-200 dark:border-admin-border-dark bg-gray-50/50 dark:bg-admin-surface-darkSubtle/40"
                style={{ borderRadius: 0 }}
              >
                <p className="text-[10px] uppercase font-bold text-gray-400">Payment</p>
                <p className="text-xs font-bold text-gray-800 dark:text-gray-200 mt-1">
                  {selectedOrder.payment_method === 'COD' ? 'Cash on Delivery' : 'UPI Online'}
                </p>
              </div>

              <div
                className="p-3 border border-gray-200 dark:border-admin-border-dark bg-gray-50/50 dark:bg-admin-surface-darkSubtle/40"
                style={{ borderRadius: 0 }}
              >
                <p className="text-[10px] uppercase font-bold text-gray-400">Admin Share</p>
                <p className="text-base font-black text-emerald-600 dark:text-emerald-400 font-mono mt-0.5">
                  ₹10
                </p>
              </div>
            </div>

            {/* Customer & Shop Details */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div
                className="p-3 border border-gray-200 dark:border-admin-border-dark bg-white dark:bg-admin-surface-dark"
                style={{ borderRadius: 0 }}
              >
                <p className="font-bold text-gray-900 dark:text-white uppercase tracking-wider text-[11px] mb-2">
                  Customer Information
                </p>
                <p className="font-semibold text-gray-800 dark:text-gray-200">
                  {selectedOrder.student_name}
                </p>
                <p className="text-gray-500 font-mono mt-0.5">
                  Phone: {selectedOrder.student_phone || '—'}
                </p>
                <p className="text-gray-500 mt-1">
                  Delivery Point: {selectedOrder.delivery_location || 'Campus Delivery'}
                </p>
                {selectedOrder.delivery_slot && (
                  <p className="text-gray-500">Slot: {selectedOrder.delivery_slot}</p>
                )}
              </div>

              <div
                className="p-3 border border-gray-200 dark:border-admin-border-dark bg-white dark:bg-admin-surface-dark"
                style={{ borderRadius: 0 }}
              >
                <p className="font-bold text-gray-900 dark:text-white uppercase tracking-wider text-[11px] mb-2">
                  Shop Information
                </p>
                <p className="font-semibold text-gray-800 dark:text-gray-200">
                  {selectedOrder.shop_name}
                </p>
                <p className="text-gray-500 font-mono mt-0.5">
                  Vendor Phone: {selectedOrder.shop_phone || '—'}
                </p>
                <p className="text-gray-500 mt-1">Order Token: #{selectedOrder.token}</p>
              </div>
            </div>

            {/* Items Breakdown */}
            <div
              className="p-4 border border-gray-200 dark:border-admin-border-dark bg-white dark:bg-admin-surface-dark"
              style={{ borderRadius: 0 }}
            >
              <p className="font-bold text-gray-900 dark:text-white uppercase tracking-wider text-[11px] mb-2">
                Order Items
              </p>
              <div className="divide-y divide-gray-100 dark:divide-admin-border-darkSubtle text-xs">
                {String(selectedOrder.items || '')
                  .split(',')
                  .map((item, idx) => (
                    <div key={idx} className="py-2 flex items-center justify-between">
                      <span className="font-medium text-gray-800 dark:text-gray-200">
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
