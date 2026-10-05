import React, { useState, useEffect } from 'react'
import { CheckSquare, Clock, Check, X, Store, AlertCircle, RefreshCw } from 'lucide-react'
import api from '../services/api'
import { apiError, fmtTime } from '../utils/formatters'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Card } from '../components/ui/Card'

export default function ApprovalsPage() {
  const [queue, setQueue] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const load = () => {
    setLoading(true)
    api
      .get('/admin/notifications')
      .then(r => {
        const list = r.data || []
        const pending = list
          .filter(
            (n: any) =>
              n?.action === 'confirm_order' && n?.action_state === 'pending' && n?.order_id
          )
          .map((n: any) => {
            let meta: any = {}
            try {
              meta = JSON.parse(n.metadata || '{}')
            } catch {}
            return {
              notif_id: n.id,
              order_id: n.order_id,
              created_at: n.created_at,
              token: meta.token || '?',
              shop_name: meta.shop_name || 'Campus Kitchen',
              student_name: meta.student_name || 'Student',
              student_phone: meta.student_phone || '',
              total: meta.total || 0,
              items: meta.items || '',
              payment_method: meta.payment_method || 'UPI',
              delivery_location: meta.delivery_location || '',
              status: meta.status || 'Pending',
            }
          })
        setQueue(pending)
      })
      .catch(e => setErr(apiError(e, 'Failed to fetch pending approval queue')))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  const confirm = async (row: any) => {
    setBusy(row.order_id)
    setMsg('')
    setErr('')
    try {
      await api.post(`/admin/orders/${row.order_id}/confirm`)
      setQueue(q => q.filter(x => x.order_id !== row.order_id))
      setMsg(`Order #${row.token} confirmed successfully!`)
    } catch (e: any) {
      setErr(apiError(e, 'Could not confirm this order'))
    } finally {
      setBusy(null)
    }
  }

  const dismiss = async (row: any) => {
    setBusy(row.order_id)
    try {
      await api.patch(`/admin/notifications/${row.notif_id}/dismiss`)
      setQueue(q => q.filter(x => x.order_id !== row.order_id))
    } catch (e: any) {
      setErr(apiError(e, 'Could not dismiss notification'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6 text-[var(--text-body)]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--border-main)] pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-black text-[var(--text-heading)] tracking-tight">
              Order Approvals Queue
            </h1>
            {queue.length > 0 && (
              <Badge variant="gold" size="md">
                {queue.length} Pending
              </Badge>
            )}
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
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
          className="p-3.5 bg-emerald-500/10 border border-emerald-500/30 text-xs font-semibold text-emerald-800 dark:text-emerald-300"
          style={{ borderRadius: 0 }}
        >
          {msg}
        </div>
      )}

      {err && (
        <div
          className="p-3.5 bg-red-500/10 border border-red-500/30 text-xs font-semibold text-red-800 dark:text-red-300"
          style={{ borderRadius: 0 }}
        >
          {err}
        </div>
      )}

      {/* Queue Listing */}
      {loading ? (
        <div className="p-12 text-center text-xs text-[var(--text-muted)]">
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
          <h3 className="text-base font-bold text-[var(--text-heading)]">
            Queue is All Cleared
          </h3>
          <p className="mt-1 text-xs text-[var(--text-muted)] max-w-sm mx-auto">
            Every incoming order has been confirmed. New orders will appear here immediately as
            students place them.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {queue.map(row => (
            <div
              key={row.order_id}
              className="border border-emerald-600/40 bg-[var(--bg-surface)] p-4 shadow-xs hover:border-emerald-600 transition-colors"
              style={{ borderRadius: 0 }}
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                {/* Details */}
                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-base font-black text-[var(--text-heading)]">
                      #{row.token}
                    </span>
                    <Badge variant="default" size="xs">
                      {row.shop_name || 'Campus Kitchen'}
                    </Badge>
                    <Badge variant={row.payment_method === 'COD' ? 'gold' : 'cyan'} size="xs">
                      {row.payment_method === 'COD' ? 'Cash on Delivery' : 'UPI Payment'}
                    </Badge>
                    <Badge variant="warning" size="xs">
                      {row.status || 'Pending'}
                    </Badge>
                  </div>

                  <div>
                    <span className="text-sm font-bold text-[var(--text-heading)]">
                      {row.student_name || 'Student'}
                    </span>
                    {row.student_phone && (
                      <span className="ml-2 text-xs text-[var(--text-muted)] font-mono">
                        ({row.student_phone})
                      </span>
                    )}
                  </div>

                  {row.items && (
                    <div className="text-xs text-[var(--text-muted)] font-medium">
                      Items: <span className="text-[var(--text-heading)]">{row.items}</span>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--text-muted)] pt-1">
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
