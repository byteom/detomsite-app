import React, { useState, useEffect, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Shop, Product, CartItem } from '../types'
import {
  isShopOrderable,
  shopStatusReason,
  getCart,
  setItemQty,
  addToCart,
  getCategoryPhoto,
} from '../utils/helpers'
import api from '../services/api'
import { MenuItemCard } from '../components/food/MenuItemCard'
import { MenuItemSkeleton } from '../components/ui/Skeleton'
import { EmptyState } from '../components/ui/EmptyState'
import {
  Star,
  Clock,
  Phone,
  Search,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
  ChevronLeft,
} from '../components/ui/Icons'

export function ShopDetailPage() {
  const { shopId } = useParams<{ shopId: string }>()
  const [shop, setShop] = useState<Shop | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState('All')

  // Cart state sync
  const [cart, setCart] = useState<CartItem[]>(() => getCart())
  useEffect(() => {
    const sync = () => setCart(getCart())
    window.addEventListener('cart-updated', sync)
    return () => window.removeEventListener('cart-updated', sync)
  }, [])

  useEffect(() => {
    if (!shopId) return
    setLoading(true)
    Promise.all([
      api.get<Shop>(`/local/shops/${shopId}`),
      api.get<Product[]>('/local/products', { params: { shop_id: shopId } }),
    ])
      .then(([s, p]) => {
        setShop(s.data)
        setProducts(p.data || [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [shopId])

  // Extract available categories
  const categories = useMemo(() => {
    const set = new Set<string>()
    products.forEach((p) => {
      if (p.category) set.add(p.category)
      if (p.is_combo) set.add('Combos')
    })
    return ['All', ...Array.from(set)]
  }, [products])

  // Filtered menu items
  const q = search.toLowerCase().trim()
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (!p.available) return false

      // Category filter
      if (activeCategory === 'Combos') {
        if (!p.is_combo) return false
      } else if (activeCategory !== 'All' && p.category !== activeCategory) {
        return false
      }

      // Search query
      if (q) {
        const matches = `${p.name} ${p.description || ''} ${p.category || ''} ${p.combo_items || ''}`
          .toLowerCase()
          .includes(q)
        if (!matches) return false
      }

      return true
    })
  }, [products, activeCategory, q])

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 space-y-6">
        <div className="h-56 rounded-panel skeleton-shimmer bg-slate-200" />
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => (
            <MenuItemSkeleton key={i} />
          ))}
        </div>
      </div>
    )
  }

  if (!shop) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 text-center">
        <EmptyState
          title="Restaurant not found"
          description="The campus kitchen you are looking for does not exist or may have been removed."
          actionLabel="Back to All Kitchens"
          actionLink="/shops"
        />
      </div>
    )
  }

  const orderable = isShopOrderable(shop)
  const coverPhoto = shop.image_url || getCategoryPhoto(shop.category, shop.name)

  const handleQuantityChange = (product: Product, newQty: number) => {
    if (newQty === 0) {
      setItemQty(product.id, 0)
    } else {
      const existing = cart.find((i) => i.product_id === product.id)
      if (existing) {
        setItemQty(product.id, newQty)
      } else {
        addToCart(product, shop, newQty)
      }
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      {/* Back button */}
      <Link
        to="/shops"
        className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-emerald-700 transition-colors mb-4"
      >
        <ChevronLeft className="h-4 w-4" />
        <span>Back to all restaurants</span>
      </Link>

      {/* Restaurant Hero Header */}
      <div className="relative overflow-hidden rounded-panel bg-slate-900 text-white shadow-card mb-6">
        {/* Cover Photo */}
        <div className="relative h-48 sm:h-64 w-full">
          <img
            src={coverPhoto}
            alt={shop.name}
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />

          {/* Status pill in header */}
          <div className="absolute top-4 right-4">
            <span
              className={`inline-flex items-center gap-1.5 rounded-pill px-3 py-1 text-xs font-bold backdrop-blur-md shadow-sm ${
                orderable
                  ? 'bg-emerald-950/80 text-emerald-200 border border-emerald-400/40'
                  : 'bg-slate-900/80 text-slate-300 border border-slate-700/50'
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  orderable ? 'bg-emerald-400 animate-pulse' : 'bg-slate-400'
                }`}
              />
              <span>{orderable ? 'Open for Orders' : 'Closed'}</span>
            </span>
          </div>

          {/* Restaurant Details overlaid */}
          <div className="absolute bottom-4 left-4 right-4 sm:bottom-6 sm:left-6 sm:right-6">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded-sm border border-emerald-500/30">
                  {shop.category}
                </span>
                <span className="inline-flex items-center gap-1 rounded-sm bg-emerald-700 text-white px-1.5 py-0.5 text-xs font-bold">
                  <Star className="h-3 w-3 fill-current text-amber-300" />
                  <span>{Number(shop.rating || 4.5).toFixed(1)}</span>
                </span>
              </div>

              <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                {shop.name}
              </h1>

              {shop.description && (
                <p className="text-xs sm:text-sm text-slate-200 line-clamp-2 max-w-2xl mt-0.5">
                  {shop.description}
                </p>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-300 font-medium">
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5 text-emerald-400" />
                  <span>{shop.opening_time} - {shop.closing_time}</span>
                </span>
                {shop.phone && (
                  <span className="flex items-center gap-1">
                    <Phone className="h-3.5 w-3.5 text-emerald-400" />
                    <span>{shop.phone}</span>
                  </span>
                )}
                <span className="text-emerald-300">
                  📍 VIT-AP Main Gate Delivery
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Closed Notice Banner if shop cannot accept orders */}
      {!orderable && (
        <div className="mb-6 flex items-start gap-3 rounded-card border border-amber-300 bg-amber-50 p-4 text-sm font-semibold text-amber-900 shadow-sm">
          <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="leading-relaxed">
            <p className="font-bold">{shopStatusReason(shop)}</p>
            <p className="text-xs text-amber-800 mt-0.5">
              You can still browse the full menu. Ordering will unlock as soon as the kitchen vendor turns on orders.
            </p>
          </div>
        </div>
      )}

      {/* In-Menu Search & Category Tabs */}
      <div className="mb-6 space-y-4">
        {/* Search within menu */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search dishes in ${shop.name}...`}
            className="w-full rounded-btn border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-900 placeholder-slate-400 outline-none transition-all focus:border-emerald-600 focus:shadow-sm"
          />
        </div>

        {/* Category Pills */}
        {categories.length > 2 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none no-scrollbar">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                className={`shrink-0 rounded-pill px-3.5 py-1.5 text-xs font-bold transition-all ${
                  activeCategory === cat
                    ? 'bg-emerald-700 text-white shadow-sm'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Menu Items List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between pb-1">
          <h2 className="text-lg font-bold text-slate-900">
            {activeCategory === 'All' ? 'Full Menu' : activeCategory} ({filteredProducts.length})
          </h2>
        </div>

        {filteredProducts.map((p) => {
          const cartEntry = cart.find((i) => i.product_id === p.id)
          const qty = cartEntry ? cartEntry.quantity || 1 : 0

          return (
            <MenuItemCard
              key={p.id}
              product={p}
              shop={shop}
              quantity={qty}
              onQuantityChange={(newQty) => handleQuantityChange(p, newQty)}
              orderable={orderable}
            />
          )
        })}

        {filteredProducts.length === 0 && (
          <EmptyState
            type="search"
            title={search ? `No items match "${search}"` : 'No items available in this category'}
            description="Try searching for another dish or choosing a different category."
            actionLabel="View All Items"
            onAction={() => {
              setSearch('')
              setActiveCategory('All')
            }}
          />
        )}
      </div>
    </div>
  )
}
