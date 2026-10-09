import React, { useState, useMemo } from 'react'
import {
  Layers,
  Search,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Plus,
  Minus,
  RefreshCw,
  X,
  Package,
} from 'lucide-react'
import { Product } from '../types'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { fmtCurrency } from '../utils/formatters'

interface InventoryPageProps {
  products: Product[]
  onUpdateInventory: (productId: string, newInventory: number) => Promise<void>
  onUpdateAvailable: (productId: string, available: boolean) => Promise<void>
}

type StockFilter = 'all' | 'low' | 'out' | 'in_stock'

export function InventoryPage({
  products,
  onUpdateInventory,
  onUpdateAvailable,
}: InventoryPageProps) {
  const [stockFilter, setStockFilter] = useState<StockFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  // Counts
  const totalProducts = products.length
  const lowStockProducts = products.filter((p) => {
    const inv = Number(p.inventory) || 0
    return inv > 0 && inv <= 5
  })
  const outOfStockProducts = products.filter((p) => (Number(p.inventory) || 0) === 0)
  const inStockProducts = products.filter((p) => (Number(p.inventory) || 0) > 5)

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const inv = Number(p.inventory) || 0

      // 1. Stock Filter
      if (stockFilter === 'low' && (inv === 0 || inv > 5)) return false
      if (stockFilter === 'out' && inv !== 0) return false
      if (stockFilter === 'in_stock' && inv <= 5) return false

      // 2. Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const matchesName = (p.name || '').toLowerCase().includes(q)
        const matchesCat = (p.category || '').toLowerCase().includes(q)
        if (!matchesName && !matchesCat) return false
      }

      return true
    })
  }, [products, stockFilter, searchQuery])

  const handleAdjust = async (product: Product, delta: number) => {
    const current = Number(product.inventory) || 0
    const next = Math.max(0, current + delta)
    if (next === current) return
    setUpdatingId(product.id)
    try {
      await onUpdateInventory(product.id, next)
    } finally {
      setUpdatingId(null)
    }
  }

  const handleSetExact = async (product: Product, exact: number) => {
    const next = Math.max(0, exact)
    setUpdatingId(product.id)
    try {
      await onUpdateInventory(product.id, next)
    } finally {
      setUpdatingId(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* ─── Header ─── */}
      <div className="border-b border-[var(--border-main)] pb-3">
        <h1 className="text-lg sm:text-xl font-black text-[var(--text-heading)] flex items-center gap-2">
          <Layers className="w-5 h-5 text-emerald-600" />
          Inventory Desk
        </h1>
        <p className="text-xs text-[var(--text-muted)]">
          Fast stock level adjustment, out-of-stock guards, and replenishment
        </p>
      </div>

      {/* ─── Stock Health Overview Cards ─── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <button
          type="button"
          onClick={() => setStockFilter('all')}
          className={`p-3.5 rounded-xl border text-left transition-all ${
            stockFilter === 'all'
              ? 'border-emerald-600 bg-emerald-500/10 shadow-xs'
              : 'border-[var(--border-main)] bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)]'
          }`}
        >
          <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] block">
            All Products
          </span>
          <span className="text-xl font-black text-[var(--text-heading)] tabular-nums mt-0.5 block">
            {totalProducts}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setStockFilter('low')}
          className={`p-3.5 rounded-xl border text-left transition-all ${
            stockFilter === 'low'
              ? 'border-amber-500 bg-amber-500/10 shadow-xs'
              : 'border-[var(--border-main)] bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)]'
          }`}
        >
          <span className="text-[11px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" /> Low Stock (≤ 5)
          </span>
          <span className="text-xl font-black text-[var(--text-heading)] tabular-nums mt-0.5 block">
            {lowStockProducts.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setStockFilter('out')}
          className={`p-3.5 rounded-xl border text-left transition-all ${
            stockFilter === 'out'
              ? 'border-red-500 bg-red-500/10 shadow-xs'
              : 'border-[var(--border-main)] bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)]'
          }`}
        >
          <span className="text-[11px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400 flex items-center gap-1">
            <XCircle className="w-3.5 h-3.5" /> Out of Stock (0)
          </span>
          <span className="text-xl font-black text-[var(--text-heading)] tabular-nums mt-0.5 block">
            {outOfStockProducts.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setStockFilter('in_stock')}
          className={`p-3.5 rounded-xl border text-left transition-all ${
            stockFilter === 'in_stock'
              ? 'border-emerald-600 bg-emerald-500/10 shadow-xs'
              : 'border-[var(--border-main)] bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)]'
          }`}
        >
          <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" /> In Stock (&gt; 5)
          </span>
          <span className="text-xl font-black text-[var(--text-heading)] tabular-nums mt-0.5 block">
            {inStockProducts.length}
          </span>
        </button>
      </div>

      {/* ─── Search input ─── */}
      <div className="relative">
        <Search className="w-4 h-4 text-[var(--text-dim)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Filter inventory by product name or category..."
          className="w-full pl-9 pr-9 py-2.5 text-xs rounded-xl border border-[var(--border-main)] bg-[var(--bg-surface)] text-[var(--text-heading)] placeholder:text-[var(--text-dim)] outline-none focus:border-emerald-600 transition-colors shadow-xs"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-full text-[var(--text-dim)] hover:text-[var(--text-heading)]"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* ─── Inventory Cards List ─── */}
      {filteredProducts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border-main)] p-12 text-center bg-[var(--bg-surface-subtle)] space-y-2">
          <Package className="w-8 h-8 text-[var(--text-dim)] mx-auto opacity-70" />
          <h3 className="font-bold text-sm text-[var(--text-heading)]">No products in this view</h3>
          <p className="text-xs text-[var(--text-muted)]">
            Try switching stock filters or clearing the search query
          </p>
          {(stockFilter !== 'all' || searchQuery) && (
            <div className="pt-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setStockFilter('all')
                  setSearchQuery('')
                }}
              >
                Reset Filter
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredProducts.map((p) => {
            const inventory = Number(p.inventory) || 0
            const isAvailable = Boolean(p.available)
            const isUpdating = updatingId === p.id

            const stockState =
              inventory === 0 ? 'out' : inventory <= 5 ? 'low' : 'ok'

            const badgeConfig = {
              out: {
                variant: 'error' as const,
                label: 'Out of Stock',
                icon: <XCircle className="w-3 h-3" />,
              },
              low: {
                variant: 'warning' as const,
                label: `Low Stock (${inventory})`,
                icon: <AlertTriangle className="w-3 h-3" />,
              },
              ok: {
                variant: 'success' as const,
                label: `In Stock (${inventory})`,
                icon: <CheckCircle2 className="w-3 h-3" />,
              },
            }[stockState]

            return (
              <div
                key={p.id}
                className="rounded-2xl border border-[var(--border-main)] bg-[var(--bg-surface)] p-4 sm:p-5 space-y-3.5 shadow-xs"
              >
                {/* Top: Product Name, Category, Price & Badge */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-sm text-[var(--text-heading)]">
                        {p.name}
                      </h3>
                      <Badge variant={badgeConfig.variant} size="xs">
                        {badgeConfig.icon}
                        <span>{badgeConfig.label}</span>
                      </Badge>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                      Category: {p.category} · Price: {fmtCurrency(p.price)}
                    </p>
                  </div>

                  {/* Available Switch */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--text-dim)]">Status:</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isAvailable}
                      onClick={() => onUpdateAvailable(p.id, !isAvailable)}
                      className={`px-3 py-1 text-xs font-bold rounded-full transition-colors border ${
                        isAvailable
                          ? 'bg-emerald-600/10 border-emerald-600 text-emerald-700 dark:text-emerald-400'
                          : 'bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {isAvailable ? 'Active on Menu' : 'Disabled on Menu'}
                    </button>
                  </div>
                </div>

                {/* ─── Quantity Stepper & Quick Actions ─── */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2.5 border-t border-[var(--border-subtle)] bg-[var(--bg-surface-subtle)] p-3 rounded-xl">
                  {/* Stepper with min 44px touch targets */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wide mr-1">
                      Qty:
                    </span>

                    <button
                      type="button"
                      onClick={() => handleAdjust(p, -1)}
                      disabled={inventory <= 0 || isUpdating}
                      className="h-10 w-10 rounded-lg flex items-center justify-center border border-[var(--border-main)] bg-[var(--bg-surface)] text-[var(--text-heading)] hover:bg-[var(--bg-surface-hover)] active:scale-95 disabled:opacity-40 transition-all font-bold shadow-xs"
                      title="Decrease by 1"
                    >
                      <Minus className="w-4 h-4" />
                    </button>

                    <input
                      type="number"
                      min="0"
                      value={inventory}
                      onChange={(e) => handleSetExact(p, parseInt(e.target.value) || 0)}
                      disabled={isUpdating}
                      className="w-16 h-10 rounded-lg text-center font-black text-sm tabular-nums border border-[var(--border-main)] bg-[var(--bg-surface)] text-[var(--text-heading)] outline-none focus:border-emerald-600 shadow-xs"
                    />

                    <button
                      type="button"
                      onClick={() => handleAdjust(p, 1)}
                      disabled={isUpdating}
                      className="h-10 w-10 rounded-lg flex items-center justify-center border border-[var(--border-main)] bg-[var(--bg-surface)] text-[var(--text-heading)] hover:bg-[var(--bg-surface-hover)] active:scale-95 disabled:opacity-40 transition-all font-bold shadow-xs"
                      title="Increase by 1"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>

                  {/* 1-Tap Quick Action shortcuts */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleSetExact(p, 0)}
                      disabled={inventory === 0 || isUpdating}
                      className="flex-1 sm:flex-initial px-3.5 py-2 text-xs font-bold rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/20 text-red-600 hover:bg-red-100 disabled:opacity-40 transition-colors"
                      style={{ minHeight: '40px' }}
                    >
                      Mark 0 (Sold Out)
                    </button>

                    <button
                      type="button"
                      onClick={() => handleAdjust(p, 10)}
                      disabled={isUpdating}
                      className="flex-1 sm:flex-initial px-3.5 py-2 text-xs font-bold rounded-lg border border-emerald-600 bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-40 transition-colors shadow-xs"
                      style={{ minHeight: '40px' }}
                    >
                      +10 Restock
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
