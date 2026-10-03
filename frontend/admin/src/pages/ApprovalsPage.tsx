import React, { useState, useCallback } from 'react'
import { Check, X, Clock, ShoppingBag, AlertCircle, RefreshCw } from 'lucide-react'
import api, { dedupeGet } from '../services/api'
import { usePolling } from '../hooks/usePolling'
import { apiError, fmtTime } from '../utils/formatters'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Card } from '../components/ui/Card'

export default function ApprovalsPage() {
  const [queue, setQueue] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string>('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const load = useCallback(() => {
    if (document.visibilityState !== 'visible') return
    return dedupeGet('/admin/order-confirmations')
      .then((r: any) => setQueue(Array.isArray(r.data) ? r.data : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const { pollNow } = usePolling(load, 10000, [])

  const confirm = async (row: any) => {
    if (!row?.order_id || busy) return
    setBusy(row.order_id)
    setMsg('')
    setErr('')
    try {
      const r = await api.post(`/admin/orders/${row.order_id}/confirm`, {
        notification_id: row.notification_id,
      })
      const d = r.data || {}
      setMsg(
        d.whatsapp_sent
          ? `${d.message} — the shop was notified on WhatsApp automatically.`
          : d.whatsapp_queued
          ? `${d.message} — the WhatsApp confirmation is queued in the WhatsApp Center.`
          : d.message || 'Order confirmed'
      )
      setQueue(q => q.filter(x => x.order_id !== row.order_id))
      pollNow()
    } catch (e: any) {
      setErr(apiError(e, 'Could not confirm this order'))
    } finally {
      setBusy('')
    }
  }

  const dismiss = async (row: any) => {
    if (!row?.notification_id || busy) return
    setBusy(row.order_id)
    setErr('')
    try {
      await api.post(`/admin/order-confirmations/${row.notification_id}/dismiss`)
      setQueue(q => q.filter(x => x.notification_id !== row.notification_id))
      setMsg('Removed from queue — the order itself remains unchanged.')
    } catch (e: any) {
      setErr(apiError(e, 'Could not remove this item from the queue'))
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-200 dark:border-admin-border-dark pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">
              Order Approvals Queue
            </h1>
            {queue.length > 0 && (
              <Badge variant="gold" size="md">
                {queue.length} Pending
              </Badge>
            )}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Incoming student orders requiring administrator confirmation before dispatch
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setLoading(true)
              load()
            }}
            icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
          >
            Refresh Queue
          </Button>
        </div>
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

      {err && (
        <div
          className="p-3.5 bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-800 text-xs font-semibold text-red-800 dark:text-red-300"
          style={{ borderRadius: 0 }}
        >
          {err}
        </div>
      )}

      {/* Queue Listing */}
      {loading ? (
        <div className="p-12 text-center text-xs text-gray-500">
          <Clock className="w-8 h-8 mx-auto mb-2 animate-spin text-emerald-600 opacity-60" />
          Loading approvals queue...
        </div>
      ) : queue.length === 0 ? (
        <Card className="text-center py-12">
          <div
            className="w-12 h-12 mx-auto flex items-center justify-center bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 mb-3 border border-emerald-500/20"
            style={{ borderRadius: 0 }}
          >
            <Check className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-gray-900 dark:text-white">
            Queue is All Cleared
          </h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
            Every incoming order has been confirmed. New orders will appear here immediately as
            students place them.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {queue.map(row => (
            <div
              key={row.order_id}
              className="border border-emerald-500/40 dark:border-emerald-700/50 bg-white dark:bg-admin-surface-dark p-4 shadow-xs hover:border-emerald-600 transition-colors"
              style={{ borderRadius: 0 }}
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                {/* Details */}
                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-base font-black text-gray-900 dark:text-white">
                      #{row.token}
                    </span>
                    <Badge variant="default" size="xs">
                      {row.shop_name || 'Campus Kitchen'}
                    </Badge>
                    <Badge variant={row.payment_method === 'COD' ? 'gold' : 'info'} size="xs">
                      {row.payment_method === 'COD' ? 'Cash on Delivery' : 'UPI Payment'}
                    </Badge>
                    <Badge variant="warning" size="xs">
                      {row.status || 'Pending'}
                    </Badge>
                  </div>

                  <div>
                    <span className="text-sm font-bold text-gray-900 dark:text-gray-100">
                      {row.student_name || 'Student'}
                    </span>
                    {row.student_phone && (
                      <span className="ml-2 text-xs text-gray-500 font-mono">
                        ({row.student_phone})
                      </span>
                    )}
                  </div>

                  {row.items && (
                    <div className="text-xs text-gray-600 dark:text-gray-400 font-medium">
                      Items: <span className="text-gray-800 dark:text-gray-200">{row.items}</span>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500 dark:text-gray-400 pt-1">
                    {row.delivery_location && <span>📍 {row.delivery_location}</span>}
                    <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                      ₹{row.total}
                    </span>
                    <span>·</span>
                    <span>Placed {fmtTime(row.created_at)}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex sm:flex-col gap-2 shrink-0">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => confirm(row)}
                    disabled={busy === row.order_id}
                    loading={busy === row.order_id}
                    icon={<Check className="w-3.5 h-3.5" />}
                  >
                    Confirm Order
                  </Button>

                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => dismiss(row)}
                    disabled={busy === row.order_id}
                    icon={<X className="w-3.5 h-3.5" />}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
