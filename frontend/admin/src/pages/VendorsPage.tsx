import React, { useState, useEffect } from 'react'
import {
  Store,
  Check,
  X,
  Plus,
  Edit2,
  Trash2,
  Settings,
  Clock,
  DollarSign,
  Layers,
  Power,
  Search,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react'
import api from '../services/api'
import { apiError, fmtTime, fmtCurrency } from '../utils/formatters'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Modal } from '../components/ui/Modal'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { Input } from '../components/ui/Input'
import { OrderItemsCell } from '../components/common/OrderItemsCell'

type VendorFilter = 'approved' | 'pending' | 'suspended' | 'removed'

const blankProductForm = {
  name: '',
  price: '',
  category: 'Food',
  description: '',
  inventory: '0',
  prep_time: '10',
  available: true,
  is_combo: false,
  combo_items: '',
}

export function VendorsPage() {
  const [vendors, setVendors] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [vendorFilter, setVendorFilter] = useState<VendorFilter>('approved')
  const [search, setSearch] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  // Settings Modal State
  const [settingsShop, setSettingsShop] = useState<any | null>(null)
  const [settingsForm, setSettingsForm] = useState({
    upi_id: '',
    upi_enabled: true,
    cod_enabled: true,
    phone: '',
  })
  const [settingsSaving, setSettingsSaving] = useState(false)

  // Products Modal & Drawer State
  const [selectedShopForProducts, setSelectedShopForProducts] = useState<any | null>(null)
  const [products, setProducts] = useState<any[]>([])
  const [productsLoading, setProductsLoading] = useState(false)
  const [editProduct, setEditProduct] = useState<any | null>(null)
  const [productForm, setProductForm] = useState(blankProductForm)
  const [productModalOpen, setProductModalOpen] = useState(false)
  const [productSaving, setProductSaving] = useState(false)
  const [productToDelete, setProductToDelete] = useState<any | null>(null)

  // Logs Modal State
  const [logsShop, setLogsShop] = useState<any | null>(null)
  const [logsData, setLogsData] = useState<any | null>(null)
  const [logsLoading, setLogsLoading] = useState(false)

  // Today Orders Modal State
  const [todayOrdersShop, setTodayOrdersShop] = useState<any | null>(null)
  const [todayOrders, setTodayOrders] = useState<any[]>([])
  const [todayLoading, setTodayLoading] = useState(false)

  // Destructive Action Confirmation
  const [confirmActionData, setConfirmActionData] = useState<{
    shopId: string
    shopName: string
    action: 'suspend' | 'remove' | 'reject'
  } | null>(null)

  const loadVendors = async () => {
    setLoading(true)
    try {
      const r = await api.get('/admin/vendors')
      setVendors(r.data || [])
    } catch (e: any) {
      setErr(apiError(e, 'Could not fetch vendors list'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadVendors()
  }, [])

  // Filter calculations
  const filterCount = (status: VendorFilter) => {
    return vendors.filter(v => {
      if (status === 'approved') return v.approval_status === 'Approved'
      if (status === 'pending') return v.approval_status === 'Pending Approval'
      if (status === 'suspended') return v.approval_status === 'Suspended'
      return v.approval_status === 'Removed'
    }).length
  }

  const filteredVendors = vendors
    .filter(v => {
      if (vendorFilter === 'approved') return v.approval_status === 'Approved'
      if (vendorFilter === 'pending') return v.approval_status === 'Pending Approval'
      if (vendorFilter === 'suspended') return v.approval_status === 'Suspended'
      return v.approval_status === 'Removed'
    })
    .filter(v => {
      if (!search.trim()) return true
      const q = search.toLowerCase()
      return (
        v.name?.toLowerCase().includes(q) ||
        v.shopkeeper_name?.toLowerCase().includes(q) ||
        v.phone?.includes(q) ||
        v.category?.toLowerCase().includes(q)
      )
    })

  // Approval actions
  const handleApprove = async (id: string) => {
    try {
      await api.post(`/admin/vendors/${id}/approve`)
      setMsg('Shop approved successfully!')
      loadVendors()
    } catch (e: any) {
      setErr(apiError(e, 'Approval failed'))
    }
  }

  const handleExecuteDestructiveAction = async () => {
    if (!confirmActionData) return
    const { shopId, action } = confirmActionData
    try {
      if (action === 'reject') {
        await api.post(`/admin/vendors/${shopId}/reject`, { action: 'reject' })
        setMsg('Shop registration rejected.')
      } else {
        await api.post(`/admin/vendors/${shopId}/admin-action`, { action })
        setMsg(action === 'remove' ? 'Shop removed.' : 'Shop suspended.')
      }
      loadVendors()
    } catch (e: any) {
      setErr(apiError(e, `Action ${action} failed`))
    } finally {
      setConfirmActionData(null)
    }
  }

  const handleRestore = async (id: string) => {
    try {
      await api.post(`/admin/vendors/${id}/admin-action`, { action: 'restore' })
      setMsg('Shop restored to active status.')
      loadVendors()
    } catch (e: any) {
      setErr(apiError(e, 'Failed to restore shop'))
    }
  }

  const handleToggleShopOpen = async (shopId: string, currentPresent: boolean) => {
    try {
      const newPresent = !currentPresent
      await api.patch(`/admin/vendors/${shopId}/present`, { present: newPresent })
      setMsg(newPresent ? 'Shop opened — accepting student orders.' : 'Shop closed — orders paused.')
      loadVendors()
    } catch (e: any) {
      setErr(apiError(e, 'Could not toggle shop status'))
    }
  }

  // Shop Settings
  const openSettingsModal = (v: any) => {
    setSettingsShop(v)
    setSettingsForm({
      upi_id: v.upi_id || '',
      upi_enabled: !!v.upi_enabled,
      cod_enabled: !!v.cod_enabled,
      phone: v.phone || '',
    })
  }

  const handleSaveSettings = async () => {
    if (!settingsShop) return
    setSettingsSaving(true)
    try {
      await api.patch(`/admin/vendors/${settingsShop.id}/settings`, settingsForm)
      setMsg('Shop settings updated!')
      setSettingsShop(null)
      loadVendors()
    } catch (e: any) {
      setErr(apiError(e, 'Could not update settings'))
    } finally {
      setSettingsSaving(false)
    }
  }

  // Products & Combos Catalog
  const openProductsDrawer = async (v: any) => {
    setSelectedShopForProducts(v)
    setProductsLoading(true)
    try {
      const r = await api.get(`/admin/vendors/${v.id}/products`)
      setProducts(r.data || [])
    } catch (e: any) {
      setErr(apiError(e, 'Could not load products'))
    } finally {
      setProductsLoading(false)
    }
  }

  const handleOpenAddProduct = () => {
    setEditProduct(null)
    setProductForm(blankProductForm)
    setProductModalOpen(true)
  }

  const handleOpenEditProduct = (p: any) => {
    setEditProduct(p)
    setProductForm({
      name: p.name || '',
      price: String(p.price || 0),
      category: p.category || 'Food',
      description: p.description || '',
      inventory: String(p.inventory || 0),
      prep_time: String(p.prep_time || 10),
      available: Boolean(p.available),
      is_combo: Boolean(p.is_combo),
      combo_items: p.combo_items || '',
    })
    setProductModalOpen(true)
  }

  const handleSaveProduct = async () => {
    if (!selectedShopForProducts) return
    if (!productForm.name || !productForm.price) {
      alert('Product name and price are required')
      return
    }
    setProductSaving(true)
    try {
      const body = {
        ...productForm,
        category: productForm.is_combo ? 'Combo' : productForm.category,
        price: parseInt(productForm.price) || 0,
        inventory: parseInt(productForm.inventory) || 0,
        prep_time: parseInt(productForm.prep_time) || 10,
        combo_items: productForm.is_combo ? productForm.combo_items : '',
      }

      if (editProduct) {
        await api.patch(
          `/admin/vendors/${selectedShopForProducts.id}/products/${editProduct.id}`,
          body
        )
        setMsg('Product updated successfully!')
      } else {
        await api.post(`/admin/vendors/${selectedShopForProducts.id}/products`, body)
        setMsg(productForm.is_combo ? 'Combo added!' : 'Product added!')
      }

      setProductModalOpen(false)
      const r = await api.get(`/admin/vendors/${selectedShopForProducts.id}/products`)
      setProducts(r.data || [])
    } catch (e: any) {
      alert(apiError(e, 'Failed to save product'))
    } finally {
      setProductSaving(false)
    }
  }

  const handleDeleteProduct = async () => {
    if (!selectedShopForProducts || !productToDelete) return
    try {
      await api.delete(
        `/admin/vendors/${selectedShopForProducts.id}/products/${productToDelete.id}`
      )
      setProducts(p => p.filter(x => x.id !== productToDelete.id))
      setMsg('Product removed from catalog.')
    } catch (e: any) {
      setErr(apiError(e, 'Could not delete product'))
    } finally {
      setProductToDelete(null)
    }
  }

  // Logs & Today's Orders
  const openLogsModal = async (v: any) => {
    setLogsShop(v)
    setLogsLoading(true)
    try {
      const r = await api.get(`/admin/vendors/${v.id}/logs`)
      setLogsData(r.data || null)
    } catch (e: any) {
      setLogsData(null)
    } finally {
      setLogsLoading(false)
    }
  }

  const openTodayOrdersModal = async (v: any) => {
    setTodayOrdersShop(v)
    setTodayLoading(true)
    try {
      const r = await api.get(`/admin/vendors/${v.id}/orders/today`)
      setTodayOrders(r.data?.orders || [])
    } catch (e: any) {
      setTodayOrders([])
    } finally {
      setTodayLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-200 dark:border-admin-border-dark pb-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">
            Vendors & Menus Directory
          </h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Manage restaurant verification, operating hours, payment routing, and food item catalogs
          </p>
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={loadVendors}
          icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
        >
          Refresh Directory
        </Button>
      </div>

      {/* Messages */}
      {msg && (
        <div
          className="p-3.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-xs font-semibold text-emerald-800 dark:text-emerald-300"
          style={{ borderRadius: 0 }}
        >
          {msg}
        </div>
      )}

      {err && (
        <div
          className="p-3.5 bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-800 text-xs font-semibold text-red-800 dark:text-red-300"
          style={{ borderRadius: 0 }}
        >
          {err}
        </div>
      )}

      {/* Tabs & Search Filter Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border border-gray-200 dark:border-admin-border-dark bg-white dark:bg-admin-surface-dark p-3">
        {/* Status Tabs */}
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: 'approved', label: 'Approved' },
              { id: 'pending', label: 'Pending Approval' },
              { id: 'suspended', label: 'Suspended' },
              { id: 'removed', label: 'Removed' },
            ] as const
          ).map(tab => (
            <button
              key={tab.id}
              onClick={() => setVendorFilter(tab.id)}
              className={`px-3 py-1.5 text-xs font-bold transition-colors select-none ${
                vendorFilter === tab.id
                  ? 'bg-emerald-700 dark:bg-emerald-600 text-white'
                  : 'bg-gray-100 dark:bg-admin-surface-darkSubtle text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800'
              }`}
              style={{ borderRadius: 0 }}
            >
              {tab.label} ({filterCount(tab.id)})
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative min-w-[220px] max-w-xs">
          <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search vendor name, owner, phone..."
            className="w-full bg-gray-50 dark:bg-admin-surface-darkSubtle border border-gray-300 dark:border-admin-border-dark pl-9 pr-3 py-1.5 text-xs text-gray-900 dark:text-gray-100 outline-none focus:border-emerald-600"
            style={{ borderRadius: 0 }}
          />
        </div>
      </div>

      {/* Vendor Cards List */}
      {loading ? (
        <div className="p-12 text-center text-xs text-gray-500">
          <Clock className="w-8 h-8 mx-auto mb-2 animate-spin text-emerald-600 opacity-60" />
          Loading vendor data...
        </div>
      ) : filteredVendors.length === 0 ? (
        <div
          className="border border-gray-200 dark:border-admin-border-dark bg-white dark:bg-admin-surface-dark p-12 text-center text-xs text-gray-500"
          style={{ borderRadius: 0 }}
        >
          <Store className="w-8 h-8 mx-auto mb-2 opacity-30" />
          No vendors found in this view.
        </div>
      ) : (
        <div className="space-y-3">
          {filteredVendors.map((v, idx) => (
            <div
              key={v.id}
              className="border border-gray-200 dark:border-admin-border-dark bg-white dark:bg-admin-surface-dark p-4 shadow-xs transition-colors hover:border-emerald-600/40"
              style={{ borderRadius: 0 }}
            >
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                {/* Information */}
                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="px-2 py-0.5 text-xs font-mono font-bold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                      style={{ borderRadius: 0 }}
                    >
                      #{idx + 1}
                    </span>
                    <h3 className="text-base font-black text-gray-900 dark:text-white">{v.name}</h3>
                    <Badge
                      variant={
                        v.approval_status === 'Approved'
                          ? 'success'
                          : v.approval_status === 'Pending Approval'
                          ? 'gold'
                          : 'error'
                      }
                      size="xs"
                    >
                      {v.approval_status}
                    </Badge>

                    {v.approval_status === 'Approved' && (
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold">
                        <span
                          className={`inline-block h-2 w-2 ${
                            v.present ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'
                          }`}
                          style={{ borderRadius: 0 }}
                        />
                        <span
                          className={
                            v.present
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-red-700 dark:text-red-400'
                          }
                        >
                          {v.present ? 'Open & Ordering' : 'Closed'}
                        </span>
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-gray-600 dark:text-gray-400 font-medium">
                    Owner: <b className="text-gray-900 dark:text-gray-200">{v.shopkeeper_name}</b> ·
                    Category: <span className="text-emerald-700 dark:text-emerald-400">{v.category}</span>
                  </p>

                  <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                    Phone: {v.phone || '—'} {v.shopkeeper_email ? `· ${v.shopkeeper_email}` : ''}
                  </p>

                  <div className="flex flex-wrap items-center gap-3 pt-1 text-xs">
                    <span className="font-semibold text-gray-700 dark:text-gray-300">
                      Today's Activity:
                    </span>
                    <span className="text-gray-600 dark:text-gray-400 font-mono">
                      {v.orders_today || 0} orders
                    </span>
                    <span className="text-gray-400">·</span>
                    <span className="text-emerald-700 dark:text-emerald-400 font-bold font-mono">
                      ₹{v.revenue_today || 0} volume
                    </span>

                    {/* UPI & COD Badges */}
                    <div className="flex items-center gap-1.5 ml-auto">
                      {v.upi_id ? (
                        <Badge variant={v.upi_enabled ? 'success' : 'warning'} size="xs">
                          UPI: {v.upi_id}
                        </Badge>
                      ) : (
                        <Badge variant="error" size="xs">
                          No UPI Configured
                        </Badge>
                      )}
                      <Badge variant={v.cod_enabled ? 'info' : 'default'} size="xs">
                        COD: {v.cod_enabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </div>
                  </div>
                </div>

                {/* Operations & Action Buttons */}
                <div className="flex flex-wrap items-center gap-2 shrink-0 border-t lg:border-t-0 pt-3 lg:pt-0 border-gray-100 dark:border-admin-border-darkSubtle">
                  {v.approval_status === 'Pending Approval' && (
                    <>
                      <Button
                        variant="primary"
                        size="xs"
                        onClick={() => handleApprove(v.id)}
                        icon={<Check className="w-3.5 h-3.5" />}
                      >
                        Approve
                      </Button>
                      <Button
                        variant="danger"
                        size="xs"
                        onClick={() =>
                          setConfirmActionData({
                            shopId: v.id,
                            shopName: v.name,
                            action: 'reject',
                          })
                        }
                        icon={<X className="w-3.5 h-3.5" />}
                      >
                        Reject
                      </Button>
                    </>
                  )}

                  {v.approval_status === 'Approved' && (
                    <Button
                      variant={v.present ? 'danger' : 'primary'}
                      size="xs"
                      onClick={() => handleToggleShopOpen(v.id, Boolean(v.present))}
                      icon={<Power className="w-3.5 h-3.5" />}
                      title={v.present ? 'Pause incoming orders' : 'Resume incoming orders'}
                    >
                      {v.present ? 'Close Store' : 'Open Store'}
                    </Button>
                  )}

                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => openProductsDrawer(v)}
                    icon={<Layers className="w-3.5 h-3.5 text-emerald-600" />}
                  >
                    Menu Items
                  </Button>

                  {v.approval_status === 'Approved' && (
                    <>
                      <Button
                        variant="secondary"
                        size="xs"
                        onClick={() => openSettingsModal(v)}
                        icon={<Settings className="w-3.5 h-3.5" />}
                      >
                        Settings
                      </Button>
                      <Button
                        variant="secondary"
                        size="xs"
                        onClick={() => openTodayOrdersModal(v)}
                        icon={<Clock className="w-3.5 h-3.5" />}
                      >
                        Today's Slots
                      </Button>
                    </>
                  )}

                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => openLogsModal(v)}
                    icon={<DollarSign className="w-3.5 h-3.5" />}
                  >
                    Earnings Logs
                  </Button>

                  {v.approval_status !== 'Removed' ? (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="xs"
                        className="text-amber-600 hover:text-amber-700"
                        onClick={() =>
                          setConfirmActionData({
                            shopId: v.id,
                            shopName: v.name,
                            action: 'suspend',
                          })
                        }
                      >
                        Suspend
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        className="text-red-600 hover:text-red-700"
                        onClick={() =>
                          setConfirmActionData({
                            shopId: v.id,
                            shopName: v.name,
                            action: 'remove',
                          })
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  ) : (
                    <Button variant="primary" size="xs" onClick={() => handleRestore(v.id)}>
                      Restore
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Products & Menus Modal */}
      {selectedShopForProducts && (
        <Modal
          open={Boolean(selectedShopForProducts)}
          onClose={() => setSelectedShopForProducts(null)}
          title={`Catalog Management · ${selectedShopForProducts.name}`}
          description="Manage food items, pricing, inventory status, and combo packages"
          maxWidth="2xl"
          footer={
            <div className="flex items-center justify-between w-full">
              <Button
                variant="primary"
                size="sm"
                onClick={handleOpenAddProduct}
                icon={<Plus className="w-4 h-4" />}
              >
                Add Food Item / Combo
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedShopForProducts(null)}>
                Done
              </Button>
            </div>
          }
        >
          {productsLoading ? (
            <p className="py-8 text-center text-xs text-gray-500">Loading catalog...</p>
          ) : products.length === 0 ? (
            <div className="text-center py-8 text-xs text-gray-500">
              No products or combos added yet. Click "Add Food Item / Combo" to populate the menu.
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[60vh] overflow-y-auto pr-1">
              {products.map(p => (
                <div
                  key={p.id}
                  className="flex items-start justify-between gap-3 p-3 border border-gray-200 dark:border-admin-border-dark bg-gray-50/50 dark:bg-admin-surface-darkSubtle/40"
                  style={{ borderRadius: 0 }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-gray-900 dark:text-white truncate">
                        {p.name}
                      </span>
                      {Boolean(p.is_combo) && (
                        <Badge variant="gold" size="xs">
                          Combo
                        </Badge>
                      )}
                      <Badge variant={p.available ? 'success' : 'error'} size="xs">
                        {p.available ? 'Available' : 'Unavailable'}
                      </Badge>
                    </div>

                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                      <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                        ₹{p.price}
                      </span>{' '}
                      · Category: {p.category} · Prep Time: {p.prep_time || 10} min
                    </p>

                    {p.description && (
                      <p className="text-xs text-gray-500 line-clamp-1 mt-0.5">{p.description}</p>
                    )}

                    {Boolean(p.is_combo) && p.combo_items && (
                      <div className="mt-1 p-2 bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-800 dark:text-amber-300">
                        <b>Combo Includes:</b>
                        <ul className="list-disc pl-4 mt-0.5 space-y-0.5">
                          {String(p.combo_items)
                            .split(/[\n,]+/)
                            .map(x => x.trim())
                            .filter(Boolean)
                            .map((it, i) => (
                              <li key={i}>{it}</li>
                            ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      variant="secondary"
                      size="xs"
                      onClick={() => handleOpenEditProduct(p)}
                      icon={<Edit2 className="w-3 h-3" />}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="danger"
                      size="xs"
                      onClick={() => setProductToDelete(p)}
                      icon={<Trash2 className="w-3 h-3" />}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}

      {/* Add / Edit Product Modal */}
      {productModalOpen && (
        <Modal
          open={productModalOpen}
          onClose={() => setProductModalOpen(false)}
          title={editProduct ? 'Edit Food Item / Combo' : 'Add New Item / Combo'}
          description="Specify pricing, category, description, and combo bundle options"
          maxWidth="md"
          footer={
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setProductModalOpen(false)}
                disabled={productSaving}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleSaveProduct}
                loading={productSaving}
              >
                {editProduct ? 'Update Product' : 'Add to Menu'}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Input
              label="Item Name"
              value={productForm.name}
              onChange={e => setProductForm({ ...productForm, name: e.target.value })}
              placeholder={productForm.is_combo ? 'Meal Combo Box' : 'Paneer Butter Masala'}
              required
            />

            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Price (₹)"
                type="number"
                value={productForm.price}
                onChange={e => setProductForm({ ...productForm, price: e.target.value })}
                placeholder="120"
                required
              />

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1.5">
                  Category
                </label>
                {productForm.is_combo ? (
                  <div
                    className="p-2.5 text-xs font-bold text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30"
                    style={{ borderRadius: 0 }}
                  >
                    Combo
                  </div>
                ) : (
                  <select
                    value={productForm.category}
                    onChange={e => setProductForm({ ...productForm, category: e.target.value })}
                    className="w-full bg-white dark:bg-admin-surface-dark border border-gray-300 dark:border-admin-border-dark px-3 py-2 text-sm text-gray-900 dark:text-white outline-none focus:border-emerald-600"
                    style={{ borderRadius: 0 }}
                  >
                    {['Food', 'Drinks', 'Snacks', 'Dessert', 'Other'].map(c => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            <Input
              label="Description (Optional)"
              value={productForm.description}
              onChange={e => setProductForm({ ...productForm, description: e.target.value })}
              placeholder="Freshly prepared with authentic spices"
            />

            {/* Combo Toggle */}
            <div
              className="p-3 border border-gray-200 dark:border-admin-border-dark bg-gray-50/50 dark:bg-admin-surface-darkSubtle/30"
              style={{ borderRadius: 0 }}
            >
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={productForm.is_combo}
                  onChange={e =>
                    setProductForm({
                      ...productForm,
                      is_combo: e.target.checked,
                      combo_items: e.target.checked ? productForm.combo_items : '',
                    })
                  }
                  className="mt-0.5 h-4 w-4 accent-emerald-600"
                  style={{ borderRadius: 0 }}
                />
                <div>
                  <span className="block text-xs font-bold text-gray-900 dark:text-white">
                    This is a combo bundle (One price, multiple items)
                  </span>
                  <span className="block text-[11px] text-gray-500">
                    Students will see all individual included items displayed on the menu.
                  </span>
                </div>
              </label>

              {productForm.is_combo && (
                <div className="mt-3">
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    Items Included in this Combo (One per line)
                  </label>
                  <textarea
                    rows={3}
                    value={productForm.combo_items}
                    onChange={e =>
                      setProductForm({ ...productForm, combo_items: e.target.value })
                    }
                    placeholder={'1x Veg Biryani\n1x Soft Drink (250ml)\n1x Gulab Jamun'}
                    className="w-full bg-white dark:bg-admin-surface-dark border border-gray-300 dark:border-admin-border-dark p-2 text-xs text-gray-900 dark:text-white outline-none focus:border-emerald-600"
                    style={{ borderRadius: 0 }}
                  />
                </div>
              )}
            </div>

            {/* Availability checkbox */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={productForm.available}
                onChange={e => setProductForm({ ...productForm, available: e.target.checked })}
                className="h-4 w-4 accent-emerald-600"
                style={{ borderRadius: 0 }}
              />
              <span className="text-xs font-bold text-gray-800 dark:text-gray-200">
                Item is available for ordering immediately
              </span>
            </label>
          </div>
        </Modal>
      )}

      {/* Delete Product Confirmation */}
      <ConfirmDialog
        open={Boolean(productToDelete)}
        onClose={() => setProductToDelete(null)}
        onConfirm={handleDeleteProduct}
        title="Delete Food Item"
        description={`Are you sure you want to permanently remove "${productToDelete?.name}" from this shop's menu? This action cannot be undone.`}
        confirmText="Delete Item"
        variant="danger"
      />

      {/* Shop Settings Modal */}
      {settingsShop && (
        <Modal
          open={Boolean(settingsShop)}
          onClose={() => setSettingsShop(null)}
          title={`Shop Settings · ${settingsShop.name}`}
          description="Configure payment methods and contact information for this vendor"
          maxWidth="md"
          footer={
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setSettingsShop(null)}
                disabled={settingsSaving}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleSaveSettings}
                loading={settingsSaving}
              >
                Save Settings
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Input
              label="Contact Phone"
              value={settingsForm.phone}
              onChange={e => setSettingsForm({ ...settingsForm, phone: e.target.value })}
              placeholder="9876543210"
            />

            <Input
              label="Vendor UPI ID"
              value={settingsForm.upi_id}
              onChange={e => setSettingsForm({ ...settingsForm, upi_id: e.target.value })}
              placeholder="vendor@okhdfcbank"
              helperText="Students pay directly to this UPI ID when ordering online."
            />

            <div className="space-y-2 pt-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settingsForm.upi_enabled}
                  onChange={e =>
                    setSettingsForm({ ...settingsForm, upi_enabled: e.target.checked })
                  }
                  className="h-4 w-4 accent-emerald-600"
                  style={{ borderRadius: 0 }}
                />
                <span className="text-xs font-bold text-gray-800 dark:text-gray-200">
                  Enable UPI Payments for this shop
                </span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settingsForm.cod_enabled}
                  onChange={e =>
                    setSettingsForm({ ...settingsForm, cod_enabled: e.target.checked })
                  }
                  className="h-4 w-4 accent-emerald-600"
                  style={{ borderRadius: 0 }}
                />
                <span className="text-xs font-bold text-gray-800 dark:text-gray-200">
                  Enable Cash on Delivery (COD)
                </span>
              </label>
            </div>
          </div>
        </Modal>
      )}

      {/* Today's Orders Slot Modal */}
      {todayOrdersShop && (
        <Modal
          open={Boolean(todayOrdersShop)}
          onClose={() => setTodayOrdersShop(null)}
          title={`Today's Orders · ${todayOrdersShop.name}`}
          description="Detailed breakdown of orders placed today"
          maxWidth="2xl"
          footer={
            <Button variant="ghost" size="sm" onClick={() => setTodayOrdersShop(null)}>
              Close
            </Button>
          }
        >
          {todayLoading ? (
            <p className="py-8 text-center text-xs text-gray-500">Loading today's orders...</p>
          ) : todayOrders.length === 0 ? (
            <p className="py-8 text-center text-xs text-gray-500">
              No orders placed for this shop yet today.
            </p>
          ) : (
            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-gray-100 dark:bg-admin-surface-darkSubtle border-b border-gray-200 dark:border-admin-border-dark font-bold text-gray-600 dark:text-gray-400">
                  <tr>
                    <th className="p-2">Token</th>
                    <th className="p-2">Customer</th>
                    <th className="p-2">Items</th>
                    <th className="p-2 text-right">Amount</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Placed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-admin-border-darkSubtle">
                  {todayOrders.map(o => (
                    <tr key={o.id}>
                      <td className="p-2 font-mono font-bold">#{o.token}</td>
                      <td className="p-2">{o.student_name}</td>
                      <td className="p-2">
                        <OrderItemsCell items={o.items} />
                      </td>
                      <td className="p-2 text-right font-mono font-bold">₹{o.total}</td>
                      <td className="p-2">
                        <Badge variant="default" size="xs">
                          {o.status}
                        </Badge>
                      </td>
                      <td className="p-2 text-gray-500">{fmtTime(o.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}

      {/* Logs Modal */}
      {logsShop && (
        <Modal
          open={Boolean(logsShop)}
          onClose={() => setLogsShop(null)}
          title={`Earnings & Share Logs · ${logsShop.name}`}
          description="Detailed breakdown of shop volume and admin ₹10/order commission"
          maxWidth="2xl"
          footer={
            <Button variant="ghost" size="sm" onClick={() => setLogsShop(null)}>
              Close
            </Button>
          }
        >
          {logsLoading ? (
            <p className="py-8 text-center text-xs text-gray-500">Loading shop logs...</p>
          ) : !logsData ? (
            <p className="py-8 text-center text-xs text-gray-500">No logs available for this shop.</p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div
                  className="p-3 border border-gray-200 dark:border-admin-border-dark bg-gray-50 dark:bg-admin-surface-darkSubtle"
                  style={{ borderRadius: 0 }}
                >
                  <p className="text-[10px] uppercase font-bold text-gray-500">Total Volume</p>
                  <p className="text-lg font-black text-gray-900 dark:text-white font-mono mt-0.5">
                    ₹{(logsData.summary?.total_revenue || 0).toLocaleString('en-IN')}
                  </p>
                </div>
                <div
                  className="p-3 border border-gray-200 dark:border-admin-border-dark bg-gray-50 dark:bg-admin-surface-darkSubtle"
                  style={{ borderRadius: 0 }}
                >
                  <p className="text-[10px] uppercase font-bold text-gray-500">Total Orders</p>
                  <p className="text-lg font-black text-gray-900 dark:text-white font-mono mt-0.5">
                    {logsData.summary?.total_orders || 0}
                  </p>
                </div>
                <div
                  className="p-3 border border-amber-500/30 bg-amber-500/10"
                  style={{ borderRadius: 0 }}
                >
                  <p className="text-[10px] uppercase font-bold text-amber-700 dark:text-amber-400">
                    Admin's ₹10 Share
                  </p>
                  <p className="text-lg font-black text-amber-800 dark:text-amber-300 font-mono mt-0.5">
                    ₹{(logsData.summary?.total_admin_fee || 0).toLocaleString('en-IN')}
                  </p>
                </div>
              </div>

              {logsData.daily && logsData.daily.length > 0 && (
                <div className="border border-gray-200 dark:border-admin-border-dark overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-gray-100 dark:bg-admin-surface-darkSubtle font-bold">
                      <tr>
                        <th className="p-2.5">Date</th>
                        <th className="p-2.5">Orders</th>
                        <th className="p-2.5">Volume</th>
                        <th className="p-2.5 text-amber-600">Admin Share</th>
                        <th className="p-2.5 text-emerald-600">Vendor Keeps</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-admin-border-darkSubtle">
                      {logsData.daily.map((d: any) => (
                        <tr key={d.created_at}>
                          <td className="p-2.5 font-mono">{d.created_at}</td>
                          <td className="p-2.5">{d.count}</td>
                          <td className="p-2.5 font-mono font-bold">₹{d.revenue || 0}</td>
                          <td className="p-2.5 font-mono font-bold text-amber-600">
                            ₹{d.admin_fee || 0}
                          </td>
                          <td className="p-2.5 font-mono font-bold text-emerald-600">
                            ₹{Math.max(0, (d.revenue || 0) - (d.admin_fee || 0))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </Modal>
      )}

      {/* Destructive Action Dialog */}
      <ConfirmDialog
        open={Boolean(confirmActionData)}
        onClose={() => setConfirmActionData(null)}
        onConfirm={handleExecuteDestructiveAction}
        title={
          confirmActionData?.action === 'reject'
            ? 'Reject Shop Application'
            : confirmActionData?.action === 'remove'
            ? 'Remove Shop Permanently'
            : 'Suspend Shop'
        }
        description={
          confirmActionData?.action === 'reject'
            ? `Are you sure you want to reject the application for "${confirmActionData?.shopName}"?`
            : confirmActionData?.action === 'remove'
            ? `Are you sure you want to remove "${confirmActionData?.shopName}"? The shop will be hidden from students.`
            : `Are you sure you want to suspend "${confirmActionData?.shopName}"? Its products will be paused immediately.`
        }
        confirmText={
          confirmActionData?.action === 'reject'
            ? 'Reject Shop'
            : confirmActionData?.action === 'remove'
            ? 'Remove Shop'
            : 'Suspend Shop'
        }
        variant="danger"
      />
    </div>
  )
}
