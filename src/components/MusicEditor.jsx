import { useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Loader2, Square, X } from 'lucide-react'
import useMusicEditor from '../hooks/useMusicEditor'
import { useFocusTrap } from '../hooks/useFocusTrap'
import Toolbar from './music/Toolbar'
import ClipInspector from './music/ClipInspector'
import Timeline from './music/Timeline'

export default function MusicEditor() {
  const e = useMusicEditor()
  const panelRef = useRef(null)
  useFocusTrap(panelRef, e.open)

  return (
    <AnimatePresence>
      {e.open && (
        <motion.div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Music editor"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-bg-primary/98 backdrop-blur-sm flex flex-col"
        >
          {/* Grey-out while audio loads/decodes/renders — big files can
              take a while, and a bare spinner chip reads as "nothing
              happened". Blocks clicks on the timeline underneath. */}
          <AnimatePresence>
            {e.busy && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                data-testid="studio-loading"
                className="absolute inset-0 z-40 bg-black/60 backdrop-blur-[2px] flex flex-col items-center justify-center gap-4 px-8 text-center"
              >
                <Loader2 size={40} className="animate-spin text-accent" />
                <p className="text-sm font-medium text-text-secondary">{e.busy}</p>
                <p className="text-xs text-text-muted">This can take a moment for long tracks</p>
              </motion.div>
            )}
          </AnimatePresence>

          <Toolbar editor={e} />
          <ClipInspector editor={e} />

          <div
            className="relative flex-1 min-h-0"
            onPointerDown={() => {
              if (e.showHistory) e.setShowHistory(false)
              if (e.showPart) e.setShowPart(false)
            }}
          >
            <Timeline editor={e} />

            {/* busy / error chips */}
            <AnimatePresence>
              {e.busy && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 rounded-xl bg-bg-card border border-border shadow-2xl text-xs text-text-secondary"
                >
                  <Loader2 size={13} className="animate-spin text-accent" />
                  {e.busy}
                  {e.busy.startsWith('Generating part') && (
                    <button
                      onClick={e.stopPartGeneration}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-500/20 text-red-300 hover:bg-red-500/35 transition-colors"
                      title="Stop this generation"
                    >
                      <Square size={10} fill="currentColor" />
                      Stop
                    </button>
                  )}
                </motion.div>
              )}
              {e.err && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-2 rounded-xl bg-red-500/15 border border-red-500/40 text-xs text-red-300 max-w-xl"
                >
                  {e.err}
                  <button onClick={() => e.setErr('')} className="shrink-0 hover:text-white" aria-label="Dismiss error">
                    <X size={12} />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Status bar */}
          <div className="shrink-0 border-t border-border bg-bg-secondary/70 px-4 py-1.5 flex items-center gap-4 text-[10px] text-text-muted select-none">
            <span>
              Space play/pause · S split · Range tool or Shift-drag select · M mute range · Del
              cut/delete · Ctrl+Z undo · ←/→ seek (Shift = 0.1s)
            </span>
            <span className="ml-auto font-mono">
              {e.zoom.toFixed(0)} px/s · {e.tracks.length} track{e.tracks.length === 1 ? '' : 's'}
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
