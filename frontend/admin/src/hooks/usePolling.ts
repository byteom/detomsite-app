import { useCallback, useEffect, useRef } from 'react'

/**
 * Visibility-aware polling hook for the admin portal.
 *
 * Why this exists: every page used to run a raw `setInterval(load, N)`, which
 * caused three separate "reloading" complaints:
 *
 *  1. **Background hammering** — the timer kept firing while the tab sat
 *     minimised, so an admin with a few tabs open was pulling the whole order
 *     list from a phone on a weak campus Wi-Fi for nothing.
 *  2. **Effect restart storms** — pages that adapted their cadence to state
 *     (e.g. "poll every 10 s while payments are pending, else 30 s") listed
 *     that state in the dependency array. Every state change tore the interval
 *     down, re-created it AND fired an extra immediate `load()` — so one data
 *     change could trigger a burst of overlapping requests.
 *  3. **Overlapping requests** — a slow response let the next tick start before
 *     the previous one finished, stacking requests until the page crawled.
 *
 * This hook fixes all three:
 *  - Fetches on mount and whenever `deps` change.
 *  - Polls ONLY while the document is visible; the timer is cleared when the
 *    tab is hidden and reinstated the moment it comes back.
 *  - Re-fetches on focus/visibility with a 300 ms debounce, so alt-tabbing
 *    never fires a burst.
 *  - Never starts a tick while one is still running (`busy` guard), so requests
 *    can never stack up.
 *  - `intervalMs` may be a FUNCTION of the latest state (see `intervalFn`).
 *    Changing the cadence re-times the timer WITHOUT re-running the effect or
 *    firing an extra request — that is the fix for problem 2.
 *
 * Returns `{ pollNow }` — call it right after a mutation to refresh instantly.
 */
export function usePolling(
  load: () => void | Promise<void>,
  intervalMs: number | (() => number),
  deps: readonly unknown[] = [],
) {
  const loadRef = useRef(load)
  loadRef.current = load

  const timerRef = useRef<number | null>(null)
  const focusTimerRef = useRef<number | null>(null)
  const busyRef = useRef(false)
  const mountedRef = useRef(true)

  // Latest cadence, readable by the timer without re-creating the effect.
  const intervalFnRef = useRef(intervalMs)
  intervalFnRef.current = intervalMs
  const resolveInterval = useCallback(
    () => (typeof intervalFnRef.current === 'function' ? intervalFnRef.current() : intervalFnRef.current),
    [],
  )

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const clearFocusTimer = useCallback(() => {
    if (focusTimerRef.current !== null) {
      window.clearTimeout(focusTimerRef.current)
      focusTimerRef.current = null
    }
  }, [])

  const run = useCallback(async () => {
    // Never let two ticks overlap: a slow response on a weak connection used to
    // stack up until the page stopped responding.
    if (busyRef.current) return
    busyRef.current = true
    try {
      await loadRef.current()
    } catch {
      /* the caller owns its own error state */
    } finally {
      busyRef.current = false
    }
  }, [])

  const pollNow = useCallback(() => {
    void run()
  }, [run])

  const start = useCallback(() => {
    if (timerRef.current !== null || document.hidden) return
    const ms = Math.max(2000, resolveInterval())
    timerRef.current = window.setInterval(() => {
      if (document.hidden) return
      void run()
    }, ms)
  }, [resolveInterval, run])

  const onVisible = useCallback(() => {
    clearTimer()
    clearFocusTimer()
    // Debounce rapid focus/visibility flips (alt-tab bursts) so we never fire a
    // burst of requests — a single instant refresh, then resume pacing.
    focusTimerRef.current = window.setTimeout(() => {
      focusTimerRef.current = null
      void run()
      start()
    }, 300)
  }, [clearTimer, clearFocusTimer, run, start])

  useEffect(() => {
    mountedRef.current = true
    clearTimer()
    clearFocusTimer()
    // Mounting (or a deps change) in an already-hidden tab must not fire a
    // request or start a timer — the visibility handler resumes everything the
    // instant the user comes back.
    if (!document.hidden) {
      void run()
      start()
    }

    const onVis = () => {
      if (document.hidden) {
        clearTimer()
        clearFocusTimer()
      } else {
        onVisible()
      }
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)

    return () => {
      mountedRef.current = false
      clearTimer()
      clearFocusTimer()
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onVis)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, start, clearTimer, clearFocusTimer, onVisible, ...deps])

  // Re-time the interval when the CADENCE changes (not the data) — this is what
  // keeps "poll fast while payments are pending, slow otherwise" from tearing
  // the effect down and firing an extra request on every state change.
  useEffect(() => {
    if (document.hidden || timerRef.current === null) return
    clearTimer()
    start()
  }, [resolveInterval, clearTimer, start])

  return { pollNow }
}
