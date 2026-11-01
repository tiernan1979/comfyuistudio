import { useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Settings, Trash2, BookmarkPlus, Upload, Download, FileText, Search, RefreshCw, X, Sparkles } from 'lucide-react'
import useStore from '../store/useStore'
import clsx from 'clsx'
import Dropdown from './Dropdown'
import ConfirmDialog from './ui/ConfirmDialog'
import { syncServerHistory } from '../hooks/useComfyUI'
import ConnectionBadge from './ConnectionBadge'
import HistoryGrid from './HistoryGrid'

const SORTS = [
  ['newest', 'Newest'],
  ['oldest', 'Oldest'],
  ['az', 'A–Z'],
]

export default function Sidebar({ drawer = false }) {
  const setShowSettings = useStore((s) => s.setShowSettings)
  const setSidebarOpen = useStore((s) => s.setSidebarOpen)
  const history = useStore((s) => s.history)
  const clearHistory = useStore((s) => s.clearHistory)

  const savedPrompts = useStore((s) => s.savedPrompts)
  const addSavedPrompt = useStore((s) => s.addSavedPrompt)
  const removeSavedPrompt = useStore((s) => s.removeSavedPrompt)
  const renameSavedPrompt = useStore((s) => s.renameSavedPrompt)
  const importSavedPrompts = useStore((s) => s.importSavedPrompts)
  const prompt = useStore((s) => s.prompt)
  const setPrompt = useStore((s) => s.setPrompt)
  const setNegativePrompt = useStore((s) => s.setNegativePrompt)
  const setStyle = useStore((s) => s.setStyle)
  const sidebarWidth = useStore((s) => s.sidebarWidth)

  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('newest')
  const [syncing, setSyncing] = useState(false)
  const [syncNote, setSyncNote] = useState(null)
  const [notice, setNotice] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const cancelRenameRef = useRef(false)
  const importRef = useRef(null)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? savedPrompts.filter(
          (p) => p.title.toLowerCase().includes(q) || p.prompt.toLowerCase().includes(q)
        )
      : [...savedPrompts]
    if (sort === 'oldest') list.sort((a, b) => a.createdAt - b.createdAt)
    else if (sort === 'az') list.sort((a, b) => a.title.localeCompare(b.title))
    else list.sort((a, b) => b.createdAt - a.createdAt)
    return list
  }, [savedPrompts, query, sort])

  const flash = (msg) => {
    setNotice(msg)
    setTimeout(() => setNotice((n) => (n === msg ? null : n)), 3500)
  }

  const saveCurrent = () => {
    const entry = addSavedPrompt({ prompt })
    flash(entry ? `Saved “${entry.title}”` : 'Nothing to save — type a prompt first')
  }

  const loadPrompt = (p) => {
    setPrompt(p.prompt)
    if (typeof p.negativePrompt === 'string') setNegativePrompt(p.negativePrompt)
    if (p.style) setStyle(p.style)
    flash(`Loaded “${p.title}”`)
    if (drawer) setSidebarOpen(false)
  }

  // In the mobile drawer, picking something should get out of the way.
  const closeDrawer = () => {
    if (drawer) setSidebarOpen(false)
  }

  const rename = (p) => {
    cancelRenameRef.current = false
    setEditingId(p.id)
    setEditDraft(p.title)
  }

  const commitRename = (id) => {
    if (cancelRenameRef.current) {
      cancelRenameRef.current = false
      setEditingId(null)
      return
    }
    const next = editDraft.trim()
    if (next && next !== savedPrompts.find((p) => p.id === id)?.title) {
      renameSavedPrompt(id, next)
    }
    setEditingId(null)
  }

  const exportPrompts = () => {
    try {
      const blob = new Blob([JSON.stringify(savedPrompts, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `comfyui-studio-prompts-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 30000)
    } catch (err) {
      flash(`Export failed: ${err.message}`)
    }
  }

  const importPrompts = async (file) => {
    if (!file) return
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      const list = Array.isArray(data) ? data : data?.savedPrompts
      if (!Array.isArray(list)) throw new Error('expected a JSON array of prompts')
      importSavedPrompts(list)
      flash(`Imported ${list.length} prompt(s)`)
    } catch (err) {
      flash(`Import failed: ${err.message}`)
    } finally {
      if (importRef.current) importRef.current.value = ''
    }
  }

  return (
    <div
      data-testid="sidebar"
      style={drawer ? undefined : { width: sidebarWidth }}
      className={clsx('h-full flex flex-col bg-bg-secondary min-w-0', drawer ? 'w-full' : 'shrink-0')}
    >
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-accent/25 bg-accent/15">
              <Sparkles size={15} className="text-accent" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold leading-tight tracking-tight text-text-primary">
                ComfyUI Studio
              </h1>
              <p className="truncate text-[10px] leading-tight text-text-muted">Local generation workspace</p>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {drawer && (
              <motion.button
                type="button"
                whileTap={{ scale: 0.94 }}
                onClick={() => setSidebarOpen(false)}
                className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
                aria-label="Close menu"
                title="Close"
              >
                <X size={16} />
              </motion.button>
            )}
            <motion.button
              type="button"
              whileTap={{ scale: 0.94 }}
              onClick={() => setShowSettings(true)}
              className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
              aria-label="Open settings"
              title="Settings"
            >
              <Settings size={16} />
            </motion.button>
          </div>
        </div>
        <ConnectionBadge />
      </div>

      {/* Saved prompts */}
      <div className="p-3 border-b border-border shrink-0">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">
            Saved prompts
          </h2>
          <div className="flex items-center gap-1">
            <span className="rounded-full border border-border bg-bg-card px-1.5 py-0.5 text-[10px] tabular-nums text-text-muted">
              {savedPrompts.length}
            </span>
            <motion.button
              type="button"
              whileTap={{ scale: 0.92 }}
              onClick={() => importRef.current?.click()}
              className="rounded-md p-1 text-text-muted transition-colors hover:bg-bg-hover hover:text-accent"
              aria-label="Import prompts from JSON"
              title="Import prompts from JSON"
            >
              <Upload size={13} />
            </motion.button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.92 }}
              onClick={exportPrompts}
              disabled={savedPrompts.length === 0}
              className="rounded-md p-1 text-text-muted transition-colors hover:bg-bg-hover hover:text-accent disabled:opacity-40 disabled:hover:bg-transparent"
              aria-label="Export prompts as JSON"
              title="Export prompts as JSON"
            >
              <Download size={13} />
            </motion.button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.92 }}
              onClick={saveCurrent}
              disabled={!prompt.trim()}
              className="rounded-md p-1 text-text-muted transition-colors hover:bg-bg-hover hover:text-accent disabled:opacity-40 disabled:hover:bg-transparent"
              aria-label="Save the current prompt"
              title="Save the current prompt"
            >
              <BookmarkPlus size={13} />
            </motion.button>
          </div>
        </div>

        {savedPrompts.length > 0 && (
          <div className="flex items-center gap-1.5 mb-2">
            <div className="relative flex-1 min-w-0">
              <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search..."
                aria-label="Search saved prompts"
                className="w-full rounded-lg border border-border bg-bg-card py-1 pl-6 pr-2 text-[11px] text-text-primary placeholder:text-text-muted focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/30"
              />
            </div>
            <Dropdown
              value={sort}
              onChange={setSort}
              options={SORTS.map(([v, l]) => ({ value: v, label: l }))}
              ariaLabel="Sort prompts"
              className="text-[11px] py-1.5 min-w-0 w-24"
            />
          </div>
        )}

        {/* Show at most 5 prompts at once — the list scrolls for the rest */}
        <div
          data-testid="saved-prompts-list"
          className="space-y-1 max-h-[186px] overflow-y-auto pr-0.5"
          onClick={closeDrawer}
        >
          {visible.length === 0 ? (
            <p className="text-[11px] text-text-muted px-1 py-1.5">
              {savedPrompts.length === 0
                ? 'None yet — type a prompt and hit the save icon.'
                : 'No matches.'}
            </p>
          ) : (
            visible.map((p) =>
              editingId === p.id ? (
                <div
                  key={p.id}
                  className="flex items-center gap-2 rounded-lg border border-accent/50 bg-bg-card px-2.5 py-1.5"
                >
                  <FileText size={12} className="shrink-0 text-accent" />
                  <input
                    autoFocus
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        commitRename(p.id)
                      } else if (e.key === 'Escape') {
                        e.preventDefault()
                        cancelRenameRef.current = true
                        setEditDraft(p.title)
                        setEditingId(null)
                      }
                    }}
                    onBlur={() => commitRename(p.id)}
                    aria-label="Prompt name"
                    className="min-w-0 flex-1 rounded border border-border bg-bg-secondary px-1.5 py-1 text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40"
                  />
                </div>
              ) : (
                <div
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => loadPrompt(p)}
                  onDoubleClick={() => rename(p)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      loadPrompt(p)
                    }
                  }}
                  className="group flex items-center gap-2 rounded-lg border border-border bg-bg-card px-2.5 py-2 transition-colors hover:border-accent/40 hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 cursor-pointer"
                  title="Click to load · double-click to rename"
                >
                  <FileText size={12} className="shrink-0 text-accent" />
                  <span className="min-w-0 flex-1 truncate text-xs text-text-secondary group-hover:text-text-primary">
                    {p.title}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      removeSavedPrompt(p.id)
                    }}
                    className="rounded p-0.5 text-text-muted opacity-0 transition-opacity hover:bg-red-500/20 hover:text-red-400 group-hover:opacity-100 focus-visible:opacity-100"
                    aria-label={`Delete prompt ${p.title}`}
                    title="Delete prompt"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              )
            )
          )}
        </div>

        {notice && <p className="mt-1.5 text-[10px] text-accent">{notice}</p>}

        <input
          ref={importRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => importPrompts(e.target.files?.[0])}
        />
      </div>

      {/* History */}
      <div className="flex-1 overflow-y-auto p-3" onClick={closeDrawer}>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">History</h2>
          <div className="flex items-center gap-1.5">
            <motion.button
              type="button"
              whileTap={{ scale: 0.92 }}
              onClick={async () => {
                setSyncing(true)
                const r = await syncServerHistory()
                setSyncNote(r.ok ? 'Synced from server' : r.error)
                setSyncing(false)
                setTimeout(() => setSyncNote(null), 3000)
              }}
              className={clsx(
                'rounded-md p-1 text-text-muted transition-colors hover:text-accent',
                syncing ? 'bg-bg-card' : 'hover:bg-bg-card'
              )}
              aria-label="Sync history from server"
              title="Pull generations from the ComfyUI server (shared by every machine)"
            >
              <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
            </motion.button>
            {history.length > 0 && (
              <>
                <span className="rounded-full border border-border bg-bg-card px-1.5 py-0.5 text-[10px] tabular-nums text-text-muted">
                  {history.length}
                </span>
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.92 }}
                  onClick={() => setConfirmClear(true)}
                  className="rounded-md p-1 text-text-muted transition-colors hover:bg-red-500/20 hover:text-red-400"
                  aria-label="Clear all history"
                  title="Clear all history"
                >
                  <Trash2 size={13} />
                </motion.button>
              </>
            )}
          </div>
        </div>
        {syncNote && (
          <p
            className={clsx(
              'text-[10px] mb-1.5 px-1 py-0.5 rounded',
              syncNote === 'Synced from server' ? 'text-green-400' : 'text-warning'
            )}
          >
            {syncNote}
          </p>
        )}
        <HistoryGrid />
      </div>

      <ConfirmDialog
        open={confirmClear}
        title="Clear all history?"
        message={`This removes all ${history.length} entries from every synced browser.`}
        note="Generated files are not deleted — they stay in ComfyUI's output folder on the server."
        confirmLabel="Clear history"
        onConfirm={() => {
          clearHistory()
          setConfirmClear(false)
        }}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  )
}
