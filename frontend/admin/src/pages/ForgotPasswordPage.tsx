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

  const requestOtp = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    setInfo('')
    setLoading(true)
    try {
      const res = await api.post('/users/forgot-password', { identifier })
      setInfo(res.data?.message || 'A 6-digit recovery code was sent to your registered address.')
      setStep('otp')
    } catch (err: any) {
      setErr(apiError(err, 'Request failed. Please verify your username or email.'))
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
    } catch (err: any) {
      setErr(apiError(err, 'Password reset failed. Invalid or expired code.'))
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-admin-bg-light dark:bg-admin-bg-dark">
        <div
          className="w-full max-w-md border border-gray-200 dark:border-admin-border-dark bg-white dark:bg-admin-surface-dark p-8 text-center"
          style={{ borderRadius: 0 }}
        >
          <div
            className="mx-auto flex h-12 w-12 items-center justify-center bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 mb-4 border border-emerald-500/20"
            style={{ borderRadius: 0 }}
          >
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-black text-gray-900 dark:text-white">Password Updated!</h2>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
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
    <div className="min-h-screen flex items-center justify-center p-4 bg-admin-bg-light dark:bg-admin-bg-dark">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div
            className="inline-flex h-10 w-10 items-center justify-center bg-emerald-700 text-white font-bold mb-3"
            style={{ borderRadius: 0 }}
          >
            <KeyRound className="w-5 h-5" />
          </div>
          <h2 className="text-2xl font-black text-gray-900 dark:text-white">Admin Recovery</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {step === 'request'
              ? 'Step 1 of 2 · Request verification code'
              : 'Step 2 of 2 · Enter code and choose new password'}
          </p>
        </div>

        <div
          className="border border-gray-200 dark:border-admin-border-dark bg-white dark:bg-admin-surface-dark p-6 sm:p-8"
          style={{ borderRadius: 0 }}
        >
          {err && (
            <div
              className="mb-4 p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs font-semibold text-red-700 dark:text-red-300"
              style={{ borderRadius: 0 }}
            >
              {err}
            </div>
          )}

          {info && (
            <div
              className="mb-4 p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs font-semibold text-emerald-700 dark:text-emerald-300"
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
                Send 6-Digit Code
              </Button>
            </form>
          ) : (
            <form onSubmit={resetPw} className="space-y-4">
              <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                Enter the <b>6-digit code</b> sent to your registered address along with your new
                password. Code expires in 15 minutes.
              </p>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1.5">
                  6-Digit Verification Code
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={otp}
                  onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="••••••"
                  className="w-full text-center text-2xl font-mono font-bold tracking-[0.4em] bg-white dark:bg-admin-surface-dark border border-gray-300 dark:border-admin-border-dark py-2 text-gray-900 dark:text-white outline-none focus:border-emerald-600"
                  style={{ borderRadius: 0 }}
                  required
                />
              </div>

              <Input
                label="New Password"
                type="password"
                value={pw}
                onChange={e => setPw(e.target.value)}
                placeholder="At least 4 characters"
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

              <div className="text-center pt-2">
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

          <div className="mt-6 pt-4 border-t border-gray-100 dark:border-admin-border-dark flex items-center justify-center">
            <Link
              to="/login"
              className="text-xs font-semibold text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 flex items-center gap-1.5"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Sign In
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
