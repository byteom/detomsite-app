import React, { useState, useMemo } from 'react'
import {
  Package,
  Plus,
  Search,
  Clock,
  Trash2,
  Sparkles,
  X,
  AlertTriangle,
} from 'lucide-react'
import { Product } from '../types'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { fmtCurrency } from '../utils/formatters'

interface ProductsPageProps {
  products: Product[]
  approvalStatus: string
  onOpenAddProduct: () => void
  onUpdateAvailable: (productId: string, available: boolean) => Promise<void>
  onDeleteProduct: (productId: string) => Promise<void>
}

const CATEGORIES = ['All', 'Food', 'Beverages', 'Starters', 'Desserts', 'Combo']

export function ProductsPage({
  products,
  approvalStatus,
  onOpenAddProduct,
  onUpdateAvailable,
  onDeleteProduct,
}: ProductsPageProps) {
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [searchQuery, setSearchQuery] = useState('')
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)

  const isApproved = approvalStatus === 'Approved'

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      // 1. Category filter
      if (selectedCategory === 'Combo') {
        if (!p.is_combo && p.category !== 'Combo') return false
      } else if (selectedCategory !== 'All') {
        if (p.category !== selectedCategory) return false
      }

      // 2. Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const matchesName = (p.name || '').toLowerCase().includes(q)
        const matchesDesc = (p.description || '').toLowerCase().includes(q)
        const matchesCombo = (p.combo_items || '').toLowerCase().includes(q)
        if (!matchesName && !matchesDesc && !matchesCombo) return false
      }

      return true
    })
  }, [products, selectedCategory, searchQuery])

  const handleDeleteConfirm = async () => {
    if (!deleteTargetId) return
    const id = deleteTargetId
    setDeleteTargetId(null)
    await onDeleteProduct(id)
  }

  return (
    <div className="space-y-4">
      {/* ─── Top Header & Add Button ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--border-main)] pb-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg sm:text-xl font-black text-[var(--text-heading)] flex items-center gap-2">
              <Package className="w-5 h-5 text-emerald-600" />
              Menu & Products
            </h1>
            {!isApproved && (
              <Badge variant="warning" size="xs">
                {approvalStatus || 'Pending Approval'}
              </Badge>
            )}
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Manage dishes, drinks, combos, stock levels, and kitchen prep times
          </p>
        </div>

        <Button
          variant="primary"
          size="md"
          icon={<Plus className="w-4 h-4" />}
          onClick={onOpenAddProduct}
          className="shadow-xs"
        >
          Add New Product
        </Button>
      </div>

      {/* ─── Non-Approved Shop Notification Banner ─── */}
      {!isApproved && (
        <div className="p-3.5 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-bold">Shop Status: {approvalStatus || 'Pending Approval'}</p>
            <p className="text-[11px] leading-relaxed">
              Your shop registration is under administrative verification. Once approved, you can publish live menu items and receive delivery orders from students.
            </p>
          </div>
        </div>
      )}

      {/* ─── Search & Category Filters ─── */}
      <div className="space-y-2.5">
        <div className="relative">
          <Search className="w-4 h-4 text-[var(--text-dim)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search dishes, ingredients, drinks..."
            className="w-full pl-9 pr-9 py-2.5 text-xs rounded-xl border border-[var(--border-main)] bg-[var(--bg-surface)] text-[var(--text-heading)] placeholder:text-[var(--text-dim)] outline-none focus:border-emerald-600 transition-colors shadow-xs"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-full text-[var(--text-dim)] hover:text-[var(--text-heading)] hover:bg-[var(--bg-surface-hover)]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Category Pills */}
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
          {CATEGORIES.map((cat) => {
            const active = selectedCategory === cat
            const count =
              cat === 'All'
                ? products.length
                : cat === 'Combo'
                ? products.filter((p) => p.is_combo || p.category === 'Combo').length
                : products.filter((p) => p.category === cat).length

            return (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-3.5 py-1.5 text-xs font-bold whitespace-nowrap rounded-full transition-all border ${
                  active
                    ? 'bg-emerald-700 text-white border-emerald-600 shadow-xs'
                    : 'bg-[var(--bg-surface)] text-[var(--text-muted)] border-[var(--border-main)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-heading)]'
                }`}
              >
                {cat} ({count})
              </button>
            )
          })}
        </div>
      </div>

      {/* ─── Product Cards Grid ─── */}
      {filteredProducts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border-main)] p-12 text-center bg-[var(--bg-surface-subtle)] space-y-3">
          <Package className="w-10 h-10 text-[var(--text-dim)] mx-auto opacity-70" />
          <h3 className="font-bold text-base text-[var(--text-heading)]">No products found</h3>
          <p className="text-xs text-[var(--text-muted)] max-w-sm mx-auto">
            {products.length === 0
              ? 'Your menu is empty. Add your first dish to start taking orders from campus students!'
              : 'No items match your active category filter or search query.'}
          </p>

          <div className="pt-2">
            {products.length === 0 ? (
              <Button
                variant="primary"
                size="md"
                icon={<Plus className="w-4 h-4" />}
                onClick={onOpenAddProduct}
              >
                Add Your First Dish
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setSelectedCategory('All')
                  setSearchQuery('')
                }}
              >
                Clear Filters
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {filteredProducts.map((p) => {
            const isAvailable = Boolean(p.available)
            const inventory = Number(p.inventory) || 0
            const isCombo = Boolean(p.is_combo || p.category === 'Combo')

            return (
              <div
                key={p.id}
                className={`rounded-2xl border bg-[var(--bg-surface)] border-[var(--border-main)] p-4 space-y-3 shadow-xs hover:border-emerald-600/40 transition-all ${
                  !isAvailable ? 'opacity-70 bg-[var(--bg-surface-subtle)]' : ''
                }`}
              >
                {/* Product Name, Category & Price */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h3 className="font-bold text-sm text-[var(--text-heading)] truncate">
                        {p.name}
                      </h3>
                      {isCombo && (
                        <Badge variant="purple" size="xs">
                          <Sparkles className="w-2.5 h-2.5" /> COMBO
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs font-semibold text-[var(--text-muted)]">
                        {p.category}
                      </span>
                      {p.prep_time && (
                        <>
                          <span className="text-[var(--text-dim)]">·</span>
                          <span className="text-xs text-[var(--text-dim)] flex items-center gap-1">
                            <Clock className="w-3 h-3" /> {p.prep_time}m prep
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <span className="text-lg font-black text-[var(--text-heading)] tabular-nums shrink-0">
                    {fmtCurrency(p.price)}
                  </span>
                </div>

                {/* Description or Combo items */}
                {p.description && (
                  <p className="text-xs text-[var(--text-muted)] line-clamp-2 leading-relaxed">
                    {p.description}
                  </p>
                )}

                {isCombo && p.combo_items && (
                  <div className="rounded-xl p-2.5 border border-purple-200 dark:border-purple-900/40 bg-purple-50/50 dark:bg-purple-950/20 text-xs text-purple-900 dark:text-purple-200">
                    <p className="font-bold text-[10px] uppercase tracking-wider text-purple-700 dark:text-purple-300">
                      Combo Includes:
                    </p>
                    <p className="text-[11px] whitespace-pre-line mt-0.5 leading-relaxed">{p.combo_items}</p>
                  </div>
                )}

                {/* Stock status indicator */}
                <div className="flex items-center justify-between text-xs pt-2 border-t border-[var(--border-subtle)]">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[var(--text-dim)] font-medium">Stock:</span>
                    <Badge
                      variant={
                        inventory === 0 ? 'error' : inventory <= 5 ? 'warning' : 'success'
                      }
                      size="xs"
                    >
                      {inventory === 0
                        ? 'Out of Stock'
                        : inventory <= 5
                        ? `${inventory} left (Low)`
                        : `${inventory} in stock`}
                    </Badge>
                  </div>

                  {/* Availability Toggle Switch */}
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-[var(--text-muted)]">
                      {isAvailable ? 'Available' : 'Unavailable'}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isAvailable}
                      onClick={() => onUpdateAvailable(p.id, !isAvailable)}
                      className={`relative h-6 w-11 rounded-full transition-colors border ${
                        isAvailable
                          ? 'bg-emerald-600 border-emerald-700'
                          : 'bg-slate-300 dark:bg-slate-700 border-slate-400'
                      }`}
                      title={isAvailable ? 'Click to mark unavailable' : 'Click to mark available'}
                    >
                      <span
                        className={`absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow-xs transition-transform ${
                          isAvailable ? 'translate-x-5' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {/* Actions row: Delete */}
                <div className="pt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setDeleteTargetId(p.id)}
                    className="p-1.5 rounded-lg text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30 text-xs font-semibold flex items-center gap-1 transition-colors"
                    title="Delete product"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete</span>
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ─── Delete Confirmation ─── */}
      <ConfirmDialog
        open={Boolean(deleteTargetId)}
        onClose={() => setDeleteTargetId(null)}
        onConfirm={handleDeleteConfirm}
        title="Delete Product Permanently?"
        description="Are you sure you want to remove this dish from your menu? Students will no longer see it on the campus store."
        confirmText="Delete Product"
        cancelText="Cancel"
        variant="danger"
      />
    </div>
  )
}

export default ProductsPage
