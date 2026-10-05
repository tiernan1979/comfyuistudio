import { useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Settings, Trash2, BookmarkPlus, Upload, Download, FileText, Search, RefreshCw } from 'lucide-react'
import useStore from '../store/useStore'
import clsx from 'clsx'
import Dropdown from './Dropdown'
import { syncServerHistory } from '../hooks/useComfyUI'
import ConnectionBadge from './ConnectionBadge'
import HistoryGrid from './HistoryGrid'

const SORTS = [
  ['newest', 'Newest'],
  ['oldest', 'Oldest'],
  ['az', 'A–Z'],
]

export default function Sidebar() {
  const setShowSettings = useStore((s) => s.setShowSettings)
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
  }

  const rename = (p) => {
    const next = window.prompt('Name this prompt:', p.title)
    if (next !== null) renameSavedPrompt(p.id, next)
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
      style={{ width: sidebarWidth }}
      className="shrink-0 h-full flex flex-col bg-bg-secondary min-w-0"
    >
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-base font-bold bg-gradient-to-r from-accent to-purple-400 bg-clip-text text-transparent">
            ComfyUI Studio
          </h1>
          <motion.button
            whileHover={{ scale: 1.1, rotate: 90 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => setShowSettings(true)}
            className="p-1.5 rounded-lg hover:bg-bg-hover transition-colors"
            title="Settings"
          >
            <Settings size={16} className="text-text-muted" />
          </motion.button>
        </div>
        <ConnectionBadge />
      </div>

      {/* Saved prompts */}
      <div className="p-3 border-b border-border shrink-0">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
            Saved prompts
          </h2>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-text-muted bg-bg-card px-1.5 py-0.5 rounded-full">
              {savedPrompts.length}
            </span>
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => importRef.current?.click()}
              className="p-1 rounded-md hover:bg-bg-hover text-text-muted hover:text-accent transition-colors"
              title="Import prompts from JSON"
            >
              <Upload size={12} />
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={exportPrompts}
              disabled={savedPrompts.length === 0}
              className="p-1 rounded-md hover:bg-bg-hover text-text-muted hover:text-accent transition-colors disabled:opacity-40"
              title="Export prompts as JSON"
            >
              <Download size={12} />
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={saveCurrent}
              disabled={!prompt.trim()}
              className="p-1 rounded-md hover:bg-bg-hover text-text-muted hover:text-accent transition-colors disabled:opacity-40"
              title="Save the current prompt"
            >
              <BookmarkPlus size={12} />
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
                className="w-full pl-6 pr-2 py-1 rounded-lg bg-bg-card border border-border text-[11px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
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
        <div data-testid="saved-prompts-list" className="space-y-1 max-h-[186px] overflow-y-auto pr-0.5">
          {visible.length === 0 ? (
            <p className="text-[11px] text-text-muted px-1 py-1.5">
              {savedPrompts.length === 0
                ? 'None yet — type a prompt and hit the save icon.'
                : 'No matches.'}
            </p>
          ) : (
            visible.map((p) => (
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
                className="group flex items-center gap-2 px-2.5 py-2 rounded-lg bg-bg-card border border-border hover:border-accent/50 hover:bg-bg-hover transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent"
                title="Click to load · double-click to rename"
              >
                <FileText size={12} className="text-accent shrink-0" />
                <span className="flex-1 min-w-0 truncate text-xs text-text-secondary group-hover:text-text-primary">
                  {p.title}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    removeSavedPrompt(p.id)
                  }}
                  className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/20 text-text-muted hover:text-red-400 transition-opacity"
                  title="Delete prompt"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))
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
      <div className="flex-1 overflow-y-auto p-3">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">History</h2>
          <div className="flex items-center gap-1.5">
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={async () => {
                setSyncing(true)
                const r = await syncServerHistory()
                setSyncNote(r.ok ? 'Synced from server' : r.error)
                setSyncing(false)
                setTimeout(() => setSyncNote(null), 3000)
              }}
              className={clsx(
                'p-1 rounded-md text-text-muted hover:text-accent transition-colors',
                syncing ? 'bg-bg-card' : 'hover:bg-bg-card'
              )}
              title="Pull generations from the ComfyUI server (shared by every machine)"
            >
              <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
            </motion.button>
            {history.length > 0 && (
              <>
                <span className="text-[10px] text-text-muted bg-bg-card px-1.5 py-0.5 rounded-full">
                  {history.length}
                </span>
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => {
                    if (window.confirm('Delete all generation history?')) clearHistory()
                  }}
                  className="p-1 rounded-md hover:bg-red-500/20 text-text-muted hover:text-red-400 transition-colors"
                  title="Clear all history"
                >
                  <Trash2 size={12} />
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
    </div>
  )
}
