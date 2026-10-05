import api from '../services/api'
import { CartItem, Shop, Order, UserProfile, Product } from '../types'

/* ─── API Error Parser ─── */
export function apiError(e: any, fb = 'Request failed'): string {
  const d = e?.response?.data?.detail
  if (typeof d === 'string' && d.trim()) return d
  if (Array.isArray(d)) {
    const msgs = d.map((x: any) => x?.msg || x?.message).filter(Boolean)
    if (msgs.length) return msgs.join(' - ')
  }
  const m = e?.response?.data?.message
  if (typeof m === 'string' && m.trim()) return m
  if (e?.userMessage) return e.userMessage as string
  return (e?.message as string) || fb
}

/* ─── Resilient localStorage ─── */
export function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw)
    return (parsed ?? fallback) as T
  } catch {
    return fallback
  }
}

export function readUser(): UserProfile {
  const raw = localStorage.getItem('user_data')
  const user = safeParse<Record<string, any>>(raw, {})
  if (raw && (!user || typeof user !== 'object')) {
    try {
      localStorage.removeItem('user_data')
    } catch {
      /* private mode */
    }
    return {}
  }
  return user
}

/* ─── Combo Parser ─── */
export function comboItemList(comboItems?: string): string[] {
  return (comboItems || '')
    .split(/[\n,]+/)
    .map((i) => i.trim())
    .filter(Boolean)
}

/* ─── Cart Management ─── */
export const CART_KEY = 'detomsite-cart'
export const MAX_ITEM_QTY = 20

export function getCart(): CartItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CART_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveCart(items: CartItem[]): void {
  localStorage.setItem(CART_KEY, JSON.stringify(items))
  window.dispatchEvent(new Event('cart-updated'))
}

export function clearCart(): void {
  saveCart([])
}

/* Single-restaurant cart: a student orders from ONE kitchen at a time.
   Adding an item from another shop does NOT merge — the caller must ask
   first (see cartShopConflict) and, on OK, replace the cart. */
export type AddResult = 'added' | 'confirm-required' | 'limit-reached'

export function cartShopConflict(shopId: string): { conflict: boolean; currentShopName: string } {
  const c = getCart()
  if (!c.length || c[0].shop_id === shopId) {
    return { conflict: false, currentShopName: '' }
  }
  return { conflict: true, currentShopName: c[0].shop_name || 'another kitchen' }
}

export function addToCart(p: Product, s: Shop, qty = 1): AddResult {
  const c = getCart()
  const existing = c.find((i) => i.product_id === p.id)
  if (existing) {
    const next = (existing.quantity || 1) + qty
    if (next > MAX_ITEM_QTY) return 'limit-reached'
    saveCart(
      c.map((i) => (i.product_id === p.id ? { ...i, quantity: next } : i))
    )
    return 'added'
  }
  if (cartShopConflict(s.id).conflict) return 'confirm-required'
  saveCart([
    ...c,
    {
      product_id: p.id,
      shop_id: s.id,
      shop_name: s.name,
      name: p.name,
      price: p.price,
      category: p.category,
      quantity: Math.min(MAX_ITEM_QTY, Math.max(1, qty)),
      is_combo: Boolean(p.is_combo),
      combo_items: p.combo_items,
    },
  ])
  return 'added'
}

/* Replace the whole cart with one item (after the cross-shop confirm). */
export function replaceCartWith(p: Product, s: Shop, qty = 1): AddResult {
  saveCart([])
  return addToCart(p, s, qty)
}

export function setItemQty(productId: string, qty: number): void {
  const c = getCart()
  if (qty <= 0) {
    saveCart(c.filter((i) => i.product_id !== productId))
    return
  }
  const next = Math.min(MAX_ITEM_QTY, qty)
  saveCart(
    c.map((i) => (i.product_id === productId ? { ...i, quantity: next } : i))
  )
}

export function billBreakdown(items: CartItem[]) {
  const subtotal = items.reduce(
    (a, i) => a + i.price * (i.quantity || 1),
    0
  )
  return {
    subtotal,
    delivery: 0,
    taxes: 0,
    platformFee: 0,
    total: subtotal,
  }
}

/* ─── Client Cache for Shops & Orders ─── */
export const SHOPS_CACHE_KEY = 'detomsite-shops-cache'
export function cachedShops(): Shop[] | null {
  try {
    const raw = localStorage.getItem(SHOPS_CACHE_KEY)
    if (!raw) return null
    const { t, data } = JSON.parse(raw)
    if (Date.now() - t > 60000) return null
    return data
  } catch {
    return null
  }
}

