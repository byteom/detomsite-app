import React, { useState, useEffect } from 'react'
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useNavigate,
} from 'react-router-dom'
import { dedupeGet } from './services/api'
import ErrorBoundary from './components/ErrorBoundary'
import { Layout } from './components/layout/Layout'

// Pages
import { ShopsPage } from './pages/ShopsPage'
import { ShopDetailPage } from './pages/ShopDetailPage'
import { CartPage } from './pages/CartPage'
import { PaymentPage } from './pages/PaymentPage'
import { PayPage } from './pages/PayPage'
import { PaymentPortalPage } from './pages/PaymentPortalPage'
import { OrderResultPage } from './pages/OrderResultPage'
import { OrdersPage } from './pages/OrdersPage'
import { ProfilePage } from './pages/ProfilePage'
import { SupportPage } from './pages/SupportPage'
import {
  RegisterPage,
  LoginPage,
  ForgotPasswordPage,
  ForgotUsernamePage,
} from './pages/auth/AuthPages'

/* ─── Auth Guard Constants ─── */
const AUTH_CHECK_KEY = 'detomsite-auth-check'
const AUTH_CHECK_TIMEOUT_MS = 8000
const AUTH_CHECK_WATCHDOG_MS = 12000

function RequireAuth({ children }: { children: React.ReactNode }) {
  const [checked, setChecked] = useState(false)
  const [ok, setOk] = useState(false)
  const [offline, setOffline] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      setChecked(true)
      setOk(false)
      return
    }
    let cancelled = false

    const watchdog = setTimeout(() => {
      if (cancelled) return
      setOffline(true)
      setChecked(true)
      setOk(false)
    }, AUTH_CHECK_WATCHDOG_MS)

    // Check cached token validation (10 min TTL)
    try {
      const cached = JSON.parse(localStorage.getItem(AUTH_CHECK_KEY) || 'null')
      if (
        cached &&
        cached.token === token &&
        Date.now() - cached.t < 10 * 60 * 1000
      ) {
        clearTimeout(watchdog)
        setChecked(true)
        setOk(true)
        return
      }
    } catch {
      /* proceed to network verification */
    }

    setOffline(false)

    dedupeGet('/users/profile', undefined, {
      timeout: AUTH_CHECK_TIMEOUT_MS,
      noRetry: true,
    })
      .then(() => {
        clearTimeout(watchdog)
        if (cancelled) return
        try {
          localStorage.setItem(
            AUTH_CHECK_KEY,
            JSON.stringify({ token, t: Date.now() })
          )
        } catch {}
        setChecked(true)
        setOk(true)
      })
      .catch((err: any) => {
        clearTimeout(watchdog)
        if (cancelled) return
        const status = err?.response?.status
        if (status === 401 || status === 403) {
          localStorage.removeItem('access_token')
          localStorage.removeItem('user_data')
          localStorage.removeItem(AUTH_CHECK_KEY)
          setChecked(true)
          setOk(false)
        } else {
          setOffline(true)
          setChecked(true)
          setOk(false)
        }
      })

    return () => {
      cancelled = true
      clearTimeout(watchdog)
    }
  }, [attempt])

  if (!checked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm font-semibold text-slate-400">
        <div className="flex flex-col items-center gap-2">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-700" />
          <span>Loading DETOMSITE...</span>
        </div>
      </div>
    )
  }

  if (offline) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-6 text-center">
        <div className="max-w-sm rounded-panel bg-white p-6 shadow-card border border-slate-200 space-y-3">
          <h2 className="text-base font-bold text-slate-900">
            Connection Issue
          </h2>
          <p className="text-xs text-slate-500 leading-relaxed">
            Could not reach the campus server. Your login session is saved — check your Wi-Fi or data connection and tap retry.
          </p>
          <button
            type="button"
            onClick={() => {
              setChecked(false)
              setAttempt((a) => a + 1)
            }}
            className="w-full rounded-btn bg-emerald-700 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-800 transition-colors shadow-sm"
          >
            Retry Connection
          </button>
        </div>
      </div>
    )
  }

  if (!ok) return <Navigate to="/login" replace />
  return <>{children}</>
}

function FallbackRedirect() {
  const navigate = useNavigate()
  const token = localStorage.getItem('access_token')
  useEffect(() => {
    navigate(token ? '/shops' : '/login', { replace: true })
  }, [token, navigate])
  return null
}

export default function App() {
  return (
    <Router>
      <ErrorBoundary>
        <Routes>
          {/* Public Auth Routes */}
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/forgot-username" element={<ForgotUsernamePage />} />

          {/* Authenticated Portal Routes */}
          <Route
            path="/*"
            element={
              <RequireAuth>
                <Layout>
                  <Routes>
                    {/* Primary Discover & Ordering */}
                    <Route path="/" element={<ShopsPage />} />
                    <Route path="/shops" element={<ShopsPage />} />
                    <Route path="/shop/:shopId" element={<ShopDetailPage />} />
                    <Route path="/cart" element={<CartPage />} />
                    <Route path="/payment" element={<PaymentPage />} />
                    <Route path="/pay" element={<PayPage />} />
                    <Route path="/pay/:orderId" element={<PaymentPortalPage />} />
                    <Route path="/order/:orderId" element={<OrderResultPage />} />

                    {/* Orders Hub */}
                    <Route path="/orders" element={<OrdersPage />} />
                    <Route path="/previous-orders" element={<OrdersPage />} />

                    {/* Profile Hub (Replaces Account & Ingests Dashboard) */}
                    <Route path="/profile" element={<ProfilePage />} />
                    <Route path="/dashboard" element={<ProfilePage />} />
                    <Route path="/account" element={<ProfilePage />} />
                    <Route path="/reviews" element={<ProfilePage />} />

                    {/* Standalone Support Route */}
                    <Route path="/support" element={<SupportPage />} />

                    {/* 404 / Catch-all */}
                    <Route path="*" element={<FallbackRedirect />} />
                  </Routes>
                </Layout>
              </RequireAuth>
            }
          />
        </Routes>
      </ErrorBoundary>
    </Router>
  )
}
