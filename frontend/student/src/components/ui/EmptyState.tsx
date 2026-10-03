import React from 'react'
import { Link } from 'react-router-dom'
import { ShoppingBag, Search, Package, Star, ArrowRight } from './Icons'

interface EmptyStateProps {
  type?: 'cart' | 'search' | 'orders' | 'reviews' | 'generic'
  title: string
  description?: string
  actionLabel?: string
  actionLink?: string
  onAction?: () => void
  icon?: React.ReactNode
}

export function EmptyState({
  type = 'generic',
  title,
  description,
  actionLabel,
  actionLink,
  onAction,
  icon,
}: EmptyStateProps) {
  const defaultIcon = () => {
    switch (type) {
      case 'cart':
        return <ShoppingBag className="h-10 w-10 text-emerald-600" />
      case 'search':
        return <Search className="h-10 w-10 text-amber-600" />
      case 'orders':
        return <Package className="h-10 w-10 text-emerald-600" />
      case 'reviews':
        return <Star className="h-10 w-10 text-amber-500" />
      default:
        return <Package className="h-10 w-10 text-slate-400" />
    }
  }

  return (
    <div className="rounded-panel border border-dashed border-slate-300 bg-white p-10 text-center flex flex-col items-center justify-center my-6">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-50 border border-slate-200 mb-4 shadow-sm">
        {icon || defaultIcon()}
      </div>
      <h3 className="text-lg font-bold text-slate-900">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-md text-sm text-slate-500 leading-relaxed">
          {description}
        </p>
      )}
      {(actionLabel && (actionLink || onAction)) && (
        <div className="mt-5">
          {actionLink ? (
            <Link
              to={actionLink}
              className="inline-flex items-center gap-2 rounded-btn bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-primary-dark transition-all active:scale-98"
            >
              <span>{actionLabel}</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          ) : (
            <button
              onClick={onAction}
              className="inline-flex items-center gap-2 rounded-btn bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-primary-dark transition-all active:scale-98"
            >
              <span>{actionLabel}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
