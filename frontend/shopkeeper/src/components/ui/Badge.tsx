import React from 'react'

export type BadgeVariant =
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'gold'
  | 'purple'
  | 'cyan'
  | 'orange'
  | 'default'
  | 'neutral'

interface BadgeProps {
  children: React.ReactNode
  variant?: BadgeVariant
  size?: 'xs' | 'sm' | 'md'
  dot?: boolean
  className?: string
}

const variantClasses: Record<BadgeVariant, string> = {
  success: 'badge-solid-success',
  warning: 'badge-solid-warning',
  orange: 'badge-solid-orange',
  error: 'badge-solid-error',
  info: 'badge-solid-info',
  gold: 'badge-solid-gold',
  purple: 'badge-solid-purple',
  cyan: 'badge-solid-cyan',
  default: 'badge-solid-default',
  neutral: 'badge-solid-neutral',
}

const sizeStyles: Record<'xs' | 'sm' | 'md', string> = {
  xs: 'px-2 py-0.5 text-[11px] font-bold',
  sm: 'px-2.5 py-0.5 text-xs font-bold',
  md: 'px-3 py-1 text-xs font-black',
}

export function Badge({
  children,
  variant = 'default',
  size = 'sm',
  dot = false,
  className = '',
}: BadgeProps) {
  const vClass = variantClasses[variant] || variantClasses.default
  const sClass = sizeStyles[size] || sizeStyles.sm

  return (
    <span
      className={`badge-solid-base rounded-full ${vClass} ${sClass} ${className}`}
    >
      {dot && (
        <span
          className="badge-dot h-1.5 w-1.5 shrink-0 inline-block rounded-full"
        />
      )}
      {children}
    </span>
  )
}
