import React, { useState } from 'react'
import api from '../../services/api'
import {
  PAYMENT_PROOF_MAX_MB,
  PAYMENT_PROOF_TYPES,
} from '../../types'
import { AlertCircle, CheckCircle2, Receipt, Upload } from '../ui/Icons'

/* Manual UPI payment proof: UTR + screenshot, submitted as multipart to
 * POST /local/payments/proof. The order is NEVER marked paid here — it waits
 * for an admin to verify the money arrived. */
export function PaymentProofForm({
  orderId,
  onSubmitted,
}: {
  orderId: string
  onSubmitted: () => void
}) {
  const [utr, setUtr] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState('')
  const [err, setErr] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const pickFile = (f: File | undefined) => {
    setErr('')
    if (!f) return
    if (!PAYMENT_PROOF_TYPES.includes(f.type)) {
      setErr('Please choose a JPEG, PNG or WEBP screenshot.')
      return
    }
    if (f.size > PAYMENT_PROOF_MAX_MB * 1024 * 1024) {
      setErr(`Screenshot must be ${PAYMENT_PROOF_MAX_MB} MB or smaller.`)
      return
    }
    setFile(f)
    setPreview(URL.createObjectURL(f))
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    const ref = utr.trim().toUpperCase()
    // ASCII-only, like the server: Unicode look-alikes must never file one
    // bank reference twice under two spellings.
    if (!/^[A-Z0-9]{6,40}$/.test(ref)) {
      setErr('Enter the UTR / transaction number from your UPI app (letters and digits, 6–40 characters).')
      return
    }
    if (!file) {
      setErr('A payment screenshot is required.')
      return
    }
    setSubmitting(true)
    try {
      const form = new FormData()
      form.append('order_id', orderId)
      form.append('utr_number', ref)
      form.append('screenshot', file)
      await api.post('/local/payments/proof', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60000,
      })
      onSubmitted()
    } catch (e: any) {
      const status = e?.response?.status
      setErr(
        e?.response?.data?.detail ||
          (status === 413
            ? 'Screenshot is too large.'
            : status === 409
            ? 'This proof was already submitted.'
            : 'Could not submit the proof. Please try again.')
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="rounded-card border border-slate-200 bg-slate-50 p-4 space-y-3">
      <p className="font-bold text-xs text-slate-800 flex items-center gap-1.5">
        <Receipt className="h-4 w-4 text-emerald-700" />
        <span>Already paid? Submit payment proof</span>
      </p>
      <div>
        <label className="text-[11px] font-bold text-slate-500">
          UTR / Transaction number (from your UPI app)
        </label>
        <input
          type="text"
          value={utr}
          onChange={(e) => setUtr(e.target.value)}
          placeholder="12-digit UTR (e.g. 423456789012)"
          autoComplete="off"
          className="mt-1 w-full rounded-btn border border-slate-200 bg-white px-3 py-2 text-xs font-mono outline-none focus:border-emerald-600"
        />
      </div>
      <div>
        <label className="text-[11px] font-bold text-slate-500">
          Payment screenshot (JPEG / PNG / WEBP, max {PAYMENT_PROOF_MAX_MB} MB)
        </label>
        <label className="mt-1 flex cursor-pointer items-center justify-center gap-2 rounded-btn border-2 border-dashed border-slate-300 bg-white px-3 py-3 text-xs font-bold text-slate-600 hover:border-emerald-600 hover:text-emerald-700">
          <Upload className="h-4 w-4" />
          <span>{file ? file.name : 'Choose screenshot from gallery'}</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
        </label>
        {preview && (
          <img
            src={preview}
            alt="Payment screenshot preview"
            className="mt-2 max-h-48 rounded-btn border border-slate-200 object-contain"
          />
        )}
      </div>
      {err && (
        <p className="flex items-center gap-1.5 text-xs font-bold text-red-600">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{err}</span>
        </p>
      )}
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-btn bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        {submitting ? 'Submitting…' : 'Submit Payment Proof'}
      </button>
      <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
        <span>An admin verifies every proof by hand before the kitchen starts cooking.</span>
      </p>
    </form>
  )
}
