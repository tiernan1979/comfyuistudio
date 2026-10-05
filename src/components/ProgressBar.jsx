import { motion } from 'framer-motion'
import useStore from '../store/useStore'

export default function ProgressBar() {
  const progress = useStore((s) => s.progress)
  const progressLabel = useStore((s) => s.progressLabel)
  const generating = useStore((s) => s.generating)
  const elapsedTime = useStore((s) => s.elapsedTime)

  if (!generating || (!progress && !progressLabel)) return null

  const pct = progress && progress.max > 0 ? (progress.step / progress.max) * 100 : 0

  const formatTime = (s) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="w-full"
    >
      <div className="flex items-center justify-between mb-1.5 text-xs text-text-secondary">
        <span>
          {progress ? (
            <>
              Step {progress.step} / {progress.total}
              {progressLabel ? <span className="text-accent"> · {progressLabel}</span> : null}
            </>
          ) : (
            <span className="text-accent">{progressLabel || 'Working…'}</span>
          )}
        </span>
        <span>{formatTime(elapsedTime)}</span>
      </div>
      {progress && (
        <div className="w-full h-2 rounded-full bg-bg-card overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-accent to-purple-500 progress-active"
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
      )}
    </motion.div>
  )
}
