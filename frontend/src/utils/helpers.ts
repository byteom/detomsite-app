/* Shared API error handling — every form/surface reports failures the same way.
   Thin wrapper over axios' own narrowing so no call site needs `any`. */
import axios from 'axios'

export function getErrorMessage(err: unknown, fallback = 'Request failed'): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { detail?: unknown; message?: unknown } | undefined
    const detail = data?.detail ?? data?.message
    if (typeof detail === 'string' && detail.trim()) return detail
    if (err.message && !err.response) return 'Cannot reach the server — check your connection and try again.'
    if (err.message) return err.message
  }
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string' && err.trim()) return err
  return fallback
}

/* NOTE: formatCurrency/formatDate/formatTime are intentionally NOT here —
   every surface formats money/dates inline (₹{v}, toLocaleDateString) so one
   shared formatter cannot drift from what checkout actually charges. Do not
   re-add generic formatters without migrating all call sites. */
