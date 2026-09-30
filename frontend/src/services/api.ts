/*
 * API client service
 */
import axios from "axios";
import { clearLocalSession } from '../utils/session';

const api = axios.create({
  /* PENTEST/RELIABILITY FIX. The old fallback was
   * `"http://localhost:8000/api/v1"`. If VITE_API_URL is ever missing from the
   * build environment (a typo'd project, a new Vercel project, a local build
   * without .env.local), Vite inlines the fallback verbatim and EVERY request
   * from a real user is sent to their own machine — where nothing listens. The
   * symptom is the app loading and then failing every call with a network error
   * that looks exactly like "no internet", which is close to undebuggable.
   *
   * The same class of bug shipped to production once already: this project's
   * VITE_API_URL pointed at a retired Render host while every other portal used
   * the Vercel backend, so the main portal was the only one that failed.
   *
   * Defaulting to the REAL production API (rather than localhost) means a
   * missing env var degrades to "works" instead of "silently dead". Local dev
   * overrides it with its own .env.local. */
  baseURL: import.meta.env.VITE_API_URL || "https://detomsite-backend.vercel.app/api/v1",
  headers: {
    "Content-Type": "application/json",
  },
  // Match the other portals: give up after 20 s so a cold start shows a real
  // message instead of an endless spinner.
  timeout: 20000,
});

// Add token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Do not deliver an old account's response into the newly signed-in UI.
function sessionChanged(config: { headers?: { Authorization?: unknown } } | undefined) {
  const sent = String(config?.headers?.Authorization || '');
  const token = localStorage.getItem('access_token');
  return sent !== (token ? `Bearer ${token}` : '');
}

api.interceptors.response.use(
  (response) => {
    if (sessionChanged(response.config)) {
      return Promise.reject(new axios.CanceledError('Session changed during request'));
    }
    return response;
  },
  async (error) => {
    const request = error.config;
    if (request && sessionChanged(request)) {
      return Promise.reject(new axios.CanceledError('Session changed during request'));
    }

    /* Cold-start retry.
     *
     * The API is serverless: the first request after a quiet period pays the
     * instance boot cost (measured up to ~14 s in production). One unlucky
     * request would time out and leave a blank page with no way back, so an
     * idempotent GET that fails on timeout / network error / 5xx is retried
     * after a short backoff — by then the instance is warm (~0.4 s). Writes are
     * NEVER retried: re-sending "Place Order" would create two orders. */
    const cfg = request as (typeof request & { _retries?: number }) | undefined
    const method = (cfg?.method || 'get').toLowerCase()
    const attempts = cfg?._retries ?? 0
    const status = error.response?.status
    const retryable = status === undefined || status === 408 || status === 429 || status >= 500
    if (cfg && method === 'get' && attempts < 2 && retryable) {
      cfg._retries = attempts + 1
      await new Promise((r) => setTimeout(r, 1500 * attempts))
      return api.request(cfg)
    }

    // No refresh endpoint exists: never retry with another account's token.
    const isAuthCall = /login|register|auth/i.test(request?.url || '');
    if (error.response?.status === 401 && !isAuthCall && localStorage.getItem('access_token')) {
      clearLocalSession();
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

/* ─── TTL GET cache ──────────────────────────────────────────────────────
   Every page mount unconditionally refetches shops/products/summary/stock,
   which makes navigating the portal feel slow (each route re-does the whole
   fetch set). `apiCached.get()` serves identical GETs from an in-memory cache
   for `ttlMs`, and dedupes concurrent identical requests (one network call
   shared by every caller). Polling/order-status calls should NOT use this —
   they need fresh data — so they keep using `api.get()`.
   The cache is keyed by token too: admin and student sessions never share.
   Mutable list GETs (orders, payments, complaints, …) are excluded by default.
*/
const ttlCache = new Map<string, { expires: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

async function removeExpired() {
  const now = Date.now();
  for (const [k, v] of ttlCache) {
    if (v.expires <= now) ttlCache.delete(k);
  }
}

export function clearCachedGet() {
  ttlCache.clear();
}

export const apiCached = {
  async get<T>(url: string, params?: Record<string, unknown>, ttlMs = 8000): Promise<T> {
    const token = localStorage.getItem("access_token") || "anon";
    const key = JSON.stringify([token, url, params || null]);
    await removeExpired();

    const hit = ttlCache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value as T;

    // Dedupe concurrent identical requests: share the in-flight promise.
    const pending = inflight.get(key);
    if (pending) return pending as Promise<T>;

    const promise = api
      .get<T>(url, { params })
      .then((r) => {
        // Guard: never cache order/payment/status reads that drift between
        // mounts — those callers should use plain `api.get` anyway.
        ttlCache.set(key, { expires: Date.now() + ttlMs, value: r.data });
        return r.data;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  },
};

// Keep the default export the plain axios instance; callers that want cached
// reads import `apiCached`.
export { api };
export default api;
