import { useEffect, useState, useCallback } from 'react'
import { Link, useParams } from 'react-router-dom'
import api from '../../services/api'

interface ProofDetail {
  order_id: string
  payment_id: string
  is_parent: boolean
  order_status: string
  payment_method: string
  amount: number
  proof_status: string
  utr_number?: string
  utr_saved: boolean
  payment_screenshot_url?: string
  payment_submitted_at: string
  payment_verified_at: string
  payment_verified_by: string
  payment_rejection_reason: string
  customer_name: string
  customer_phone: string
  customer_email: string
  owner_user_id: string
  order_token: string | number
  delivery_location: string
  created_at: string
  items_summary: string
}

/* Admin payment-verification page. Opened directly from the Telegram
 * "VIEW ORDER" button — the admin must still be logged in (RoleGate sends
 * anyone else to login); authentication is never bypassed. */
export function AdminOrderPage() {
  const { orderId = '' } = useParams()
  const [detail, setDetail] = useState<ProofDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [reason, setReason] = useState('')
  const [working, setWorking] = useState(false)

  const load = useCallback(() => {
    if (!orderId) return
    setError('')
    api.get(`/local/payments/proof/${orderId}`)
      .then(r => setDetail(r.data))
      .catch((err: any) => setError(err?.response?.data?.detail || 'Could not load this order'))
      .finally(() => setLoading(false))
  }, [orderId])

  useEffect(() => {
    load()
  }, [load])

  const decide = async (approved: boolean) => {
    const pid = detail?.payment_id || ''
    if (!pid) return
    if (approved && !window.confirm('Approve this payment? The order will be released for processing.')) return
    if (!approved) {
      if (!reason.trim()) {
        setError('A rejection reason is required so the student knows what to fix.')
        return
      }
      if (!window.confirm('Confirm rejection? The student can submit a fresh proof.')) return
    }
    setWorking(true)
    setError('')
    setMessage('')
    try {
      const r = await api.patch(`/local/payments/${pid}/verify`, {
        action: approved ? 'approve' : 'reject',
        reason: approved ? '' : reason.trim(),
      })
      setMessage(r.data?.message || (approved ? 'Payment approved.' : 'Payment rejected.'))
      load()
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Could not record the decision')
    } finally {
      setWorking(false)
    }
  }

  const proofStatus = detail?.proof_status || 'PENDING_PAYMENT'
  const decided = proofStatus === 'PAYMENT_APPROVED' || proofStatus === 'PAYMENT_REJECTED'

  if (loading) {
    return (
      <div className="min-h-screen bg-white">
        <div className="mx-auto max-w-3xl px-4 py-10 text-center text-sm text-gray-400">Loading order…</div>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="min-h-screen bg-white">
        <div className="mx-auto max-w-3xl px-4 py-10 text-center">
          {error && <p className="text-sm font-bold text-red-600">{error}</p>}
          <Link to="/admin-dashboard" className="mt-4 inline-block text-sm font-bold text-primary hover:underline">← Back to admin dashboard</Link>
        </div>
      </div>
    )
  }

  const submittedAt = detail.payment_submitted_at ? new Date(detail.payment_submitted_at).toLocaleString('en-IN') : '—'

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-3xl px-4 py-6">
        <Link to="/admin-dashboard" className="text-xs font-bold text-gray-500 hover:text-primary">← Back to admin dashboard</Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-black text-primary-dark">Order #{detail.order_token} · Payment Verification</h1>
          <span className="rounded-pill bg-gold-50 px-3 py-1 text-xs font-bold text-gold-dark">{proofStatus.replace(/_/g, ' ')}</span>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          {detail.is_parent ? 'Multi-shop bill · one UPI payment' : 'Single-shop order'} · placed {detail.created_at ? new Date(detail.created_at).toLocaleString('en-IN') : '—'}
        </p>

        {message && <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-700">{message}</p>}
        {error && <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-bold text-red-600">{error}</p>}

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <section className="rounded-btn border border-gray-200 bg-white p-5 shadow-card">
            <h2 className="text-sm font-black text-primary-dark">Customer & Order</h2>
            <dl className="mt-2 space-y-1.5 text-xs">
              <div className="flex justify-between gap-3"><dt className="text-gray-500">Customer</dt><dd className="font-bold">{detail.customer_name || '—'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-gray-500">User ID</dt><dd className="font-mono">{detail.owner_user_id || '—'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-gray-500">Phone</dt><dd className="font-bold">{detail.customer_phone || '—'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-gray-500">Email</dt><dd className="break-all">{detail.customer_email || '—'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-gray-500">Order ID</dt><dd className="font-mono">{detail.order_id}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-gray-500">Items</dt><dd className="max-w-[60%] text-right">{detail.items_summary || '—'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-gray-500">Total</dt><dd className="font-black text-primary">₹{detail.amount}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-gray-500">Location</dt><dd>{detail.delivery_location || '—'}</dd></div>
            </dl>
          </section>

          <section className="rounded-btn border border-gray-200 bg-white p-5 shadow-card">
            <h2 className="text-sm font-black text-primary-dark">Payment Information</h2>
            <dl className="mt-2 space-y-1.5 text-xs">
              <div className="flex justify-between gap-3"><dt className="text-gray-500">Method</dt><dd className="font-bold">UPI</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-gray-500">UTR / Transaction</dt><dd className="font-mono font-bold">{detail.utr_number || '—'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-gray-500">Submitted at</dt><dd>{submittedAt}</dd></div>
              {detail.payment_verified_by && (
                <div className="flex justify-between gap-3"><dt className="text-gray-500">Decided by</dt><dd>{detail.payment_verified_by}</dd></div>
              )}
              {detail.payment_rejection_reason && (
                <div className="flex justify-between gap-3"><dt className="text-gray-500">Rejection reason</dt><dd className="text-red-600">{detail.payment_rejection_reason}</dd></div>
              )}
            </dl>
            {detail.payment_screenshot_url ? (
              <a href={detail.payment_screenshot_url} target="_blank" rel="noreferrer" title="Open full screenshot">
                <img src={detail.payment_screenshot_url} alt="Payment screenshot" className="mt-3 max-h-96 w-full rounded-btn border border-gray-200 bg-white object-contain" />
              </a>
            ) : (
              <p className="mt-3 text-xs italic text-gray-400">No screenshot submitted yet.</p>
            )}
            <p className="mt-2 text-[11px] text-gray-500">⚠️ Never trust the UTR or screenshot alone — confirm the money arrived in the bank account before approving.</p>
          </section>
        </div>

        {!decided && detail.payment_screenshot_url ? (
          <section className="mt-4 rounded-btn border border-gray-200 bg-white p-5 shadow-card">
            <h2 className="text-sm font-black text-primary-dark">Verify payment</h2>
            <label className="mt-2 block text-[11px] font-bold text-gray-500">Rejection reason (required only when rejecting)</label>
            <input
              type="text"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g. Screenshot is blurry — send a clearer one"
              maxLength={500}
              className="mt-1 w-full rounded-btn border border-gray-200 px-3 py-2 text-xs outline-none focus:border-primary"
            />
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => void decide(true)}
                disabled={working}
                className="rounded-btn bg-primary px-5 py-2.5 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-50"
              >
                {working ? 'Working…' : '✓ Approve Payment'}
              </button>
              <button
                type="button"
                onClick={() => void decide(false)}
                disabled={working}
                className="rounded-btn border border-red-200 px-5 py-2.5 text-sm font-bold text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                ✕ Reject Payment
              </button>
            </div>
          </section>
        ) : decided ? (
          <p className="mt-4 text-xs text-gray-500">This proof is already decided ({proofStatus.replace(/_/g, ' ')}).</p>
        ) : (
          <p className="mt-4 text-xs italic text-gray-400">No proof submitted for this order yet — nothing to verify.</p>
        )}
      </div>
    </div>
  )
}
