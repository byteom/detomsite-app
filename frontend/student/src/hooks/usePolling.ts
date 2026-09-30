import { useCallback, useEffect, useRef } from 'react'

/**
 * Visibility-aware polling hook.
 *
 * The student app polls order status every few seconds on the payment screen and
 * refreshes lists on the orders screen, and each of those used to run a raw
 * `setInterval` that:
 *   - kept firing while the phone screen was off (draining battery and the
 *     backend on a student's flaky campus Wi-Fi), and
 *   - could stack overlapping requests whenever one response was slower than the
 *     interval, until the app stopped responding.
 *
 * This hook fetches on mount, polls only while the document is visible, pauses
 * the timer the instant the app is backgrounded, re-fetches (debounced) on
 * focus, and never starts a tick while one is still running.
 *
 * `intervalMs` may be a function of the latest state, so an adaptive cadence
 * ("fast while there are pending orders, slow when idle") re-times the timer
 * WITHOUT re-running the effect or firing an extra request.
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
    timerRef.current = window.setInterval(() => {
      if (document.hidden) return
      void run()
    }, Math.max(2000, resolveInterval()))
  }, [resolveInterval, run])

  const onVisible = useCallback(() => {
    clearTimer()
    clearFocusTimer()
    focusTimerRef.current = window.setTimeout(() => {
      focusTimerRef.current = null
      void run()
      start()
    }, 300)
  }, [clearTimer, clearFocusTimer, run, start])

  useEffect(() => {
    clearTimer()
    clearFocusTimer()
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
      clearTimer()
      clearFocusTimer()
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onVis)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, start, clearTimer, clearFocusTimer, onVisible, ...deps])

  // Re-time the interval when the CADENCE changes (not the data).
  useEffect(() => {
    if (document.hidden || timerRef.current === null) return
    clearTimer()
    start()
  }, [resolveInterval, clearTimer, start])

  return { pollNow }
}
