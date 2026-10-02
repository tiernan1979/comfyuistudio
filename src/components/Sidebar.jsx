import { motion } from 'framer-motion'
import { Settings, Trash2 } from 'lucide-react'
import useStore from '../store/useStore'
import ConnectionBadge from './ConnectionBadge'
import HistoryGrid from './HistoryGrid'

export default function Sidebar() {
  const setShowSettings = useStore((s) => s.setShowSettings)
  const history = useStore((s) => s.history)
  const clearHistory = useStore((s) => s.clearHistory)

  return (
    <div className="w-64 h-full flex flex-col bg-bg-secondary border-r border-border">
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

      {/* History */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">History</h2>
          <div className="flex items-center gap-1.5">
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
        <HistoryGrid />
      </div>
    </div>
  )
}
