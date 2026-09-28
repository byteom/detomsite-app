/**
 * Mount entry for the smoke test. Vite bundles this to `.smoke/mount.mjs`, so
 * the test drives the REAL `<App />` — the same module the portal ships.
 *
 * React needs the browser globals, so everything the app touches at import or
 * render time is copied onto the jsdom window BEFORE the app module loads.
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from '../src/App'

export function mount(window) {
  const g = globalThis
  const keys = ['window', 'document', 'navigator', 'location', 'history',
                'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent',
                'localStorage', 'XMLHttpRequest', 'matchMedia', 'getComputedStyle',
                'requestAnimationFrame', 'cancelAnimationFrame']
  for (const key of keys) {
    if (window[key] === undefined) continue
    // FORCE the assignment: each boot gets its own module instance, so the
    // globals must point at THIS window. Setting them only-if-undefined left
    // every later boot reading the FIRST window's `location`, so every route
    // rendered the first route and the test silently measured nothing.
    try {
      Object.defineProperty(g, key, { configurable: true, writable: true, value: window[key] })
    } catch {
      try { g[key] = window[key] } catch { /* read-only global */ }
    }
  }
  g.IS_REACT_ACT_ENVIRONMENT = false
  const root = window.document.getElementById('root')
  createRoot(root).render(React.createElement(App))
  return root
}
