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
      className={`border bg-white dark:bg-admin-surface-dark border-gray-200 dark:border-admin-border-dark transition-colors duration-150 ${className}`}
      style={{ borderRadius: 0 }}
    >
      {hasHeader && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-gray-200 dark:border-admin-border-dark bg-gray-50/50 dark:bg-admin-surface-darkSubtle/40">
          <div>
            {title && (
              <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</p>
            )}
          </div>
          {action && <div className="flex items-center gap-2">{action}</div>}
        </div>
      )}

      <div className={noPadding ? '' : 'p-5'}>{children}</div>

      {footer && (
        <div className="px-5 py-3 border-t border-gray-200 dark:border-admin-border-dark bg-gray-50/40 dark:bg-admin-surface-darkSubtle/30">
          {footer}
        </div>
      )}
    </div>
  )
}
