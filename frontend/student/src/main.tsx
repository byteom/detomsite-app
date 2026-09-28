import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import './index.css'

/* A deploy replaces the hashed JS chunk names, so a tab that was open across
 * a release can ask for a chunk that no longer exists. Vite surfaces that as a
 * rejected dynamic import, React unmounts, and the student gets a blank page
 * that only a manual refresh fixes. Detect it once and reload automatically. */
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* Nothing rendered above this can blank the page: any render throw lands
        on a readable recovery screen with Try again / Reload instead. */}
    <ErrorBoundary app="Student Portal" accent="bg-primary">
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
