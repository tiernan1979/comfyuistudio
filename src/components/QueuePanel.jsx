import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ListOrdered, Loader2, RefreshCw, Square, Trash2, X } from 'lucide-react'
import clsx from 'clsx'
import useStore from '../store/useStore'
import { deleteQueuedPrompts, getQueue, resolveApiBase, stopGeneration } from '../lib/comfyui'

// Live ComfyUI queue: shows the running job + everything pending, lets you
// drop individual pending jobs or clear them all, and stops the running one.
// Jobs can also arrive from the REST API or another browser, so the panel
// polls while open (the closed badge is refreshed by useAppConnection).
export default function QueuePanel() {
  const serverUrl = useStore((s) => s.serverUrl)
  const useProxy = useStore((s) => s.useProxy)
  const connected = useStore((s) => s.connected)
  const queueRemaining = useStore((s) => s.queueRemaining)
  const setQueueRemaining = useStore((s) => s.setQueueRemaining)
  const setError = useStore((s) => s.setError)

  const [open, setOpen] = useState(false)
  const [queue, setQueue] = useState({ running: [], pending: [], total: 0 })
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [panelError, setPanelError] = useState(null)
  const aliveRef = useRef(true)
  const base = resolveApiBase(serverUrl, useProxy)

  const refresh = useCallback(async () => {
    if (!connected) return
    setLoading(true)
    try {
      const next = await getQueue(base)
      if (!aliveRef.current) return
      setQueue(next)
      setQueueRemaining(next.total)
      setPanelError(null)
    } catch (err) {
      if (!aliveRef.current) return
      setPanelError(err.message)
    } finally {
      if (aliveRef.current) setLoading(false)
    }
  }, [base, connected, setQueueRemaining])

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  // Poll only while the popover is open; 2s matches the generation progress
  // cadence without hammering the server.
  useEffect(() => {
    if (!open) return
    refresh()
    const id = setInterval(refresh, 2000)
    return () => clearInterval(id)
  }, [open, refresh])

  // Escape closes the popover but leaves the queue alone.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const remove = async (promptId) => {
    setBusyId(promptId)
    try {
      await deleteQueuedPrompts(base, [promptId])
      await refresh()
    } catch (err) {
      setPanelError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  const clearPending = async () => {
    if (!queue.pending.length) return
    setBusyId('all')
    try {
      await deleteQueuedPrompts(
        base,
        queue.pending.map((j) => j.promptId)
      )
      await refresh()
    } catch (err) {
      setPanelError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  const stopRunning = async () => {
    setBusyId('running')
    try {
      await stopGeneration(base)
      await refresh()
    } catch (err) {
      setPanelError(err.message)
      setError(`Could not stop the running job: ${err.message}`)
    } finally {
      setBusyId(null)
    }
  }

  const count = Math.max(queueRemaining || 0, queue.total || 0)

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Queue (${count} job${count === 1 ? '' : 's'})`}
        title="Queue"
        className={clsx(
          'relative flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70',
          open
            ? 'bg-bg-hover text-text-primary'
            : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
        )}
      >
        <ListOrdered size={16} />
        <span className="hidden lg:inline">Queue</span>
        {count > 0 && (
          <span className="min-w-[18px] rounded-full bg-accent px-1 text-[10px] font-semibold leading-[18px] text-white">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[90]" onClick={() => setOpen(false)} />
            <div
              role="dialog"
              aria-label="ComfyUI queue"
              className="fixed right-2 top-16 z-[100] w-[min(92vw,22rem)] overflow-hidden rounded-xl border border-border bg-bg-secondary shadow-2xl sm:right-4"
            >
            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
              <div>
                <p className="text-xs font-semibold text-text-primary">Render queue</p>
                <p className="text-[10px] text-text-muted">
                  {queue.running.length} running · {queue.pending.length} pending
                </p>
              </div>
              <button
                type="button"
                onClick={refresh}
                disabled={loading || !connected}
                className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                aria-label="Refresh queue"
                title="Refresh"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto px-2 py-2">
              {!connected ? (
                <p className="px-2 py-6 text-center text-[11px] text-text-muted">
                  Not connected to ComfyUI.
                </p>
              ) : queue.total === 0 ? (
                <p className="px-2 py-6 text-center text-[11px] text-text-muted">
                  Queue is empty.
                </p>
              ) : (
                <div className="space-y-1">
                  {queue.running.map((job) => (
                    <QueueRow
                      key={job.promptId}
                      job={job}
                      running
                      busy={busyId === 'running'}
                      onStop={stopRunning}
                    />
                  ))}
                  {queue.pending.map((job, i) => (
                    <QueueRow
                      key={job.promptId}
                      job={job}
                      position={i + 1}
                      busy={busyId === job.promptId || busyId === 'all'}
                      onRemove={() => remove(job.promptId)}
                    />
                  ))}
                </div>
              )}
            </div>

            {panelError && (
              <p className="border-t border-danger/30 bg-danger/10 px-3 py-2 text-[10px] text-danger">
                {panelError}
              </p>
            )}

            {queue.pending.length > 0 && (
              <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
                <span className="text-[10px] text-text-muted">
                  Stopping the running job does not start the next one automatically.
                </span>
                <button
                  type="button"
                  onClick={clearPending}
                  disabled={busyId === 'all'}
                  className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/60"
                >
                  <Trash2 size={11} /> Clear
                </button>
              </div>
            )}
            </div>
          </>,
          document.body,
        )}
    </div>
  )
}

function QueueRow({ job, running = false, position, busy, onStop, onRemove }) {
  return (
    <div className="flex items-start gap-2 rounded-lg px-2 py-2 hover:bg-bg-card/70">
      <span
        className={clsx(
          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
          running ? 'bg-accent/20 text-accent' : 'bg-bg-hover text-text-muted'
        )}
      >
        {running ? <Loader2 size={11} className="animate-spin" /> : position}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-medium text-text-primary">
          {job.prompt || 'Untitled job'}
        </p>
        <p className="truncate font-mono text-[9px] text-text-muted">{job.promptId}</p>
      </div>
      {running ? (
        <button
          type="button"
          onClick={onStop}
          disabled={busy}
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-text-secondary transition-colors hover:bg-danger/15 hover:text-danger disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/60"
          title="Interrupt the running job"
        >
          <Square size={10} /> Stop
        </button>
      ) : (
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          className="rounded-md p-1 text-text-muted transition-colors hover:bg-danger/15 hover:text-danger disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/60"
          aria-label={`Remove queued job ${position}`}
          title="Remove from queue"
        >
          <X size={12} />
        </button>
      )}
    </div>
  )
}
