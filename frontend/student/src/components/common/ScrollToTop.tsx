import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * ScrollToTop ensures every route transition immediately resets scroll to (0, 0),
 * so new pages always load from the very start (top) of the page instead of retaining
 * the previous scroll/cursor position.
 *
 * This prevents:
 * 1. New pages loading halfway down or at the bottom where the cursor clicked.
 * 2. Unwanted network requests from lazy-loaded components, infinite-scroll sentinels,
 *    and off-screen images that are falsely detected as visible when starting scrolled down.
 */
export function ScrollToTop() {
  const { pathname, search, hash } = useLocation()

  useEffect(() => {
    // If there is an anchor hash (e.g. #section), scroll to that element
    if (hash) {
      const target = document.getElementById(hash.slice(1))
      if (target) {
        target.scrollIntoView({ behavior: 'smooth' })
        return
      }
    }

    // Disable browser automatic history scroll restoration
    if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) {
      try {
        window.history.scrollRestoration = 'manual'
      } catch {
        /* ignore */
      }
    }

    // Immediate scroll to top
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })
    if (document.documentElement) {
      document.documentElement.scrollTop = 0
    }
    if (document.body) {
      document.body.scrollTop = 0
    }

    // Re-assert on next animation frame in case new route DOM takes a tick to layout
    const rafId = requestAnimationFrame(() => {
      window.scrollTo(0, 0)
      if (document.documentElement) document.documentElement.scrollTop = 0
      if (document.body) document.body.scrollTop = 0
    })

    return () => cancelAnimationFrame(rafId)
  }, [pathname, search, hash])

  return null
}
