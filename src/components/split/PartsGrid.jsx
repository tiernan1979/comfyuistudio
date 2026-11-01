import { motion } from 'framer-motion'
import { Download, FolderArchive, FileJson } from 'lucide-react'
import { downloadFileAs } from '../../lib/comfyui'

const CHECKER = {
  backgroundImage:
    'linear-gradient(45deg, rgba(128,128,128,0.18) 25%, transparent 25%),' +
    'linear-gradient(-45deg, rgba(128,128,128,0.18) 25%, transparent 25%),' +
    'linear-gradient(45deg, transparent 75%, rgba(128,128,128,0.18) 75%),' +
    'linear-gradient(-45deg, transparent 75%, rgba(128,128,128,0.18) 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
}

const toolbarClass =
  'flex items-center gap-1.5 rounded-lg border border-border bg-bg-card px-2.5 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary'

export default function PartsGrid({ result, onZip, onManifest }) {
  return (
    <motion.div
      key="result"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex min-h-0 flex-1 flex-col gap-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-text-secondary">
          {result.parts.length} parts · canvas {result.canvas[0]}×{result.canvas[1]}
        </span>
        {result.missing.length > 0 && (
          <span className="text-[11px] text-amber-300">missing: {result.missing.join(', ')}</span>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={onZip}
          className={toolbarClass}
          title="Download every part + parts.json as a zip"
        >
          <FolderArchive size={14} /> All (.zip)
        </button>
        <button type="button" onClick={onManifest} className={toolbarClass}>
          <FileJson size={14} /> parts.json
        </button>
      </div>

      <div className="grid min-h-0 grid-cols-2 gap-2 overflow-y-auto pb-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {result.parts.map((p) => (
          <div
            key={p.file}
            className="flex flex-col overflow-hidden rounded-xl border border-border bg-bg-card"
          >
            <div
              className="flex min-h-[110px] flex-1 items-center justify-center p-2"
              style={CHECKER}
            >
              <img src={p.url} alt={p.name} className="max-h-32 max-w-full object-contain" />
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-border px-2 py-1.5">
              <div className="min-w-0">
                <p className="truncate text-[11px] text-text-primary">{p.name}</p>
                <p className="font-mono text-[10px] text-text-muted">
                  z{p.z} · {p.size[0]}×{p.size[1]}
                </p>
              </div>
              <button
                type="button"
                onClick={() => downloadFileAs(p.url, p.file)}
                className="shrink-0 rounded-lg p-1.5 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
                title="Download part"
              >
                <Download size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  )
}
