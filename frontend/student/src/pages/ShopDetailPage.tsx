import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Shop, Product, CartItem } from '../types'
import {
  isShopOrderable,
  shopStatusReason,
  getCart,
  setItemQty,
  addToCart,
  replaceCartWith,
  cartShopConflict,
  getCategoryPhoto,
} from '../utils/helpers'
import api from '../services/api'
import { usePolling } from '../hooks/usePolling'
import { MenuItemCard } from '../components/food/MenuItemCard'
import { MenuItemSkeleton } from '../components/ui/Skeleton'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
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

const MENU_PAGE = 20

export function ShopDetailPage() {
  const { shopId } = useParams<{ shopId: string }>()
  const [shop, setShop] = useState<Shop | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  // Split loading states: the shop header renders as soon as the shop row
  // arrives; the menu section shows skeletons until the products arrive.
  // A slow menu fetch must never block the critical header (and vice versa).
  const [shopLoading, setShopLoading] = useState(true)
  const [menuLoading, setMenuLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState('All')
  // Infinite scroll: only the first MENU_PAGE dishes render; the sentinel
  // below grows the budget as the student scrolls. No extra requests — it
  // slices the already-fetched per-shop menu.
  const [visibleCount, setVisibleCount] = useState(MENU_PAGE)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  // Guards against a slow response from shop A overwriting shop B after a
  // fast navigation between two shop pages.
  const reqId = useRef(0)

  // Cart state sync
  const [cart, setCart] = useState<CartItem[]>(() => getCart())
  useEffect(() => {
    const sync = () => setCart(getCart())
    window.addEventListener('cart-updated', sync)
    return () => window.removeEventListener('cart-updated', sync)
  }, [])

  // Cross-shop add awaiting user confirm (one kitchen per cart).
  const [pendingReplace, setPendingReplace] = useState<{ product: Product; qty: number } | null>(null)

  // Reset per-shop state when navigating between shops.
  useEffect(() => {
    setShop(null)
    setProducts([])
    setShopLoading(true)
    setMenuLoading(true)
    setSearch('')
    setActiveCategory('All')
    setVisibleCount(MENU_PAGE)
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })
  }, [shopId])

  const load = useCallback(() => {
    if (!shopId) return
    const id = ++reqId.current
    // Independent fetches — neither blocks the other. The menu is scoped to
    // one shop (index-served); limit 500 is the backend max and covers the
    // largest real menu (s30: 187 items) in one small (~60KB) fetch. Render
    // stays cheap via infinite scroll no matter how large the menu gets.
    api
      .get<Shop>(`/local/shops/${shopId}`)
      .then((s) => {
        if (reqId.current === id) setShop(s.data)
      })
      .catch(() => {
        if (reqId.current === id) setShop(null)
      })
      .finally(() => {
        if (reqId.current === id) setShopLoading(false)
      })
    api
      .get<Product[]>('/local/products', { params: { shop_id: shopId, limit: 500 } })
      .then((p) => {
        if (reqId.current === id) setProducts(p.data || [])
      })
      .catch(() => {
        if (reqId.current === id) setProducts([])
      })
      .finally(() => {
        if (reqId.current === id) setMenuLoading(false)
      })
  }, [shopId])

  // 15s visibility-aware poll — open/closed flips and availability surface
  // promptly; background tabs never hammer the API.
  usePolling(load, 15000, [shopId])

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

  // Single pass over the (tiny) cart per render instead of one
  // `cart.find` linear scan per menu row.
  const cartQtyById = useMemo(() => {
    const map = new Map<string, number>()
    for (const item of cart) map.set(item.product_id, item.quantity || 0)
    return map
  }, [cart])

  // New filter or new shop → start back at the first page of results.
  useEffect(() => {
    setVisibleCount(MENU_PAGE)
  }, [shopId, search, activeCategory])

  const visibleProducts = filteredProducts.slice(0, visibleCount)
  const hasMore = filteredProducts.length > visibleCount

  useEffect(() => {
    if (!hasMore) return
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleCount((c) => (c >= filteredProducts.length ? c : c + MENU_PAGE))
        }
      },
      { rootMargin: '600px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, filteredProducts.length])

  if (shopLoading) {
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
      } else if (addToCart(product, shop, newQty) === 'confirm-required') {
        // One kitchen per cart: ask before swapping kitchens.
        setPendingReplace({ product, qty: newQty })
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
            decoding="async"
            fetchPriority="high"
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
            {menuLoading
              ? 'Full Menu'
              : `${activeCategory === 'All' ? 'Full Menu' : activeCategory} (${filteredProducts.length})`}
          </h2>
        </div>

        {menuLoading ? (
          [...Array(3)].map((_, i) => <MenuItemSkeleton key={i} />)
        ) : (
          <>
            {visibleProducts.map((p) => {
          const qty = cartQtyById.get(p.id) ?? 0

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
        {hasMore && (
          <div ref={sentinelRef} className="space-y-3" aria-hidden>
            {[...Array(3)].map((_, i) => (
              <MenuItemSkeleton key={i} />
            ))}
          </div>
        )}
          </>
        )}
      </div>

      {/* One kitchen per cart: confirm before swapping kitchens. */}
      <ConfirmDialog
        open={pendingReplace !== null}
        title="Replace cart?"
        message={
          pendingReplace ? (
            <span>
              Your cart has items from <b>{cartShopConflict(shop.id).currentShopName}</b>.
              Adding from <b>{shop.name}</b> will clear those items first.
            </span>
          ) : null
        }
        confirmLabel="Replace cart"
        onConfirm={() => {
          if (pendingReplace && shop) {
            replaceCartWith(pendingReplace.product, shop, pendingReplace.qty)
          }
          setPendingReplace(null)
        }}
        onCancel={() => setPendingReplace(null)}
      />
    </div>
  )
}
