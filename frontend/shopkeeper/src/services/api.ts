import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api/v1',
  headers: { 'Content-Type': 'application/json' },
  // A request that never answers used to hang the vendor's phone forever. Every
  // call now gives up after 20 s so the UI can show a real message.
  timeout: 20000,
})

/* In-flight GET de-duplication: several screens pull the same endpoint at once
 * (dashboard poll + boot retry + focus refresh), and each identical request on a
 * shop's weak connection makes the app feel slower. One shared promise per
 * (url, params) collapses them into a single network call. Writes are never
 * shared — two taps on "Accept" must be two requests. */
const inflight = new Map<string, Promise<unknown>>()

/* Cold-start retry.
 *
 * The API is serverless, so the first request after a quiet period pays the
 * instance boot cost (measured up to ~14 s in production). A shopkeeper on a
 * weak connection would see the screen simply never populate. An idempotent GET
 * that fails on timeout / network error / 5xx is retried with a short backoff.
 * Writes are NEVER retried — "Accept order" must not fire twice. */
const RETRYABLE = (status?: number) =>
  status === undefined || status === 408 || status === 429 || status >= 500

export async function dedupeGet<T>(url: string, params?: Record<string, unknown>): Promise<any> {
  const key = `get ${url} ${JSON.stringify(params || {})}`
  const existing = inflight.get(key)
  if (existing) return existing
  const p = api.get<T>(url, { params }).finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('vendor_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const config = err.config as (typeof err.config & { _retries?: number }) | undefined
    const method = (config?.method || 'get').toLowerCase()
    const attempts = config?._retries ?? 0
    if (config && method === 'get' && attempts < 2 && RETRYABLE(err.response?.status)) {
      config._retries = attempts + 1
      await new Promise((r) => setTimeout(r, 1500 * attempts))
      return api.request(config)
    }
    // Only force a redirect when an existing session was rejected — a failed
    // login (401 on /login, /register, /auth/*) must show its error message
    // on the form instead of silently redirecting.
    const url = err.config?.url || ''
    const isAuthCall = /login|register|auth/i.test(url)
    const hadToken = !!localStorage.getItem('vendor_token')
    if (err.response?.status === 401 && !isAuthCall && hadToken) {
      localStorage.removeItem('vendor_token')
      localStorage.removeItem('vendor_user')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default api
