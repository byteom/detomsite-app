import React, { useState, FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ShieldCheck, ArrowLeft, KeyRound, CheckCircle2 } from 'lucide-react'
import api from '../services/api'
import { apiError } from '../utils/formatters'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'

export function ForgotPasswordPage() {
  const [step, setStep] = useState<'request' | 'otp'>('request')
  const [identifier, setIdentifier] = useState('')
  const [otp, setOtp] = useState('')
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)

  const friendlyError = (err: any, fallback: string) => {
    if (err?.response?.status === 503) {
      return 'We could not send the reset email right now. Please try again shortly — or contact the server admin.'
    }
    return apiError(err, fallback)
  }

  const requestOtp = async (e?: FormEvent) => {
    e?.preventDefault()
    setErr('')
    setInfo('')
    if (!identifier.trim()) {
      setErr('Enter your admin username or email.')
      return
    }
    setLoading(true)
    try {
      const res = await api.post('/admin/forgot-password', { identifier: identifier.trim() })
      setInfo(res.data?.message || 'A 4-digit recovery code was sent to your registered address.')
      setStep('otp')
    } catch (err: any) {
      setErr(friendlyError(err, 'Request failed. Please verify your username or email.'))
    } finally {
      setLoading(false)
    }
  }

  const resetPw = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    setInfo('')
    if (pw !== confirm) {
      setErr('Passwords do not match')
      return
    }
    if (pw.length < 8) {
      setErr('Password must be at least 8 characters')
      return
    }
    if (otp.trim().length < 4) {
      setErr('Enter the 4-digit code sent to your email.')
      return
    }
    setLoading(true)
    try {
      await api.post('/admin/reset-password', { identifier: identifier.trim(), otp: otp.trim(), new_password: pw })
      setDone(true)
    } catch (err: any) {
      setErr(friendlyError(err, 'Password reset failed. Invalid or expired code.'))
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg-page)] text-[var(--text-body)]">
        <div
          className="w-full max-w-md border border-[var(--border-main)] bg-[var(--bg-surface)] p-8 text-center"
          style={{ borderRadius: 0 }}
        >
          <div
            className="mx-auto flex h-12 w-12 items-center justify-center bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 mb-4 border border-emerald-500/20"
            style={{ borderRadius: 0 }}
          >
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-black text-[var(--text-heading)]">Password Updated!</h2>
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            Your administrator account credentials have been successfully updated.
          </p>
          <Link to="/login" className="mt-6 block">
            <Button variant="primary" size="md" className="w-full">
              Proceed to Sign In
            </Button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg-page)] text-[var(--text-body)]">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div
            className="inline-flex h-10 w-10 items-center justify-center bg-emerald-700 text-white font-bold mb-3"
            style={{ borderRadius: 0 }}
          >
            <KeyRound className="w-5 h-5" />
          </div>
          <h2 className="text-2xl font-black text-[var(--text-heading)]">Admin Recovery</h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {step === 'request'
              ? 'Step 1 of 2 · Request verification code'
              : 'Step 2 of 2 · Enter code and choose new password'}
          </p>
        </div>

        <div
          className="border border-[var(--border-main)] bg-[var(--bg-surface)] p-6 sm:p-8"
          style={{ borderRadius: 0 }}
        >
          {err && (
            <div
              className="mb-4 p-3 bg-red-500/10 border border-red-500/30 text-xs font-semibold text-red-800 dark:text-red-300"
              style={{ borderRadius: 0 }}
            >
              {err}
            </div>
          )}

          {info && (
            <div
              className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/30 text-xs font-semibold text-emerald-800 dark:text-emerald-300"
              style={{ borderRadius: 0 }}
            >
              {info}
            </div>
          )}

          {step === 'request' ? (
            <form onSubmit={requestOtp} className="space-y-4">
              <Input
                label="Admin Username or Email"
                value={identifier}
                onChange={e => setIdentifier(e.target.value)}
                placeholder="admin or admin@detomsite.com"
                required
              />

              <Button type="submit" variant="primary" size="md" loading={loading} className="w-full">
                Send 4-Digit Code
              </Button>
            </form>
          ) : (
            <form onSubmit={resetPw} className="space-y-4">
              <p className="text-xs text-[var(--text-body)] leading-relaxed">
                Enter the <b>4-digit code</b> sent to your registered address along with your new
                password. Code expires in 15 minutes.
              </p>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-heading)] mb-1.5">
                  4-Digit Verification Code
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={otp}
                  onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="••••"
                  className="w-full text-center text-2xl font-mono font-bold tracking-[0.4em] bg-[var(--bg-surface)] border border-[var(--border-main)] py-2 text-[var(--text-heading)] outline-none focus:border-emerald-600 transition-colors"
                  style={{ borderRadius: 0 }}
                  required
                />
              </div>

              <Input
                label="New Password"
                type="password"
                value={pw}
                onChange={e => setPw(e.target.value)}
                placeholder="At least 8 characters"
                required
              />

              <Input
                label="Confirm New Password"
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="Repeat new password"
                required
              />

              <Button type="submit" variant="primary" size="md" loading={loading} className="w-full">
                Verify & Update Password
              </Button>

              <div className="text-center pt-2 flex items-center justify-center gap-4">
                <button
                  type="button"
                  onClick={() => requestOtp()}
                  disabled={loading}
                  className="text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:underline disabled:opacity-50"
                >
                  Resend code
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStep('request')
                    setErr('')
                    setInfo('')
                  }}
                  className="text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:underline"
                >
                  ← Start over
                </button>
              </div>
            </form>
          )}

          <div className="mt-6 pt-4 border-t border-[var(--border-subtle)] flex items-center justify-center">
            <Link
              to="/login"
              className="text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-heading)] transition-colors flex items-center gap-1.5"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Sign In
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
