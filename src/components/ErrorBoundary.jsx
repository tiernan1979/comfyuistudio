import { Component } from 'react'
import { AlertTriangle, RotateCcw, RefreshCw } from 'lucide-react'

// Catches render errors so one broken panel can't blank the whole studio.
// Used at the app root and around the main workspace; the fallback offers a
// retry (re-mounts the subtree) and a full reload (drops bad in-memory state).
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[studio] render error', error, info)
  }

  reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex h-full min-h-[240px] w-full items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-border bg-bg-card p-6 shadow-2xl">
          <div className="mb-4 flex items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-danger/15">
              <AlertTriangle size={18} className="text-danger" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-text-primary">
                {this.props.label || 'Something went wrong'}
              </h2>
              <p className="text-xs text-text-muted">
                This panel hit an unexpected error — the rest of the studio is still usable.
              </p>
            </div>
          </div>
          <pre className="mb-4 max-h-32 overflow-auto rounded-lg border border-border bg-bg-primary p-3 font-mono text-[11px] leading-relaxed text-text-secondary">
            {String(error?.message || error)}
          </pre>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={this.reset}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-bg-hover px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
            >
              <RotateCcw size={13} />
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
            >
              <RefreshCw size={13} />
              Reload studio
            </button>
          </div>
        </div>
      </div>
    )
  }
}
