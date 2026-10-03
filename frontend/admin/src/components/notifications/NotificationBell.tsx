import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Bell, Check, ExternalLink } from 'lucide-react'
import api, { dedupeGet } from '../../services/api'
import { usePolling } from '../../hooks/usePolling'
import { apiError, fmtTime } from '../../utils/formatters'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'

export function NotificationBell() {
  const [notifs, setNotifs] = useState<any[]>([])
  const [open, setOpen] = useState(false)
  const [busyConfirm, setBusyConfirm] = useState<string>('')
  const [notifMsg, setNotifMsg] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const loadNotifs = useCallback(() => {
    if (document.visibilityState !== 'visible') return
    dedupeGet('/admin/notifications')
      .then((r: any) => setNotifs(r.data || []))
      .catch(() => {
        /* keep last known bell through a network blip */
      })
  }, [])

  const { pollNow: reloadNotifs } = usePolling(loadNotifs, 20000, [])

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])

  const confirmFromBell = async (n: any) => {
    if (!n?.order_id || busyConfirm) return
    setBusyConfirm(n.id)
    setNotifMsg('')
    try {
      const r = await api.post(`/admin/orders/${n.order_id}/confirm`, { notification_id: n.id })
      setNotifMsg(r.data?.message || 'Order confirmed successfully')
      setNotifs(list => list.map(x => (x.id === n.id ? { ...x, action_state: 'done' } : x)))
      reloadNotifs()
    } catch (e: any) {
      setNotifMsg(apiError(e, 'Could not confirm this order'))
    } finally {
      setBusyConfirm('')
    }
  }

  const pendingConfirmCount = notifs.filter(
    n => n?.action === 'confirm_order' && n?.action_state === 'pending' && n?.order_id
  ).length

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(p => !p)}
        className="relative p-2 text-gray-400 hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-admin-surface-darkHover transition-colors border border-transparent hover:border-gray-200 dark:hover:border-admin-border-dark"
        style={{ borderRadius: 0 }}
        aria-label="Notifications"
        title="Admin Notifications"
      >
        <Bell className="w-4 h-4" />
        {pendingConfirmCount > 0 ? (
          <span
            className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center bg-emerald-600 px-1 text-[10px] font-black text-white"
            style={{ borderRadius: 0 }}
          >
            {pendingConfirmCount}
          </span>
        ) : (
          notifs.length > 0 && (
            <span
              className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center bg-gray-600 dark:bg-gray-700 px-1 text-[10px] font-bold text-gray-200"
              style={{ borderRadius: 0 }}
            >
              {notifs.length}
            </span>
          )
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-80 sm:w-96 border border-gray-200 dark:border-admin-border-dark bg-white dark:bg-admin-surface-dark shadow-2xl z-50 overflow-hidden"
          style={{ borderRadius: 0 }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-admin-border-dark bg-gray-50 dark:bg-admin-surface-darkSubtle">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-gray-900 dark:text-white">
                Notifications
              </span>
              {notifs.length > 0 && (
                <Badge variant="neutral" size="xs">
                  {notifs.length}
                </Badge>
              )}
            </div>

            {pendingConfirmCount > 0 && (
              <Link
                to="/approvals"
                onClick={() => setOpen(false)}
                className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline"
              >
                {pendingConfirmCount} to confirm →
              </Link>
            )}
          </div>

          {notifMsg && (
            <div className="px-4 py-2 text-xs font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-b border-emerald-200 dark:border-emerald-800">
              {notifMsg}
            </div>
          )}

          {/* List */}
          <div className="max-h-80 overflow-y-auto divide-y divide-gray-100 dark:divide-admin-border-darkSubtle">
            {notifs.length === 0 ? (
              <div className="p-8 text-center text-xs text-gray-500">
                <Bell className="w-6 h-6 mx-auto mb-2 opacity-30" />
                No new notifications
              </div>
            ) : (
              notifs.map(n => {
                const actionable =
                  n.action === 'confirm_order' && n.action_state === 'pending' && n.order_id

                return (
                  <div
                    key={n.id}
                    className={`p-3.5 text-xs transition-colors ${
                      actionable
                        ? 'bg-emerald-50/40 dark:bg-emerald-950/20 border-l-2 border-emerald-600'
                        : 'hover:bg-gray-50 dark:hover:bg-admin-surface-darkHover'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-gray-900 dark:text-white">{n.title}</p>
                      {actionable && (
                        <Badge variant="success" size="xs">
                          Action Required
                        </Badge>
                      )}
                    </div>

                    <p className="mt-1 text-gray-600 dark:text-gray-400 leading-relaxed">
                      {n.message}
                    </p>

                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-[10px] text-gray-400">{fmtTime(n.created_at)}</span>

                      {actionable ? (
                        <div className="flex items-center gap-1.5">
                          <Button
                            variant="primary"
                            size="xs"
                            onClick={() => confirmFromBell(n)}
                            disabled={busyConfirm === n.id}
                            loading={busyConfirm === n.id}
                            icon={<Check className="w-3 h-3" />}
                          >
                            Confirm Order
                          </Button>
                          <Link
                            to="/orders"
                            onClick={() => setOpen(false)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
                            style={{ borderRadius: 0 }}
                          >
                            <ExternalLink className="w-3 h-3" />
                            View
                          </Link>
                        </div>
                      ) : (
                        n.order_id && (
                          <Link
                            to="/orders"
                            onClick={() => setOpen(false)}
                            className="text-[11px] text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1"
                          >
                            View Order <ExternalLink className="w-3 h-3" />
                          </Link>
                        )
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