export function fetchShopsCached(): Promise<Shop[]> {
  const hit = cachedShops()
  if (hit) return Promise.resolve(hit)
  return api
    .get<Shop[]>('/local/shops', { params: { public_only: true } })
    .then((r) => {
      try {
        localStorage.setItem(
          SHOPS_CACHE_KEY,
          JSON.stringify({ t: Date.now(), data: r.data })
        )
      } catch {
        /* storage full */
      }
      return r.data
    })
    .catch(() => cachedShops() || [])
}

export interface MenuSummaryData {
  shops: Record<string, { dishes: number; has_combo: boolean; matched?: number }>
  total_dishes: number
}

/* ─── Client Cache for Menu Flags ─── */
export const MENUFLAGS_CACHE_KEY = 'detomsite-menuflags-cache'
// Same 60s client cache as shops: the /shops grid remounts on every
// back-navigation, and without this each visit re-fetched menu-summary and
// flashed skeletons even when nothing changed.
export function fetchMenuSummaryCached(match: string): Promise<MenuSummaryData> {
  try {
    const raw = localStorage.getItem(MENUFLAGS_CACHE_KEY)
    if (raw) {
      const { t, data, m } = JSON.parse(raw)
      if (m === match && Date.now() - t < 60000 && data) return Promise.resolve(data)
    }
  } catch {
    /* corrupt cache — fall through to network */
  }
  return api
    .get<MenuSummaryData>('/local/menu-summary', { params: { match } })
    .then((r) => {
      try {
        localStorage.setItem(
          MENUFLAGS_CACHE_KEY,
          JSON.stringify({ t: Date.now(), m: match, data: r.data })
        )
      } catch {
        /* storage full */
      }
      return r.data
    })
}

export const ORDERS_CACHE_KEY = 'detomsite-orders-cache'
export function cachedOrders(): Order[] | null {
  try {
    const raw = localStorage.getItem(ORDERS_CACHE_KEY)
    if (!raw) return null
    const { t, data } = JSON.parse(raw)
    if (Date.now() - t > 30000) return null
    return data
  } catch {
    return null
  }
}

export function fetchOrdersCached(): Promise<Order[]> {
  const hit = cachedOrders()
  if (hit) return Promise.resolve(hit)
  return api
    .get<Order[]>('/local/orders')
    .then((r) => {
      try {
        localStorage.setItem(
          ORDERS_CACHE_KEY,
          JSON.stringify({ t: Date.now(), data: r.data })
        )
      } catch {
        /* ignore */
      }
      return r.data
    })
    .catch(() => cachedOrders() || [])
}

export function invalidateOrdersCache(): void {
  try {
    localStorage.removeItem(ORDERS_CACHE_KEY)
  } catch {
    /* ignore */
  }
}

/* ─── UPI Helpers ─── */
export function upiAmount(am: number): number {
  const n = Number(am)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}

export function buildUpiUri(pa: string, pn: string, am: number, tn: string): string {
  const payee = String(pa || '').trim()
  const name = String(pn || '').trim()
  const note = String(tn || '').trim().slice(0, 40)
  return `upi://pay?pa=${encodeURIComponent(payee)}&pn=${encodeURIComponent(
    name
  )}&am=${upiAmount(am).toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`
}

