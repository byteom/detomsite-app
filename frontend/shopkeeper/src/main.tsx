import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import { ThemeProvider } from './context/ThemeContext'
import './index.css'

/* A deploy replaces the hashed JS chunk names, so a tab that was open across a
 * release can ask for a chunk that no longer exists. That surfaces as a
 * rejected dynamic import, React unmounts, and the shopkeeper is left with a
 * blank page that only a manual refresh fixes. Detect it once and reload. */
let reloadedForStaleChunk = false
function recoverFromStaleChunk(err: unknown) {
  const message = String((err as any)?.message || err || '')
  if (!/Loading chunk|dynamically imported module|Importing a module script failed|Failed to fetch dynamically/i.test(message)) return
  if (reloadedForStaleChunk) return   // only ever once, never a reload loop
  reloadedForStaleChunk = true
  window.location.reload()
}
window.addEventListener('error', e => recoverFromStaleChunk(e))
window.addEventListener('unhandledrejection', e => recoverFromStaleChunk((e as PromiseRejectionEvent)?.reason))

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // updateViaCache: 'none' — always re-check the SW file so a stale cached
    // worker can never linger and block the newest one.
    navigator.serviceWorker.register('/mobile/sw.js', { updateViaCache: 'none' }).catch((err) => {
      // Visible in the browser console (F12) — helps diagnose why push is off.
      console.warn('Vendor app service worker registration failed:', err)
    })
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* Nothing rendered above this can blank the page: any render throw lands on
        a readable recovery screen with Try again / Reload instead. */}
    <ErrorBoundary app="Shopkeeper Portal">
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
