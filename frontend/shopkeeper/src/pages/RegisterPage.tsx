import React, { useState, FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import api from '../services/api'
import { apiError } from '../utils/formatters'
import { Input } from '../components/ui/Input'
import { Button } from '../components/ui/Button'
import { PhoneField, PasswordField, isValidMobile } from '../components/common/FormFields'

export function RegisterPage() {
  const navigate = useNavigate()
  const [f, setF] = useState({
    username: '',
    email: '',
    phone: '',
    password: '',
    confirm: '',
    shopName: '',
    shopCategory: '',
    shopDescription: '',
    upiId: '',
  })
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [registered, setRegistered] = useState(false)
  const categories = [
    'Italian',
    'Chinese',
    'Indian',
    'Fast Food',
    'Biryani',
    'Cafe',
    'Bakery',
    'Desserts',
    'Beverages',
    'Japanese',
    'Mexican',
    'Continental',
  ]

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    if (f.password !== f.confirm) {
      setErr('Passwords do not match')
      return
    }
    if (!isValidMobile(f.phone)) {
      setErr('Please enter a valid 10-digit mobile number')
      return
    }
    setLoading(true)
    try {
      await api.post('/vendor/register', {
        username: f.username,
        email: f.email,
        password: f.password,
        name: f.username,
        phone: f.phone,
        shop_name: f.shopName,
        shop_category: f.shopCategory,
        shop_description: f.shopDescription,
        upi_id: f.upiId,
      })
      // Auto-login
      const loginRes = await api.post('/vendor/login', {
        username: f.username,
        password: f.password,
      })
      localStorage.setItem('vendor_token', loginRes.data.access_token)
      localStorage.setItem('vendor_user', JSON.stringify(loginRes.data.user))
      setRegistered(true)
    } catch (error: any) {
      setErr(apiError(error, 'Registration failed'))
    } finally {
      setLoading(false)
    }
  }

  if (registered) {
    return (
      <div className="min-h-screen bg-[var(--bg-page)] flex items-center justify-center p-4">
        <div className="border border-[var(--border-main)] bg-[var(--bg-surface)] p-8 max-w-md w-full text-center space-y-4 shadow-lg rounded-2xl">
          <div className="flex h-12 w-12 items-center justify-center bg-emerald-600/10 text-emerald-600 rounded-full mx-auto">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold text-[var(--text-heading)]">Registration Submitted!</h1>
          <p className="text-xs text-[var(--text-muted)]">
            Your shop "{f.shopName}" has been submitted for administrator review. You can log into your desk to review settings while verification completes.
          </p>
          <Button
            variant="primary"
            size="md"
            onClick={() => navigate('/mobile')}
            className="w-full"
          >
            Open Shopkeeper Desk →
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[var(--bg-page)] flex items-center justify-center p-4 py-12">
      <div className="border border-[var(--border-main)] bg-[var(--bg-surface)] p-6 sm:p-8 max-w-lg w-full shadow-lg rounded-2xl space-y-4">
        <div className="text-center space-y-1">
          <div className="flex h-11 w-11 items-center justify-center bg-emerald-700 text-white font-bold rounded-xl mx-auto mb-2 shadow-xs">
            D
          </div>
          <h1 className="text-xl font-bold text-[var(--text-heading)]">Register Your Shop</h1>
          <p className="text-xs text-[var(--text-muted)]">Create your campus kitchen account</p>
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
            value={f.username}
            onChange={(e) => setF({ ...f, username: e.target.value })}
            placeholder="Choose username"
            required
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Email"
              type="email"
              value={f.email}
              onChange={(e) => setF({ ...f, email: e.target.value })}
              placeholder="you@shop.com"
              required
            />
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1">
                Mobile
              </label>
              <PhoneField value={f.phone} onChange={(v) => setF({ ...f, phone: v })} />
            </div>
          </div>

          <div className="border-t border-[var(--border-subtle)] pt-3 space-y-3">
            <p className="text-xs font-bold text-[var(--text-heading)] uppercase tracking-wider">
              Shop Details
            </p>

            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Shop Name"
                value={f.shopName}
                onChange={(e) => setF({ ...f, shopName: e.target.value })}
                placeholder="e.g. Royal Biryani Hub"
                required
              />

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1">
                  Category
                </label>
                <select
                  value={f.shopCategory}
                  onChange={(e) => setF({ ...f, shopCategory: e.target.value })}
                  className="w-full px-3.5 py-2 text-xs rounded-lg border border-[var(--border-main)] bg-[var(--bg-surface)] text-[var(--text-heading)] outline-none focus:border-emerald-600 transition-colors"
                  required
                >
                  <option value="">Select Category</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <Input
              label="UPI ID for Student Payments (Optional)"
              value={f.upiId}
              onChange={(e) => setF({ ...f, upiId: e.target.value })}
              placeholder="e.g. yourshop@okhdfcbank"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-[var(--border-subtle)] pt-3">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1">
                Password
              </label>
              <PasswordField
                value={f.password}
                onChange={(v) => setF({ ...f, password: v })}
                placeholder="Min 4 characters"
                autoComplete="new-password"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1">
                Confirm
              </label>
              <PasswordField
                value={f.confirm}
                onChange={(v) => setF({ ...f, confirm: v })}
                placeholder="Repeat password"
                autoComplete="new-password"
              />
            </div>
          </div>

          <Button variant="primary" size="md" type="submit" loading={loading} className="w-full">
            Register Shop Account
          </Button>
        </form>

        <p className="text-center text-xs text-[var(--text-muted)] pt-2 border-t border-[var(--border-subtle)]">
          Already registered?{' '}
          <Link to="/login" className="font-bold text-emerald-600 hover:text-emerald-700">
            Sign In
          </Link>
        </p>
      </div>
    </div>
  )
}
export default RegisterPage
