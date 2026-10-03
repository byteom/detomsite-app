import React, { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Shop, Product, StudentNotice, DeliveryBatch } from '../types'
import { fetchShopsCached, readUser, isShopOrderable } from '../utils/helpers'
import api from '../services/api'
import { ShopCard } from '../components/food/ShopCard'
import { ShopCardSkeleton } from '../components/ui/Skeleton'
import { EmptyState } from '../components/ui/EmptyState'
import {
  Search,
  AlertCircle,
  Clock,
  Sparkles,
  Flame,
  Star,
  Filter,
  Check,
  ChevronDown,
} from '../components/ui/Icons'

const CUISINE_TAGS = [
  'All',
  'Open Now',
  'Top Rated (4.0+)',
  'Combos',
  'Tiffins',
  'Biryani & Rice',
  'Fast Food',
  'Beverages',
]

export function ShopsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const user = readUser()
  const searchInputRef = React.useRef<HTMLInputElement>(null)

  const [shops, setShops] = useState<Shop[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [notice, setNotice] = useState<StudentNotice | null>(null)
  const [batch, setBatch] = useState<DeliveryBatch | null>(null)
  const [loading, setLoading] = useState(true)

  const [activeTag, setActiveTag] = useState('All')
  const [sortBy, setSortBy] = useState<'recommended' | 'rating' | 'open'>('recommended')

  // Search input state
  const queryParam = searchParams.get('q') || ''
  const [search, setSearch] = useState(queryParam)
  const [debouncedSearch, setDebouncedSearch] = useState(queryParam)

  // Backend search results & states
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [backendShops, setBackendShops] = useState<Shop[] | null>(null)
  const [backendProducts, setBackendProducts] = useState<Product[] | null>(null)

  // Sync from URL query
  useEffect(() => {
    setSearch(queryParam)
    setDebouncedSearch(queryParam)
  }, [queryParam])

  // Focus input if requested by navigation (e.g. mobile search tab)
  useEffect(() => {
    const focusParam = searchParams.get('focus') || searchParams.get('search')
    if (focusParam) {
      setTimeout(() => {
        searchInputRef.current?.focus()
        searchInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 100)
    }
  }, [searchParams])

  // Initial data load for browse mode
  useEffect(() => {
    Promise.all([
      fetchShopsCached(),
      api.get<Product[]>('/local/products').then((r) => r.data || []).catch(() => []),
      api.get<StudentNotice>('/local/student-notice').then((r) => r.data).catch(() => null),
      api.get<DeliveryBatch>('/local/batch').then((r) => r.data).catch(() => null),
    ])
      .then(([s, p, n, b]) => {
        setShops(s)
        setProducts(p)
        setNotice(n)
        setBatch(b)
      })
      .finally(() => setLoading(false))
  }, [])

  // Debounce user search typing (300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim())
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  // Execute backend search when debounced search changes
  useEffect(() => {
    const q = debouncedSearch.trim()
    if (!q) {
      setBackendShops(null)
      setBackendProducts(null)
      setSearchLoading(false)
      setSearchError(null)
      return
    }

    let cancelled = false
    setSearchLoading(true)
    setSearchError(null)

    // Call backend search endpoint
    api
      .get<{ shops: Shop[]; products: Product[]; total: number }>('/local/search', {
        params: { q },
      })
      .then((res) => {
        if (cancelled) return
        setBackendShops(res.data?.shops || [])
        setBackendProducts(res.data?.products || [])
      })
      .catch((err) => {
        if (cancelled) return
        // Fallback to querying shops and products separately if needed
        api
          .get<Shop[]>('/local/shops', { params: { search: q, public_only: true } })
          .then((sRes) => {
            if (cancelled) return
            setBackendShops(sRes.data || [])
          })
          .catch(() => {
            if (cancelled) return
            setSearchError('Could not complete search. Please try again.')
          })
      })
      .finally(() => {
        if (!cancelled) setSearchLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [debouncedSearch])

  // When search is active, use backend search shops; otherwise use initial shops
  const sourceShops = backendShops !== null ? backendShops : shops
  const sourceProducts = backendProducts !== null ? backendProducts : products

  // Filter & sort shops
  const filtered = useMemo(() => {
    let list = sourceShops.filter((s) => {
      // Filter Tag
      if (activeTag === 'Open Now') {
        return isShopOrderable(s)
      }
      if (activeTag === 'Top Rated (4.0+)') {
        return Number(s.rating || 0) >= 4.0
      }
      if (activeTag === 'Combos') {
        return sourceProducts.some(
          (p) => p.shop_id === s.id && Boolean(p.is_combo)
        )
      }
      if (activeTag === 'Tiffins') {
        return (
          s.category.toLowerCase().includes('tiffin') ||
          s.category.toLowerCase().includes('south')
        )
      }
      if (activeTag === 'Biryani & Rice') {
        return (
          s.category.toLowerCase().includes('biryani') ||
          s.category.toLowerCase().includes('rice') ||
          sourceProducts.some(
            (p) =>
              p.shop_id === s.id &&
              (p.name.toLowerCase().includes('biryani') ||
                p.name.toLowerCase().includes('rice'))
          )
        )
      }
      if (activeTag === 'Fast Food') {
        return (
          s.category.toLowerCase().includes('fast') ||
          s.category.toLowerCase().includes('burger') ||
          s.category.toLowerCase().includes('snack')
        )
      }
      if (activeTag === 'Beverages') {
        return (
          s.category.toLowerCase().includes('beverage') ||
          s.category.toLowerCase().includes('tea') ||
          s.category.toLowerCase().includes('juice')
        )
      }

      return true
    })

    // Sorting
    if (sortBy === 'rating') {
      list = [...list].sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0))
    } else if (sortBy === 'open') {
      list = [...list].sort((a, b) => {
        const aOpen = isShopOrderable(a) ? 1 : 0
        const bOpen = isShopOrderable(b) ? 1 : 0
        return bOpen - aOpen
      })
    }

    return list
  }, [sourceShops, sourceProducts, activeTag, sortBy])

  const openCount = useMemo(
    () => sourceShops.filter((s) => isShopOrderable(s)).length,
    [sourceShops]
  )

  const handleSearchChange = (val: string) => {
    setSearch(val)
    if (val.trim()) {
      setSearchParams({ q: val.trim() }, { replace: true })
    } else {
      setSearchParams({}, { replace: true })
    }
  }

  const clearSearch = () => {
    setSearch('')
    setDebouncedSearch('')
    setBackendShops(null)
    setBackendProducts(null)
    setSearchParams({}, { replace: true })
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 sm:py-6">
      {/* Admin Notice Banner (If enabled) */}
      {notice?.enabled && notice.text && (
        <div className="mb-4 flex items-start gap-3 rounded-card border border-emerald-200 bg-emerald-50/80 p-3 text-sm font-semibold text-emerald-950 shadow-sm animate-fade-in">
          <AlertCircle className="h-5 w-5 text-emerald-700 shrink-0 mt-0.5" />
          <div className="flex-1 leading-relaxed whitespace-pre-line text-xs sm:text-sm">
            {notice.text}
          </div>
        </div>
      )}

      {/* COMPACT Discovery & Search Banner */}
      <div className="relative overflow-hidden rounded-panel bg-gradient-to-r from-emerald-900 via-emerald-800 to-teal-800 text-white p-4 sm:p-5 shadow-card mb-5">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          {/* Left: Compact Welcome Header & Status */}
          <div className="max-w-xl">
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
              <span className="inline-flex items-center gap-1.5 rounded-pill bg-white/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-200 border border-white/20 backdrop-blur-sm">
                <Sparkles className="h-3 w-3 text-amber-300" />
                <span>VIT-AP Campus Kitchens</span>
              </span>

              {batch && (
                <span className="inline-flex items-center gap-1.5 rounded-btn bg-black/25 px-2.5 py-0.5 text-[11px] text-emerald-100 border border-white/10 backdrop-blur-sm">
                  <Clock className="h-3 w-3 text-amber-400 shrink-0" />
                  <span>
                    <b>{batch.batch_type} Batch</b> · Orders until{' '}
                    <span className="font-extrabold text-amber-300">{batch.accepted_until}</span>
                  </span>
                </span>
              )}
            </div>

            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white leading-tight">
              Craving something delicious, {user.name ? user.name.split(' ')[0] : 'Student'}?
            </h1>
            <p className="mt-1 text-xs text-emerald-100/90 leading-relaxed">
              Order from campus kitchens with fast pickup at the Main Gate · Zero delivery fee
            </p>
          </div>

          {/* Right: Embedded Search Input */}
          <div className="w-full md:w-80 lg:w-96 shrink-0">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Search dishes (biryani, dosa) or kitchens..."
                className="w-full rounded-btn border-2 border-white/20 bg-white py-2 pl-9 pr-9 text-xs sm:text-sm text-slate-900 placeholder-slate-400 outline-none shadow-sm focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 transition-all"
              />
              {searchLoading ? (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-emerald-700" />
                </div>
              ) : search ? (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 text-xs font-bold"
                  aria-label="Clear search"
                >
                  ✕
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Filter Chips & Sorting Toolbar */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Category Pill Carousel */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none no-scrollbar">
          {CUISINE_TAGS.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setActiveTag(tag)}
              className={`shrink-0 rounded-pill px-3 py-1 text-xs font-bold transition-all ${
                activeTag === tag
                  ? 'bg-emerald-700 text-white shadow-sm'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>

        {/* Sort Selector */}
        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
          <label className="text-xs font-bold text-slate-500 flex items-center gap-1">
            <Filter className="h-3 w-3 text-slate-400" />
            <span>Sort:</span>
          </label>
          <div className="relative">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="appearance-none rounded-btn border border-slate-200 bg-white py-1 pl-2.5 pr-7 text-xs font-bold text-slate-800 outline-none focus:border-emerald-600 transition-all"
            >
              <option value="recommended">Recommended</option>
              <option value="rating">Top Rated</option>
              <option value="open">Open First</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          </div>
        </div>
      </div>

      {/* Matching Dishes Quick Section (If search query matched products) */}
      {backendProducts && backendProducts.length > 0 && (
        <div className="mb-5 rounded-card border border-amber-200 bg-amber-50/50 p-3 sm:p-4">
          <div className="flex items-center justify-between mb-2.5">
            <p className="text-xs font-bold uppercase tracking-wider text-amber-900">
              Matching Dishes ({backendProducts.length})
            </p>
            <span className="text-[11px] text-amber-700">Click dish to view restaurant menu</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {backendProducts.slice(0, 6).map((item) => (
              <a
                key={item.id}
                href={`/shop/${item.shop_id}`}
                className="flex items-center justify-between rounded-btn border border-amber-200/80 bg-white p-2.5 hover:border-amber-400 hover:shadow-sm transition-all"
              >
                <div className="min-w-0 pr-2">
                  <p className="font-bold text-xs text-slate-900 truncate">{item.name}</p>
                  <p className="text-[11px] text-slate-500 truncate">{item.category}</p>
                </div>
                <span className="font-black text-xs text-emerald-800 shrink-0">₹{item.price}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Discovery Section Header */}
      <div className="mb-3.5 flex items-center justify-between">
        <h2 className="text-base sm:text-lg font-bold text-slate-900">
          {debouncedSearch ? (
            <span>
              Results for <span className="text-emerald-700">"{debouncedSearch}"</span>
            </span>
          ) : (
            <span>Campus Kitchens ({filtered.length})</span>
          )}
        </h2>
        <span className="text-xs font-semibold text-slate-500">
          {openCount} kitchen{openCount === 1 ? '' : 's'} open
        </span>
      </div>

      {/* Search Error State */}
      {searchError && (
        <div className="mb-4 rounded-btn border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 flex items-center justify-between">
          <span>{searchError}</span>
          <button
            type="button"
            onClick={() => handleSearchChange(search)}
            className="font-bold underline ml-2"
          >
            Retry
          </button>
        </div>
      )}

      {/* Grid of Restaurant Cards */}
      {loading || searchLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {[...Array(6)].map((_, i) => (
            <ShopCardSkeleton key={i} />
          ))}
        </div>
      ) : filtered.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {filtered.map((shop) => (
            <ShopCard
              key={shop.id}
              shop={shop}
              featured={Number(shop.rating || 0) >= 4.7}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          type="search"
          title={`No kitchens match "${search || activeTag}"`}
          description={
            search
              ? `No kitchens or dishes found matching "${search}". Try searching for 'biryani', 'masala dosa', 'burger', or 'tea'.`
              : 'Try choosing a different cuisine tag or clearing filters.'
          }
          actionLabel="Clear Search & Filters"
          onAction={() => {
            clearSearch()
            setActiveTag('All')
            setSortBy('recommended')
          }}
        />
      )}
    </div>
  )
}
