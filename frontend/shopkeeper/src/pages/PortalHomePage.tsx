import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Store,
  ChefHat,
  Smartphone,
  Download,
  CheckCircle2,
} from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { usePwaInstall } from '../hooks/usePwaInstall'
import { safeStorageJSON } from '../utils/formatters'

export function PortalHomePage() {
  const navigate = useNavigate()
  const { install, canInstall, installed } = usePwaInstall()
  const [loggedIn, setLoggedIn] = useState(false)
  const vendor = safeStorageJSON<Record<string, any>>('vendor_user', {})

  useEffect(() => {
    setLoggedIn(Boolean(localStorage.getItem('vendor_token')))
  }, [])

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text-body)] flex flex-col justify-between">
      {/* Top Header */}
      <header className="h-16 border-b border-[var(--border-main)] bg-[var(--bg-surface)] px-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center bg-emerald-700 text-white font-black text-base shadow-xs">
            D
          </div>
          <div>
            <span className="font-black text-sm uppercase tracking-wider text-[var(--text-heading)] flex items-center gap-1.5">
              DETOMSITE <Store className="w-4 h-4 text-emerald-600" />
            </span>
            <span className="text-[11px] text-[var(--text-muted)] font-medium block">
              Campus Shopkeeper Desk
            </span>
          </div>
        </div>

        <div>
          {loggedIn ? (
            <Button variant="primary" size="sm" onClick={() => navigate('/mobile')}>
              Open Shop Desk →
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => navigate('/login')}>
              Sign In
            </Button>
          )}
        </div>
      </header>

      {/* Hero Section */}
      <main className="max-w-4xl mx-auto px-4 py-12 flex-1 flex flex-col justify-center">
        <div className="text-center mb-10 space-y-3">
          <span className="inline-flex items-center gap-2 px-3 py-1 text-xs font-bold uppercase tracking-wider bg-emerald-600/10 text-emerald-700 dark:text-emerald-400 border border-emerald-600/30">
            <ChefHat className="w-3.5 h-3.5" /> Campus Kitchen Operations
          </span>
          <h1 className="text-3xl sm:text-5xl font-black text-[var(--text-heading)] tracking-tight">
            Run Your Kitchen Desk in Real-Time
          </h1>
          <p className="text-sm sm:text-base text-[var(--text-muted)] max-w-xl mx-auto">
            Receive orders the moment students checkout, coordinate cooking with live tokens, and collect payments with zero confusion.
          </p>
        </div>

        {/* Action Cards */}
        {!loggedIn ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl mx-auto w-full">
            <div
              className="border border-[var(--border-main)] bg-[var(--bg-surface)] p-6 space-y-3 shadow-sm hover:border-emerald-600 transition-all cursor-pointer rounded-2xl"
              onClick={() => navigate('/register')}
            >
              <div className="flex h-11 w-11 items-center justify-center bg-amber-500/10 text-amber-600 rounded-xl">
                <Store className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-[var(--text-heading)]">Register Your Shop</h2>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  New campus vendor? Submit shop details for administrator approval.
                </p>
              </div>
              <Button variant="gold" size="sm" className="w-full">
                Register New Shop →
              </Button>
            </div>

            <div
              className="border border-[var(--border-main)] bg-[var(--bg-surface)] p-6 space-y-3 shadow-sm hover:border-emerald-600 transition-all cursor-pointer rounded-2xl"
              onClick={() => navigate('/login')}
            >
              <div className="flex h-11 w-11 items-center justify-center bg-emerald-600/10 text-emerald-600 rounded-xl">
                <ChefHat className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-[var(--text-heading)]">Shopkeeper Sign In</h2>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  Already registered? Access your orders queue, menu, and daily earnings.
                </p>
              </div>
              <Button variant="primary" size="sm" className="w-full">
                Sign In to Desk →
              </Button>
            </div>
          </div>
        ) : (
          <div className="max-w-md mx-auto w-full">
            <Card
              title={
                <span className="flex items-center gap-2 text-sm font-bold text-[var(--text-heading)]">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  Active Session Detected
                </span>
              }
              subtitle={`Signed in as ${vendor.name || vendor.username || 'Shopkeeper'}`}
            >
              <Button
                variant="primary"
                size="md"
                onClick={() => navigate('/mobile')}
                className="w-full"
              >
                Go to Shopkeeper Dashboard →
              </Button>
            </Card>
          </div>
        )}

        {/* PWA Install Banner */}
        {!installed && canInstall && (
          <div className="mt-8 max-w-xl mx-auto w-full">
            <div className="border border-emerald-600/40 bg-[var(--bg-surface)] p-5 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm rounded-2xl">
              <div className="flex items-center gap-3.5 text-center sm:text-left">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center bg-emerald-700 text-white rounded-xl">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[var(--text-heading)]">
                    Install Shopkeeper Mobile PWA
                  </h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    Install to phone home screen for instant orders, sound alerts, and full screen
                  </p>
                </div>
              </div>

              <Button
                variant="primary"
                size="sm"
                icon={<Download className="w-4 h-4" />}
                onClick={install}
                className="w-full sm:w-auto shrink-0"
              >
                Install App
              </Button>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--border-main)] py-4 text-center text-xs text-[var(--text-dim)]">
        © {new Date().getFullYear()} DETOMSITE Campus Operations · Shopkeeper Portal v2.0
      </footer>
    </div>
  )
}
export default PortalHomePage
