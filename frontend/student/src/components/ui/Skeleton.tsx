import React from 'react'

export function Skeleton({
  className = '',
  rounded = 'rounded-card',
}: {
  className?: string
  rounded?: string
}) {
  return (
    <div
      className={`skeleton-shimmer bg-slate-200 ${rounded} ${className}`}
    />
  )
}

export function ShopCardSkeleton() {
  return (
    <div className="rounded-card border border-slate-200 bg-white p-4 shadow-sm space-y-3">
      <Skeleton className="h-44 w-full rounded-card" />
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-40 rounded-sm" />
        <Skeleton className="h-5 w-12 rounded-pill" />
      </div>
      <Skeleton className="h-4 w-28 rounded-sm" />
      <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
        <Skeleton className="h-4 w-32 rounded-sm" />
        <Skeleton className="h-4 w-20 rounded-pill" />
      </div>
    </div>
  )
}

export function MenuItemSkeleton() {
  return (
    <div className="rounded-card border border-slate-200 bg-white p-4 flex items-center justify-between gap-4">
      <div className="space-y-2 flex-1">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-4 rounded-sm" />
          <Skeleton className="h-5 w-36 rounded-sm" />
        </div>
        <Skeleton className="h-4 w-20 rounded-sm" />
        <Skeleton className="h-3 w-56 rounded-sm" />
      </div>
      <Skeleton className="h-9 w-24 rounded-btn" />
    </div>
  )
}

export function OrderCardSkeleton() {
  return (
    <div className="rounded-card border border-slate-200 bg-white p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Skeleton className="h-5 w-40 rounded-sm" />
          <Skeleton className="h-3 w-28 rounded-sm" />
        </div>
        <Skeleton className="h-6 w-24 rounded-pill" />
      </div>
      <Skeleton className="h-12 w-full rounded-sm" />
      <div className="flex items-center justify-between pt-2 border-t border-slate-100">
        <Skeleton className="h-5 w-20 rounded-sm" />
        <Skeleton className="h-8 w-28 rounded-btn" />
      </div>
    </div>
  )
}

export function StatCardSkeleton() {
  return (
    <div className="rounded-card border border-slate-200 bg-white p-4 space-y-2">
      <Skeleton className="h-3 w-20 rounded-sm" />
      <Skeleton className="h-7 w-24 rounded-sm" />
    </div>
  )
}
