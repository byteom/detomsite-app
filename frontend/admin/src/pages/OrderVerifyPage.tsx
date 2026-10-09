import React, { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  CheckCircle,
  XCircle,
  ArrowLeft,
  RefreshCw,
  ShieldAlert,
  Receipt,
  User,
  Phone,
  Mail,
} from 'lucide-react'
import api from '../services/api'
import { apiError, fmtTime, fmtCurrency } from '../utils/formatters'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'

/* DEPRECATED — verification now lives in the OrdersPage detail modal
 * (Verify & Confirm / Reject with resubmit-or-cancel). This file is kept for
 * reference only and is no longer routed (`/orders/:orderId` redirects to
 * `/orders`). Do not link to it from new UI. */
export function OrderVerifyPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const [detail, setDetail] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [reason, setReason] = useState('')
  const [working, setWorking] = useState(false)

  const load = useCallback(() => {
    if (!orderId) return
    setErr('')
    api
      .get(`/local/payments/proof/${orderId}`)
      .then((r) => setDetail(r.data))
      .catch((e: any) => setErr(apiError(e, 'Could not load this order')))
      .finally(() => setLoading(false))
  }, [orderId])

  useEffect(() => {
    load()
  }, [load])

  const paymentId = detail?.is_parent
    ? detail?.order_id
    : detail?.payment_id || detail?.order_id

  const decide = async (approved: boolean) => {
    if (!paymentId) return
    if (approved && !window.confirm('Approve this payment? The order will be released for processing.')) return
    if (!approved) {
      if (!reason.trim()) {
        setErr('A rejection reason is required so the student knows what to fix.')
        return
      }
      if (!window.confirm('Reject this payment? The student will be asked to submit a fresh proof.')) return
    }
    setWorking(true)
    setErr('')
    setMsg('')
    try {
      const r = await api.patch(`/local/payments/${paymentId}/verify`, {
        action: approved ? 'approve' : 'reject',
        reason: approved ? '' : reason.trim(),
      })
      setMsg(r.data?.message || (approved ? 'Payment approved.' : 'Payment rejected.'))
      load()
    } catch (e: any) {
      setErr(apiError(e, 'Could not record the decision'))
    } finally {
      setWorking(false)
    }
  }

  const proofStatus: string = detail?.proof_status || 'PENDING_PAYMENT'
  const decided = proofStatus === 'PAYMENT_APPROVED' || proofStatus === 'PAYMENT_REJECTED'

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-44 animate-pulse bg-[var(--bg-surface-subtle)]" />
        <p className="text-xs text-[var(--text-muted)]">Loading order…</p>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="space-y-4">
        {err && <p className="text-xs font-bold text-red-600">{err}</p>}
        <Link to="/orders" className="text-xs font-bold text-emerald-700 hover:underline">
          ← Back to orders
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-5 text-[var(--text-body)]">
      <Link
        to="/orders"
        className="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--text-muted)] hover:text-emerald-700"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        <span>Back to orders</span>
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-main)] pb-4">
        <div>
          <h1 className="text-2xl font-black text-[var(--text-heading)] tracking-tight">
            Order #{detail.order_token} · Payment Verification
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {detail.is_parent ? 'Multi-shop bill · one UPI payment' : 'Single-shop order'} · placed {fmtTime(detail.created_at)}
          </p>
        </div>
        <Badge
          variant={
            proofStatus === 'PAYMENT_APPROVED'
              ? 'success'
              : proofStatus === 'PAYMENT_REJECTED'
              ? 'error'
              : proofStatus === 'PAYMENT_PROOF_SUBMITTED'
              ? 'gold'
              : 'default'
          }
        >
          {proofStatus.replace(/_/g, ' ')}
        </Badge>
      </div>

      {msg && (
        <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/30 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
          {msg}
        </div>
      )}
      {err && (
        <div className="p-3.5 bg-red-500/10 border border-red-500/30 text-xs font-semibold text-red-800 dark:text-red-300">
          {err}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Customer + order */}
        <section className="border border-[var(--border-main)] bg-[var(--bg-surface)] p-5 space-y-3">
          <h2 className="text-sm font-black text-[var(--text-heading)] flex items-center gap-2">
            <User className="w-4 h-4" /> Customer & Order
          </h2>
          <dl className="space-y-1.5 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--text-muted)]">Customer</dt>
              <dd className="font-bold text-right">{detail.customer_name || '—'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--text-muted)]">User ID</dt>
              <dd className="font-mono text-right">{detail.owner_user_id || '—'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--text-muted)] flex items-center gap-1"><Phone className="w-3 h-3" /> Phone</dt>
              <dd className="font-bold text-right">{detail.customer_phone || '—'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--text-muted)] flex items-center gap-1"><Mail className="w-3 h-3" /> Email</dt>
              <dd className="text-right break-all">{detail.customer_email || '—'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--text-muted)]">Order ID</dt>
              <dd className="font-mono text-right">{detail.order_id}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--text-muted)]">Items</dt>
              <dd className="text-right max-w-[60%]">{detail.items_summary || '—'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--text-muted)]">Total</dt>
              <dd className="font-black text-emerald-700 dark:text-emerald-400">
                {fmtCurrency(detail.amount || 0)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--text-muted)]">Location</dt>
              <dd className="text-right">{detail.delivery_location || '—'}</dd>
            </div>
          </dl>
        </section>

        {/* Payment proof */}
        <section className="border border-[var(--border-main)] bg-[var(--bg-surface)] p-5 space-y-3">
          <h2 className="text-sm font-black text-[var(--text-heading)] flex items-center gap-2">
            <Receipt className="w-4 h-4" /> Payment Information
          </h2>
          <dl className="space-y-1.5 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--text-muted)]">Method</dt>
              <dd className="font-bold">UPI</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--text-muted)]">UTR / Transaction</dt>
              <dd className="font-mono font-bold text-right">{detail.utr_number || '—'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--text-muted)]">Submitted at</dt>
              <dd className="text-right">{detail.payment_submitted_at ? fmtTime(detail.payment_submitted_at) : '—'}</dd>
            </div>
            {detail.payment_verified_by && (
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--text-muted)]">Decided by</dt>
                <dd className="text-right">{detail.payment_verified_by} · {fmtTime(detail.payment_verified_at)}</dd>
              </div>
            )}
            {detail.payment_rejection_reason && (
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--text-muted)]">Rejection reason</dt>
                <dd className="text-right text-red-600">{detail.payment_rejection_reason}</dd>
              </div>
            )}
          </dl>
          {detail.payment_screenshot_url ? (
            <a href={detail.payment_screenshot_url} target="_blank" rel="noreferrer" title="Open full screenshot">
              <img
                src={detail.payment_screenshot_url}
                alt="Payment screenshot"
                className="mt-2 max-h-96 w-full rounded border border-[var(--border-main)] object-contain bg-white"
              />
            </a>
          ) : (
            <p className="text-xs text-[var(--text-muted)] italic">No screenshot submitted yet.</p>
          )}
          <p className="flex items-start gap-1.5 text-[11px] text-[var(--text-muted)]">
            <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>Never trust the UTR or screenshot alone — confirm the money arrived in the bank account before approving.</span>
          </p>
        </section>
      </div>

      {/* Actions */}
      {!decided && detail.payment_screenshot_url ? (
        <section className="border border-[var(--border-main)] bg-[var(--bg-surface)] p-5 space-y-3">
          <h2 className="text-sm font-black text-[var(--text-heading)]">Verify payment</h2>
          <div>
            <label className="text-[11px] font-bold text-[var(--text-muted)]">
              Rejection reason (required only when rejecting)
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Screenshot is blurry — send a clearer one"
              maxLength={500}
              className="mt-1 w-full border border-[var(--border-main)] bg-[var(--bg-input)] px-3 py-2 text-xs outline-none focus:border-emerald-600"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              onClick={() => decide(true)}
              disabled={working}
              icon={<CheckCircle className="w-4 h-4" />}
            >
              {working ? 'Working…' : '✓ Approve Payment'}
            </Button>
            <Button
              variant="danger"
              onClick={() => decide(false)}
              disabled={working}
              icon={<XCircle className="w-4 h-4" />}
            >
              ✕ Reject Payment
            </Button>
            <Button variant="secondary" onClick={load} icon={<RefreshCw className="w-3.5 h-3.5" />}>
              Reload
            </Button>
          </div>
        </section>
      ) : decided ? (
        <p className="text-xs text-[var(--text-muted)]">
          This proof is already decided ({proofStatus.replace(/_/g, ' ')}). {detail.payment_verified_by && <>by {detail.payment_verified_by} · </>} {detail.payment_verified_at && fmtTime(detail.payment_verified_at)}
        </p>
      ) : (
        <p className="text-xs text-[var(--text-muted)] italic">No proof submitted for this order yet — nothing to verify.</p>
      )}
    </div>
  )
}
