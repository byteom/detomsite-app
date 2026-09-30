import { useState, useCallback } from 'react'
import api, { dedupeGet } from '../services/api'
import { usePolling } from '../hooks/usePolling'

/* Same message extraction the rest of the admin portal uses, so a failed
   Confirm shows the server's real reason ("already cancelled") instead of a
   generic "Request failed". */
function apiError(e: any, fb = 'Request failed') {
  const d = e?.response?.data?.detail
  if (typeof d === 'string' && d.trim()) return d
  if (Array.isArray(d)) {
    const msgs = d.map((x: any) => (x?.msg || x?.message)).filter(Boolean)
    if (msgs.length) return msgs.join(' - ')
  }
  const m = e?.response?.data?.message
  if (typeof m === 'string' && m.trim()) return m
  if (e?.userMessage) return e.userMessage as string
  return (e?.message as string) || fb
}

/** Renders a stored timestamp (UTC ISO from Supabase, IST wall-clock from SQLite). */
export function fmtDateTime(value: any) {
  const raw = String(value || '')
  if (!raw) return 'just now'
  let iso = raw
  if (!/T/.test(raw) && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(raw)) iso = raw.replace(' ', 'T') + '+05:30'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return raw.slice(0, 16)
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d)
}

/* ─── Order Approvals ───
   Every order the admin still has to confirm, newest first. This is the same
   queue the notification bell summarises, rendered as a working list so a busy
   service can be cleared order-by-order without opening the bell each time.

   One tap on Confirm:
     • marks the order Confirmed (visible in every portal at once),
     • fires the shopkeeper's WhatsApp confirmation automatically,
     • texts the student, and
     • settles the queue row so it can never be confirmed twice. */
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
      .catch(() => { /* keep the last known queue through a network blip */ })
      .finally(() => setLoading(false))
  }, [])

  // Visible-only polling that never overlaps a tick. 10 s here because this is
  // the one screen an admin genuinely watches during a service.
  const { pollNow } = usePolling(load, 10000, [])

  const confirm = async (row: any) => {
    if (!row?.order_id || busy) return
    setBusy(row.order_id)
    setMsg(''); setErr('')
    try {
      const r = await api.post(`/admin/orders/${row.order_id}/confirm`, { notification_id: row.notification_id })
      const d = r.data || {}
      setMsg(
        d.whatsapp_sent
          ? `${d.message} — the shop was notified on WhatsApp automatically.`
          : d.whatsapp_queued
            ? `${d.message} — the WhatsApp confirmation is queued in the WhatsApp Centre.`
            : d.message,
      )
      // Drop it locally right away so the row never lingers as "waiting".
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
      setMsg('Removed from the queue — the order itself is unchanged.')
    } catch (e: any) {
      setErr(apiError(e, 'Could not remove this from the queue'))
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-white">Order Approvals</h1>
        <p className="text-sm text-gray-400">
          Every new student order lands here and in your notification bell. Confirming marks the order
          {' '}<b className="text-gold">Confirmed</b>, sends the shopkeeper a WhatsApp message automatically,
          and lets the student download their payment QR to pay from their own UPI app.
        </p>
      </div>

      {msg && <div className="mb-4 rounded-btn border border-emerald-900/60 bg-emerald-900/20 px-4 py-3 text-sm font-semibold text-emerald-300">{msg}</div>}
      {err && <div className="mb-4 rounded-btn border border-red-900/60 bg-red-900/20 px-4 py-3 text-sm font-semibold text-red-300">{err}</div>}

      {loading ? <p className="py-8 text-center text-gray-500">Loading…</p> : queue.length === 0 ? (
        <div className="rounded-card border border-gray-800 bg-gray-900 p-10 text-center">
          <p className="text-4xl">✅</p>
          <p className="mt-3 text-gray-400">Nothing waiting for approval.</p>
          <p className="mt-1 text-sm text-gray-600">
            Every order has been confirmed. New ones appear here the moment a student places one.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {queue.map(row => (
            <div key={row.order_id} className="rounded-card border border-gold/30 bg-gray-900 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-lg font-black text-white">#{row.token}</span>
                    <span className="rounded-pill bg-gray-800 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-300">
                      {row.shop_name || 'Shop'}
                    </span>
                    <span className="rounded-pill bg-blue-900/40 px-2 py-0.5 text-[10px] font-bold uppercase text-blue-300">
                      {row.payment_method === 'COD' ? 'Cash on Delivery' : 'UPI'}
                    </span>
                    <span className="rounded-pill bg-amber-900/40 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-300">{row.status}</span>
                  </div>
                  <p className="mt-1.5 text-sm font-semibold text-gray-200">{row.student_name || 'A student'}</p>
                  {row.items && <p className="mt-0.5 text-sm text-gray-400">{row.items}</p>}
                  <p className="mt-1 text-xs text-gray-500">
                    {row.delivery_location ? `${row.delivery_location} · ` : ''}₹{row.total} · placed {fmtDateTime(row.created_at)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col gap-2">
                  <button onClick={() => confirm(row)} disabled={busy === row.order_id}
                    className="rounded-pill bg-gold px-5 py-2 text-sm font-black text-black transition-colors hover:bg-gold/80 disabled:opacity-50">
                    {busy === row.order_id ? 'Confirming…' : 'Confirm order'}
                  </button>
                  <button onClick={() => dismiss(row)} disabled={busy === row.order_id}
                    className="rounded-pill bg-gray-800 px-5 py-2 text-xs font-bold text-gray-400 hover:bg-gray-700 disabled:opacity-50">
                    Not now
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
