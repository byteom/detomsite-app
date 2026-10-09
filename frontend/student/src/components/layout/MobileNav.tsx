import React, { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Store, Search, Package, User, ShoppingBag } from '../ui/Icons'
import { getCart } from '../../utils/helpers'
import { CartItem } from '../../types'

export function MobileNav() {
  const location = useLocation()
  const path = location.pathname
  const [cart, setCart] = useState<CartItem[]>(() => getCart())

  useEffect(() => {
    const sync = () => setCart(getCart())
    window.addEventListener('cart-updated', sync)
    return () => window.removeEventListener('cart-updated', sync)
  }, [])

  const cartCount = cart.reduce((sum, item) => sum + (item.quantity || 1), 0)

  const searchParams = new URLSearchParams(location.search)
  const isSearchActive = (path === '/shops' && Boolean(searchParams.get('q') || searchParams.get('focus')))

  const isExplore = (path === '/' || path === '/shops' || path.startsWith('/shop/')) && !isSearchActive
  const isOrders = path === '/orders' || path === '/previous-orders' || path.startsWith('/order/')
  const isProfile = path === '/profile' || path === '/account' || path === '/dashboard' || path === '/support' || path === '/reviews'

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200/90 bg-white/95 backdrop-blur-lg md:hidden shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
      <div className="flex h-16 items-center justify-around px-2">
        {/* Explore */}
        <Link
          to="/shops"
          className={`flex flex-col items-center justify-center flex-1 py-1 transition-all ${
            isExplore
              ? 'text-emerald-700 font-extrabold'
              : 'text-slate-500 font-semibold hover:text-slate-900'
          }`}
        >
          <div
            className={`flex h-7 w-7 items-center justify-center transition-transform ${
              isExplore ? 'bg-emerald-100 scale-105' : ''
            }`}
          >
            <Store className="h-4 w-4" />
          </div>
          <span className="text-[11px] mt-0.5">Explore</span>
        </Link>

        {/* Search */}
        <Link
          to="/shops?focus=search"
          className={`flex flex-col items-center justify-center flex-1 py-1 transition-all ${
            isSearchActive
              ? 'text-emerald-700 font-extrabold'
              : 'text-slate-500 font-semibold hover:text-slate-900'
          }`}
        >
          <div
            className={`flex h-7 w-7 items-center justify-center transition-transform ${
              isSearchActive ? 'bg-emerald-100 scale-105' : ''
            }`}
          >
            <Search className="h-4 w-4" />
          </div>
          <span className="text-[11px] mt-0.5">Search</span>
        </Link>

        {/* Orders */}
        <Link
          to="/orders"
          className={`flex flex-col items-center justify-center flex-1 py-1 transition-all ${
            isOrders
              ? 'text-emerald-700 font-extrabold'
              : 'text-slate-500 font-semibold hover:text-slate-900'
          }`}
        >
          <div
            className={`flex h-7 w-7 items-center justify-center rounded-full transition-transform ${
              isOrders ? 'bg-emerald-100 scale-105' : ''
            }`}
          >
            <Package className="h-4 w-4" />
          </div>
          <span className="text-[11px] mt-0.5">Orders</span>
        </Link>

        {/* Profile */}
        <Link
          to="/profile"
          className={`flex flex-col items-center justify-center flex-1 py-1 transition-all ${
            isProfile
              ? 'text-emerald-700 font-extrabold'
              : 'text-slate-500 font-semibold hover:text-slate-900'
          }`}
        >
          <div
            className={`flex h-7 w-7 items-center justify-center rounded-full transition-transform ${
              isProfile ? 'bg-emerald-100 scale-105' : ''
            }`}
          >
            <User className="h-4 w-4" />
          </div>
          <span className="text-[11px] mt-0.5">Profile</span>
        </Link>
      </div>
    </nav>
  )
}
