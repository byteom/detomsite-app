import React, { useState, useEffect, useRef } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  Store,
  Package,
  ShoppingBag,
  Bell,
  User,
  Search,
  MapPin,
  ChevronDown,
  LogOut,
  Settings,
  Star,
  LifeBuoy,
  Clock,
  Sparkles,
  ExternalLink,
} from '../ui/Icons'
import { readUser, getCart, billBreakdown, MAIN_GATE } from '../../utils/helpers'
import { Notification, CartItem } from '../../types'
import { dedupeGet } from '../../services/api'
import { usePolling } from '../../hooks/usePolling'

export function Navbar() {
  const location = useLocation()
  const navigate = useNavigate()
  const user = readUser()
  const path = location.pathname

  const [cart, setCart] = useState<CartItem[]>(() => getCart())
  const [notifs, setNotifs] = useState<Notification[]>([])
  const [notifOpen, setNotifOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const notifRef = useRef<HTMLDivElement>(null)
  const profileRef = useRef<HTMLDivElement>(null)

  // Sync navbar search with URL
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    setSearchQuery(params.get('q') || '')
  }, [location.search])

  // Listen to cart updates
  useEffect(() => {
    const sync = () => setCart(getCart())
    window.addEventListener('cart-updated', sync)
    return () => window.removeEventListener('cart-updated', sync)
  }, [])

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false)
      }
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Poll notifications. Backs off when the backend is sick: after 3 straight
  // failures the bell quiets to one check every 2 minutes (instead of
  // stamping a 500 into the console every 30 s forever) until it recovers.
  const notifFails = React.useRef(0)
  usePolling(
    React.useCallback(() => {
      if (document.visibilityState !== 'visible') return
      return dedupeGet<Notification[]>('/local/notifications', { role: 'student' })
        .then((r) => {
          notifFails.current = 0
          setNotifs(r.data || [])
        })
        .catch(() => {
          notifFails.current += 1
        })
    }, []),
    () => (notifFails.current >= 3 ? 120000 : 30000),
    []
  )

  const cartTotalItems = cart.reduce((acc, i) => acc + (i.quantity || 1), 0)
  const cartBill = billBreakdown(cart)

  const logout = () => {
    localStorage.removeItem('access_token')
    localStorage.removeItem('user_data')
    localStorage.removeItem('detomsite-auth-check')
    window.location.href = '/login'
  }

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (searchQuery.trim()) {
      navigate(`/shops?q=${encodeURIComponent(searchQuery.trim())}`)
    } else {
      navigate('/shops')
    }
  }

  const isExploreActive = path === '/' || path === '/shops' || path.startsWith('/shop/')
  const isOrdersActive = path === '/orders' || path === '/previous-orders' || path.startsWith('/order/')
  const isProfileActive = path === '/profile' || path === '/account' || path === '/dashboard'

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 glass-nav shadow-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2.5 sm:px-6">
        {/* Left: Brand Logo & Campus Delivery Point */}
        <div className="flex items-center gap-4 sm:gap-6">
          <Link to="/shops" className="flex items-center gap-2 group">
            <span className="flex h-9 w-9 items-center justify-center rounded-btn bg-emerald-700 text-white font-black text-lg shadow-sm group-hover:bg-emerald-800 transition-colors">
              D
            </span>
            <div className="flex flex-col">
              <span className="text-base font-black tracking-tight text-slate-900 group-hover:text-emerald-700 transition-colors">
                DETOMSITE
              </span>
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-700">
                Campus Eats
              </span>
            </div>
          </Link>

          {/* Delivery Gate Pill */}
          <div
            className="hidden lg:flex items-center gap-1.5 rounded-pill bg-slate-100/90 hover:bg-slate-200/80 px-3 py-1 text-xs text-slate-700 font-medium border border-slate-200 transition-colors cursor-default"
            title="All campus deliveries arrive at the VIT-AP Main Gate"
          >
            <MapPin className="h-3.5 w-3.5 text-emerald-600" />
            <span className="font-bold text-slate-900">{MAIN_GATE}</span>
            <span className="text-slate-400 text-[11px]">· Delivery Point</span>
          </div>
        </div>

        {/* Center: Global Search Bar */}
        <div className="hidden md:flex flex-1 max-w-md mx-6">
          <form onSubmit={handleSearchSubmit} className="relative w-full">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search dishes, snacks, kitchens..."
              className="w-full rounded-btn border border-slate-200 bg-slate-50/80 py-2 pl-9 pr-4 text-sm text-slate-900 placeholder-slate-400 outline-none transition-all focus:bg-white focus:border-emerald-600 focus:shadow-card"
            />
          </form>
        </div>

        {/* Right: Primary Navigation Items */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Explore / Shops */}
          <Link
            to="/shops"
            className={`hidden sm:inline-flex items-center gap-1.5 rounded-btn px-3 py-2 text-sm font-bold transition-all ${
              isExploreActive
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Store className="h-4 w-4 text-emerald-600" />
            <span>Explore</span>
          </Link>

          {/* Orders */}
          <Link
            to="/orders"
            className={`hidden sm:inline-flex items-center gap-1.5 rounded-btn px-3 py-2 text-sm font-bold transition-all ${
              isOrdersActive
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Package className="h-4 w-4 text-emerald-600" />
            <span>Orders</span>
          </Link>

          {/* Cart Button with Count and Price */}
          <Link
            to="/cart"
            className={`relative flex items-center gap-2 rounded-btn px-3 py-2 text-sm font-bold transition-all ${
              path === '/cart'
                ? 'bg-emerald-700 text-white shadow-sm'
                : 'bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100'
            }`}
          >
            <div className="relative">
              <ShoppingBag className="h-4 w-4" />
              {cartTotalItems > 0 && (
                <span className="absolute -top-1.5 -right-2 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-black text-slate-950">
                  {cartTotalItems}
                </span>
              )}
            </div>
            <span className="hidden sm:inline">Cart</span>
            {cartTotalItems > 0 && (
              <span className="hidden lg:inline text-xs font-black bg-emerald-900/10 px-1.5 py-0.5 rounded">
                ₹{cartBill.total}
              </span>
            )}
          </Link>

          {/* Notifications Dropdown */}
          <div ref={notifRef} className="relative">
            <button
              type="button"
              onClick={() => setNotifOpen(!notifOpen)}
              className="relative rounded-btn p-2 text-slate-600 hover:bg-slate-100 transition-colors"
              aria-label="Notifications"
            >
              <Bell className="h-5 w-5" />
              {notifs.length > 0 && (
                <span className="absolute top-1 right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-black text-slate-950 shadow">
                  {notifs.length}
                </span>
              )}
            </button>

            {notifOpen && (
              <div className="absolute right-0 top-12 z-50 w-80 sm:w-96 rounded-panel border border-slate-200 bg-white p-3.5 shadow-modal animate-slide-up">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100 mb-2">
                  <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                    <Bell className="h-4 w-4 text-emerald-600" />
                    <span>Notifications</span>
                  </h3>
                  <span className="text-xs font-semibold text-slate-400">
                    {notifs.length} new
                  </span>
                </div>
                <div className="max-h-72 space-y-1.5 overflow-y-auto">
                  {notifs.map((n) => (
                    <Link
                      key={n.id}
                      to={n.order_id ? `/order/${n.order_id}` : '/orders'}
                      onClick={() => setNotifOpen(false)}
                      className="block rounded-btn bg-slate-50 p-2.5 text-sm hover:bg-emerald-50 transition-colors"
                    >
                      <p className="font-bold text-slate-900 text-xs">{n.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">
                        {n.message}
                      </p>
                    </Link>
                  ))}
                  {notifs.length === 0 && (
                    <div className="py-6 text-center text-slate-400 text-xs">
                      No new notifications
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Profile Hub Dropdown */}
          <div ref={profileRef} className="relative">
            <button
              type="button"
              onClick={() => setProfileOpen(!profileOpen)}
              className={`flex items-center gap-2 rounded-btn pl-1.5 pr-2.5 py-1 text-sm font-bold transition-all ${
                isProfileActive || profileOpen
                  ? 'bg-slate-100 text-slate-900 ring-2 ring-emerald-500/20'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-700 text-white font-black text-xs shadow-sm">
                {(user.name || 'S').charAt(0).toUpperCase()}
              </div>
              <span className="hidden sm:inline font-bold text-xs max-w-[100px] truncate">
                {user.name ? user.name.split(' ')[0] : 'Profile'}
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
            </button>

            {profileOpen && (
              <div className="absolute right-0 top-12 z-50 w-64 rounded-panel border border-slate-200 bg-white p-2 shadow-modal animate-slide-up">
                {/* User Header */}
                <div className="p-3 bg-slate-50 rounded-btn mb-1.5 border border-slate-100">
                  <p className="font-extrabold text-sm text-slate-900 truncate">
                    {user.name || 'Campus Student'}
                  </p>
                  <p className="text-xs text-slate-500 truncate">
                    @{user.username || 'student'}
                  </p>
                </div>

                <div className="space-y-0.5 text-sm">
                  <Link
                    to="/profile?tab=overview"
                    onClick={() => setProfileOpen(false)}
                    className="flex items-center gap-2 rounded-btn px-3 py-2 font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-800 transition-colors"
                  >
                    <User className="h-4 w-4 text-emerald-600" />
                    <span>Profile Hub & Stats</span>
                  </Link>

                  <Link
                    to="/orders"
                    onClick={() => setProfileOpen(false)}
                    className="flex items-center gap-2 rounded-btn px-3 py-2 font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-800 transition-colors"
                  >
                    <Package className="h-4 w-4 text-emerald-600" />
                    <span>My Orders</span>
                  </Link>

                  <Link
                    to="/profile?tab=reviews"
                    onClick={() => setProfileOpen(false)}
                    className="flex items-center gap-2 rounded-btn px-3 py-2 font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-800 transition-colors"
                  >
                    <Star className="h-4 w-4 text-amber-500" />
                    <span>My Reviews</span>
                  </Link>

                  <Link
                    to="/profile?tab=support"
                    onClick={() => setProfileOpen(false)}
                    className="flex items-center gap-2 rounded-btn px-3 py-2 font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-800 transition-colors"
                  >
                    <LifeBuoy className="h-4 w-4 text-emerald-600" />
                    <span>Help & Support</span>
                  </Link>

                  <Link
                    to="/profile?tab=settings"
                    onClick={() => setProfileOpen(false)}
                    className="flex items-center gap-2 rounded-btn px-3 py-2 font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-800 transition-colors"
                  >
                    <Settings className="h-4 w-4 text-slate-500" />
                    <span>Account Settings</span>
                  </Link>
                </div>

                <div className="pt-2 mt-1.5 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={logout}
                    className="flex w-full items-center gap-2 rounded-btn px-3 py-2 text-sm font-bold text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <LogOut className="h-4 w-4" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
