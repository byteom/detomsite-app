import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { Shop } from '../../types'
import { isShopOrderable, getCategoryPhoto } from '../../utils/helpers'
import { Star, Clock, MapPin, Heart, ChevronRight, Sparkles } from '../ui/Icons'

interface ShopCardProps {
  shop: Shop
  featured?: boolean
}

export function ShopCard({ shop, featured = false }: ShopCardProps) {
  const [favorite, setFavorite] = useState(() => {
    try {
      const favs = JSON.parse(localStorage.getItem('detomsite_fav_shops') || '[]')
      return favs.includes(shop.id)
    } catch {
      return false
    }
  })

  const toggleFavorite = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      const raw = localStorage.getItem('detomsite_fav_shops')
      const favs: string[] = raw ? JSON.parse(raw) : []
      const next = favorite
        ? favs.filter((id) => id !== shop.id)
        : [...favs, shop.id]
      localStorage.setItem('detomsite_fav_shops', JSON.stringify(next))
      setFavorite(!favorite)
      window.dispatchEvent(new Event('favorites-updated'))
    } catch {
      setFavorite(!favorite)
    }
  }

  const orderable = isShopOrderable(shop)
  const photo = shop.image_url || getCategoryPhoto(shop.category, shop.name)

  return (
    <Link
      to={`/shop/${shop.id}`}
      className="group relative flex flex-col overflow-hidden rounded-panel border border-slate-200/90 bg-white shadow-card hover:shadow-card-hover hover:-translate-y-1 transition-all duration-300"
    >
      {/* Photo Header */}
      <div className="relative h-36 sm:h-38 w-full overflow-hidden bg-slate-100">
        <img
          src={photo}
          alt={shop.name}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          onError={(e) => {
            e.currentTarget.src =
              'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=600&q=80'
          }}
        />

        {/* Gradient Overlay for text readability */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/20" />

        {/* Live Status Badge */}
        <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
          <span
            className={`inline-flex items-center gap-1.5 rounded-pill px-2 py-0.5 text-[11px] font-bold backdrop-blur-md shadow-sm ${
              orderable
                ? 'bg-emerald-950/80 text-emerald-200 border border-emerald-400/40'
                : 'bg-slate-900/80 text-slate-300 border border-slate-700/50'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                orderable ? 'bg-emerald-400 animate-pulse' : 'bg-slate-400'
              }`}
            />
            <span>{orderable ? 'Open Now' : 'Closed'}</span>
          </span>

          {featured && (
            <span className="inline-flex items-center gap-1 rounded-pill bg-amber-500/90 text-white border border-amber-300/40 px-2 py-0.5 text-[10px] font-bold backdrop-blur-md">
              <Sparkles className="h-2.5 w-2.5" />
              <span>Campus Pick</span>
            </span>
          )}
        </div>

        {/* Favorite Button */}
        <button
          type="button"
          onClick={toggleFavorite}
          aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
          className={`absolute top-2.5 right-2.5 flex h-7 w-7 items-center justify-center rounded-full backdrop-blur-md transition-all active:scale-90 ${
            favorite
              ? 'bg-rose-500 text-white shadow-md'
              : 'bg-black/30 text-white/90 hover:bg-black/50 hover:text-white'
          }`}
        >
          <Heart
            className={`h-3.5 w-3.5 ${favorite ? 'fill-current text-white' : ''}`}
          />
        </button>

        {/* Rating Badge at bottom of image */}
        <div className="absolute bottom-2 left-2.5 flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-pill bg-emerald-700 text-white px-2 py-0.5 text-[11px] font-bold shadow-sm">
            <Star className="h-3 w-3 fill-current text-amber-300" />
            <span>{Number(shop.rating || 4.5).toFixed(1)}</span>
          </div>
          <span className="text-[10px] font-semibold text-white/90 drop-shadow">
            20-30 min delivery
          </span>
        </div>
      </div>

      {/* Card Content */}
      <div className="flex flex-1 flex-col p-3.5 justify-between">
        <div>
          <div className="flex items-start justify-between gap-2">
            <h3
              className="font-bold text-slate-900 text-base group-hover:text-emerald-700 transition-colors line-clamp-1"
              title={shop.name}
            >
              {shop.name}
            </h3>
          </div>

          <p className="mt-0.5 text-[11px] font-medium text-slate-500 line-clamp-1">
            {shop.category}
          </p>

          <p className="mt-1.5 text-xs text-slate-600 line-clamp-2 leading-relaxed">
            {shop.description || 'Quality campus food made fresh to order.'}
          </p>
        </div>

        {/* Card Footer Info */}
        <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
          <span className="flex items-center gap-1 font-medium">
            <Clock className="h-3 w-3 text-slate-400" />
            <span>{shop.opening_time} - {shop.closing_time}</span>
          </span>

          <span className="inline-flex items-center gap-0.5 font-bold text-emerald-700 group-hover:translate-x-0.5 transition-transform">
            <span>View Menu</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>
    </Link>
  )
}
