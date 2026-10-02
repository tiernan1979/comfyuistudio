import { motion, AnimatePresence } from 'framer-motion'
import { AlertTriangle, X } from 'lucide-react'
import useStore from '../store/useStore'

export default function ErrorBanner() {
  const error = useStore((s) => s.error)
  const clearError = useStore((s) => s.clearError)

  return (
    <AnimatePresence>
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 flex items-start gap-3"
        >
          <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-red-300 mb-0.5">Generation failed</p>
            <p className="text-xs text-red-200/80 font-mono break-words whitespace-pre-wrap">{error}</p>
          </div>
          <button
            onClick={clearError}
            className="p-1 rounded-md hover:bg-red-500/20 transition-colors shrink-0"
          >
            <X size={14} className="text-red-300" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
