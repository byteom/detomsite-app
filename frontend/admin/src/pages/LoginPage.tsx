import React, { useState, FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Shield, Lock, User, ArrowRight, Sun, Moon } from 'lucide-react'
import api from '../services/api'
import { apiError } from '../utils/formatters'
import { useTheme } from '../context/ThemeContext'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'

export function LoginPage() {
  const navigate = useNavigate()
  const { isDark, toggleTheme } = useTheme()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    setLoading(true)
    try {
      const res = await api.post('/admin/login', { username, password })
      localStorage.setItem('admin_token', res.data.access_token)
      localStorage.setItem('admin_user', JSON.stringify(res.data.user))
      navigate('/dashboard')
    } catch (err: any) {
      setErr(apiError(err, 'Invalid administrator credentials'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen lg:grid lg:grid-cols-2 bg-admin-bg-light dark:bg-admin-bg-dark transition-colors duration-200">
      {/* Theme Toggle Top Right */}
      <div className="absolute right-4 top-4 z-20">
        <button
          type="button"
          onClick={toggleTheme}
          className="p-2 border border-gray-300 dark:border-admin-border-dark bg-white dark:bg-admin-surface-dark text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-admin-surface-darkHover"
          style={{ borderRadius: 0 }}
          title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
          {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>

      {/* Left panel: Enterprise Branding & Stats */}
      <div className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-gradient-to-br from-emerald-950 via-gray-950 to-gray-900 p-12 text-white border-r border-emerald-900/40">
        <div className="relative z-10">
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-10 w-10 items-center justify-center bg-emerald-600 text-white font-black text-base"
              style={{ borderRadius: 0 }}
            >
              D
            </div>
            <span className="text-lg font-black tracking-wider uppercase text-emerald-400">
              DETOMSITE ADMIN
            </span>
          </div>

          <div className="mt-20 max-w-lg">
            <span
              className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold uppercase tracking-widest bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
              style={{ borderRadius: 0 }}
            >
              <Shield className="w-3.5 h-3.5" /> High-Performance Campus Operations
            </span>
            <h1 className="mt-6 text-4xl font-black leading-tight text-white">
              Campus commerce & food logistics command centre.
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-gray-300">
              Manage shops, real-time orders, payment reconciliation, vendor settlements, and student
              announcements from a unified operational dashboard.
            </p>
          </div>

          <div className="mt-12 grid grid-cols-2 gap-4 max-w-md">
            <div
              className="p-4 border border-emerald-800/40 bg-emerald-950/40"
              style={{ borderRadius: 0 }}
            >
              <p className="text-xs uppercase font-bold text-emerald-400">Real-time Orders</p>
              <p className="text-2xl font-black mt-1 text-white">Live Stream</p>
              <p className="text-[11px] text-gray-400 mt-0.5">Instant WhatsApp dispatch & SMS sync</p>
            </div>
            <div
              className="p-4 border border-emerald-800/40 bg-emerald-950/40"
              style={{ borderRadius: 0 }}
            >
              <p className="text-xs uppercase font-bold text-emerald-400">Platform Share</p>
              <p className="text-2xl font-black mt-1 text-white">₹10 / Order</p>
              <p className="text-[11px] text-gray-400 mt-0.5">Automated vendor fee reconciliation</p>
            </div>
          </div>
        </div>

        <div className="relative z-10 flex items-center justify-between text-xs text-gray-500">
          <p>© {new Date().getFullYear()} DETOMSITE Inc. All rights reserved.</p>
          <span className="font-mono">SECURE ADMIN v1.2</span>
        </div>
      </div>

      {/* Right panel: Login Form */}
      <div className="flex min-h-screen items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md">
          {/* Header */}
          <div className="mb-8">
            <div
              className="inline-flex h-12 w-12 items-center justify-center bg-emerald-700 dark:bg-emerald-600 text-white font-black text-xl mb-4"
              style={{ borderRadius: 0 }}
            >
              D
            </div>
            <h2 className="text-2xl font-black text-gray-900 dark:text-white">
              Administrator Login
            </h2>
            <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
              Enter your credentials to access the operational portal
            </p>
          </div>

          {/* Form Container */}
          <div
            className="border border-gray-200 dark:border-admin-border-dark bg-white dark:bg-admin-surface-dark p-6 sm:p-8 shadow-sm"
            style={{ borderRadius: 0 }}
          >
            {err && (
              <div
                className="mb-5 p-3.5 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs font-semibold text-red-700 dark:text-red-300"
                style={{ borderRadius: 0 }}
              >
                {err}
              </div>
            )}

            <form onSubmit={submit} className="space-y-5">
              <Input
                label="Username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="admin_demo"
                icon={<User className="w-4 h-4" />}
                required
                autoComplete="username"
              />

              <Input
                label="Password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                icon={<Lock className="w-4 h-4" />}
                required
                autoComplete="current-password"
              />

              <div className="flex items-center justify-between text-xs">
                <Link
                  to="/forgot-password"
                  className="font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
                >
                  Forgot password?
                </Link>
              </div>

              <Button
                type="submit"
                variant="primary"
                size="md"
                loading={loading}
                className="w-full"
                iconRight={<ArrowRight className="w-4 h-4" />}
              >
                Sign In to Admin
              </Button>
            </form>
          </div>

          <div className="mt-6 text-center text-xs text-gray-400">
            Internal Operations Portal · Authorized Personnel Only
          </div>
        </div>
      </div>
    </div>
  )
}
