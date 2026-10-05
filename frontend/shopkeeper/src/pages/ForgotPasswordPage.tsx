import React, { useState, FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, AlertCircle } from 'lucide-react'
import api from '../services/api'
import { apiError } from '../utils/formatters'
import { Input } from '../components/ui/Input'
import { Button } from '../components/ui/Button'
import { PasswordField } from '../components/common/FormFields'

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

  const requestOtp = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    setInfo('')
    setLoading(true)
    try {
      const res = await api.post('/users/forgot-password', { identifier })
      setInfo(res.data?.message || 'A 6-digit code was sent to your registered email.')
      setStep('otp')
    } catch (error: any) {
      setErr(apiError(error, 'Request failed'))
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
    if (pw.length < 4) {
      setErr('Password must be at least 4 characters')
      return
    }
    setLoading(true)
    try {
      await api.post('/users/reset-password', { identifier, otp, new_password: pw })
      setDone(true)
    } catch (error: any) {
      setErr(apiError(error, 'Reset failed'))
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="min-h-screen bg-[var(--bg-page)] flex items-center justify-center p-4">
        <div className="border border-[var(--border-main)] bg-[var(--bg-surface)] p-8 max-w-sm w-full text-center space-y-4 shadow-lg rounded-2xl">
          <div className="flex h-12 w-12 items-center justify-center bg-emerald-600/10 text-emerald-600 rounded-full mx-auto">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold text-[var(--text-heading)]">Password Updated</h1>
          <p className="text-xs text-[var(--text-muted)]">
            Your new password has been saved. Please sign in with your updated credentials.
          </p>
          <Link to="/login" className="block">
            <Button variant="primary" size="md" className="w-full">
              Proceed to Sign In
            </Button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[var(--bg-page)] flex items-center justify-center p-4">
      <div className="border border-[var(--border-main)] bg-[var(--bg-surface)] p-6 sm:p-8 max-w-sm w-full shadow-lg rounded-2xl space-y-4">
        <div className="text-center space-y-1">
          <h1 className="text-xl font-bold text-[var(--text-heading)]">Reset Password</h1>
          <p className="text-xs text-[var(--text-muted)]">
            {step === 'request'
              ? 'Enter your username or email'
              : 'Enter verification OTP & new password'}
          </p>
        </div>

        {err && (
          <div className="p-3.5 rounded-xl border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-xs font-semibold text-red-700 dark:text-red-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{err}</span>
          </div>
        )}

        {info && (
          <div className="p-3.5 rounded-xl border border-blue-300 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 text-xs font-semibold text-blue-800 dark:text-blue-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
            <span>{info}</span>
          </div>
        )}

        {step === 'request' ? (
          <form onSubmit={requestOtp} className="space-y-3.5">
            <Input
              label="Username or Email"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="Your username or email"
              required
            />
            <Button variant="primary" size="md" type="submit" loading={loading} className="w-full">
              Send Verification OTP
            </Button>
          </form>
        ) : (
          <form onSubmit={resetPw} className="space-y-3.5">
            <Input
              label="6-Digit OTP Code"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              placeholder="e.g. 123456"
              required
            />
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1">
                New Password
              </label>
              <PasswordField
                value={pw}
                onChange={setPw}
                placeholder="Min 4 characters"
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1">
                Confirm Password
              </label>
              <PasswordField
                value={confirm}
                onChange={setConfirm}
                placeholder="Repeat password"
                autoComplete="new-password"
              />
            </div>
            <Button variant="primary" size="md" type="submit" loading={loading} className="w-full">
              Save New Password
            </Button>
          </form>
        )}

        <div className="text-center pt-2">
          <Link
            to="/login"
            className="text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-heading)]"
          >
            ← Back to Sign In
          </Link>
        </div>
      </div>
    </div>
  )
}
export default ForgotPasswordPage
