export function apiError(e: any, fb = 'Request failed'): string {
  const d = e?.response?.data?.detail
  if (typeof d === 'string' && d.trim()) return d
  if (Array.isArray(d)) {
    const msgs = d.map((x: any) => (x?.msg || x?.message)).filter(Boolean)
    if (msgs.length) return msgs.join(' - ')
  }
  const m = e?.response?.data?.message
  if (typeof m === 'string' && m.trim()) return m
  if (e?.userMessage) return e.userMessage as string
  return (e?.message as string) || fb
}

export function safeStorageJSON<T>(key: string, fallback: T): T {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(key)
  } catch {
    return fallback
  }
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw)
    return (parsed ?? fallback) as T
  } catch {
    try {
      localStorage.removeItem(key)
    } catch {
      /* private mode */
    }
    return fallback
  }
}

export function fmtTime(createdAt?: string): string {
  const raw = String(createdAt || '').trim()
  if (!raw) return '—'
  let iso = raw
  if (!/T/.test(raw) && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(raw)) {
    iso = raw.replace(' ', 'T') + '+05:30'
  }
  const d = new Date(iso)
  if (isNaN(d.getTime())) return raw.slice(0, 16)
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d)
}

export function fmtDateOnly(createdAt?: string): string {
  const raw = String(createdAt || '').trim()
  if (!raw) return '—'
  let iso = raw
  if (!/T/.test(raw) && /^\d{4}-\d{2}-\d{2}/.test(raw)) {
    iso = raw.slice(0, 10)
  }
  const d = new Date(iso)
  if (isNaN(d.getTime())) return raw.slice(0, 10)
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d)
}

export function fmtCurrency(amount: number | string | undefined | null): string {
  const num = Number(amount) || 0
  return `₹${num.toLocaleString('en-IN')}`
}