export function downloadQrPng(svg: SVGSVGElement | null, filename: string): void {
  if (!svg) return
  try {
    const clone = svg.cloneNode(true) as SVGSVGElement
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    const size = Number(svg.getAttribute('width')) || 180
    clone.setAttribute('width', String(size))
    clone.setAttribute('height', String(size))
    const xml = new XMLSerializer().serializeToString(clone)
    const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`
    const img = new Image()
    img.onload = () => {
      const scale = 2
      const canvas = document.createElement('canvas')
      canvas.width = size * scale
      canvas.height = size * scale
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((blob) => {
        if (!blob) return
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }, 'image/png')
    }
    img.src = src
  } catch {
    /* safely ignore download failure */
  }
}

/* ─── Location & Phone Helpers ─── */
export const MAIN_GATE = 'VIT-AP Main Gate'
export const HELP_DESK_PHONE = '+916382603607'

export function isVitApLocation(v: string): boolean {
  return /vit[\s-]*ap/i.test(v || '') && /main[\s-]*gate/i.test(v || '')
}

export function isValidMobile(v: string): boolean {
  const d = v.replace(/\D/g, '')
  return d.length === 10 || (d.length === 12 && d.startsWith('91'))
}

export function toE164(v: string): string {
  let d = v.replace(/\D/g, '')
  if (d.length > 10 && d.startsWith('91')) d = d.slice(2)
  d = d.slice(-10)
  return d ? `+91${d}` : ''
}

export function displayDigits(v: string): string {
  let d = v.replace(/\D/g, '')
  const raw = String(v || '')
  if (d.startsWith('91') && (raw.startsWith('+91') || d.length > 10)) d = d.slice(2)
  return d.slice(-10)
}

/* ─── Shop Orderability ─── */
export function isShopOrderable(s: Shop): boolean {
  return (
    s.approval_status === 'Approved' &&
    Boolean(s.present) &&
    s.status === 'Open'
  )
}

export function shopStatusReason(s: Shop): string {
  if (s.approval_status !== 'Approved') return 'Waiting for admin approval'
  if (!Boolean(s.present) || s.status !== 'Open')
    return 'Not accepting orders right now'
  return 'Open now'
}

/* ─── Date & Delivery Window Helpers ─── */
export function toDate(createdAt?: string): Date | null {
  const raw = String(createdAt || '').trim()
  if (!raw) return null
  let iso = raw
  if (!/T/.test(raw) && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(raw))
    iso = raw.replace(' ', 'T') + '+05:30'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : d
}

export function formatPlacedAt(createdAt?: string): string {
  const d = toDate(createdAt)
  if (!d) return String(createdAt || '').slice(0, 16)
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d)
}

export function istClock(d: Date): { h: number; m: number } {
  const s = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  return { h: s.getHours(), m: s.getMinutes() }
}

export function canCancelOrder(o: Order | null): boolean {
  if (!o || ['Completed', 'Cancelled', 'Failed'].includes(o.status)) return false
  const placed = toDate(o.created_at)
  if (!placed) return false
  const placedMin = istClock(placed).h * 60 + istClock(placed).m
  const nowMin = istClock(new Date()).h * 60 + istClock(new Date()).m
  const cutoff =
    placedMin < 12 * 60 + 30
      ? 12 * 60 + 30
      : placedMin < 18 * 60 + 30
      ? 18 * 60 + 30
      : -1
  return cutoff !== -1 && nowMin < cutoff
}

/* ─── Idempotency Key Generator ─── */
export function checkoutRef(items: CartItem[], method: string): string {
  const basis = items
    .map((i) => `${i.product_id}x${i.quantity || 1}`)
    .sort()
    .join('-')
  let hash = 5381
  const key = `${basis}|${method}`
  for (let i = 0; i < key.length; i++)
    hash = ((hash << 5) + hash + key.charCodeAt(i)) >>> 0
  return `co-${hash.toString(36)}`
}

/* ─── Category image generator for curated food aesthetic ─── */
export function getCategoryPhoto(category: string, name: string): string {
  const lower = `${category} ${name}`.toLowerCase()
  if (lower.includes('biryani') || lower.includes('rice') || lower.includes('pulao')) {
    return 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?auto=format&fit=crop&w=600&q=80'
  }
  if (lower.includes('dosa') || lower.includes('idli') || lower.includes('tiffin') || lower.includes('vada')) {
    return 'https://images.unsplash.com/photo-1668236543090-82eba5ee5976?auto=format&fit=crop&w=600&q=80'
  }
  if (lower.includes('burger') || lower.includes('pizza') || lower.includes('sandwich') || lower.includes('fast food')) {
    return 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=600&q=80'
  }
  if (lower.includes('tea') || lower.includes('chai') || lower.includes('coffee') || lower.includes('juice') || lower.includes('beverage')) {
    return 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?auto=format&fit=crop&w=600&q=80'
  }
  if (lower.includes('snack') || lower.includes('samosa') || lower.includes('roll') || lower.includes('chat') || lower.includes('chaat')) {
    return 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=600&q=80'
  }
  if (lower.includes('sweet') || lower.includes('dessert') || lower.includes('cake') || lower.includes('ice cream')) {
    return 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&w=600&q=80'
  }
  return 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=600&q=80'
}
