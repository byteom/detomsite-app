import React, { useState, FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import api from '../../services/api'
import {
  apiError,
  isValidMobile,
  toE164,
  displayDigits,
} from '../../utils/helpers'
import {
  User,
  Lock,
  Phone,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  ArrowRight,
} from '../../components/ui/Icons'

const AUTH_CHECK_KEY = 'detomsite-auth-check'

function PasswordInput({
  value,
  onChange,
  placeholder = '••••••••',
  required = true,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  required?: boolean
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full rounded-btn border-2 border-slate-200 bg-white py-3 pl-4 pr-11 text-sm font-semibold text-slate-900 outline-none transition-all focus:border-emerald-600 focus:shadow-sm"
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        tabIndex={-1}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  )
}

/* ─── REGISTER PAGE ─── */
export function RegisterPage() {
  const navigate = useNavigate()
  const [f, setF] = useState({
    username: '',
    email: '',
    phone: '',
    password: '',
    confirm: '',
  })
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    if (f.password !== f.confirm) {
      setErr('Passwords do not match.')
      return
    }
    if (!isValidMobile(f.phone)) {
      setErr('Please enter a valid 10-digit mobile number.')
      return
    }
    setLoading(true)
    try {
      await api.post('/users/register', {
        username: f.username,
        email: f.email,
        password: f.password,
        name: f.username,
        phone: f.phone,
      })
      navigate('/login?registered=true')
    } catch (e: any) {
      setErr(apiError(e, 'Registration failed.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-btn bg-emerald-700 text-white font-black text-2xl shadow-sm mb-3">
            D
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
            Create Your Account
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Order food from your campus kitchens in seconds
          </p>
        </div>

        <div className="rounded-panel border border-slate-200 bg-white p-6 sm:p-8 shadow-card space-y-4">
          {err && (
            <div className="flex items-center gap-2 rounded-btn bg-red-50 border border-red-200 p-3 text-xs font-bold text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{err}</span>
            </div>
          )}

          <form onSubmit={submit} className="space-y-4 text-xs font-semibold">
            <div>
              <label className="block text-slate-600 mb-1">Username</label>
              <input
                type="text"
                value={f.username}
                onChange={(e) => setF({ ...f, username: e.target.value })}
                placeholder="Pick a username"
                required
                className="w-full rounded-btn border-2 border-slate-200 bg-white p-3 text-sm outline-none focus:border-emerald-600"
              />
            </div>

            <div>
              <label className="block text-slate-600 mb-1">Campus Email</label>
              <input
                type="email"
                value={f.email}
                onChange={(e) => setF({ ...f, email: e.target.value })}
                placeholder="your.name@campus.edu"
                required
                className="w-full rounded-btn border-2 border-slate-200 bg-white p-3 text-sm outline-none focus:border-emerald-600"
              />
            </div>

            <div>
              <label className="block text-slate-600 mb-1">Mobile Number</label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">
                  +91
                </span>
                <input
                  type="tel"
                  inputMode="numeric"
                  value={displayDigits(f.phone)}
                  onChange={(e) => setF({ ...f, phone: toE164(e.target.value) })}
                  placeholder="98765 43210"
                  required
                  className="w-full rounded-btn border-2 border-slate-200 bg-white py-3 pl-12 pr-4 text-sm font-semibold outline-none focus:border-emerald-600"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-600 mb-1">Password</label>
                <PasswordInput
                  value={f.password}
                  onChange={(v) => setF({ ...f, password: v })}
                />
              </div>

              <div>
                <label className="block text-slate-600 mb-1">Confirm</label>
                <PasswordInput
                  value={f.confirm}
                  onChange={(v) => setF({ ...f, confirm: v })}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-btn bg-emerald-700 py-3.5 text-sm font-black text-white shadow-modal hover:bg-emerald-800 transition-all disabled:opacity-50"
            >
              {loading ? 'Creating Account...' : 'Create Account'}
            </button>
          </form>

          <div className="pt-4 border-t border-slate-100 text-center text-xs text-slate-500">
            Already have an account?{' '}
            <Link to="/login" className="font-bold text-emerald-700 hover:underline">
              Sign In
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── LOGIN PAGE ─── */
export function LoginPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const registered = params.get('registered') === 'true'

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    setLoading(true)
    try {
      const res = await api.post('/users/login', { username, password })
      localStorage.setItem('access_token', res.data.access_token)
      localStorage.setItem('user_data', JSON.stringify(res.data.user))
      try {
        localStorage.setItem(
          AUTH_CHECK_KEY,
          JSON.stringify({ token: res.data.access_token, t: Date.now() })
        )
      } catch {}
      navigate('/shops')
    } catch (e: any) {
      setErr(apiError(e, 'Login failed. Please check your credentials.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-btn bg-emerald-700 text-white font-black text-2xl shadow-sm mb-3">
            D
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
            Welcome Back
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Sign in to order food, track deliveries, and view your receipts
          </p>
        </div>

        <div className="rounded-panel border border-slate-200 bg-white p-6 sm:p-8 shadow-card space-y-4">
          {registered && (
            <div className="flex items-center gap-2 rounded-btn bg-emerald-50 border border-emerald-200 p-3 text-xs font-bold text-emerald-800">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>Account created successfully! Please sign in.</span>
            </div>
          )}

          {err && (
            <div className="flex items-center gap-2 rounded-btn bg-red-50 border border-red-200 p-3 text-xs font-bold text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{err}</span>
            </div>
          )}

          <form onSubmit={submit} className="space-y-4 text-xs font-semibold">
            <div>
              <label className="block text-slate-600 mb-1">Username or Email</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter username"
                required
                className="w-full rounded-btn border-2 border-slate-200 bg-white p-3 text-sm outline-none focus:border-emerald-600"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-slate-600">Password</label>
                <Link
                  to="/forgot-password"
                  className="text-[11px] font-bold text-emerald-700 hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <PasswordInput value={password} onChange={setPassword} />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-btn bg-emerald-700 py-3.5 text-sm font-black text-white shadow-modal hover:bg-emerald-800 transition-all disabled:opacity-50"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <div className="pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>New to Detomsite?</span>
            <Link to="/register" className="font-bold text-emerald-700 hover:underline">
              Create an account →
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── FORGOT PASSWORD PAGE (2-step: identifier → 4-digit OTP + new password) ─── */
export function ForgotPasswordPage() {
  const [step, setStep] = useState<'request' | 'otp'>('request')
  const [identifier, setIdentifier] = useState('')
  const [otp, setOtp] = useState('')
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)

  const friendlyError = (e: any, fallback: string) => {
    if (e?.response?.status === 503) {
      return 'We could not send the reset email right now. Please try again shortly — or ask the admin for help.'
    }
    return apiError(e, fallback)
  }

  const requestOtp = async (e?: FormEvent) => {
    e?.preventDefault()
    setErr('')
    setMsg('')
    if (!identifier.trim()) {
      setErr('Enter your username or registered email.')
      return
    }
    setLoading(true)
    try {
      const res = await api.post('/users/forgot-password', { identifier: identifier.trim() })
      setMsg(res.data?.message || 'A 4-digit code was sent to your registered email.')
      setStep('otp')
    } catch (e: any) {
      setErr(friendlyError(e, 'Could not process password reset.'))
    } finally {
      setLoading(false)
    }
  }

  const resetPw = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    setMsg('')
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
      await api.post('/users/reset-password', {
        identifier: identifier.trim(),
        otp: otp.trim(),
        new_password: pw,
      })
      setDone(true)
    } catch (e: any) {
      setErr(friendlyError(e, 'Password reset failed. Invalid or expired code.'))
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-12">
        <div className="w-full max-w-md">
          <div className="rounded-panel border border-slate-200 bg-white p-6 sm:p-8 shadow-card space-y-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600/10 text-emerald-600">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <h1 className="text-xl font-black text-slate-900">Password Updated!</h1>
            <p className="text-xs text-slate-500">
              Your new password has been saved. Please sign in with your updated credentials.
            </p>
            <Link
              to="/login"
              className="block w-full rounded-btn bg-emerald-700 py-3 text-sm font-bold text-white hover:bg-emerald-800 transition-colors"
            >
              Proceed to Sign In
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="rounded-panel border border-slate-200 bg-white p-6 sm:p-8 shadow-card space-y-4">
          <h1 className="text-xl font-black text-slate-900">Reset Your Password</h1>
          <p className="text-xs text-slate-500">
            {step === 'request'
              ? 'Step 1 of 2 · Enter your username or registered email — we will send a 4-digit code.'
              : 'Step 2 of 2 · Enter the 4-digit code & choose a new password (code expires in 15 min).'}
          </p>

          {msg && (
            <div className="flex items-center gap-2 rounded-btn bg-emerald-50 border border-emerald-200 p-3 text-xs font-bold text-emerald-800">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{msg}</span>
            </div>
          )}

          {err && (
            <div className="flex items-center gap-2 rounded-btn bg-red-50 border border-red-200 p-3 text-xs font-bold text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{err}</span>
            </div>
          )}

          {step === 'request' ? (
            <form onSubmit={requestOtp} className="space-y-4 text-xs font-semibold">
              <div>
                <label className="block text-slate-600 mb-1">Username or Email</label>
                <input
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="your username or email"
                  required
                  className="w-full rounded-btn border-2 border-slate-200 p-3 text-sm outline-none focus:border-emerald-600"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-btn bg-emerald-700 py-3 font-bold text-white hover:bg-emerald-800 transition-colors disabled:opacity-50"
              >
                {loading ? 'Sending...' : 'Send 4-Digit Code'}
              </button>
            </form>
          ) : (
            <form onSubmit={resetPw} className="space-y-4 text-xs font-semibold">
              <div>
                <label className="block text-slate-600 mb-1">4-Digit Code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="••••"
                  required
                  className="w-full rounded-btn border-2 border-slate-200 p-3 text-center text-2xl font-mono font-bold tracking-[0.4em] outline-none focus:border-emerald-600"
                />
              </div>

              <div>
                <label className="block text-slate-600 mb-1">New Password (min 8 characters)</label>
                <PasswordInput value={pw} onChange={setPw} placeholder="At least 8 characters" />
              </div>

              <div>
                <label className="block text-slate-600 mb-1">Confirm New Password</label>
                <PasswordInput value={confirm} onChange={setConfirm} placeholder="Repeat new password" />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-btn bg-emerald-700 py-3 font-bold text-white hover:bg-emerald-800 transition-colors disabled:opacity-50"
              >
                {loading ? 'Saving...' : 'Verify & Update Password'}
              </button>

              <div className="flex items-center justify-center gap-4 pt-1 text-xs">
                <button
                  type="button"
                  onClick={() => requestOtp()}
                  disabled={loading}
                  className="font-bold text-emerald-700 hover:underline disabled:opacity-50"
                >
                  Resend code
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStep('request')
                    setErr('')
                    setMsg('')
                  }}
                  className="font-bold text-emerald-700 hover:underline"
                >
                  ← Start over
                </button>
              </div>
            </form>
          )}

          <div className="pt-3 border-t border-slate-100 text-center text-xs">
            <Link to="/login" className="font-bold text-emerald-700 hover:underline">
              ← Back to Sign In
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── FORGOT USERNAME PAGE ─── */
export function ForgotUsernamePage() {
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    setMsg('')
    setLoading(true)
    try {
      await api.post('/users/forgot-username', { email })
      setMsg('If an account matches that email, your username has been sent.')
    } catch (e: any) {
      setErr(apiError(e, 'Could not process request.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="rounded-panel border border-slate-200 bg-white p-6 sm:p-8 shadow-card space-y-4">
          <h1 className="text-xl font-black text-slate-900">Forgot Username</h1>
          <p className="text-xs text-slate-500">
            Enter your registered campus email to look up your student username.
          </p>

          {msg && (
            <div className="flex items-center gap-2 rounded-btn bg-emerald-50 border border-emerald-200 p-3 text-xs font-bold text-emerald-800">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{msg}</span>
            </div>
          )}

          {err && (
            <div className="flex items-center gap-2 rounded-btn bg-red-50 border border-red-200 p-3 text-xs font-bold text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{err}</span>
            </div>
          )}

          <form onSubmit={submit} className="space-y-4 text-xs font-semibold">
            <div>
              <label className="block text-slate-600 mb-1">Campus Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your.email@campus.edu"
                required
                className="w-full rounded-btn border-2 border-slate-200 p-3 text-sm outline-none focus:border-emerald-600"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-btn bg-emerald-700 py-3 font-bold text-white hover:bg-emerald-800 transition-colors disabled:opacity-50"
            >
              {loading ? 'Sending...' : 'Find My Username'}
            </button>
          </form>

          <div className="pt-3 border-t border-slate-100 text-center text-xs">
            <Link to="/login" className="font-bold text-emerald-700 hover:underline">
              ← Back to Sign In
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
