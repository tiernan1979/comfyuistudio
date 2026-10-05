import { motion } from 'framer-motion'
import { Image, Film, Music, Trash2 } from 'lucide-react'
import useStore from '../store/useStore'
import clsx from 'clsx'

export default function HistoryGrid() {
  const history = useStore((s) => s.history)
  const selectedHistoryId = useStore((s) => s.selectedHistoryId)
  const selectHistory = useStore((s) => s.selectHistory)
  const removeFromHistory = useStore((s) => s.removeFromHistory)

  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <div className="w-10 h-10 rounded-xl bg-bg-hover flex items-center justify-center">
          <Image size={18} className="text-text-muted" />
        </div>
        <p className="text-xs text-text-muted">No generations yet</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-1.5">
      {history.map((entry, i) => (
        <motion.button
          key={entry.id}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: i * 0.03 }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => selectHistory(entry.id)}
          className={clsx(
            'relative aspect-square rounded-lg overflow-hidden border transition-all group',
            selectedHistoryId === entry.id
              ? 'border-accent ring-1 ring-accent/50'
              : 'border-transparent hover:border-border'
          )}
        >
          <span
            onClick={(e) => {
              e.stopPropagation()
              removeFromHistory(entry.id)
            }}
            title="Delete"
            className="absolute top-1 left-1 z-10 p-1 rounded-md bg-black/60 text-white/80 opacity-0 group-hover:opacity-100 hover:bg-red-500 hover:text-white transition-all cursor-pointer"
          >
            <Trash2 size={10} />
          </span>
          {/* Music entries are audio URLs — no thumbnail, show a tile instead */}
          {entry.type === 'music' ? (
            <span className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-purple-500/30 to-accent/20">
              <Music size={22} className="text-white/80" />
            </span>
          ) : (
            <img
              src={entry.data}
              alt={entry.prompt}
              className="w-full h-full object-cover"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 hover:opacity-100 transition-opacity">
            <div className="absolute bottom-1 left-1 right-1">
              <p className="text-[9px] text-white/80 line-clamp-2 leading-tight">
                {entry.prompt}
              </p>
            </div>
          </div>
          <div className="absolute top-1 right-1">
            {entry.type === 'video' ? (
              <Film size={10} className="text-white/70" />
            ) : entry.type === 'music' ? (
              <Music size={10} className="text-white/70" />
            ) : (
              <Image size={10} className="text-white/70" />
            )}
          </div>
        </motion.button>
      ))}
    </div>
  )
}
