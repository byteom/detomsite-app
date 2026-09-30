import { FormEvent, ReactNode, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../services/api'
import { getLocalSession, saveLocalSession } from '../utils/session'
import { PhoneInput, isValidMobile } from './PhoneInput'

interface RoleGateProps { children: ReactNode }

/* Where the one-time password the server hands out on FIRST phone sign-up is
 * kept, so a returning student is signed in automatically. It is a credential,
 * so it lives under its own key and never leaks into the visible session. */
const PW_KEY = 'detomsite-phone-password'

function getSavedPassword(): string {
  try { return localStorage.getItem(PW_KEY) || '' } catch { return '' }
}
function savePassword(pw: string) {
  try { if (pw) localStorage.setItem(PW_KEY, pw) } catch { /* private mode */ }
}
function clearSavedPassword() {
  try { localStorage.removeItem(PW_KEY) } catch { /* private mode */ }
}

/* Students enter the student portal only — there is no role switcher here.
   Phone-first onboarding creates a real student account (via /local/auth/phone)
   and stores its JWT, so the protected order/payment APIs work exactly like a
   password-login. */

export function RoleGate({ children }: RoleGateProps) {
  const navigate = useNavigate()
  const [hasSession, setHasSession] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  /* The account was JUST created: show the generated password once, so the
     student saves it before continuing. */
  const [newPassword, setNewPassword] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (getLocalSession()) setHasSession(true)
  }, [])

  const finish = (
    access_token?: string, refresh_token?: string, user?: any,
    displayName?: string, phoneNo?: string,
  ) => {
    if (access_token) localStorage.setItem('access_token', access_token)
    if (refresh_token) localStorage.setItem('refresh_token', refresh_token)
    saveLocalSession({
      role: 'student',
      email: `${user?.username || 'student'}@student.local`,
      name: user?.name || displayName || 'Student',
      phone: phoneNo || phone.trim(),
    })
    setHasSession(true)
    navigate('/shops')
  }

  const handleStart = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim() || !isValidMobile(phone)) return
    setError('')

    // First-time signup: the server returned the account's password, so hold
    // the student here to save it before letting them in.
    if (newPassword) {
      savePassword(password.trim() || newPassword)
      finish(undefined, undefined, undefined, name.trim(), phone.trim())
      return
    }

    setLoading(true)
    try {
      const body: Record<string, string> = { name: name.trim(), phone: phone.trim() }
      const saved = getSavedPassword()
      // Sent for a RETURNING student. A brand-new number is unaffected: the
      // server ignores it when it creates the account.
      if (saved) body.password = saved
      const res = await api.post('/local/auth/phone', body)
      const { access_token, refresh_token, user, generated_password } = res.data || {}
      if (generated_password) {
        setNewPassword(generated_password)
        setPassword(generated_password)
        return
      }
      finish(access_token, refresh_token, user, name.trim(), phone.trim())
    } catch (err: any) {
      // A saved password that is no longer accepted (rotated, or an account that
      // predates it) — drop it and ask for the current one instead of looping.
      if (err?.response?.status === 401 && getSavedPassword()) {
        clearSavedPassword()
        setError('Your saved password was not accepted. Please enter your password to sign in.')
      } else {
        setError(err?.response?.data?.detail || 'Could not sign you in. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  if (hasSession) return <>{children}</>

  return (
    <main className="min-h-screen bg-gradient-to-br from-white to-emerald-50">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-card bg-primary-dark text-3xl font-black text-gold-300 shadow-gold-lg">
            D
          </div>
          <h1 className="text-4xl font-black tracking-tight text-primary-dark">DETOMSITE</h1>
          <p className="mt-2 text-sm font-medium text-gray-500">Campus Food Ordering Platform</p>
        </div>

        <div className="rounded-card bg-white p-8 shadow-gold-lg">
          {newPassword ? (
            /* ── Shown ONCE, right after the account is created ── */
            <>
              <h2 className="mb-2 text-xl font-bold text-primary">Save your password</h2>
              <p className="mb-4 text-sm font-medium text-gray-500">
                This is the only time it will be shown. We have saved it on this device — you
                will be signed in automatically next time. Write it down so you can sign in from
                another device.
              </p>
              <div className="mb-4 rounded-btn border-2 border-dashed border-primary-light/60 bg-primary-light/20 px-4 py-4 text-center">
                <p className="break-all font-mono text-xl font-black tracking-wide text-primary-dark">
                  {newPassword}
                </p>
              </div>
              <p className="mb-5 text-xs text-gray-500">
                Nobody from DETOMSITE will ever ask you for this password.
              </p>
              <label className="mb-1.5 block text-sm font-semibold text-gray-700">
                Save it somewhere safe (optional — you can edit what we keep)
              </label>
              <input value={password} onChange={e => setPassword(e.target.value)}
                className="mb-5 w-full rounded-btn border-2 border-gray-200 bg-white px-4 py-3 font-mono text-gray-900 outline-none focus:border-primary"
                autoComplete="off" spellCheck={false} />
              <button type="submit"
                className="w-full rounded-btn bg-primary px-6 py-3.5 text-base font-bold text-white shadow-gold transition-all hover:bg-primary-dark">
                I have saved it — Continue →
              </button>
            </>
          ) : (
            <>
          <h2 className="mb-2 text-xl font-bold text-primary">Student Portal</h2>
          <p className="mb-6 text-sm font-medium text-gray-500">Browse shops, order, and track deliveries — login with your phone number</p>

          <form onSubmit={handleStart} className="space-y-5">
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-gray-700">Your Name</label>
              <input value={name} onChange={e => setName(e.target.value)}
                className="w-full rounded-btn border-2 border-gray-200 bg-white px-4 py-3 text-gray-900 placeholder-gray-400 outline-none transition-all focus:border-primary focus:shadow-emerald-sm"
                placeholder="Enter your name" required />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-semibold text-gray-700">Phone Number</label>
              <PhoneInput value={phone} onChange={setPhone} />
              <p className="mt-1 text-xs font-medium text-gray-400">Shop deliveries will use this number to reach you.</p>
            </div>

            {/* Shown when this number is already registered and we need the
                password, so the student is not left staring at an error. */}
            {(error || password) && (
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-gray-700">
                  Password {getSavedPassword() ? '' : '(if you have joined before)'}
                </label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                  className="w-full rounded-btn border-2 border-gray-200 bg-white px-4 py-3 text-gray-900 placeholder-gray-400 outline-none focus:border-primary"
                  placeholder="Your password" autoComplete="current-password" />
                <p className="mt-1 text-xs text-gray-400">
                  New here? Just continue — we will create your account and show you a password.
                </p>
              </div>
            )}

            {error && <p className="rounded-btn bg-red-50 border border-red-200 px-4 py-2.5 text-sm font-medium text-red-600">{error}</p>}

            <button type="submit" disabled={!name.trim() || !isValidMobile(phone) || loading}
              className="w-full rounded-btn bg-primary px-6 py-3.5 text-base font-bold text-white shadow-gold transition-all hover:bg-primary-dark hover:shadow-gold-lg disabled:opacity-40 disabled:cursor-not-allowed">
              {loading ? 'Signing in…' : 'Continue →'}
            </button>
            </form>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs font-medium text-gray-400">By continuing, you agree to our Terms of Service</p>
      </div>
    </main>
  )
}