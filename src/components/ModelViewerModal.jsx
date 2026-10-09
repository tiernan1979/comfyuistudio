import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Box, Loader2 } from 'lucide-react'
import useStore from '../store/useStore'

// Fullscreen GLB viewer for 3D history entries. <model-viewer> is loaded
// from the CDN on demand (same pattern as ThreeDPanel) — offline we show
// a filename card instead of blocking.
export default function ModelViewerModal() {
  const viewing3d = useStore((s) => s.viewing3d)
  const setViewing3d = useStore((s) => s.setViewing3d)
  const [mvReady, setMvReady] = useState(false)
  const [mvFailed, setMvFailed] = useState(false)

  // Lazy-load the model-viewer custom element once.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.customElements?.get('model-viewer')) {
      setMvReady(true)
      return
    }
    let loaded = false
    const el = document.createElement('script')
    el.type = 'module'
    el.src = 'https://unpkg.com/@google/model-viewer@3.5.0/dist/model-viewer.min.js'
    el.onload = () => {
      loaded = true
      setMvReady(true)
    }
    el.onerror = () => setMvFailed(true)
    document.head.appendChild(el)
    const t = setTimeout(() => {
      if (!loaded) setMvFailed(true)
    }, 10000)
    return () => clearTimeout(t)
  }, [])

  // Escape closes the modal.
  useEffect(() => {
    if (!viewing3d) return
    const onKey = (e) => {
      if (e.key === 'Escape') setViewing3d(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewing3d, setViewing3d])

  return (
    <AnimatePresence>
      {viewing3d && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-6"
          onClick={() => setViewing3d(null)}
        >
          <motion.div
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.92, opacity: 0 }}
            className="relative w-full max-w-3xl aspect-square bg-bg-secondary rounded-2xl border border-border overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute top-3 left-4 right-4 flex items-center justify-between z-10 pointer-events-none">
              <p className="text-xs text-text-secondary truncate pr-3">{viewing3d.name}</p>
              <button
                onClick={() => setViewing3d(null)}
                className="pointer-events-auto p-1.5 rounded-lg bg-black/50 text-white/80 hover:bg-red-500 hover:text-white transition-colors"
                title="Close (Esc)"
              >
                <X size={16} />
              </button>
            </div>
            {mvReady && !mvFailed ? (
              <model-viewer
                src={viewing3d.url}
                camera-controls
                auto-rotate
                rotation-per-second="24deg"
                shadow-intensity="1"
                exposure="0.95"
                style={{ width: '100%', height: '100%', backgroundColor: 'transparent' }}
                data-testid="history-3d-viewer"
              />
            ) : mvFailed ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
                <Box size={36} className="text-text-muted" />
                <p className="text-sm text-text-secondary">{viewing3d.name}</p>
                <p className="text-xs text-text-muted">
                  3D preview unavailable offline — download the GLB to view it locally.
                </p>
              </div>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                <Loader2 size={22} className="text-accent animate-spin" />
                <p className="text-xs text-text-muted">Loading 3D viewer…</p>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
