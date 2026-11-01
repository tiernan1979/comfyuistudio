import { useRef, useState } from 'react'
import clsx from 'clsx'
import { Upload, X, ImagePlus } from 'lucide-react'
import { fileFromDrop } from '../../lib/dropImage'
import { Section } from './Section'

// Drag/drop + browse surface for the character image. Drag depth is tracked
// so leaving a child element doesn't clear the highlight mid-drag.
export default function SplitSource({ source, busy, onPick, onClear, onError }) {
  const fileRef = useRef(null)
  const dragDepth = useRef(0)
  const [dragOver, setDragOver] = useState(false)

  const accept = (file) => {
    if (!file) return
    if (file.type && !file.type.startsWith('image/')) return
    onPick(file)
  }

  const onDrop = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current = 0
    setDragOver(false)
    if (busy) return
    try {
      const file = await fileFromDrop(e)
      accept(file)
    } catch (err) {
      onError(`Could not use that dropped image — ${err.message}`)
    }
  }

  return (
    <Section title="Source image">
      <div
        onDragEnter={(e) => {
          e.preventDefault()
          dragDepth.current += 1
          if (!busy) setDragOver(true)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
        }}
        onDragLeave={(e) => {
          e.preventDefault()
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (dragDepth.current === 0) setDragOver(false)
        }}
        onDrop={onDrop}
      >
        {source ? (
          <div className="group relative overflow-hidden rounded-xl border border-border">
            <img
              src={source.preview || source.url}
              alt="Source"
              className="max-h-44 w-full bg-bg-card object-contain"
            />
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6">
              <span className="max-w-[180px] truncate text-[10px] text-white/80">{source.name}</span>
              {!busy && (
                <button
                  type="button"
                  onClick={onClear}
                  className="rounded-lg bg-black/50 p-1.5 transition-colors hover:bg-red-500/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                  title="Remove image"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
        ) : (
          <div
            onClick={() => !busy && fileRef.current?.click()}
            className={clsx(
              'flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors',
              dragOver
                ? 'border-accent bg-accent/10'
                : 'border-border hover:border-accent/50 hover:bg-bg-card',
              busy && 'pointer-events-none opacity-50',
            )}
          >
            {dragOver ? (
              <Upload size={22} className="text-accent" />
            ) : (
              <ImagePlus size={22} className="text-text-muted" />
            )}
            <p className="text-xs text-text-secondary">
              Drop a character image or <span className="font-medium text-accent">browse</span>
            </p>
            <p className="text-[10px] text-text-muted">
              Best on a flat, clearly-separated character — a bare “underwear” T-pose splits cleanly
            </p>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            accept(e.target.files?.[0])
            // Allow picking the same file again after a failed run.
            e.target.value = ''
          }}
        />
      </div>
    </Section>
  )
}
