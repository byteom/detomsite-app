import React, { useState, FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle } from 'lucide-react'
import api from '../services/api'
import { apiError } from '../utils/formatters'
import { Input } from '../components/ui/Input'
import { Button } from '../components/ui/Button'
import { PasswordField } from '../components/common/FormFields'

export function LoginPage() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    setLoading(true)
    try {
      const res = await api.post('/vendor/login', { username, password })
      localStorage.setItem('vendor_token', res.data.access_token)
      localStorage.setItem('vendor_user', JSON.stringify(res.data.user))
      navigate('/mobile')
    } catch (error: any) {
      setErr(apiError(error, 'Login failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg-page)] flex items-center justify-center p-4">
      <div className="border border-[var(--border-main)] bg-[var(--bg-surface)] p-6 sm:p-8 max-w-sm w-full shadow-lg rounded-2xl space-y-4">
        <div className="text-center space-y-1">
          <div className="flex h-11 w-11 items-center justify-center bg-emerald-700 text-white font-bold rounded-xl mx-auto mb-2 shadow-xs">
            D
          </div>
          <h1 className="text-xl font-bold text-[var(--text-heading)]">Shopkeeper Sign In</h1>
          <p className="text-xs text-[var(--text-muted)]">Sign in to manage your kitchen orders</p>
        </div>

        {err && (
          <div className="p-3.5 rounded-xl border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-xs font-semibold text-red-700 dark:text-red-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{err}</span>
          </div>
        )}

        <form onSubmit={submit} className="space-y-3.5">
          <Input
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Your shop username"
            required
          />

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1">
              Password
            </label>
            <PasswordField
              value={password}
              onChange={setPassword}
              placeholder="Your password"
              autoComplete="current-password"
            />
          </div>

          <div className="flex justify-end">
            <Link
              to="/forgot-password"
              className="text-xs font-semibold text-emerald-600 hover:text-emerald-700"
            >
              Forgot password?
            </Link>
          </div>

          <Button variant="primary" size="md" type="submit" loading={loading} className="w-full">
            Sign In to Shop
          </Button>
        </form>

        <p className="text-center text-xs text-[var(--text-muted)] pt-3 border-t border-[var(--border-subtle)]">
          New shopkeeper?{' '}
          <Link to="/register" className="font-bold text-emerald-600 hover:text-emerald-700">
            Register your shop
          </Link>
        </p>
      </div>
    </div>
  )
}
export default LoginPage
