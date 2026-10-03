import React, { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { getCart, billBreakdown } from '../../utils/helpers'
import { ShoppingBag, ArrowRight } from '../ui/Icons'

export function StickyCartBar() {
  const location = useLocation()
  const [cart, setCart] = useState(() => getCart())

  useEffect(() => {
    const sync = () => setCart(getCart())
    window.addEventListener('cart-updated', sync)
    return () => window.removeEventListener('cart-updated', sync)
  }, [])

  // Do not show sticky bar if cart is empty or if we are already on cart/checkout/pay pages
  const isHiddenPage =
    location.pathname === '/cart' ||
    location.pathname === '/payment' ||
    location.pathname === '/pay' ||
    location.pathname.startsWith('/pay/') ||
    location.pathname.startsWith('/order/')

  if (cart.length === 0 || isHiddenPage) return null

  const totalCount = cart.reduce((sum, item) => sum + (item.quantity || 1), 0)
  const bill = billBreakdown(cart)
  const shopCount = new Set(cart.map((i) => i.shop_id)).size

  return (
    <div className="fixed bottom-20 md:bottom-6 left-0 right-0 z-40 px-4 pointer-events-none">
      <div className="mx-auto max-w-2xl pointer-events-auto">
        <Link
          to="/cart"
          className="group flex items-center justify-between rounded-panel bg-emerald-800 text-white p-3.5 sm:p-4 shadow-modal border border-emerald-600/40 backdrop-blur-md hover:bg-emerald-900 transition-all active:scale-[0.99]"
        >
          <div className="flex items-center gap-3">
            <div className="relative flex h-10 w-10 items-center justify-center rounded-btn bg-white/15 text-white">
              <ShoppingBag className="h-5 w-5" />
              <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-black text-slate-900 shadow">
                {totalCount}
              </span>
            </div>
            <div>
              <p className="text-sm font-bold tracking-tight">
                {totalCount} item{totalCount > 1 ? 's' : ''} added
                {shopCount > 1 && (
                  <span className="ml-1 text-xs font-normal text-emerald-200">
                    ({shopCount} shops)
                  </span>
                )}
              </p>
              <p className="text-xs font-semibold text-emerald-200">
                Total: ₹{bill.total}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-white group-hover:underline">
              View Cart
            </span>
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20 text-white group-hover:translate-x-0.5 transition-transform">
              <ArrowRight className="h-4 w-4" />
            </div>
          </div>
        </Link>
      </div>
    </div>
  )
}
