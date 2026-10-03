import React from 'react'

interface StatCardProps {
  title: string
  value: string | number
  subtitle?: string
  icon?: React.ReactNode
  trend?: {
    value: string
    isPositive?: boolean
  }
  badge?: React.ReactNode
  variant?: 'default' | 'emerald' | 'gold' | 'warning' | 'info'
  onClick?: () => void
  className?: string
}

export function StatCard({
  title,
  value,
  subtitle,
  icon,
  trend,
  badge,
  variant = 'default',
  onClick,
  className = '',
}: StatCardProps) {
  const borderHighlight = {
    default: 'hover:border-emerald-600/50',
    emerald: 'border-l-4 border-l-emerald-600',
    gold: 'border-l-4 border-l-amber-500',
    warning: 'border-l-4 border-l-red-500',
    info: 'border-l-4 border-l-blue-500',
  }[variant]

  return (
    <div
      onClick={onClick}
      className={`border bg-white dark:bg-admin-surface-dark border-gray-200 dark:border-admin-border-dark p-4 transition-all duration-150 ${borderHighlight} ${
        onClick ? 'cursor-pointer hover:shadow-md dark:hover:bg-admin-surface-darkHover' : ''
      } ${className}`}
      style={{ borderRadius: 0 }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 truncate">
            {title}
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-black text-gray-900 dark:text-white tabular-nums tracking-tight">
              {value}
            </span>
            {trend && (
              <span
                className={`text-xs font-semibold ${
                  trend.isPositive
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-red-600 dark:text-red-400'
                }`}
              >
                {trend.value}
              </span>
            )}
          </div>
          {subtitle && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 line-clamp-1">{subtitle}</p>
          )}
        </div>

        {icon && (
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center border border-gray-100 dark:border-admin-border-dark bg-gray-50 dark:bg-admin-surface-darkSubtle text-emerald-600 dark:text-emerald-400"
            style={{ borderRadius: 0 }}
          >
            {icon}
          </div>
        )}

        {badge && <div className="shrink-0">{badge}</div>}
      </div>
    </div>
  )
}
