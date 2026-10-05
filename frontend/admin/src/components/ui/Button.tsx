import React from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline' | 'gold' | 'success'
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: React.ReactNode
  iconRight?: React.ReactNode
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-emerald-700 hover:bg-emerald-600 active:bg-emerald-800 text-white font-semibold border border-emerald-600 dark:bg-emerald-600 dark:hover:bg-emerald-500 dark:border-emerald-500 shadow-sm',
  secondary:
    'bg-[var(--bg-surface)] border border-[var(--border-main)] text-[var(--text-heading)] hover:bg-[var(--bg-surface-hover)] font-medium shadow-xs',
  danger:
    'bg-red-600 hover:bg-red-500 active:bg-red-700 text-white font-semibold border border-red-700 dark:bg-red-700 dark:hover:bg-red-600 shadow-sm',
  ghost:
    'bg-transparent hover:bg-[var(--bg-surface-hover)] text-[var(--text-heading)] font-medium',
  outline:
    'bg-transparent border border-emerald-600 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 font-semibold',
  gold:
    'bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-gray-950 font-bold border border-amber-600 shadow-sm',
  success:
    'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-semibold border border-emerald-700 shadow-sm',
}

const sizeStyles: Record<ButtonSize, string> = {
  xs: 'px-2 py-1 text-xs gap-1',
  sm: 'px-3 py-1.5 text-xs gap-1.5',
  md: 'px-4 py-2 text-sm gap-2',
  lg: 'px-5 py-2.5 text-base gap-2.5',
}

export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled = false,
  icon,
  iconRight,
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  const v = variantStyles[variant] || variantStyles.secondary
  const s = sizeStyles[size]

  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center transition-all duration-150 select-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${v} ${s} ${className}`}
      style={{ borderRadius: 0 }}
      {...props}
    >
      {loading ? (
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      ) : (
        icon && <span className="shrink-0">{icon}</span>
      )}
      <span>{children}</span>
      {!loading && iconRight && <span className="shrink-0">{iconRight}</span>}
    </button>
  )
}
