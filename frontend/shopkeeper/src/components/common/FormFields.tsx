import React, { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

export function isValidMobile(v: string) {
  const d = v.replace(/\D/g, '')
  return d.length === 10 || (d.length === 12 && d.startsWith('91'))
}

export function toE164(v: string) {
  let d = v.replace(/\D/g, '')
  if (d.length > 10 && d.startsWith('91')) d = d.slice(2)
  d = d.slice(-10)
  return d ? `+91${d}` : ''
}

export function displayDigits(v: string) {
  let d = v.replace(/\D/g, '')
  const raw = String(v || '')
  if (d.startsWith('91') && (raw.startsWith('+91') || d.length > 10)) d = d.slice(2)
  return d.slice(-10)
}

export function PhoneField({
  value,
  onChange,
  placeholder = '98765 43210',
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const digits = displayDigits(value)
  return (
    <input
      type="tel"
      inputMode="numeric"
      autoComplete="off"
      value={digits}
      required
      onChange={(e) => onChange(toE164(e.target.value))}
      placeholder={placeholder}
      className="w-full rounded-lg px-3 py-2 text-xs border border-[var(--border-main)] bg-[var(--bg-surface)] text-[var(--text-heading)] placeholder:text-[var(--text-dim)] outline-none"
    />
  )
}

export function PasswordField({
  value,
  onChange,
  placeholder = '••••••',
  autoComplete,
  required = true,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoComplete?: string
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
        autoComplete={autoComplete}
        required={required}
        className="w-full rounded-lg px-3 py-2 pr-9 text-xs border border-[var(--border-main)] bg-[var(--bg-surface)] text-[var(--text-heading)] placeholder:text-[var(--text-dim)] outline-none"
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        tabIndex={-1}
        aria-label={show ? 'Hide password' : 'Show password'}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-dim)] hover:text-[var(--text-heading)]"
      >
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  )
}
