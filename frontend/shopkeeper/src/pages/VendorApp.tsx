import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
} from 'react'
import {
  Routes,
  Route,
  useNavigate,
  Navigate,
} from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import {
  CheckCircle2,
  AlertCircle,
} from 'lucide-react'

import api from '../services/api'
import { usePolling } from '../hooks/usePolling'
import { apiError, safeStorageJSON } from '../utils/formatters'
import {
  upiAmount,
  urlBase64ToUint8Array,
  pushKeyToBase64,
  istDay,
} from '../utils/helpers'
import { Shop, Product, Order, ShopStats, HistoryData } from '../types'

// Layout & UI Components
import { ShopkeeperLayout } from '../components/layout/ShopkeeperLayout'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { AddProductModal } from '../components/products/AddProductModal'

// Modular Page Views
import { DashboardPage } from './DashboardPage'
import { OrdersPage } from './OrdersPage'
import { ProductsPage } from './ProductsPage'
import { InventoryPage } from './InventoryPage'
import { SalesPage } from './SalesPage'
import { SettingsPage } from './SettingsPage'

export function VendorApp() {
  const navigate = useNavigate()
  const [shop, setShop] = useState<Shop | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [stats, setStats] = useState<ShopStats>({})
  const [approvalStatus, setApprovalStatus] = useState<string>('loading')
  const [upiId, setUpiId] = useState('')
  const [upiEnabled, setUpiEnabled] = useState(true)
  const [codEnabled, setCodEnabled] = useState(true)
  const [historyRange, setHistoryRange] = useState('today')
  const [history, setHistory] = useState<HistoryData>({
    orders: [],
    daily: [],
    revenue: 0,
    count: 0,
  })

  // Modals & UI states
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [showDuesQr, setShowDuesQr] = useState(false)
  const [payingDues, setPayingDues] = useState(false)
  const [showAgentGuide, setShowAgentGuide] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const lastRefresh = useRef(0)

  // Push notification state
  const [pushState, setPushState] = useState<
    'checking' | 'disabled' | 'unsupported' | 'denied' | 'unsubscribed' | 'subscribed' | 'error'
  >('checking')
  const [pushPublicKey, setPushPublicKey] = useState('')
  const [pushReason, setPushReason] = useState('')
  const [pushError, setPushError] = useState('')
  const [sendingTest, setSendingTest] = useState(false)

  const vendor = safeStorageJSON<Record<string, any>>('vendor_user', {})
  const isLoggedIn = Boolean(localStorage.getItem('vendor_token'))

  // Cache utilities for instant launch
  const CACHE_KEY = 'detomsite_vendor_cache'
  const loadCache = (): any | null => {
    try {
      const raw = localStorage.getItem(CACHE_KEY)
      if (!raw) return null
      const c = JSON.parse(raw)
      if (!c?.shop || c?.vendorId !== (vendor?.id || '')) return null
      return c
    } catch {
      return null
    }
  }

  const saveCache = (patch: any) => {
    try {
      const c = loadCache() || {}
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ ...c, ...patch, ts: Date.now(), vendorId: vendor?.id || '' })
      )
    } catch {}
  }

  // API Loaders
  const loadDashboard = async (silent = false): Promise<boolean> => {
    try {
      const res = await api.get('/vendor/dashboard')
      const data = res.data
      setShop(data.shop || null)
      setUpiId(data.shop?.upi_id || '')
      setUpiEnabled(data.shop ? Boolean(data.shop.upi_enabled) : true)
      setCodEnabled(data.shop ? Boolean(data.shop.cod_enabled) : true)
      setOrders(data.orders || [])
      setStats(data.stats || {})
      setApprovalStatus(data.shop?.approval_status || 'not_found')
      saveCache({
        shop: data.shop || null,
        orders: data.orders || [],
        stats: data.stats || {},
      })
      return true
    } catch {
      if (!silent) setErr('Failed to load dashboard')
      return false
    }
  }

  const loadProducts = async (silent = false) => {
    try {
      const res = await api.get('/vendor/products')
      setProducts(res.data || [])
      saveCache({ products: res.data || [] })
    } catch {
      if (!silent) setErr('Failed to load products')
    }
  }

  const loadHistory = async (range: string) => {
    const today = new Date()
    let from = ''
    let to = istDay(today)
    if (range === 'today') from = istDay(today)
    else if (range === 'yesterday') {
      const y = new Date(today)
      y.setDate(y.getDate() - 1)
      from = to = istDay(y)
    } else if (range === 'week') {
      const w = new Date(today)
      w.setDate(w.getDate() - 6)
      from = istDay(w)
    }
    try {
      const res = await api.get('/vendor/history', {
        params: range === 'all' ? { from, to } : { range, from, to },
      })
      setHistory(res.data || { orders: [], daily: [], revenue: 0, count: 0 })
      setErr('')
    } catch {
      setErr('Failed to load history')
    }
  }

  const selectHistoryRange = (range: string) => {
    setHistoryRange(range)
    loadHistory(range)
  }

  const refreshAll = async (silent = false) => {
    const now = Date.now()
    if (silent && now - lastRefresh.current < 2000) return
    lastRefresh.current = now
    if (!silent) setRefreshing(true)
    try {
      await Promise.all([loadDashboard(silent), loadProducts(silent)])
    } finally {
      if (!silent) setTimeout(() => setRefreshing(false), 400)
    }
  }

  // Push notifications logic
  const ensureServiceWorker = async (timeoutMs = 12000): Promise<ServiceWorkerRegistration> => {
    const registration = await navigator.serviceWorker.register('/mobile/sw.js', {
      updateViaCache: 'none',
    })
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const reg = await navigator.serviceWorker.getRegistration()
      if (reg?.active || registration.active || navigator.serviceWorker.controller) {
        return reg || registration
      }
      await new Promise((r) => setTimeout(r, 400))
    }
    throw new Error('service-worker-timeout')
  }

  const checkPushSupport = async () => {
    try {
      const res = await api.get('/vendor/push/config')
      const cfg = res.data || {}
      if (!cfg.enabled || !cfg.vapid_public_key) {
        setPushReason(
          cfg.reason || 'Push alerts are not configured on the server yet (VAPID keys missing).'
        )
        setPushState('disabled')
        return
      }
      setPushReason('')
      setPushPublicKey(cfg.vapid_public_key)
      if (!window.isSecureContext) {
        setPushError('Push needs a secure HTTPS connection.')
        setPushState('unsupported')
        return
      }
      if (
        !('serviceWorker' in navigator) ||
        !('PushManager' in window) ||
        !('Notification' in window)
      ) {
        setPushState('unsupported')
        return
      }
      let reg
      try {
        reg = await ensureServiceWorker()
      } catch (e: any) {
        setPushError(e?.message || 'Service worker not active')
        setPushState('unsupported')
        return
      }
      try {
        const sub = await reg.pushManager.getSubscription()
        if (sub) {
          try {
            await api.post('/vendor/push/subscribe', {
              endpoint: sub.endpoint,
              keys: {
                p256dh: pushKeyToBase64(sub.getKey('p256dh')),
                auth: pushKeyToBase64(sub.getKey('auth')),
              },
            })
          } catch {}
          setPushState('subscribed')
        } else if (Notification.permission === 'denied') {
          setPushState('denied')
        } else {
          setPushState('unsubscribed')
        }
      } catch {
        setPushState('unsubscribed')
      }
    } catch {
      setPushReason('Server push configuration check failed')
      setPushState('disabled')
    }
  }

  const enablePush = async () => {
    setPushError('')
    try {
      if (!pushPublicKey) {
        setErr('Push notifications are not configured on the server yet')
        return
      }
      let perm = Notification.permission
      if (perm === 'default') perm = await Notification.requestPermission()
      if (perm !== 'granted') {
        setPushState('denied')
        setErr('Notification permission was not granted')
        return
      }
      const reg = await ensureServiceWorker()
      let sub = await reg.pushManager.getSubscription()
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(pushPublicKey),
        })
      }
      await api.post('/vendor/push/subscribe', {
        endpoint: sub.endpoint,
        keys: {
          p256dh: pushKeyToBase64(sub.getKey('p256dh')),
          auth: pushKeyToBase64(sub.getKey('auth')),
        },
      })
      setPushState('subscribed')
      setMsg('Order sound alerts enabled on this device!')
    } catch (error: any) {
      setErr(apiError(error, 'Could not enable push notifications'))
    }
  }

  const disablePush = async () => {
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        try {
          await api.delete('/vendor/push/subscribe', { params: { endpoint: sub.endpoint } })
        } catch {}
        await sub.unsubscribe()
      }
      setPushState('unsubscribed')
      setMsg('Order notifications disabled')
    } catch {
      setErr('Could not disable notifications')
    }
  }

  const sendTestPush = async () => {
    setSendingTest(true)
    try {
      const res = await api.post('/vendor/push/test')
      if (res.data?.ok) setMsg('Test notification sent!')
      else setErr(res.data?.detail || 'Test push failed')
    } catch (error: any) {
      setErr(apiError(error, 'Test push failed'))
    } finally {
      setSendingTest(false)
    }
  }

  // Operational Actions
  const updateOrderStatus = async (orderId: string, status: string) => {
    try {
      await api.patch(`/vendor/orders/${orderId}/status`, { status })
      setMsg(`Order status updated to ${status}`)
      loadDashboard(true)
    } catch (error: any) {
      setErr(apiError(error, 'Failed to update order status'))
    }
  }

  const confirmPayment = async (orderId: string) => {
    try {
      await api.post(`/vendor/orders/${orderId}/payment-received`)
      setMsg('Payment confirmed! Order moved to active queue.')
      loadDashboard(true)
    } catch (error: any) {
      setErr(apiError(error, 'Failed to confirm payment'))
    }
  }

  const togglePresent = async () => {
    if (!shop || shop.approval_status !== 'Approved') {
      setErr('Shop must be approved by admin before changing open status')
      return
    }
    const next = !Boolean(shop.present)
    try {
      await api.patch('/vendor/shop', { present: next })
      setMsg(next ? 'Shop opened! Now accepting orders.' : 'Shop paused. No new orders will arrive.')
      loadDashboard(true)
    } catch (error: any) {
      setErr(apiError(error, 'Failed to toggle shop status'))
    }
  }

  const addProduct = async (formData: any) => {
    try {
      await api.post('/vendor/products', {
        name: formData.name,
        price: parseInt(formData.price, 10),
        category: formData.is_combo ? 'Combo' : formData.category,
        description: formData.description,
        inventory: parseInt(formData.inventory, 10) || 10,
        prep_time: parseInt(formData.prep_time, 10) || 10,
        is_combo: formData.is_combo,
        combo_items: formData.is_combo ? formData.combo_items : '',
      })
      setMsg(formData.is_combo ? 'Combo added to menu!' : 'Product added to menu!')
      loadProducts()
    } catch (error: any) {
      setErr(apiError(error, 'Failed to add product'))
      throw error
    }
  }

  const updateProductAvailable = async (productId: string, available: boolean) => {
    try {
      await api.patch(`/vendor/products/${productId}`, { available })
      setMsg(available ? 'Product marked available' : 'Product marked unavailable')
      loadProducts(true)
    } catch {
      setErr('Failed to update availability')
    }
  }

  const updateProductInventory = async (productId: string, newInventory: number) => {
    try {
      await api.patch(`/vendor/products/${productId}`, { inventory: newInventory })
      setMsg('Inventory updated')
      loadProducts(true)
    } catch (error: any) {
      setErr(apiError(error, 'Failed to update inventory'))
    }
  }

  const deleteProduct = async (productId: string) => {
    try {
      await api.delete(`/vendor/products/${productId}`)
      setMsg('Product deleted from menu')
      loadProducts(true)
    } catch (error: any) {
      setErr(apiError(error, 'Failed to delete product'))
    }
  }

  const saveUpi = () => {
    const v = upiId.trim()
    if (!v) {
      setErr('Please enter a valid UPI ID')
      return
    }
    api
      .patch('/vendor/shop', { upi_id: v })
      .then(() => {
        setMsg('UPI ID saved! Students will see your QR at checkout.')
        loadDashboard(true)
      })
      .catch((e) => setErr(apiError(e, 'Failed to save UPI ID')))
  }

  const togglePayment = async (key: 'upi_enabled' | 'cod_enabled', value: boolean) => {
    if (key === 'upi_enabled' && !value && !codEnabled) {
      setErr('At least one payment method must remain active')
      return
    }
    if (key === 'cod_enabled' && !value && !upiEnabled) {
      setErr('At least one payment method must remain active')
      return
    }
    try {
      await api.patch('/vendor/shop', { [key]: value })
      if (key === 'upi_enabled') setUpiEnabled(value)
      else setCodEnabled(value)
      setMsg(value ? 'Payment method enabled' : 'Payment method disabled')
      loadDashboard(true)
    } catch {
      setErr('Failed to update payment settings')
    }
  }

  const recordDuesPaid = async () => {
    setPayingDues(true)
    try {
      await api.post('/vendor/dues/pay', { amount: duesAmount })
      setShowDuesQr(false)
      setMsg(`Share payment of ₹${duesAmount} recorded! Administrator will verify.`)
      loadDashboard(true)
    } catch (error: any) {
      setErr(apiError(error, 'Could not record payment'))
    } finally {
      setPayingDues(false)
    }
  }

  const handleCallStudent = (phone?: string) => {
    if (!phone) {
      setErr('Student phone number not available')
      return
    }
    window.location.href = `tel:${phone}`
  }

  const handleLogout = () => {
    localStorage.removeItem('vendor_token')
    localStorage.removeItem('vendor_user')
    navigate('/')
  }

  // Initial startup
  useEffect(() => {
    if (!isLoggedIn) {
      navigate('/login')
      return
    }
    checkPushSupport()

    // Hydrate cached dashboard immediately
    const cached = loadCache()
    if (cached) {
      if (cached.shop) {
        setShop(cached.shop)
        setApprovalStatus(cached.shop.approval_status || 'not_found')
        setUpiId(cached.shop.upi_id || '')
        setUpiEnabled(Boolean(cached.shop.upi_enabled))
        setCodEnabled(Boolean(cached.shop.cod_enabled))
      }
      if (Array.isArray(cached.orders)) setOrders(cached.orders)
      if (cached.stats) setStats(cached.stats)
      if (Array.isArray(cached.products)) setProducts(cached.products)
    }

    // Network boot refresh
    const boot = async () => {
      let ok = await loadDashboard(true)
      loadProducts(true)
      loadHistory(historyRange)
      for (let attempt = 0; attempt < 5 && !ok; attempt++) {
        await new Promise((r) => setTimeout(r, 2500))
        ok = await loadDashboard(true)
      }
    }
    void boot()
  }, [])

  // Auto-reload orders periodically
  usePolling(
    useCallback(async () => {
      await refreshAll(true)
    }, []),
    25000,
    [isLoggedIn]
  )

  // Auto-dismiss alert toasts after 4 seconds
  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(''), 4000)
    return () => clearTimeout(t)
  }, [msg])

  useEffect(() => {
    if (!err) return
    const t = setTimeout(() => setErr(''), 5000)
    return () => clearTimeout(t)
  }, [err])

  if (!isLoggedIn) return null

  const duesAmount = stats.platform_fee_due ?? 0
  const adminUpi = (stats.admin_upi_id || '').trim()
  const adminReceiver = (stats.admin_receiver_name || 'DETOMSITE Admin').trim()
  const duesQrUri = adminUpi
    ? `upi://pay?pa=${encodeURIComponent(adminUpi)}&pn=${encodeURIComponent(adminReceiver)}&am=${upiAmount(duesAmount).toFixed(2)}&cu=INR&mode=04&tn=${encodeURIComponent('DETOMSITE Admin Share')}`
    : ''

  const pendingOrdersCount = orders.filter(
    (o) => o.status === 'Pending Acceptance' || o.status === 'Pending Payment'
  ).length

  return (
    <ShopkeeperLayout
      shopName={shop?.name}
      pendingOrdersCount={pendingOrdersCount}
      shopPresent={Boolean(shop?.present)}
      onTogglePresent={togglePresent}
      onRefresh={() => refreshAll(false)}
      refreshing={refreshing}
    >
      {/* ─── Toast Notifications ─── */}
      {msg && (
        <div className="mb-4 p-3.5 rounded-xl border border-emerald-600/40 bg-emerald-50 dark:bg-emerald-950/40 text-xs font-bold text-emerald-800 dark:text-emerald-300 flex items-center justify-between shadow-xs animate-slide-up">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{msg}</span>
          </div>
          <button type="button" onClick={() => setMsg('')} className="p-1 rounded hover:bg-emerald-200/50">
            ✕
          </button>
        </div>
      )}

      {err && (
        <div className="mb-4 p-3.5 rounded-xl border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-xs font-bold text-red-700 dark:text-red-300 flex items-center justify-between shadow-xs animate-slide-up">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{err}</span>
          </div>
          <button type="button" onClick={() => setErr('')} className="p-1 rounded hover:bg-red-200/50">
            ✕
          </button>
        </div>
      )}

      {/* ─── Routing between Modular Views ─── */}
      <Routes>
        <Route
          index
          element={
            <DashboardPage
              shop={shop}
              stats={stats}
              orders={orders}
              products={products}
              approvalStatus={approvalStatus}
              onTogglePresent={togglePresent}
              onUpdateOrderStatus={updateOrderStatus}
              onConfirmPayment={confirmPayment}
              onOpenAddProduct={() => setAddModalOpen(true)}
              onOpenDuesPay={() => setShowDuesQr(true)}
              onCallStudent={handleCallStudent}
            />
          }
        />

        <Route
          path="orders"
          element={
            <OrdersPage
              orders={orders}
              onUpdateOrderStatus={updateOrderStatus}
              onConfirmPayment={confirmPayment}
              onCallStudent={handleCallStudent}
            />
          }
        />

        <Route
          path="products"
          element={
            <ProductsPage
              products={products}
              approvalStatus={approvalStatus}
              onOpenAddProduct={() => setAddModalOpen(true)}
              onUpdateAvailable={updateProductAvailable}
              onDeleteProduct={deleteProduct}
            />
          }
        />

        <Route
          path="inventory"
          element={
            <InventoryPage
              products={products}
              onUpdateInventory={updateProductInventory}
              onUpdateAvailable={updateProductAvailable}
            />
          }
        />

        <Route
          path="history"
          element={
            <SalesPage
              history={history}
              historyRange={historyRange}
              onSelectRange={selectHistoryRange}
              onCallStudent={handleCallStudent}
            />
          }
        />

        <Route
          path="settings"
          element={
            <SettingsPage
              shop={shop}
              stats={stats}
              approvalStatus={approvalStatus}
              upiId={upiId}
              setUpiId={setUpiId}
              onSaveUpi={saveUpi}
              upiEnabled={upiEnabled}
              codEnabled={codEnabled}
              onTogglePayment={togglePayment}
              pushState={pushState}
              pushReason={pushReason}
              pushError={pushError}
              onEnablePush={enablePush}
              onDisablePush={disablePush}
              onSendTestPush={sendTestPush}
              sendingTest={sendingTest}
              onOpenDuesPay={() => setShowDuesQr(true)}
              onOpenAgentGuide={() => setShowAgentGuide(true)}
              onLogout={handleLogout}
            />
          }
        />

        <Route path="*" element={<Navigate to="/mobile" replace />} />
      </Routes>

      {/* ─── Admin Share UPI QR Modal ─── */}
      <Modal
        open={showDuesQr}
        onClose={() => setShowDuesQr(false)}
        title="Pay Admin Platform Share"
        description={`Scan with GPay / PhonePe / Paytm to pay ₹${duesAmount} to the administrator`}
        maxWidth="sm"
      >
        <div className="space-y-4 text-center">
          <div className="p-4 rounded-2xl border border-[var(--border-main)] bg-white inline-block mx-auto shadow-xs">
            {duesQrUri ? (
              <QRCodeSVG value={duesQrUri} size={180} level="M" />
            ) : (
              <p className="text-xs text-[var(--text-dim)] p-4">Admin UPI not configured yet</p>
            )}
          </div>

          <div className="text-xs space-y-1">
            <p className="font-mono font-bold text-[var(--text-heading)]">{adminUpi || '—'}</p>
            <p className="text-[var(--text-muted)]">Receiver: {adminReceiver}</p>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[var(--border-subtle)]">
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                if (duesQrUri) window.open(duesQrUri, '_blank')
              }}
              disabled={!duesQrUri}
            >
              Open UPI App
            </Button>

            <Button
              variant="primary"
              size="md"
              onClick={recordDuesPaid}
              loading={payingDues}
            >
              I've Paid ✓
            </Button>
          </div>
        </div>
      </Modal>

      {/* ─── SMS Agent Setup Modal ─── */}
      <Modal
        open={showAgentGuide}
        onClose={() => setShowAgentGuide(false)}
        title="📲 Payment Agent Setup"
        description="Automatic bank confirmation is disabled — verification is manual"
        maxWidth="md"
      >
        <div className="space-y-3 text-xs text-[var(--text-body)]">
          <p className="text-[var(--text-muted)]">
            Automatic bank confirmation is disabled on this platform: student
            UPI payments are verified by an admin from the submitted UTR +
            screenshot. The agent app below is kept for reference only and no
            longer confirms orders.
          </p>

          <ol className="space-y-2 rounded-xl border border-[var(--border-subtle)] p-3.5 bg-[var(--bg-surface-subtle)]">
            <li className="flex gap-2">
              <span className="font-bold text-emerald-600">1.</span>
              <span>
                Download the APK directly onto your shop phone:{' '}
                <a
                  href="/mobile/Detomsite-SMS-Agent.apk"
                  download
                  className="font-bold text-emerald-600 underline"
                >
                  Download SMS Agent APK
                </a>
              </span>
            </li>
            <li className="flex gap-2">
              <span className="font-bold text-emerald-600">2.</span>
              <span>Install the app and grant "SMS Read" permissions when prompted.</span>
            </li>
            <li className="flex gap-2">
              <span className="font-bold text-emerald-600">3.</span>
              <span>Enter your backend URL & agent key (provided by the administrator) and tap Save.</span>
            </li>
          </ol>

          <div className="p-3.5 rounded-xl border border-emerald-600/30 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-300">
            <p className="font-bold uppercase tracking-wider text-[10px]">
              🔒 Privacy Guaranteed
            </p>
            <p className="text-[11px] mt-0.5">
              The agent runs 100% on the device. Personal texts, account balances, and SMS contents never leave your phone. Only the verified UTR number and transaction amount are transmitted.
            </p>
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setShowAgentGuide(false)
                window.location.href =
                  'intent://open#Intent;scheme=detomsite-agent;package=com.detomsite.smsagent;end'
              }}
            >
              Launch Installed Agent
            </Button>
            <Button variant="primary" size="sm" onClick={() => setShowAgentGuide(false)}>
              Close
            </Button>
          </div>
        </div>
      </Modal>

      {/* ─── Global Add Product Modal ─── */}
      <AddProductModal
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        onAddProduct={addProduct}
        approvalStatus={approvalStatus}
      />
    </ShopkeeperLayout>
  )
}
export default VendorApp
