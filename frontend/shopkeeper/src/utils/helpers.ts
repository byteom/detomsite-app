import { Order } from '../types'

export interface ParsedOrderItem {
  name: string
  quantity: number
  price?: number
}

function parseSingleTextItem(seg: string): ParsedOrderItem | null {
  let name = seg.trim()
  let quantity = 1

  // Strip stray JSON punctuation if malformed text passed in
  name = name.replace(/^[{\["'\s]+|[}\]"'\s]+$/g, '')

  // Reject raw JSON syntax remnants (e.g. "price": 49, "quantity": 2})
  if (!name || /^"?(price|quantity|qty|subtotal|product_id|id)"?\s*:/i.test(name)) {
    return null
  }

  const m1 = name.match(/^(\d+)\s*[xX*]\s*(.+)$/)
  const m2 = name.match(/^(.+?)\s*[xX*]\s*(\d+)$/)
  const m3 = name.match(/^(.+?)\s*\((\d+)\)$/)

  if (m1) {
    quantity = parseInt(m1[1], 10) || 1
    name = m1[2].trim()
  } else if (m2) {
    quantity = parseInt(m2[2], 10) || 1
    name = m2[1].trim()
  } else if (m3) {
    quantity = parseInt(m3[2], 10) || 1
    name = m3[1].trim()
  }

  return { name: name || 'Item', quantity: isNaN(quantity) || quantity <= 0 ? 1 : quantity }
}

/**
 * Universal order items parser.
 * Handles:
 * 1. JSON arrays: `[{"name": "Dish-5506", "quantity": 1, "price": 99}]`
 * 2. Double-stringified / escaped JSON strings
 * 3. Python dict string representations: `[{'name': 'Dish-1', 'quantity': 2}]`
 * 4. Plain strings: `"2x Biryani, 1x Coke"` or `"Special Veg Thali (2), Crispy Samosa"`
 */
export function parseOrderItems(rawInput: any): ParsedOrderItem[] {
  if (!rawInput) return []

  // Case 1: Already an array
  if (Array.isArray(rawInput)) {
    return rawInput
      .map((item) => {
        if (typeof item === 'object' && item !== null) {
          const name = String(
            item.name || item.product_name || item.dish_name || item.title || ''
          ).trim()
          const quantity = Number(item.quantity || item.qty || item.count || 1)
          const price = item.price ? Number(item.price) : undefined
          return {
            name: name || 'Dish',
            quantity: isNaN(quantity) || quantity <= 0 ? 1 : quantity,
            price,
          }
        }
        return parseSingleTextItem(String(item))
      })
      .filter((i): i is ParsedOrderItem => Boolean(i && i.name && i.name !== 'Item'))
  }

  let raw = String(rawInput || '').trim()
  if (!raw) return []

  // Case 2: Double-encoded or quote-wrapped string
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    try {
      const unwrapped = JSON.parse(raw)
      if (typeof unwrapped === 'string') raw = unwrapped.trim()
    } catch {}
  }

  // Case 3: JSON array or object
  if (
    (raw.startsWith('[') && raw.endsWith(']')) ||
    (raw.startsWith('{') && raw.endsWith('}'))
  ) {
    try {
      const parsed = JSON.parse(raw)
      return parseOrderItems(parsed)
    } catch {
      // If single quotes were used e.g. python dict string
      try {
        const fixed = raw.replace(/'/g, '"')
        const parsed = JSON.parse(fixed)
        return parseOrderItems(parsed)
      } catch {}
    }
  }

  // Case 4: Raw string containing JSON patterns e.g. {"name": ...}
  if (raw.includes('"name":') || raw.includes("'name':") || raw.includes('"price":')) {
    const items: ParsedOrderItem[] = []
    const objRegex = /\{[^{}]*\}/g
    let match: RegExpExecArray | null
    while ((match = objRegex.exec(raw)) !== null) {
      const chunk = match[0]
      const nameMatch = chunk.match(
        /["'](?:name|product_name|dish_name|title)["']\s*:\s*["']([^"']+)["']/
      )
      const qtyMatch = chunk.match(/["'](?:quantity|qty|count)["']\s*:\s*(\d+)/)
      const priceMatch = chunk.match(/["']price["']\s*:\s*(\d+(?:\.\d+)?)/)
      if (nameMatch) {
        items.push({
          name: nameMatch[1].trim(),
          quantity: qtyMatch ? parseInt(qtyMatch[1], 10) : 1,
          price: priceMatch ? Number(priceMatch[1]) : undefined,
        })
      }
    }
    if (items.length > 0) return items
  }

  // Case 5: Comma or newline separated text string
  const segments = raw
    .split(/,\s*|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)

  return segments
    .map((seg) => parseSingleTextItem(seg))
    .filter((i): i is ParsedOrderItem => Boolean(i && i.name))
}

/**
 * Returns formatted human-readable text for order card (e.g. "2x Chicken Biryani, 1x Coke")
 */
export function formatOrderItemsDisplay(rawInput: any): string {
  const items = parseOrderItems(rawInput)
  if (!items.length) {
    const raw = String(rawInput || '').trim()
    return raw || '—'
  }
  return items.map((i) => `${i.quantity}x ${i.name}`).join(', ')
}

export function upiAmount(am: number): number {
  const n = Number(am)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}

export function buildShopUpiUri(pa: string, pn: string): string {
  const params = new URLSearchParams()
  params.set('pa', pa)
  params.set('pn', pn)
  params.set('cu', 'INR')
  params.set('mode', '04')
  return `upi://pay?${params.toString()}`
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const buffer = new ArrayBuffer(rawData.length)
  const outputArray = new Uint8Array(buffer)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

export function pushKeyToBase64(key: ArrayBuffer | null): string {
  if (!key) return ''
  const bytes = new Uint8Array(key)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function istTime(createdAt?: string): { h: number; m: number } | null {
  const raw = String(createdAt || '').trim()
  if (!raw) return null
  let iso = raw
  if (!/T/.test(raw) && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(raw)) {
    iso = raw.replace(' ', 'T') + '+05:30'
  }
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(d)
  const h = Number(parts.find((p) => p.type === 'hour')?.value)
  const m = Number(parts.find((p) => p.type === 'minute')?.value)
  if (isNaN(h) || isNaN(m)) return null
  return { h, m }
}

export function slotBucket(createdAt?: string): string {
  const t = istTime(createdAt)
  if (!t) return 'All'
  const mins = t.h * 60 + t.m
  if (mins < 12 * 60 + 30) return 'before-1230'
  if (mins < 18 * 60) return 'before-1830'
  return 'All'
}

/**
 * Builds aggregated kitchen summary for cooking/prep across live orders.
 */
export function buildItemSummary(orders: Order[]): { name: string; qty: number }[] {
  const totals: Record<string, number> = {}

  for (const o of orders) {
    const items = parseOrderItems(o.items)
    for (const item of items) {
      if (!item.name) continue
      totals[item.name] = (totals[item.name] || 0) + item.quantity
    }
  }

  return Object.entries(totals)
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty)
}

export function istDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}
