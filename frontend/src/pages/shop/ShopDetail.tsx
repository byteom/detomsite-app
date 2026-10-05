import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiCached } from '../../services/api'
import { canOrderFromShop, LocalProduct, LocalShop, shopStatusText } from '../../types/localApi'
import { addProductToCart, cartShopConflict, getCart, replaceCartWithProduct } from '../../utils/cart'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { usePolling } from '../../hooks/usePolling'
import { same } from '../../utils/same'
import { getShopImage } from '../../utils/shopImages'

/* Combo items are free text (one per line, commas also work). */
function comboItems(product: LocalProduct): string[] {
  return (product.combo_items || '').split(/[\n,]+/).map(item => item.trim()).filter(Boolean)
}

const MENU_PAGE = 20

export function ShopDetail() {
  const { shopId } = useParams<{ shopId: string }>()
  const [shop, setShop] = useState<LocalShop | null>(null)
  const [products, setProducts] = useState<LocalProduct[]>([])
  // Split loading: the header renders as soon as the shop resolves instead of
  // waiting on the full menu, so first paint isn't blocked by menu size.
  const [shopLoading, setShopLoading] = useState(true)
  const [menuLoading, setMenuLoading] = useState(true)
  const [added, setAdded] = useState<string | null>(null)
  const [selectedQty, setSelectedQty] = useState<Record<string, number>>({})
  // Infinite scroll: only the first MENU_PAGE dishes render; the sentinel
  // below grows the budget as the student scrolls. No extra requests — it
  // slices the already-fetched per-shop menu.
  const [visibleCount, setVisibleCount] = useState(MENU_PAGE)
  // Bumped on every add so the cart-quantity map below recomputes once per
  // mutation instead of once per product per render.
  const [cartTick, setCartTick] = useState(0)
  // Cross-shop add awaiting user confirm (one kitchen per cart).
  const [pendingReplace, setPendingReplace] = useState<{ product: LocalProduct; qty: number } | null>(null)
  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  // Reset per-shop state when navigating between shops.
  useEffect(() => {
    setShop(null)
    setProducts([])
    setShopLoading(true)
    setMenuLoading(true)
    setVisibleCount(MENU_PAGE)
    setSelectedQty({})
  }, [shopId])

  const handleAdd = (product: LocalProduct) => {
    if (!shop) return
    const p = { ...product }
    const qty = selectedQty[product.id] || 1
    if (addProductToCart(p, shop, qty) === 'confirm-required') {
      // One kitchen per cart: ask before swapping kitchens.
      setPendingReplace({ product: p, qty })
      return
    }
    setAdded(product.id)
    setSelectedQty({})
    setCartTick(t => t + 1)
    if (addedTimer.current) clearTimeout(addedTimer.current)
    addedTimer.current = setTimeout(() => setAdded(null), 1500)
  }

  const load = useCallback(() => {
    if (!shopId) return
    apiCached.get<LocalShop>('/local/shops/' + shopId, undefined, 15000)
      .then(s => setShop(cur => same(cur, s) ? cur : s))
      .catch(() => setShop(null))
      .finally(() => setShopLoading(false))
    // Scoped to one shop (index-served); limit 500 is the backend max and
    // covers the largest real menu in one small fetch. Render cost is bounded
    // separately by infinite scroll.
    apiCached.get<LocalProduct[]>('/local/products', { shop_id: shopId, limit: 500 }, 15000)
      .then(r => setProducts(cur => same(cur, r || []) ? cur : (r || [])))
      .catch(() => setProducts([]))
      .finally(() => setMenuLoading(false))
  }, [shopId])

  // 15s poll while visible — open/closed flips surface promptly.
  usePolling(load, 15000, [shopId])

  useEffect(() => () => { if (addedTimer.current) clearTimeout(addedTimer.current) }, [])

  const grouped = useMemo(() => {
    return products.reduce((acc, p) => {
      acc[p.category] = acc[p.category] || []
      acc[p.category].push(p)
      return acc
    }, {} as Record<string, LocalProduct[]>)
  }, [products])

  // Single localStorage read per render (not per product per render).
  const cartQtyById = useMemo(() => {
    const map = new Map<string, number>()
    for (const item of getCart()) map.set(item.product_id, item.quantity)
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartTick, products])

  // Slice the grouped menu to the infinite-scroll budget, preserving
  // category headers for the visible slice only.
  const renderedSections = useMemo(() => {
    const out: Array<[string, LocalProduct[]]> = []
    let remaining = visibleCount
    for (const [cat, items] of Object.entries(grouped)) {
      if (remaining <= 0) break
      const slice = items.slice(0, remaining)
      if (slice.length > 0) out.push([cat, slice])
      remaining -= slice.length
    }
    return out
  }, [grouped, visibleCount])
  const hasMore = products.length > visibleCount

  useEffect(() => {
    if (!hasMore) return
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) {
        setVisibleCount(c => (c >= products.length ? c : c + MENU_PAGE))
      }
    }, { rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, products.length, renderedSections.length])

  if (shopLoading) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="animate-pulse bg-gradient-to-br from-emerald-950 via-emerald-900 to-emerald-800">
          <div className="mx-auto max-w-4xl px-4 pt-6 pb-8">
            <div className="h-8 w-48 rounded bg-white/20" />
            <div className="mt-2 h-4 w-64 rounded bg-white/10" />
          </div>
        </div>
        <div className="mx-auto max-w-4xl px-4 py-6">
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-card border border-primary-light/20 bg-white" />
            ))}
          </div>
        </div>
      </div>
    )
  }
  if (!shop) return (
    <div className="flex min-h-screen items-center justify-center bg-white">
      <p className="text-gray-600 font-semibold">Shop not found</p>
      <Link to="/shops" className="ml-2 text-sm font-bold text-primary">Back to shops</Link>
    </div>
  )

  const isOrderable = canOrderFromShop(shop)

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-gradient-to-br from-emerald-950 via-emerald-900 to-emerald-800 text-white">
        <div className="mx-auto max-w-4xl px-4 pt-6 pb-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <img loading="lazy" decoding="async" src={shop.shop_image || getShopImage(shop.category)} alt={`${shop.name} food`} className="h-28 w-full rounded-card bg-white/10 object-cover sm:order-2 sm:h-32 sm:w-48" onError={event => { event.currentTarget.src = getShopImage() }} />
            <div>
              <h1 className="text-3xl font-black tracking-tight">{shop.name}</h1>
              <p className="mt-2 text-sm font-medium text-emerald-100/80">{shop.category} by {shop.shopkeeper_name}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold">
                <span className="rounded-full bg-white/10 px-3 py-1">Rating {shop.rating}</span>
                <span className="rounded-full bg-white/10 px-3 py-1">{shopStatusText(shop)}</span>
                <span className="rounded-full bg-white/10 px-3 py-1">Prep: {shop.prep_time} min</span>
              </div>
              {shop.description && <p className="mt-3 max-w-2xl text-sm text-emerald-100/70 leading-relaxed">{shop.description}</p>}
            </div>
            <div className="flex shrink-0 gap-2">
              <a href={"tel:" + shop.phone}
                className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-white/20">Call</a>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-6">
        {menuLoading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-card border border-primary-light/20 bg-white" />
            ))}
          </div>
        ) : (
          <>
            {renderedSections.map(([cat, items]) => (
              <section key={cat} className="mb-8">
                <h2 className="mb-3 text-lg font-bold text-primary-dark">{cat}</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {items.map(product => {
                    const cartQty = cartQtyById.get(product.id) ?? 0
                    const showStepper = isOrderable && added !== product.id
                    const qty = selectedQty[product.id] || 1
                    return (
                      <div key={product.id} className={"flex items-start justify-between gap-3 rounded-card border p-4 transition-all " + (isOrderable ? "border-primary-light/30 bg-white shadow" : "border-primary-light/20 bg-white/70 opacity-60")}>
                        <div className="min-w-0 flex-1">
                          <h3 className="font-bold text-primary-dark">
                            {product.name}
                            {Boolean(product.is_combo) && (
                              <span className="ml-1.5 align-middle rounded-pill bg-gold-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-gold-700">Combo</span>
                            )}
                          </h3>
                          {product.description && <p className="mt-0.5 text-xs text-slate-500 leading-relaxed">{product.description}</p>}
                          {/* Combo contents — what the ONE price buys */}
                          {Boolean(product.is_combo) && comboItems(product).length > 0 && (
                            <ul className="mt-1 space-y-0.5 text-[11px] font-medium text-slate-500">
                              {comboItems(product).map((item, i) => <li key={i}>• {item}</li>)}
                            </ul>
                          )}
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold">
                            <span className="font-bold text-primary">Rs.{product.price}{Boolean(product.is_combo) && <span className="ml-1 text-[10px] font-semibold text-slate-400">full combo</span>}</span>
                            {product.pending_price ? <span className="text-gold-600">Pending: Rs.{product.pending_price}</span> : null}
                            <span className="text-slate-400">Prep: {product.prep_time} min</span>
                          </div>
                          {cartQty > 0 && (
                            <span className="mt-1 block text-xs font-semibold text-gold-600">In cart: {cartQty}</span>
                          )}
                        </div>
                        {isOrderable ? (
                          showStepper ? (
                            <div className="flex shrink-0 flex-col items-end gap-2">
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => setSelectedQty(prev => ({ ...prev, [product.id]: Math.max(1, (prev[product.id] || 1) - 1) }))}
                                  className="h-8 w-8 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200"
                                >-</button>
                                <span className="w-8 text-center text-sm font-bold">{qty}</span>
                                <button
                                  type="button"
                                  onClick={() => setSelectedQty(prev => ({ ...prev, [product.id]: (prev[product.id] || 1) + 1 }))}
                                  className="h-8 w-8 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200"
                                >+</button>
                              </div>
                              <button
                                onClick={() => handleAdd(product)}
                                className="rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-white transition-all hover:bg-primary-dark"
                              >
                                Add to Cart
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => handleAdd(product)}
                              className={"shrink-0 rounded-full px-5 py-2 text-xs font-bold transition-all " + (added === product.id ? "bg-primary text-white" : "bg-primary-light/30 text-primary hover:bg-primary-light")}
                            >
                              {added === product.id ? "+ ADDED" : "+ ADD"}
                            </button>
                          )
                        ) : (
                          <span className="shrink-0 pt-1 text-xs font-semibold text-slate-400">
                            Shop closed
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            ))}
            {products.length === 0 && (
              <div className="rounded-card bg-white p-10 text-center text-gray-400 shadow-card">No menu items yet</div>
            )}
            {hasMore && (
              <div ref={sentinelRef} className="grid gap-3 sm:grid-cols-2" aria-hidden>
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-28 animate-pulse rounded-card border border-primary-light/20 bg-white" />
                ))}
              </div>
            )}
          </>
        )}

        <div className="mt-8 flex justify-center gap-3">
          <Link to="/cart" className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-bold text-white transition-all hover:bg-primary-dark">View Cart</Link>
          <Link to="/shops" className="inline-flex items-center gap-2 rounded-full border border-primary-light/30 bg-white px-6 py-3 text-sm font-bold text-primary transition-all hover:bg-primary-light/30">Add from another shop</Link>
        </div>
      </div>

      {/* One kitchen per cart: confirm before swapping kitchens. */}
      <ConfirmDialog
        open={pendingReplace !== null}
        title="Replace cart?"
        message={
          pendingReplace && shop ? (
            <span>
              Your cart has items from <b>{cartShopConflict(shop.id).currentShopName}</b>.
              Adding from <b>{shop.name}</b> will clear those items first.
            </span>
          ) : null
        }
        confirmLabel="Replace cart"
        onConfirm={() => {
          if (pendingReplace && shop) {
            replaceCartWithProduct(pendingReplace.product, shop, pendingReplace.qty)
            setAdded(pendingReplace.product.id)
            setSelectedQty({})
            setCartTick(t => t + 1)
          }
          setPendingReplace(null)
        }}
        onCancel={() => setPendingReplace(null)}
      />
    </div>
  )
}
