import React, { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  helperText?: string
  icon?: React.ReactNode
  iconRight?: React.ReactNode
}

export function Input({
  label,
  error,
  helperText,
  icon,
  iconRight,
  className = '',
  type = 'text',
  id,
  ...props
}: InputProps) {
  const [showPassword, setShowPassword] = useState(false)
  const isPassword = type === 'password'
  const inputType = isPassword ? (showPassword ? 'text' : 'password') : type
  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined)

  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={inputId}
          className="block text-xs font-bold uppercase tracking-wider text-[var(--text-heading)] mb-1.5"
        >
          {label}
        </label>
      )}

      <div className="relative">
        {icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-dim)] pointer-events-none">
            {icon}
          </div>
        )}

        <input
          id={inputId}
          type={inputType}
          className={`w-full bg-[var(--bg-surface)] border ${
            error
              ? 'border-red-500 focus:border-red-500'
              : 'border-[var(--border-main)] focus:border-emerald-600'
          } px-3.5 py-2.5 text-sm text-[var(--text-heading)] placeholder:text-[var(--text-dim)] outline-none transition-colors duration-150 ${
            icon ? 'pl-9' : ''
          } ${isPassword || iconRight ? 'pr-10' : ''} ${className}`}
          style={{ borderRadius: 0 }}
          {...props}
        />

        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword(p => !p)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-dim)] hover:text-[var(--text-heading)] transition-colors p-1"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            tabIndex={-1}
          >
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}

        {!isPassword && iconRight && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-dim)]">
            {iconRight}
          </div>
        )}
      </div>

      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
      {!error && helperText && (
        <p className="mt-1 text-xs text-[var(--text-muted)]">{helperText}</p>
      )}
    </div>
  )
}
