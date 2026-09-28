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
      err.userMessage = 'Could not reach the server — check your internet connection and try again.'
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
