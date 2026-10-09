import React, { useState, FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { readUser, apiError, HELP_DESK_PHONE } from '../utils/helpers'
import api from '../services/api'
import {
  Phone,
  Send,
  LifeBuoy,
  CheckCircle2,
  AlertCircle,
  ChevronLeft,
  Clock,
  ShieldCheck,
} from '../components/ui/Icons'

export function SupportPage() {
  const user = readUser()
  const [f, setF] = useState({
    category: 'Order Issue',
    title: '',
    description: '',
  })
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    setMsg('')
    setLoading(true)
    try {
      await api.post('/local/tickets', {
        ...f,
        name: user.name || 'Student',
        email: user.email || '',
        phone_number: user.phone || '',
      })
      setMsg('Your support ticket was submitted successfully! Our campus desk will reach out.')
      setF({ category: 'Order Issue', title: '', description: '' })
    } catch (e: any) {
      setErr(apiError(e, 'Failed to submit support ticket.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8 space-y-6">
      <Link
        to="/shops"
        className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-emerald-700 transition-colors mb-2"
      >
        <ChevronLeft className="h-4 w-4" />
        <span>Back to Explore</span>
      </Link>

      <div>
        <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
          Help & Support Desk
        </h1>
        <p className="mt-1 text-xs sm:text-sm text-slate-500">
          We are here to assist with order issues, delivery questions, and payment verification.
        </p>
      </div>

      {/* Urgent Call Desk Card */}
      <div className="rounded-panel border border-emerald-200 bg-emerald-50/80 p-5 sm:p-6 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-btn bg-emerald-700 text-white shadow-sm">
            <Phone className="h-7 w-7" />
          </div>
          <div>
            <h3 className="font-extrabold text-base text-slate-900">
              Direct Phone Support
            </h3>
            <p className="text-xs text-slate-600 mt-0.5 max-w-sm">
              Need immediate help with a live order? Call our campus support team directly.
            </p>
          </div>
        </div>

        <a
          href={`tel:${HELP_DESK_PHONE}`}
          className="inline-flex items-center justify-center gap-2 rounded-btn bg-emerald-700 px-6 py-3 text-sm font-bold text-white shadow-sm hover:bg-emerald-800 transition-colors self-start sm:self-auto active:scale-95"
        >
          <Phone className="h-4 w-4" />
          <span>Call +91 63826 03607</span>
        </a>
      </div>

      {/* Support Ticket Submission */}
      <div className="rounded-panel border border-slate-200 bg-white p-6 sm:p-8 shadow-card space-y-4">
        <h3 className="text-lg font-bold text-slate-900 border-b border-slate-100 pb-3">
          Submit an Online Request
        </h3>

        {msg && (
          <div className="flex items-center gap-2 rounded-btn bg-emerald-50 border border-emerald-200 p-3.5 text-xs font-bold text-emerald-800">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{msg}</span>
          </div>
        )}

        {err && (
          <div className="flex items-center gap-2 rounded-btn bg-red-50 border border-red-200 p-3.5 text-xs font-bold text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{err}</span>
          </div>
        )}

        <form onSubmit={submit} className="space-y-4 text-xs">
          <div>
            <label className="block font-bold text-slate-700 mb-1.5">
              Topic / Category
            </label>
            <select
              value={f.category}
              onChange={(e) => setF({ ...f, category: e.target.value })}
              className="w-full rounded-btn border-2 border-slate-200 p-3 text-sm font-semibold outline-none focus:border-emerald-600"
            >
              <option>Order Issue</option>
              <option>Payment Verification</option>
              <option>Food Quality Feedback</option>
              <option>Account / Password Help</option>
              <option>Other Question</option>
            </select>
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1.5">
              Subject
            </label>
            <input
              type="text"
              value={f.title}
              onChange={(e) => setF({ ...f, title: e.target.value })}
              placeholder="e.g. Issue with Token #24"
              required
              className="w-full rounded-btn border-2 border-slate-200 p-3 text-sm font-semibold outline-none focus:border-emerald-600"
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1.5">
              Description
            </label>
            <textarea
              value={f.description}
              onChange={(e) => setF({ ...f, description: e.target.value })}
              rows={4}
              placeholder="Describe your issue with details (token number, kitchen name, order time)..."
              required
              className="w-full rounded-btn border-2 border-slate-200 p-3 text-sm font-semibold outline-none focus:border-emerald-600"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-btn bg-emerald-700 px-6 py-3.5 text-sm font-bold text-white shadow-modal hover:bg-emerald-800 transition-colors disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            <span>{loading ? 'Submitting...' : 'Submit Ticket'}</span>
          </button>
        </form>
      </div>
    </div>
  )
}
