import React from 'react'
import { Plus, Minus, Trash2 } from '../ui/Icons'
import { MAX_ITEM_QTY } from '../../utils/helpers'

interface QuantityStepperProps {
  quantity: number
  onIncrement: () => void
  onDecrement: () => void
  disabled?: boolean
  max?: number
  variant?: 'compact' | 'cart' | 'large'
  size?: 'sm' | 'md' | 'lg'
}

export function QuantityStepper({
  quantity,
  onIncrement,
  onDecrement,
  disabled = false,
  max = MAX_ITEM_QTY,
  variant = 'compact',
  size = 'md',
}: QuantityStepperProps) {
  const atMax = quantity >= max

  if (quantity === 0 && variant === 'compact') {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onIncrement()
        }}
        className={`group relative inline-flex items-center justify-center font-bold transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${
          size === 'sm'
            ? 'px-3 py-1 text-xs rounded-btn border border-emerald-600 text-emerald-700 bg-emerald-50/70 hover:bg-emerald-600 hover:text-white'
            : 'px-4 py-2 text-sm rounded-btn border-2 border-emerald-600 text-emerald-700 bg-white hover:bg-emerald-600 hover:text-white shadow-sm'
        }`}
      >
        <span>ADD</span>
        <Plus className="ml-1 h-3.5 w-3.5 transition-transform group-hover:scale-110" />
      </button>
    )
  }

  return (
    <div
      className={`inline-flex items-center justify-between rounded-btn border border-emerald-600 bg-emerald-600 text-white shadow-sm transition-all select-none ${
        size === 'sm'
          ? 'h-7 min-w-[76px] px-1'
          : size === 'lg'
          ? 'h-10 min-w-[110px] px-2'
          : 'h-8 min-w-[92px] px-1.5'
      }`}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={onDecrement}
        aria-label="Decrease quantity"
        className="flex h-full items-center justify-center rounded px-1.5 text-white/90 hover:text-white active:scale-90 transition-transform disabled:opacity-40"
      >
        {quantity === 1 && variant === 'cart' ? (
          <Trash2 className="h-3.5 w-3.5" />
        ) : (
          <Minus className="h-3.5 w-3.5" />
        )}
      </button>

      <span className="font-extrabold text-sm text-center min-w-[20px] text-white">
        {quantity}
      </span>

      <button
        type="button"
        disabled={disabled || atMax}
        onClick={onIncrement}
        aria-label="Increase quantity"
        className="flex h-full items-center justify-center rounded px-1.5 text-white/90 hover:text-white active:scale-90 transition-transform disabled:opacity-40"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
