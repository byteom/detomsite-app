import React, { useState, useEffect, useMemo, FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Shop, Order, Product } from '../types'
import {
  readUser,
  fetchShopsCached,
  fetchOrdersCached,
  formatPlacedAt,
  apiError,
  MAIN_GATE,
  HELP_DESK_PHONE,
} from '../utils/helpers'
import api from '../services/api'
import { ShopCard } from '../components/food/ShopCard'
import { TokenBadge } from '../components/ui/Icons'
import { EmptyState } from '../components/ui/EmptyState'
import {
  User,
  Package,
  Heart,
  Star,
  LifeBuoy,
  Settings,
  Phone,
  Store,
  Clock,
  LogOut,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
  Send,
  MapPin,
} from '../components/ui/Icons'

type ProfileTab = 'overview' | 'orders' | 'favorites' | 'reviews' | 'support' | 'settings'

export function ProfilePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialTab = (searchParams.get('tab') as ProfileTab) || 'overview'
  const [activeTab, setActiveTab] = useState<ProfileTab>(initialTab)

  const [user, setUser] = useState(() => readUser())
  const [shops, setShops] = useState<Shop[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [reviews, setReviews] = useState<any[]>([])
  const [favShops, setFavShops] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  // Edit profile form state
  const [profileForm, setProfileForm] = useState({
    name: user.name || '',
    email: user.email || '',
    phone: user.phone || '',
  })
  const [profileMsg, setProfileMsg] = useState('')
  const [profileErr, setProfileErr] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)

  // Reviews form state
  const [reviewForm, setReviewForm] = useState({
    shop_id: '',
    rating: 5,
    comment: '',
  })
  const [reviewMsg, setReviewMsg] = useState('')

  // Support ticket form state
  const [ticketForm, setTicketForm] = useState({
    category: 'Order Issue',
    title: '',
    description: '',
  })
  const [ticketMsg, setTicketMsg] = useState('')
  const [ticketErr, setTicketErr] = useState('')

  // Sync tab with URL
  useEffect(() => {
    const tabParam = searchParams.get('tab') as ProfileTab
    if (tabParam && tabParam !== activeTab) {
      setActiveTab(tabParam)
    }
  }, [searchParams])

  const handleTabChange = (tab: ProfileTab) => {
    setActiveTab(tab)
    setSearchParams({ tab }, { replace: true })
  }

  // Load user data, shops, and orders
  useEffect(() => {
    Promise.all([
      fetchShopsCached(),
      fetchOrdersCached(),
      api.get('/users/reviews').then((r) => r.data || []).catch(() => []),
    ])
      .then(([s, o, r]) => {
        setShops(s)
        const myOrders = o.filter(
          (x) => x.student_name.toLowerCase() === (user.name || '').toLowerCase()
        )
        setOrders(myOrders)
        setReviews(r)
      })
      .finally(() => setLoading(false))

    // Read favorite shops
    try {
      const favs = JSON.parse(localStorage.getItem('detomsite_fav_shops') || '[]')
      setFavShops(favs)
    } catch {}
  }, [user.name])

  // Overview stats
  const activeOrders = useMemo(
    () =>
      orders.filter(
        (o) => o.status !== 'Completed' && o.status !== 'Cancelled' && o.status !== 'Failed'
      ),
    [orders]
  )
  const totalSpent = useMemo(
    () => orders.reduce((sum, o) => sum + (o.status !== 'Cancelled' ? o.total : 0), 0),
    [orders]
  )

  const favoriteShopList = useMemo(
    () => shops.filter((s) => favShops.includes(s.id)),
    [shops, favShops]
  )

  // Save profile updates (PUT /users/profile)
  const handleUpdateProfile = async (e: FormEvent) => {
    e.preventDefault()
    setProfileMsg('')
    setProfileErr('')
    setSavingProfile(true)
    try {
      const res = await api.put('/users/profile', profileForm)
      const updatedUser = res.data?.user || { ...user, ...profileForm }
      setUser(updatedUser)
      localStorage.setItem('user_data', JSON.stringify(updatedUser))
      setProfileMsg('Profile updated successfully!')
    } catch (err: any) {
      setProfileErr(apiError(err, 'Failed to update profile'))
    } finally {
      setSavingProfile(false)
    }
  }

  // Submit review (POST /users/reviews)
  const handleSubmitReview = async (e: FormEvent) => {
    e.preventDefault()
    setReviewMsg('')
    try {
      await api.post('/users/reviews', reviewForm)
      setReviewMsg('Thank you! Your review was submitted.')
      setReviewForm({ shop_id: '', rating: 5, comment: '' })
      api.get('/users/reviews').then((r) => setReviews(r.data || [])).catch(() => {})
    } catch (err: any) {
      setReviewMsg(apiError(err, 'Failed to submit review'))
    }
  }

  // Submit support ticket (POST /local/tickets)
  const handleSubmitTicket = async (e: FormEvent) => {
    e.preventDefault()
    setTicketMsg('')
    setTicketErr('')
    try {
      await api.post('/local/tickets', {
        ...ticketForm,
        name: user.name || 'Student',
        email: user.email || '',
        phone_number: user.phone || '',
      })
      setTicketMsg('Ticket submitted! Campus support will get in touch shortly.')
      setTicketForm({ category: 'Order Issue', title: '', description: '' })
    } catch (err: any) {
      setTicketErr(apiError(err, 'Failed to submit ticket'))
    }
  }

  const logout = () => {
    if (window.confirm('Are you sure you want to sign out?')) {
      localStorage.removeItem('access_token')
      localStorage.removeItem('user_data')
      localStorage.removeItem('detomsite-auth-check')
      window.location.href = '/login'
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 space-y-6">
      {/* Profile Hub Header Card */}
      <div className="relative overflow-hidden rounded-panel bg-gradient-to-br from-emerald-900 via-emerald-800 to-teal-800 p-6 sm:p-8 text-white shadow-card">
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 sm:h-20 sm:w-20 items-center justify-center rounded-panel bg-white/15 text-2xl sm:text-3xl font-black text-white shadow-sm ring-2 ring-white/20">
              {(user.name || 'S').charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
                  {user.name || 'Student Profile'}
                </h1>
                <span className="rounded-pill bg-white/20 px-2 py-0.5 text-[10px] font-black uppercase text-emerald-200">
                  {user.role || 'Student'}
                </span>
              </div>
              <p className="text-xs sm:text-sm text-emerald-200/90 mt-0.5">
                @{user.username || 'student'} · {user.email || 'campus student'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={logout}
            className="self-start sm:self-auto inline-flex items-center gap-2 rounded-btn bg-white/15 hover:bg-white/25 px-4 py-2 text-xs font-bold text-white transition-colors"
          >
            <LogOut className="h-4 w-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>

      {/* Main Hub Body: Sidebar + Content */}
      <div className="grid gap-6 md:grid-cols-[240px_1fr] items-start">
        {/* Navigation Sidebar (Desktop) / Horizontal Tabs (Mobile) */}
        <div className="flex md:flex-col gap-1.5 overflow-x-auto pb-2 md:pb-0 scrollbar-none no-scrollbar rounded-panel md:border md:border-slate-200 md:bg-white md:p-3 md:shadow-card">
          <button
            type="button"
            onClick={() => handleTabChange('overview')}
            className={`flex items-center gap-2.5 rounded-btn px-3.5 py-2.5 text-xs font-bold transition-all shrink-0 md:w-full ${
              activeTab === 'overview'
                ? 'bg-emerald-700 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 bg-white md:bg-transparent border md:border-0 border-slate-200'
            }`}
          >
            <User className="h-4 w-4" />
            <span>Overview & Stats</span>
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('orders')}
            className={`flex items-center justify-between rounded-btn px-3.5 py-2.5 text-xs font-bold transition-all shrink-0 md:w-full ${
              activeTab === 'orders'
                ? 'bg-emerald-700 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 bg-white md:bg-transparent border md:border-0 border-slate-200'
            }`}
          >
            <span className="flex items-center gap-2.5">
              <Package className="h-4 w-4" />
              <span>My Orders</span>
            </span>
            {activeOrders.length > 0 && (
              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-400 text-slate-950 font-black text-[10px]">
                {activeOrders.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('favorites')}
            className={`flex items-center gap-2.5 rounded-btn px-3.5 py-2.5 text-xs font-bold transition-all shrink-0 md:w-full ${
              activeTab === 'favorites'
                ? 'bg-emerald-700 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 bg-white md:bg-transparent border md:border-0 border-slate-200'
            }`}
          >
            <Heart className="h-4 w-4" />
            <span>Saved Kitchens ({favoriteShopList.length})</span>
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('reviews')}
            className={`flex items-center gap-2.5 rounded-btn px-3.5 py-2.5 text-xs font-bold transition-all shrink-0 md:w-full ${
              activeTab === 'reviews'
                ? 'bg-emerald-700 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 bg-white md:bg-transparent border md:border-0 border-slate-200'
            }`}
          >
            <Star className="h-4 w-4" />
            <span>Reviews & Ratings</span>
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('support')}
            className={`flex items-center gap-2.5 rounded-btn px-3.5 py-2.5 text-xs font-bold transition-all shrink-0 md:w-full ${
              activeTab === 'support'
                ? 'bg-emerald-700 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 bg-white md:bg-transparent border md:border-0 border-slate-200'
            }`}
          >
            <LifeBuoy className="h-4 w-4" />
            <span>Support & Help Desk</span>
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('settings')}
            className={`flex items-center gap-2.5 rounded-btn px-3.5 py-2.5 text-xs font-bold transition-all shrink-0 md:w-full ${
              activeTab === 'settings'
                ? 'bg-emerald-700 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 bg-white md:bg-transparent border md:border-0 border-slate-200'
            }`}
          >
            <Settings className="h-4 w-4" />
            <span>Account Settings</span>
          </button>
        </div>

        {/* Tab Content Panel */}
        <div className="space-y-6">
          {/* TAB 1: OVERVIEW (Formerly Dashboard) */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Stat Tiles 4-grid */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-card border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Total Orders
                  </p>
                  <p className="text-2xl font-black text-slate-900 mt-1">
                    {orders.length}
                  </p>
                </div>

                <div className="rounded-card border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Active Orders
                  </p>
                  <p className="text-2xl font-black text-emerald-700 mt-1">
                    {activeOrders.length}
                  </p>
                </div>

                <div className="rounded-card border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Total Spent
                  </p>
                  <p className="text-2xl font-black text-slate-900 mt-1">
                    ₹{totalSpent}
                  </p>
                </div>

                <div className="rounded-card border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Available Kitchens
                  </p>
                  <p className="text-2xl font-black text-slate-900 mt-1">
                    {shops.length}
                  </p>
                </div>
              </div>

              {/* Active Orders Tracker */}
              {activeOrders.length > 0 && (
                <div className="rounded-panel border border-emerald-200 bg-emerald-50/50 p-5 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-extrabold text-emerald-950 flex items-center gap-2">
                      <Clock className="h-4 w-4 text-emerald-700" />
                      <span>Live Order in Progress ({activeOrders.length})</span>
                    </h3>
                    <Link
                      to="/orders"
                      className="text-xs font-bold text-emerald-800 hover:underline"
                    >
                      View all →
                    </Link>
                  </div>

                  <div className="space-y-2">
                    {activeOrders.slice(0, 2).map((o) => (
                      <Link
                        key={o.id}
                        to={`/order/${o.id}`}
                        className="flex items-center justify-between rounded-card border border-emerald-200 bg-white p-4 shadow-sm hover:shadow-card transition-all"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-slate-900">
                              {o.shop_name}
                            </span>
                            <TokenBadge token={o.token} />
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {o.items}
                          </p>
                        </div>
                        <span className="text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-pill">
                          {o.status}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Campus Delivery Rules Card */}
              <div className="rounded-panel border border-slate-200 bg-white p-5 shadow-sm space-y-2">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                  <MapPin className="h-4 w-4 text-emerald-600" />
                  <span>Campus Main Gate Delivery Guideline</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  All deliveries are brought directly to the <b>{MAIN_GATE}</b>. Arrive with your Token Number to collect your parcel. For any order-related issues, use the Support tab or call our direct Help Desk at{' '}
                  <a href={`tel:${HELP_DESK_PHONE}`} className="text-emerald-700 font-bold underline">
                    +91 63826 03607
                  </a>.
                </p>
              </div>

              {/* Recent Orders List */}
              <div className="rounded-panel border border-slate-200 bg-white p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold text-slate-900">
                    Recent Orders
                  </h3>
                  <button
                    type="button"
                    onClick={() => handleTabChange('orders')}
                    className="text-xs font-bold text-emerald-700 hover:underline"
                  >
                    View Order History →
                  </button>
                </div>

                <div className="divide-y divide-slate-100">
                  {orders.slice(0, 4).map((o) => (
                    <Link
                      key={o.id}
                      to={`/order/${o.id}`}
                      className="flex items-center justify-between py-3 hover:bg-slate-50 px-2 rounded-btn transition-colors"
                    >
                      <div>
                        <p className="font-bold text-sm text-slate-900">
                          {o.shop_name}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {formatPlacedAt(o.created_at)} · ₹{o.total}
                        </p>
                      </div>
                      <span className="text-xs font-semibold text-slate-600">
                        {o.status} →
                      </span>
                    </Link>
                  ))}
                  {orders.length === 0 && (
                    <p className="text-xs text-slate-400 py-4 text-center">
                      No orders placed yet.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: MY ORDERS */}
          {activeTab === 'orders' && (
            <div className="rounded-panel border border-slate-200 bg-white p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h2 className="text-lg font-bold text-slate-900">
                  Order Management
                </h2>
                <Link
                  to="/orders"
                  className="text-xs font-bold text-emerald-700 hover:underline"
                >
                  Open Full Orders Hub →
                </Link>
              </div>

              <div className="space-y-3">
                {orders.map((o) => (
                  <Link
                    key={o.id}
                    to={`/order/${o.id}`}
                    className="block rounded-card border border-slate-200 p-4 hover:shadow-card transition-all"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-slate-900">
                          {o.shop_name}
                        </span>
                        <TokenBadge token={o.token} />
                      </div>
                      <span className="text-xs font-bold text-emerald-800">
                        ₹{o.total}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1 line-clamp-1">
                      {o.items}
                    </p>
                    <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
                      <span>{formatPlacedAt(o.created_at)}</span>
                      <span className="font-bold text-slate-700">
                        Status: {o.status}
                      </span>
                    </div>
                  </Link>
                ))}
                {orders.length === 0 && (
                  <EmptyState
                    type="orders"
                    title="No Orders Yet"
                    description="When you order from any campus kitchen, your receipts will be saved here."
                    actionLabel="Order Food"
                    actionLink="/shops"
                  />
                )}
              </div>
            </div>
          )}

          {/* TAB 3: SAVED KITCHENS */}
          {activeTab === 'favorites' && (
            <div className="rounded-panel border border-slate-200 bg-white p-5 shadow-sm space-y-4">
              <h2 className="text-lg font-bold text-slate-900 border-b border-slate-100 pb-3">
                Saved & Favorite Kitchens ({favoriteShopList.length})
              </h2>

              {favoriteShopList.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  {favoriteShopList.map((shop) => (
                    <ShopCard key={shop.id} shop={shop} favorite />
                  ))}
                </div>
              ) : (
                <EmptyState
                  type="generic"
                  icon={<Heart className="h-10 w-10 text-rose-500" />}
                  title="No Saved Kitchens"
                  description="Tap the heart icon on any restaurant card to save your favorite campus food spots here."
                  actionLabel="Explore Kitchens"
                  actionLink="/shops"
                />
              )}
            </div>
          )}

          {/* TAB 4: REVIEWS & RATINGS */}
          {activeTab === 'reviews' && (
            <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
              {/* Submitted Reviews List */}
              <div className="rounded-panel border border-slate-200 bg-white p-5 shadow-sm space-y-4">
                <h3 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3">
                  Your Reviews ({reviews.length})
                </h3>

                {reviews.length > 0 ? (
                  <div className="space-y-3">
                    {reviews.map((r: any, idx: number) => (
                      <div
                        key={idx}
                        className="rounded-card border border-slate-200 p-4 space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-800">
                            {r.shop_name || 'Campus Kitchen'}
                          </span>
                          <span className="text-amber-500 font-bold text-xs flex items-center">
                            {'★'.repeat(r.rating || 5)}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600">
                          {r.comment || 'No comment provided.'}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 py-6 text-center">
                    You haven't written any reviews yet. Share your feedback on campus food!
                  </p>
                )}
              </div>

              {/* Write Review Form */}
              <div className="rounded-panel border border-slate-200 bg-white p-5 shadow-sm space-y-4 h-fit">
                <h3 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3">
                  Rate a Kitchen
                </h3>

                {reviewMsg && (
                  <div className="rounded-btn bg-emerald-50 border border-emerald-200 p-3 text-xs font-bold text-emerald-800">
                    {reviewMsg}
                  </div>
                )}

                <form onSubmit={handleSubmitReview} className="space-y-3 text-xs">
                  <div>
                    <label className="block font-bold text-slate-600 mb-1">
                      Select Kitchen
                    </label>
                    <select
                      value={reviewForm.shop_id}
                      onChange={(e) =>
                        setReviewForm({ ...reviewForm, shop_id: e.target.value })
                      }
                      required
                      className="w-full rounded-btn border border-slate-200 p-2.5 outline-none focus:border-emerald-600"
                    >
                      <option value="">Choose a restaurant</option>
                      {shops.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block font-bold text-slate-600 mb-1">
                      Rating (1 to 5 Stars)
                    </label>
                    <select
                      value={reviewForm.rating}
                      onChange={(e) =>
                        setReviewForm({
                          ...reviewForm,
                          rating: parseInt(e.target.value),
                        })
                      }
                      className="w-full rounded-btn border border-slate-200 p-2.5 outline-none focus:border-emerald-600"
                    >
                      {[5, 4, 3, 2, 1].map((n) => (
                        <option key={n} value={n}>
                          {n} Stars ({'★'.repeat(n)})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block font-bold text-slate-600 mb-1">
                      Your Comments
                    </label>
                    <textarea
                      value={reviewForm.comment}
                      onChange={(e) =>
                        setReviewForm({ ...reviewForm, comment: e.target.value })
                      }
                      rows={3}
                      placeholder="Taste, freshness, quantity..."
                      className="w-full rounded-btn border border-slate-200 p-2.5 outline-none focus:border-emerald-600"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full rounded-btn bg-emerald-700 py-2.5 font-bold text-white hover:bg-emerald-800 transition-colors"
                  >
                    Submit Review
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* TAB 5: HELP & SUPPORT DESK */}
          {activeTab === 'support' && (
            <div className="space-y-6">
              {/* Help Desk Call Banner */}
              <div className="rounded-panel border border-emerald-200 bg-emerald-50/70 p-5 sm:p-6 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-btn bg-emerald-700 text-white">
                    <Phone className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-base text-slate-900">
                      Campus Support Hotline
                    </h3>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Need urgent help with an active order or delivery? Speak directly with support.
                    </p>
                  </div>
                </div>

                <a
                  href={`tel:${HELP_DESK_PHONE}`}
                  className="inline-flex items-center justify-center gap-2 rounded-btn bg-emerald-700 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-800 transition-colors shadow-sm self-start sm:self-auto"
                >
                  <Phone className="h-4 w-4" />
                  <span>Call +91 63826 03607</span>
                </a>
              </div>

              {/* Submit Ticket Form */}
              <div className="rounded-panel border border-slate-200 bg-white p-5 sm:p-6 shadow-card space-y-4">
                <h3 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3">
                  Submit a Support Request
                </h3>

                {ticketMsg && (
                  <div className="flex items-center gap-2 rounded-btn bg-emerald-50 border border-emerald-200 p-3 text-xs font-bold text-emerald-800">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span>{ticketMsg}</span>
                  </div>
                )}

                {ticketErr && (
                  <div className="flex items-center gap-2 rounded-btn bg-red-50 border border-red-200 p-3 text-xs font-bold text-red-700">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{ticketErr}</span>
                  </div>
                )}

                <form onSubmit={handleSubmitTicket} className="space-y-4 text-xs">
                  <div>
                    <label className="block font-bold text-slate-600 mb-1">
                      Issue Category
                    </label>
                    <select
                      value={ticketForm.category}
                      onChange={(e) =>
                        setTicketForm({ ...ticketForm, category: e.target.value })
                      }
                      className="w-full rounded-btn border border-slate-200 p-3 text-sm outline-none focus:border-emerald-600"
                    >
                      <option>Order Issue</option>
                      <option>Payment Verification</option>
                      <option>Food Quality Feedback</option>
                      <option>Technical / Account Problem</option>
                      <option>Other</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-bold text-slate-600 mb-1">
                      Subject
                    </label>
                    <input
                      type="text"
                      value={ticketForm.title}
                      onChange={(e) =>
                        setTicketForm({ ...ticketForm, title: e.target.value })
                      }
                      placeholder="Brief summary of your issue..."
                      required
                      className="w-full rounded-btn border border-slate-200 p-3 text-sm outline-none focus:border-emerald-600"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-600 mb-1">
                      Description
                    </label>
                    <textarea
                      value={ticketForm.description}
                      onChange={(e) =>
                        setTicketForm({
                          ...ticketForm,
                          description: e.target.value,
                        })
                      }
                      rows={4}
                      placeholder="Include your Order Token or details to help us resolve this faster..."
                      required
                      className="w-full rounded-btn border border-slate-200 p-3 text-sm outline-none focus:border-emerald-600"
                    />
                  </div>

                  <button
                    type="submit"
                    className="inline-flex items-center gap-2 rounded-btn bg-emerald-700 px-6 py-3 font-bold text-sm text-white hover:bg-emerald-800 transition-colors shadow-sm"
                  >
                    <Send className="h-4 w-4" />
                    <span>Submit Request</span>
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* TAB 6: SETTINGS (Includes PUT /users/profile Edit Form!) */}
          {activeTab === 'settings' && (
            <div className="space-y-6">
              {/* Edit Profile Form */}
              <div className="rounded-panel border border-slate-200 bg-white p-5 sm:p-6 shadow-card space-y-4">
                <div className="border-b border-slate-100 pb-3">
                  <h3 className="text-base font-bold text-slate-900">
                    Personal Information
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Update your display name, campus email, and contact number.
                  </p>
                </div>

                {profileMsg && (
                  <div className="flex items-center gap-2 rounded-btn bg-emerald-50 border border-emerald-200 p-3 text-xs font-bold text-emerald-800">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span>{profileMsg}</span>
                  </div>
                )}

                {profileErr && (
                  <div className="flex items-center gap-2 rounded-btn bg-red-50 border border-red-200 p-3 text-xs font-bold text-red-700">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{profileErr}</span>
                  </div>
                )}

                <form onSubmit={handleUpdateProfile} className="space-y-4 text-xs">
                  <div>
                    <label className="block font-bold text-slate-600 mb-1">
                      Full Name
                    </label>
                    <input
                      type="text"
                      value={profileForm.name}
                      onChange={(e) =>
                        setProfileForm({ ...profileForm, name: e.target.value })
                      }
                      required
                      className="w-full rounded-btn border border-slate-200 p-3 text-sm font-semibold outline-none focus:border-emerald-600"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-600 mb-1">
                      Campus Email
                    </label>
                    <input
                      type="email"
                      value={profileForm.email}
                      onChange={(e) =>
                        setProfileForm({ ...profileForm, email: e.target.value })
                      }
                      required
                      className="w-full rounded-btn border border-slate-200 p-3 text-sm font-semibold outline-none focus:border-emerald-600"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-600 mb-1">
                      Mobile Number
                    </label>
                    <input
                      type="tel"
                      value={profileForm.phone}
                      onChange={(e) =>
                        setProfileForm({ ...profileForm, phone: e.target.value })
                      }
                      placeholder="10-digit phone"
                      className="w-full rounded-btn border border-slate-200 p-3 text-sm font-semibold outline-none focus:border-emerald-600"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-400 mb-1">
                      Username (Read Only)
                    </label>
                    <input
                      type="text"
                      disabled
                      value={user.username || 'student'}
                      className="w-full rounded-btn border border-slate-200 bg-slate-100 p-3 text-sm font-semibold text-slate-500 cursor-not-allowed"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={savingProfile}
                    className="inline-flex items-center gap-2 rounded-btn bg-emerald-700 px-6 py-3 font-bold text-sm text-white hover:bg-emerald-800 transition-colors shadow-sm disabled:opacity-50"
                  >
                    <span>{savingProfile ? 'Saving...' : 'Save Changes'}</span>
                  </button>
                </form>
              </div>

              {/* Account Security & Sign Out */}
              <div className="rounded-panel border border-slate-200 bg-white p-5 shadow-card flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-sm text-slate-900">
                    Session Security
                  </h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Sign out of your student session on this browser.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={logout}
                  className="rounded-btn border border-red-200 bg-red-50 hover:bg-red-100 px-4 py-2 text-xs font-bold text-red-600 transition-colors"
                >
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
