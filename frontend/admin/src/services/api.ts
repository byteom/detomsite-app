import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api/v1',
  headers: { 'Content-Type': 'application/json' },
  // A request that never answers used to hang its page forever — the admin saw a
  // permanent spinner with no way out. Every call now gives up after 20 s so the
  // UI can show a real "could not reach the server" message.
  timeout: 20000,
})

/* In-flight GET de-duplication.
 *
 * The admin portal polls from several places at once (the nav bell, the orders
 * page, the WhatsApp centre, the payments monitor) and every page mount refires
 * its own load. Without de-dup one screen could put 4-6 identical requests on
 * the wire every few seconds — that is what makes the portal feel like it keeps
 * "reloading". One shared promise per (url, params) collapses them into a
 * single network call. Writes are never shared: two clicks on Confirm must be
 * two requests, not one silently de-duplicated call. */
const inflight = new Map<string, Promise<unknown>>()

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('admin_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

/* Cold-start retry.
 *
 * The API is serverless, so the first request after a quiet period pays the
 * instance boot cost (measured up to ~14 s in production). One unlucky request
 * would time out and leave the admin on a dead screen with no way back. An
 * idempotent GET that fails on timeout / network error / 5xx is therefore
 * retried with a short backoff — by the second attempt the instance is warm and
 * the answer is ~0.4 s. Writes are NEVER retried: two Confirm taps must stay two
 * real requests, not one silently repeated. */
const RETRYABLE = (status?: number) =>
  status === undefined || status === 408 || status === 429 || status >= 500

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
    if (err.response?.status === 401) {
      /* Don't redirect on failed login attempts — the login form needs to show the
         error message to the user. Only redirect on 401s from authenticated requests
         (i.e. when we already have a token that turned out to be invalid). */
      const isLoginRequest = err.config?.url?.includes('/admin/login')
      const hasToken = !!localStorage.getItem('admin_token')
      if (!isLoginRequest && hasToken) {
        localStorage.removeItem('admin_token')
        localStorage.removeItem('admin_user')
        window.location.href = '/login'
      }
    }
    // A network failure / timeout has NO response. Treating it as a rejected
    // session would sign the admin out every time a cold start or a spotty
    // connection blipped, so only a real 401 ever logs anyone out.
    if (!err.response) {
      /* PENTEST/UX FIX. A timeout and a dead connection are BOTH `!response`,
         but they mean different things. Telling the admin their internet is
         broken when the server is merely slow (measured: ~3.5 s to answer a login
         on a cold instance) sends them debugging the wrong layer. Name the real
         cause so the right fix is obvious. */
      const timedOut = err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT'
        || /timeout/i.test(String(err.message || ''))
      err.userMessage = timedOut
        ? 'The server is taking too long to respond. Please try again in a moment.'
        : 'Could not reach the server — please try again in a moment.'
    } else if (err.response.status === 429) {
      err.userMessage = 'Too many attempts. Please wait a moment and try again.'
    } else if (err.response.status === 503) {
      err.userMessage = 'The service is restarting — please try again in a few seconds.'
    } else if (err.response.status >= 500) {
      err.userMessage = 'The server had a problem. Please try again in a moment.'
    }
    return Promise.reject(err)
  }
)

/** GET that shares one in-flight request per (url, params). */
export async function dedupeGet<T>(url: string, params?: Record<string, unknown>): Promise<any> {
  const key = `get ${url} ${JSON.stringify(params || {})}`
  const existing = inflight.get(key)
  if (existing) return existing
  const p = api.get<T>(url, { params }).finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}
export default api
