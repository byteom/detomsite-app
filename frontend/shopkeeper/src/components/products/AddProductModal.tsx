import React, { useState } from 'react'
import { Sparkles, AlertTriangle } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'

interface AddProductModalProps {
  open: boolean
  onClose: () => void
  onAddProduct: (formData: any) => Promise<void>
  approvalStatus?: string
}

const initialFormState = {
  name: '',
  price: '',
  category: 'Food',
  description: '',
  inventory: '15',
  prep_time: '10',
  is_combo: false,
  combo_items: '',
}

export function AddProductModal({
  open,
  onClose,
  onAddProduct,
  approvalStatus,
}: AddProductModalProps) {
  const [formData, setFormData] = useState(initialFormState)
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState('')

  const isApproved = approvalStatus ? approvalStatus === 'Approved' : true

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isApproved) {
      setErr(`Cannot add products while shop status is "${approvalStatus || 'Pending'}". Please wait for administrator approval.`)
      return
    }
    setSubmitting(true)
    setErr('')
    try {
      await onAddProduct(formData)
      setFormData(initialFormState)
      onClose()
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e?.message || 'Failed to add product')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Product to Menu"
      description="Fill in dish details, pricing, and availability"
      maxWidth="lg"
    >
      <form onSubmit={handleFormSubmit} className="space-y-4">
        {!isApproved && (
          <div className="p-3.5 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Shop Awaiting Admin Approval</p>
              <p className="text-[11px] mt-0.5 leading-relaxed">
                Your shop is currently marked as <span className="font-semibold underline">{approvalStatus || 'Pending'}</span>. You can configure dish details now, but new products will be submitted to the menu once your shop is verified and approved.
              </p>
            </div>
          </div>
        )}

        {err && (
          <div className="p-3 rounded-lg border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-xs font-semibold text-red-700 dark:text-red-300">
            {err}
          </div>
        )}

        <Input
          label="Product / Dish Name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder={
            formData.is_combo
              ? 'Combo Name (e.g. Biryani + Drink Meal)'
              : 'Dish name (e.g. Chicken Biryani, Masala Dosa)'
          }
          required
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Price (₹)"
            type="number"
            min="1"
            value={formData.price}
            onChange={(e) => setFormData({ ...formData, price: e.target.value })}
            placeholder="e.g. 180"
            required
          />

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-heading)] mb-1.5">
              Category
            </label>
            {formData.is_combo ? (
              <div className="px-3.5 py-2.5 rounded-lg border border-purple-300 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/30 text-xs font-bold text-purple-700 dark:text-purple-300 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" /> Combo Category
              </div>
            ) : (
              <select
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="w-full rounded-lg px-3.5 py-2.5 text-sm border border-[var(--border-main)] bg-[var(--bg-surface)] text-[var(--text-heading)] outline-none focus:border-emerald-600 transition-colors"
              >
                <option value="Food">Food</option>
                <option value="Beverages">Beverages</option>
                <option value="Starters">Starters</option>
                <option value="Desserts">Desserts</option>
              </select>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Initial Stock Units"
            type="number"
            min="0"
            value={formData.inventory}
            onChange={(e) => setFormData({ ...formData, inventory: e.target.value })}
            placeholder="e.g. 20"
            required
          />

          <Input
            label="Prep Time (Minutes)"
            type="number"
            min="1"
            value={formData.prep_time}
            onChange={(e) => setFormData({ ...formData, prep_time: e.target.value })}
            placeholder="e.g. 10"
            required
          />
        </div>

        {/* Combo Toggle */}
        <div className="p-3.5 rounded-xl border border-[var(--border-main)] bg-[var(--bg-surface-subtle)] flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-[var(--text-heading)] flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-purple-600" /> Combo Product
            </p>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
              Single price for a full mix (e.g. Biryani + Drink + Dessert)
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={formData.is_combo}
            onClick={() =>
              setFormData({
                ...formData,
                is_combo: !formData.is_combo,
                category: !formData.is_combo ? 'Combo' : 'Food',
              })
            }
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out border-2 border-transparent ${
              formData.is_combo ? 'bg-purple-600' : 'bg-slate-300 dark:bg-slate-700'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-md transform ring-0 transition duration-200 ease-in-out ${
                formData.is_combo ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {formData.is_combo && (
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-heading)] mb-1.5">
              Included Items in Combo (One per line)
            </label>
            <textarea
              value={formData.combo_items}
              onChange={(e) => setFormData({ ...formData, combo_items: e.target.value })}
              rows={3}
              placeholder="1x Chicken Biryani&#10;1x Cold Drink 250ml&#10;1x Gulab Jamun"
              className="w-full rounded-lg p-3 text-xs border border-[var(--border-main)] bg-[var(--bg-surface)] text-[var(--text-heading)] outline-none focus:border-purple-600"
              required={formData.is_combo}
            />
          </div>
        )}

        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-heading)] mb-1.5">
            Description (Optional)
          </label>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            rows={2}
            placeholder="Freshly prepared with aromatic basmati rice and signature spices..."
            className="w-full rounded-lg p-3 text-xs border border-[var(--border-main)] bg-[var(--bg-surface)] text-[var(--text-heading)] outline-none focus:border-emerald-600"
          />
        </div>

        <div className="pt-2 flex justify-end gap-2 border-t border-[var(--border-subtle)]">
          <Button
            variant="secondary"
            size="md"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button variant="primary" size="md" type="submit" loading={submitting}>
            Add Product to Menu
          </Button>
        </div>
      </form>
    </Modal>
  )
}
