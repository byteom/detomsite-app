import React from 'react'

interface CardProps {
  children: React.ReactNode
  className?: string
  title?: React.ReactNode
  subtitle?: React.ReactNode
  action?: React.ReactNode
  footer?: React.ReactNode
  noPadding?: boolean
}

export function Card({
  children,
  className = '',
  title,
  subtitle,
  action,
  footer,
  noPadding = false,
}: CardProps) {
  const hasHeader = Boolean(title || subtitle || action)

  return (
    <div
      className={`border rounded-xl shadow-xs overflow-hidden bg-[var(--bg-surface)] border-[var(--border-main)] text-[var(--text-body)] transition-colors duration-150 ${className}`}
    >
      {hasHeader && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-[var(--border-main)] bg-[var(--bg-surface-subtle)]">
          <div>
            {title && (
              <h3 className="text-sm font-bold text-[var(--text-heading)] flex items-center gap-2">
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="text-xs text-[var(--text-muted)] mt-0.5">{subtitle}</p>
            )}
          </div>
          {action && <div className="flex items-center gap-2">{action}</div>}
        </div>
      )}

      <div className={noPadding ? '' : 'p-5'}>{children}</div>

      {footer && (
        <div className="px-5 py-3 border-t border-[var(--border-main)] bg-[var(--bg-surface-subtle)]">
          {footer}
        </div>
      )}
    </div>
  )
}
