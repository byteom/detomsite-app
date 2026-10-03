import React, { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CartItem } from '../types'
import {
  getCart,
  setItemQty,
  clearCart,
  billBreakdown,
  MAIN_GATE,
} from '../utils/helpers'
import { QuantityStepper } from '../components/food/QuantityStepper'
import { EmptyState } from '../components/ui/EmptyState'
import {
  Store,
  MapPin,
  ShieldCheck,
  ArrowRight,
  Trash2,
  Sparkles,
} from '../components/ui/Icons'

export function CartPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<CartItem[]>(() => getCart())

  useEffect(() => {
    const sync = () => setItems(getCart())
    window.addEventListener('cart-updated', sync)
    return () => window.removeEventListener('cart-updated', sync)
  }, [])

  const bill = billBreakdown(items)

  // Group items by restaurant
  const grouped = React.useMemo(() => {
    const map: Record<string, CartItem[]> = {}
    for (const item of items) {
      if (!map[item.shop_name]) map[item.shop_name] = []
      map[item.shop_name].push(item)
    }
    return map
  }, [items])

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16">
        <EmptyState
          type="cart"
          title="Your Cart is Empty"
          description="Looks like you haven't added any dishes yet. Explore our campus kitchens to start ordering!"
          actionLabel="Explore Campus Kitchens"
          actionLink="/shops"
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
            Review Your Order
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-slate-500">
            {items.length} item{items.length === 1 ? '' : 's'} in your basket
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            if (window.confirm('Clear all items from your cart?')) {
              clearCart()
              setItems([])
            }
          }}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-red-600 hover:text-red-700 p-2 rounded-btn hover:bg-red-50 transition-colors"
        >
          <Trash2 className="h-4 w-4" />
          <span>Clear Cart</span>
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px] lg:items-start">
        {/* Left Column: Items grouped by restaurant */}
        <div className="space-y-5">
          {Object.entries(grouped).map(([shopName, shopItems]) => {
            const shopSubtotal = shopItems.reduce(
              (sum, item) => sum + item.price * (item.quantity || 1),
              0
            )

            return (
              <div
                key={shopName}
                className="overflow-hidden rounded-panel border border-slate-200 bg-white shadow-card"
              >
                {/* Restaurant Section Header */}
                <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-4 py-3 sm:px-5">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-btn bg-emerald-100 text-emerald-800">
                      <Store className="h-4 w-4" />
                    </div>
                    <h3 className="font-extrabold text-sm sm:text-base text-slate-900">
                      {shopName}
                    </h3>
                  </div>

                  <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-pill">
                    Subtotal: ₹{shopSubtotal}
                  </span>
                </div>

                {/* Items in this shop */}
                <div className="divide-y divide-slate-100 p-2 sm:p-3">
                  {shopItems.map((item) => (
                    <div
                      key={item.product_id}
                      className="flex items-center justify-between gap-3 p-3 rounded-btn hover:bg-slate-50/60 transition-colors"
                    >
                      {/* Item Details */}
                      <div className="min-w-0 flex-1">
                        <h4 className="font-bold text-sm text-slate-900 truncate">
                          {item.name}
                        </h4>
                        <p className="text-xs font-semibold text-slate-400">
                          ₹{item.price} each
                        </p>
                      </div>

                      {/* Quantity Stepper & Line Price */}
                      <div className="flex items-center gap-3 sm:gap-4 shrink-0">
                        <QuantityStepper
                          quantity={item.quantity || 1}
                          onIncrement={() =>
                            setItemQty(item.product_id, (item.quantity || 1) + 1)
                          }
                          onDecrement={() =>
                            setItemQty(item.product_id, (item.quantity || 1) - 1)
                          }
                          variant="cart"
                          size="sm"
                        />

                        <span className="min-w-[54px] text-right font-black text-sm text-slate-900">
                          ₹{item.price * (item.quantity || 1)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}

          {/* Campus Delivery Callout */}
          <div className="flex items-start gap-3 rounded-card border border-emerald-200 bg-emerald-50/60 p-4 text-xs text-emerald-950 shadow-sm">
            <MapPin className="h-4 w-4 text-emerald-700 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-slate-900">
                Pick up point: {MAIN_GATE}
              </p>
              <p className="text-slate-600 mt-0.5 leading-relaxed">
                Campus delivery is completely free. Arrive at the Main Gate with your Order Token once your kitchen marks it ready.
              </p>
            </div>
          </div>
        </div>

        {/* Right Column: Bill Details & Checkout CTA */}
        <div className="sticky top-20 rounded-panel border border-slate-200 bg-white p-5 shadow-card space-y-4">
          <h2 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3">
            Bill Summary
          </h2>

          <div className="space-y-2.5 text-xs sm:text-sm text-slate-600">
            <div className="flex justify-between">
              <span>Item Subtotal</span>
              <span className="font-bold text-slate-900">₹{bill.subtotal}</span>
            </div>

            <div className="flex justify-between text-emerald-700">
              <span className="flex items-center gap-1 font-semibold">
                <Sparkles className="h-3.5 w-3.5" />
                Delivery Fee (Campus)
              </span>
              <span className="font-extrabold uppercase tracking-wide">
                FREE
              </span>
            </div>

            <div className="flex justify-between text-slate-500">
              <span>Taxes & Service Fees</span>
              <span>₹0</span>
            </div>

            <div className="pt-3 border-t border-slate-200 flex justify-between items-baseline text-base sm:text-lg font-black text-slate-900">
              <span>To Pay</span>
              <span className="text-xl sm:text-2xl text-emerald-700">
                ₹{bill.total}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => navigate('/payment')}
            className="w-full inline-flex items-center justify-center gap-2 rounded-btn bg-emerald-700 py-3.5 px-5 text-sm sm:text-base font-black text-white shadow-modal hover:bg-emerald-800 transition-all active:scale-[0.98]"
          >
            <span>Proceed to Checkout</span>
            <ArrowRight className="h-4 w-4" />
          </button>

          <p className="text-[11px] text-center text-slate-400 font-medium">
            Next: Verify delivery details & choose payment method.
          </p>
        </div>
      </div>
    </div>
  )
}
