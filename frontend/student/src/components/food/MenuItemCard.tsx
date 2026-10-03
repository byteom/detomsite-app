import React from 'react'
import { Product, Shop } from '../../types'
import { comboItemList } from '../../utils/helpers'
import { QuantityStepper } from './QuantityStepper'
import { VegIcon, NonVegIcon, Sparkles } from '../ui/Icons'

interface MenuItemCardProps {
  product: Product
  shop: Shop
  quantity: number
  onQuantityChange: (qty: number) => void
  orderable: boolean
}

export function MenuItemCard({
  product,
  shop,
  quantity,
  onQuantityChange,
  orderable,
}: MenuItemCardProps) {
  const isCombo = Boolean(product.is_combo)
  const comboItems = comboItemList(product.combo_items)
  const isVeg = product.is_veg !== undefined ? Boolean(product.is_veg) : true

  return (
    <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 rounded-card border border-slate-200/80 bg-white p-3 sm:p-4 shadow-card hover:shadow-card-hover transition-all">
      <div className="min-w-0 flex-1">
        {/* Type & Combo Badges */}
        <div className="flex items-center gap-2 mb-1">
          {isVeg ? <VegIcon className="h-3 w-3" /> : <NonVegIcon className="h-3 w-3" />}
          {isCombo && (
            <span className="inline-flex items-center gap-1 rounded-pill bg-amber-100 text-amber-800 border border-amber-300 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider">
              <Sparkles className="h-2 w-2 text-amber-600" />
              Combo
            </span>
          )}
          {product.category && (
            <span className="text-[10px] font-semibold text-slate-400">
              {product.category}
            </span>
          )}
        </div>

        {/* Title */}
        <h3 className="font-bold text-slate-900 text-sm sm:text-base">
          {product.name}
        </h3>

        {/* Price */}
        <div className="mt-0.5 flex items-baseline gap-2">
          <span className="text-base font-black text-slate-900">
            ₹{product.price}
          </span>
          {isCombo && (
            <span className="text-[11px] font-medium text-emerald-700">
              combo meal
            </span>
          )}
        </div>

        {/* Description */}
        {product.description && (
          <p className="mt-1 text-xs text-slate-500 line-clamp-2 leading-relaxed max-w-xl">
            {product.description}
          </p>
        )}

        {/* Combo breakdown list */}
        {isCombo && comboItems.length > 0 && (
          <div className="mt-2 rounded-btn bg-amber-50/80 border border-amber-200/60 p-2 max-w-md">
            <p className="text-[11px] font-bold uppercase tracking-wider text-amber-900 mb-1">
              Includes in this combo:
            </p>
            <ul className="space-y-0.5 text-xs text-amber-800">
              {comboItems.map((item, idx) => (
                <li key={idx} className="flex items-center gap-1.5">
                  <span className="h-1 w-1 rounded-full bg-amber-500" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Action Stepper / Add Button */}
      <div className="flex sm:flex-col items-center justify-end sm:items-end shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
        {orderable ? (
          <QuantityStepper
            quantity={quantity}
            onIncrement={() => onQuantityChange(quantity + 1)}
            onDecrement={() => onQuantityChange(Math.max(0, quantity - 1))}
            variant="compact"
            size="md"
          />
        ) : (
          <span className="rounded-btn bg-slate-100 border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-400">
            Unavailable
          </span>
        )}
      </div>
    </div>
  )
}
