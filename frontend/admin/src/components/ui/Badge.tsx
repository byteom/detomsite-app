import React from 'react'

export type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'gold' | 'default' | 'neutral' | 'purple'

interface BadgeProps {
  children: React.ReactNode
  variant?: BadgeVariant
  size?: 'xs' | 'sm' | 'md'
  dot?: boolean
  className?: string
}

const variantStyles: Record<BadgeVariant, { bg: string; text: string; dot: string }> = {
  success: {
    bg: 'bg-emerald-500/10 border-emerald-500/30 dark:bg-emerald-950/40 dark:border-emerald-700/40',
    text: 'text-emerald-700 dark:text-emerald-400 font-semibold',
    dot: 'bg-emerald-500',
  },
  warning: {
    bg: 'bg-amber-500/10 border-amber-500/30 dark:bg-amber-950/40 dark:border-amber-700/40',
    text: 'text-amber-700 dark:text-amber-400 font-semibold',
    dot: 'bg-amber-500',
  },
  error: {
    bg: 'bg-red-500/10 border-red-500/30 dark:bg-red-950/40 dark:border-red-700/40',
    text: 'text-red-700 dark:text-red-400 font-semibold',
    dot: 'bg-red-500',
  },
  info: {
    bg: 'bg-blue-500/10 border-blue-500/30 dark:bg-blue-950/40 dark:border-blue-700/40',
    text: 'text-blue-700 dark:text-blue-400 font-semibold',
    dot: 'bg-blue-500',
  },
  gold: {
    bg: 'bg-amber-400/15 border-amber-400/30 dark:bg-amber-900/30 dark:border-amber-600/40',
    text: 'text-amber-700 dark:text-amber-300 font-semibold',
    dot: 'bg-amber-400',
  },
  purple: {
    bg: 'bg-purple-500/10 border-purple-500/30 dark:bg-purple-950/40 dark:border-purple-700/40',
    text: 'text-purple-700 dark:text-purple-300 font-semibold',
    dot: 'bg-purple-500',
  },
  default: {
    bg: 'bg-gray-100 border-gray-200 dark:bg-gray-800/60 dark:border-gray-700/50',
    text: 'text-gray-700 dark:text-gray-300 font-medium',
    dot: 'bg-gray-400',
  },
  neutral: {
    bg: 'bg-gray-100 border-gray-200 dark:bg-gray-800/80 dark:border-gray-700',
    text: 'text-gray-600 dark:text-gray-400 font-medium',
    dot: 'bg-gray-400',
  },
}

const sizeStyles = {
  xs: 'px-1.5 py-0.5 text-[10px] leading-tight',
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-1 text-xs',
}

export function Badge({ children, variant = 'default', size = 'sm', dot = false, className = '' }: BadgeProps) {
  const v = variantStyles[variant] || variantStyles.default
  const s = sizeStyles[size]

  return (
    <span
      className={`inline-flex items-center gap-1.5 border tracking-wide uppercase ${v.bg} ${v.text} ${s} ${className}`}
      style={{ borderRadius: 0 }}
    >
      {dot && <span className={`h-1.5 w-1.5 shrink-0 ${v.dot}`} style={{ borderRadius: 0 }} />}
      {children}
    </span>
  )
}
