import React from 'react'

type Props = {
  /** The subtree to protect. */
  children?: React.ReactNode
  /** Shown in the heading, e.g. "Student Portal". */
  app?: string
  /** Tailwind classes for the panel so each portal keeps its own dark/light look. */
  shell?: string
  card?: string
  title?: string
  accent?: string
  muted?: string
  pre?: string
}

type State = { error: Error | null }

/**
 * The last line of defence against a **blank white screen**.
 *
 * Without this, any render-time throw (a corrupt `localStorage` value, a
 * missing field on a response, a bad date) unmounts the whole React tree and
 * the student is left staring at an empty page with no way forward except a
 * manual refresh. Catching it here turns "white screen, nothing works" into a
 * readable message with two recovery buttons.
 *
 * "Try again" resets the boundary *without* reloading, which is enough for a
 * transient failure (a bad cached value that has since been refreshed). "Reload"
 * is the nuclear option for a stale chunk after a deploy.
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Keep the real cause in the console so a bug report can be traced.
    console.error('[portal] render error:', error, info.componentStack)
  }

  private reset = () => this.setState({ error: null })
  private reload = () => window.location.reload()

  render() {
    const { error } = this.state
    if (!error) return this.props.children as React.ReactElement

    const {
      app = 'DETOMSITE',
      shell = 'min-h-screen flex items-center justify-center bg-gray-50 p-6',
      card = 'rounded-btn bg-white p-8 text-center border shadow-sm max-w-md',
      title = 'text-2xl font-bold text-primary-dark',
      accent = 'bg-primary',
      muted = 'text-sm text-gray-500',
      pre = 'mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-btn bg-gray-50 p-3 text-[11px] text-gray-600',
    } = this.props

    return (
      <div className={shell}>
        <div className={card}>
          <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-pill bg-red-50 text-2xl">⚠️</span>
          <h1 className={title}>Something went wrong</h1>
          <p className={`mt-2 ${muted}`}>
            {app} hit an unexpected error on this page. Nothing is lost — your cart and
            orders are safe. Try again, and if it keeps happening reload the page.
          </p>
          <details className="mt-4 text-left text-xs text-gray-400">
            <summary className="cursor-pointer font-semibold text-gray-500">Technical details</summary>
            <pre className={pre}>
              {String((error && error.message) || error)}
            </pre>
          </details>
          <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
            <button
              onClick={this.reset}
              className={`rounded-btn px-5 py-2.5 text-sm font-bold text-white ${accent} hover:opacity-90`}
            >
              Try again
            </button>
            <button
              onClick={this.reload}
              className="rounded-btn border border-gray-200 bg-white px-5 py-2.5 text-sm font-bold text-gray-600 hover:bg-gray-50"
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    )
  }
}
