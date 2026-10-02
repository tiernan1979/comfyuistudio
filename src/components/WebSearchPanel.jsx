import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Search, Loader2, Globe, ExternalLink, ImageOff, Bot } from 'lucide-react'
import useStore from '../store/useStore'
import { searchImages, downloadImage } from '../lib/search'

export default function WebSearchPanel() {
  const show = useStore((s) => s.showWebSearch)
  const setShow = useStore((s) => s.setShowWebSearch)
  const searchUrl = useStore((s) => s.searchUrl)
  const prompt = useStore((s) => s.prompt)
  const searchQuery = useStore((s) => s.searchQuery)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState(null)
  const [picking, setPicking] = useState(null)
  const abortRef = useRef(null)
  const queryAtOpen = useRef('')
  const aiPicked = useRef(false)

  const runSearch = async (q) => {
    const term = (q ?? query).trim()
    if (!term || loading) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setError(null)
    setResults([])
    setSearched(false)
    try {
      const r = await searchImages(searchUrl, term, ctrl.signal)
      setResults(r)
      setSearched(true)
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // When the panel opens: use the AI-picked query if there is one (falls back
  // to the prompt), then auto-search
  useEffect(() => {
    if (show) {
      const initial = (searchQuery || prompt).trim()
      queryAtOpen.current = initial
      aiPicked.current = !!searchQuery
      setQuery(initial)
      setError(null)
      if (initial) runSearch(initial)
    } else {
      abortRef.current?.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show])

  const pick = async (r) => {
    if (picking) return
    setPicking(r.fullPath)
    setError(null)
    try {
      // Prefer the full-size image; if the host blocks us, fall back to
      // the search engine's thumbnail (usually on a friendly CDN)
      let file
      let usedFallback = false
      try {
        file = await downloadImage(r.fullPath)
      } catch (err) {
        if (!r.thumbPath || r.thumbPath === r.fullPath) throw err
        file = await downloadImage(r.thumbPath)
        usedFallback = true
      }
      const state = useStore.getState()
      if (state.sourceImage?.preview) {
        URL.revokeObjectURL(state.sourceImage.preview)
      }
      const name = usedFallback ? `preview_${file.name}` : file.name
      state.setSourceImage({
        file: usedFallback ? new File([file], name, { type: file.type }) : file,
        preview: URL.createObjectURL(file),
        name,
      })
      state.setMode('edit')
      setShow(false)
    } catch (err) {
      setError(`Couldn't use that image — ${err.message}. Try another one.`)
    } finally {
      setPicking(null)
    }
  }

  const close = () => {
    abortRef.current?.abort()
    setShow(false)
  }

  if (!show) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-6"
        onClick={close}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 10 }}
          transition={{ type: 'spring', stiffness: 300, damping: 28 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-2xl bg-bg-secondary border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div>
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Globe size={14} className="text-accent" />
                Find a reference image
              </h2>
              <p className="text-[11px] text-text-muted mt-0.5">
                Click a result to load it as the Edit source — then ComfyUI updates it
              </p>
            </div>
            <button
              onClick={close}
              className="p-2 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* Search bar */}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              runSearch()
            }}
            className="flex gap-2 px-5 pt-4"
          >
            <div className="relative flex-1">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Describe the image you're looking for..."
                autoFocus
                className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-bg-card border border-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="px-4 py-2.5 rounded-xl bg-accent text-white text-xs font-medium hover:bg-accent/90 transition-colors disabled:opacity-40 flex items-center gap-1.5"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              Search
            </button>
          </form>

          {aiPicked.current && query.trim() === queryAtOpen.current && queryAtOpen.current && (
            <p className="px-5 pt-2 text-[10px] text-sky-300/80 flex items-center gap-1">
              <Bot size={10} />
              AI picked this search query from your prompt
            </p>
          )}

          {/* Body */}
          <div className="p-5 overflow-y-auto flex-1 min-h-[200px]">
            {loading && (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <Loader2 size={24} className="animate-spin text-accent" />
                <p className="text-xs text-text-muted">Searching the web...</p>
              </div>
            )}

            {!loading && results.length === 0 && searched && !error && (
              <div className="flex flex-col items-center justify-center py-12 gap-2 text-text-muted">
                <ImageOff size={22} />
                <p className="text-xs">No results — try other words</p>
              </div>
            )}

            {!loading && results.length === 0 && !searched && !error && (
              <div className="flex flex-col items-center justify-center py-12 gap-2 text-text-muted">
                <Globe size={22} />
                <p className="text-xs">
                  {queryAtOpen.current
                    ? 'Press Search to find images'
                    : 'Type what you are looking for, then hit Search'}
                </p>
              </div>
            )}

            {results.length > 0 && (
              <div className="grid grid-cols-4 gap-2.5">
                {results.map((r, i) => (
                  <button
                    key={`${r.fullPath}-${i}`}
                    onClick={() => pick(r)}
                    disabled={!!picking}
                    title={r.title || r.fullPath}
                    className="group relative aspect-square rounded-lg overflow-hidden border border-border hover:border-accent transition-all disabled:opacity-60"
                  >
                    <img
                      src={r.thumbPath}
                      alt={r.title}
                      loading="lazy"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    {picking === r.fullPath ? (
                      <span className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-1">
                        <Loader2 size={18} className="animate-spin text-white" />
                        <span className="text-[9px] text-white/90">Downloading...</span>
                      </span>
                    ) : (
                      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent flex items-center justify-center py-1.5">
                        <span className="text-[10px] text-white font-semibold drop-shadow">
                          Use this image
                        </span>
                      </span>
                    )}
                    {r.resolution && (
                      <span className="absolute top-1 right-1 text-[8px] text-white/90 bg-black/50 px-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                        {r.resolution}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Footer — sticky status area, always visible while scrolling */}
          <div className="px-5 py-3 border-t border-border space-y-2">
            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}
            {picking && !error && (
              <div className="flex items-center gap-2 text-xs text-sky-300">
                <Loader2 size={12} className="animate-spin" />
                Downloading image — it will open in Edit mode...
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-text-muted truncate max-w-[60%]">
                via {searchUrl || 'SearXNG — not configured'}
              </span>
              {results.length > 0 && results[0].page && (
                <a
                  href={results[0].page}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] text-text-muted hover:text-accent flex items-center gap-1"
                >
                  First source page <ExternalLink size={10} />
                </a>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
