import { useEffect, useMemo, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { apiCached } from '../services/api'
import { canOrderFromShop, LocalProduct, LocalShop, shopStatusText } from '../types/localApi'
import { addProductToCart, cartShopConflict, replaceCartWithProduct } from '../utils/cart'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { usePolling } from '../hooks/usePolling'
import { same } from '../utils/same'
import { getShopImage } from '../utils/shopImages'

export function Shops() {
  const [shops, setShops] = useState<LocalShop[]>([])
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('rating')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  // Dish matches come from the server (bounded to 8 rows) — the page never
  // downloads the full products catalog anymore.
  const [dishResults, setDishResults] = useState<LocalProduct[]>([])
  // Cross-shop add awaiting user confirm (one kitchen per cart).
  const [pendingReplace, setPendingReplace] = useState<{ product: LocalProduct; shop: LocalShop } | null>(null)

  const loadShops = useCallback(() => {
    // 15s TTL covers the 15s poll below — steady-state ticks never hit the DB.
    apiCached.get<LocalShop[]>('/local/shops', { public_only: true }, 15000)
      .then(res => setShops(cur => same(cur, res || []) ? cur : (res || [])))
      .catch(() => { /* keep the last known list on transient failures */ })
      .finally(() => setLoading(false))
  }, [])

  // Re-poll every 15s while visible; background tabs stop hammering the API
  // and refresh instantly when you switch back.
  usePolling(loadShops, 15000, [loadShops])

  const query = search.trim().toLowerCase()

  // Server-side dish search, debounced: one small bounded request per pause in
  // typing instead of one full-catalog download per mount. `limit: 8` bounds
  // the payload no matter how large the catalog grows.
  useEffect(() => {
    if (!query) {
      setDishResults([])
      return
    }
    const t = setTimeout(() => {
      apiCached.get<LocalProduct[]>('/local/products', { search: query, limit: 8 }, 15000)
        .then(res => setDishResults(cur => same(cur, res || []) ? cur : (res || [])))
        .catch(() => setDishResults([]))
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  const categories = useMemo(() => ['all', ...new Set(shops.map(s => s.category))], [shops])
  const filtered = shops
    // Closed shops are hidden entirely — students only browse shops that are
    // actually accepting orders right now.
    .filter(s => canOrderFromShop(s))
    .filter(s => filter === 'all' || s.category === filter)
    .filter(s => {
      if (!query) return true
      return `${s.name} ${s.category}`.toLowerCase().includes(query)
    })
    .sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name)
      if (sort === 'status') return Number(canOrderFromShop(b)) - Number(canOrderFromShop(a))
      return b.rating - a.rating
    })

  // Dish results: only AVAILABLE dishes from OPEN shops — a search must never
  // surface food that cannot be ordered (unavailable item or closed shop).
  const openShopIds = useMemo(() => new Set(shops.filter(s => canOrderFromShop(s)).map(s => s.id)), [shops])
  const foodResults = useMemo(() => {
    if (!query) return []
    return dishResults.filter(p => p.available && openShopIds.has(p.shop_id))
  }, [dishResults, query, openShopIds])

  const perPage = 8
  const pages = Math.max(1, Math.ceil(filtered.length / perPage))
  const visible = filtered.slice((page - 1) * perPage, page * perPage)

  const handleAdd = (product: LocalProduct) => {
    const shop = shops.find(s => s.id === product.shop_id)
    if (shop) {
      if (addProductToCart(product, shop) === 'confirm-required') {
        // One kitchen per cart: ask before swapping kitchens.
        setPendingReplace({ product, shop })
      }
    }
  }

  return (
    <div className="page-shell min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-6">
        <section className="mb-6 rounded-[28px] border border-primary-light/30 bg-gradient-to-br from-emerald-900 via-emerald-800 to-emerald-700 p-6 text-white shadow-[0_16px_50px_rgba(6,78,59,0.2)]">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-primary/50">Browse campus favorites</p>
              <h1 className="mt-2 text-3xl font-black tracking-tight">Restaurants & cafes</h1>
              <p className="mt-2 max-w-2xl text-sm font-medium text-emerald-50/90">Find the best open spots, compare ratings, and order from the place that fits your mood.</p>
            </div>
            <div className="rounded-card bg-white/10 px-4 py-3 text-sm font-semibold text-emerald-50 backdrop-blur-sm">
              {filtered.length} shops · {foodResults.length} dishes
            </div>
          </div>
        </section>

        <div className="mb-4 flex flex-wrap gap-3">
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search restaurants or dishes..."
            className="min-w-[240px] flex-1 rounded-card border border-primary-light/30 bg-white/90 px-4 py-2.5 text-sm text-slate-700 placeholder-slate-400 outline-none transition-all focus:border-primary focus:shadow-[0_0_0_3px_rgba(15,118,110,0.12)]" />
          <select value={sort} onChange={e => { setSort(e.target.value); setPage(1) }}
            className="rounded-card border border-primary-light/30 bg-white/90 px-4 py-2.5 text-sm font-medium text-slate-700 outline-none transition-all focus:border-primary focus:shadow-[0_0_0_3px_rgba(15,118,110,0.12)]">
            <option value="rating">Rating</option>
            <option value="status">Open First</option>
            <option value="name">Name</option>
          </select>
        </div>

        {/* Dish search results across all shops (server-side, bounded) */}
        {foodResults.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">Dishes found for "{search.trim()}"</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {foodResults.slice(0, 8).map(product => {
                const shop = shops.find(s => s.id === product.shop_id)
                if (!shop) return null
                const orderable = canOrderFromShop(shop)
                return (
                  <div key={product.id} className="flex items-center justify-between rounded-btn border border-primary-light/30 bg-white p-3 shadow-[0_8px_25px_rgba(15,118,110,0.08)]">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-bold text-primary-dark">
                        {product.name}
                        {Boolean(product.is_combo) && <span className="ml-1.5 rounded-pill bg-gold-100 px-1.5 py-0.5 text-[10px] font-black uppercase text-gold-700">Combo</span>}
                      </h3>
                      <p className="truncate text-xs font-semibold text-slate-500">{shop.name} · ₹{product.price}</p>
                    </div>
                    {orderable && product.inventory > 0 ? (
                      <button onClick={() => handleAdd(product)}
                        className="shrink-0 rounded-pill bg-primary-light/30 px-3 py-1.5 text-xs font-bold text-primary transition-colors hover:bg-primary hover:text-white">Add</button>
                    ) : (
                      <span className="shrink-0 text-xs font-semibold text-slate-400">{!orderable ? 'Closed' : 'Out'}</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div className="mb-6 flex gap-2 overflow-x-auto pb-2">
          {categories.map(cat => (
            <button key={cat} onClick={() => { setFilter(cat); setPage(1) }}
              className={`shrink-0 rounded-pill border px-4 py-1.5 text-sm font-semibold transition-all ${
                filter === cat ? 'border-emerald-600 bg-primary-light/30 text-primary' : 'border-primary-light/30 bg-white text-slate-600 hover:border-emerald-300'
              }`}>{cat === 'all' ? 'All' : cat}</button>
          ))}
        </div>

        {loading ? (
          <div className="rounded-[24px] border border-primary-light/30 bg-white/80 p-12 text-center text-slate-500 shadow-[0_10px_35px_rgba(15,118,110,0.06)]">Loading...</div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {visible.map(shop => (
              <Link key={shop.id} to={`/shop/${shop.id}`}
                className="group overflow-hidden rounded-[24px] border border-primary-light/30 bg-white/90 shadow-[0_10px_35px_rgba(15,118,110,0.08)] transition-all hover:-translate-y-1 hover:shadow-[0_16px_45px_rgba(15,118,110,0.16)]">
                <img loading="lazy" decoding="async" width={400} height={128} src={shop.shop_image || getShopImage(shop.category)} alt={`${shop.name} food`} className="h-32 w-full bg-emerald-50 object-cover" onError={event => { event.currentTarget.src = getShopImage() }} />
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div><h3 className="font-bold text-primary-dark">{shop.name}</h3><p className="text-sm font-medium text-slate-500">{shop.category}</p></div>
                    <span className="shrink-0 rounded-pill bg-primary-light/30 px-2.5 py-1 text-xs font-bold text-primary">{shop.rating.toFixed(1)}</span>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs font-semibold">
                    <span className={canOrderFromShop(shop) ? 'text-primary' : 'text-slate-400'}>{shopStatusText(shop)}</span>
                    <span className="text-slate-400">{shop.opening_time}</span>
                  </div>
                </div>
              </Link>
            ))}
            {visible.length === 0 && <div className="rounded-[24px] border border-dashed border-primary-light/50 bg-white/80 p-8 text-center text-slate-500 shadow-[0_10px_35px_rgba(15,118,110,0.06)] md:col-span-2 lg:col-span-4">No shops found</div>}
          </div>
        )}

        {pages > 1 && (
          <div className="mt-6 flex justify-center gap-2">
            <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}
              className="rounded-pill border border-primary-light/30 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-primary-light/30 disabled:opacity-40">← Previous</button>
            <span className="flex items-center px-3 text-sm font-semibold text-slate-500">{page} / {pages}</span>
            <button onClick={() => setPage(Math.min(pages, page + 1))} disabled={page === pages}
              className="rounded-pill border border-primary-light/30 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-primary-light/30 disabled:opacity-40">Next →</button>
          </div>
        )}

        {/* One kitchen per cart: confirm before swapping kitchens. */}
        <ConfirmDialog
          open={pendingReplace !== null}
          title="Replace cart?"
          message={
            pendingReplace ? (
              <span>
                Your cart has items from <b>{cartShopConflict(pendingReplace.shop.id).currentShopName}</b>.
                Adding from <b>{pendingReplace.shop.name}</b> will clear those items first.
              </span>
            ) : null
          }
          confirmLabel="Replace cart"
          onConfirm={() => {
            if (pendingReplace) replaceCartWithProduct(pendingReplace.product, pendingReplace.shop)
            setPendingReplace(null)
          }}
          onCancel={() => setPendingReplace(null)}
        />
      </div>
    </div>
  )
}
