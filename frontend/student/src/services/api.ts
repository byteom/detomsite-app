import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api/v1',
  headers: { 'Content-Type': 'application/json' },
  // A request that never answers used to hang its page forever — the student
  // saw a permanent spinner and had no way out. Every call now gives up after
  // 20 s so the UI can show a real "could not reach the server" message.
  timeout: 20000,
})

/* In-flight GET de-duplication.
 *
 * The portals fire the same read from several places at once (the layout polls
 * notifications while a page loads shops and orders), and each page also
 * re-renders its own polling. Without de-dup, one screen could put 4-5
 * identical requests on the wire every few seconds — that is what makes a
 * refresh feel slow on a weak campus connection. One shared promise per
 * (method, url, params) collapses them into a single network call. */
const inflight = new Map<string, Promise<unknown>>()

/* Cold-start retry.
 *
 * The API runs on a serverless platform, so the FIRST request after a quiet
 * period pays the instance's boot cost (measured at up to ~14 s in production).
 * One unlucky request would time out and leave a phone on a blank screen with no
 * way back — which is exactly the "nothing loads on my phone" report.
 *
 * So an idempotent GET that fails on a timeout / network error / 5xx is retried
 * with a short backoff. By the second attempt the instance is warm and the
 * response is ~0.4 s, so the page recovers transparently instead of failing.
 * Writes are NEVER retried: re-sending "Place Order" would create two orders. */
const RETRYABLE = (status?: number) =>
  status === undefined || status === 408 || status === 429 || status >= 500

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const config = err.config as (typeof err.config & { _retries?: number }) | undefined
    const method = (config?.method || 'get').toLowerCase()
    const attempts = config?._retries ?? 0
    // Only safe reads, and never more than two extra tries.
    if (config && method === 'get' && attempts < 2 && RETRYABLE(err.response?.status)) {
      config._retries = attempts + 1
      const wait = 1500 * attempts
      await new Promise((r) => setTimeout(r, wait))
      return api.request(config)
    }
    return Promise.reject(err)
  },
)

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    /* Only force a redirect when the server actually REJECTED an existing
     * session. A failed login (401 on /login, /register, /auth/*) must show
     * its message on the form, and — just as importantly — a network failure
     * (no response at all: spotty Wi-Fi, a sleeping server) must NOT be
     * mistaken for a rejected session. Doing so logged students out every
     * time the connection blipped, which is most of the "it kicks me back to
     * login" complaints. */
    const status = err?.response?.status
    const isNetwork = !err?.response
    const url = err.config?.url || ''
    const isAuthCall = /login|register|auth|forgot/i.test(url)
    const hadToken = !!localStorage.getItem('access_token')
    if (status === 401 && !isAuthCall && hadToken) {
      localStorage.removeItem('access_token')
      localStorage.removeItem('user_data')
      localStorage.removeItem('detomsite-auth-check')
      // A soft navigation is not possible from the interceptor (it has no
      // router handle), so fall back to a reload — but only for a real 401.
      if (!window.location.pathname.endsWith('/login')) window.location.href = '/login'
    }
    if (isNetwork) {
      /* PENTEST/UX FIX. A timeout and a dead connection are BOTH `!response`,
         but they mean completely different things, and telling a student on
         working mobile data to "check your internet connection" sends them
         pointlessly debugging a network that is fine. Measured in production,
         a cold instance answers a login in ~3.5 s and a register in ~4.9 s, so a
         20 s timeout with no response is overwhelmingly a SLOW SERVER, not an
         offline device. Say what actually happened so the user retries instead
         of toggling airplane mode. */
      const timedOut = err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT'
        || /timeout/i.test(String(err.message || ''))
      err.userMessage = timedOut
        ? 'The server is taking too long to respond. Please try again in a moment.'
        : 'Could not reach the server — please try again in a moment.'
    } else if (status === 429) {
      err.userMessage = 'Too many attempts. Please wait a moment and try again.'
    } else if (status === 503) {
      err.userMessage = 'The service is restarting — please try again in a few seconds.'
    } else if (status && status >= 500) {
      err.userMessage = 'The server had a problem. Please try again in a moment.'
    }
    return Promise.reject(err)
  }
)

/* Wrap axios with in-flight de-duplication for safe (read) requests. Writes
 * are never shared — two clicks on "Place Order" must be two orders, not one
 * silently de-duplicated call. */
export async function dedupeGet<T>(url: string, params?: Record<string, unknown>): Promise<any> {
  const key = `get ${url} ${JSON.stringify(params || {})}`
  const existing = inflight.get(key)
  if (existing) return existing
  const p = api.get<T>(url, { params }).finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

export default api
