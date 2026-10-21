import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Download, LayoutGrid, Loader2, FileJson, FileCode2 } from 'lucide-react'
import useStore from '../store/useStore'
import { downloadBlob, downloadText, buildAtlas, buildGodotSpriteFrames, spriteSlug } from '../lib/sprite'
import { layoutRows } from '../lib/character'

function formatElapsed(s) {
  if (!Number.isFinite(s) || s < 0) s = 0
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`
}

export default function SpritePlayer() {
  const outputImage = useStore((s) => s.outputImage)
  const liveSettings = useStore((s) => s.spriteSettings)
  const history = useStore((s) => s.history)
  const generating = useStore((s) => s.generating)
  const progress = useStore((s) => s.progress)
  const progressLabel = useStore((s) => s.progressLabel)
  const elapsedTime = useStore((s) => s.elapsedTime)
  const title = useStore((s) => s.titles?.sprite)
  const prompt = useStore((s) => s.prompt)
  const [busy, setBusy] = useState('')
  const [dims, setDims] = useState(null)

  // outputImage is shared across every mode — an image/edit render also lands
  // there. Only treat it as a sheet when a matching sprite history entry
  // exists (publishSpriteSheet always writes one, so this is exact). Any other
  // image must NOT be shown here, or its download would hand you a single
  // frame labelled as a sheet.
  const entry = outputImage ? history.find((h) => h.type === 'sprite' && h.data === outputImage) : null
  const isSheet = !!entry
  // Describe the sheet that is actually on screen: prefer the history entry
  // that produced this exact image (it snapshots the layout/cell/fps used), so
  // the caption, row chips and .tres/.json exports always match the PNG — not
  // whatever settings the user has edited since. Falls back to live settings
  // while generating / before any render.
  const settings = entry?.settings || liveSettings
  const name = title || spriteSlug(prompt) || 'sprite'
  const cellSize = settings?.cellSize || 256
  const fps = settings?.fps || 12
  const rows =
    Array.isArray(settings?.layout) && settings.layout.length
      ? settings.layout.map((r) => ({ name: r.name, frames: r.frames }))
      : layoutRows(settings || {}).map((r) => ({ name: r.name, frames: r.frames }))
  const rowCount = rows.length
  const columns = rows.reduce((m, r) => Math.max(m, r.frames), 1)
  const frameCount = rows.reduce((n, r) => n + r.frames, 0)
  const background = settings?.background || 'transparent'
  const meta = { name, columns, cellSize, rows, fps }

  const downloadSheet = async () => {
    if (!outputImage) return
    setBusy('png')
    try {
      const res = await fetch(outputImage)
      downloadBlob(await res.blob(), `${name}.png`)
    } catch (err) {
      console.error('sheet download failed', err)
    } finally {
      setBusy('')
    }
  }

  const downloadAtlas = () => {
    downloadText(JSON.stringify(buildAtlas(meta), null, 2), `${name}.json`, 'application/json')
  }

  const downloadTres = () => {
    downloadText(buildGodotSpriteFrames(meta), `${name}.tres`)
  }

  return (
    <div className="relative w-full h-full flex flex-col rounded-2xl overflow-hidden bg-bg-card border border-border">
      <AnimatePresence mode="wait">
        {generating && !isSheet ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 flex flex-col items-center justify-center gap-4 p-8"
          >
            <div className="relative w-20 h-20">
              <div className="absolute inset-0 rounded-full border-2 border-accent/20" />
              <div className="absolute inset-0 rounded-full border-2 border-accent border-t-transparent animate-spin" />
              {progress && (
                <span className="absolute inset-0 flex items-center justify-center text-xs text-accent font-mono">
                  {progress.max > 0 ? Math.round((progress.step / progress.max) * 100) : 0}%
                </span>
              )}
            </div>
            <p className="text-sm text-text-secondary">
              {progressLabel ? `${progressLabel}…` : `Generating ${frameCount} sprite frames…`}
            </p>
            <p className="text-xs text-text-muted">
              {formatElapsed(elapsedTime)} elapsed — {rowCount} animation{rowCount > 1 ? 's' : ''} ×{' '}
              {columns} frames
            </p>
          </motion.div>
        ) : isSheet ? (
          <motion.div
            key="sheet"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 flex flex-col items-center justify-center gap-4 p-6 overflow-auto"
          >
            <div
              className="max-w-full max-h-[60vh] rounded-xl border border-border overflow-hidden"
              style={
                background === 'transparent'
                  ? {
                      backgroundImage:
                        'conic-gradient(#2a2a2e 0 25%, #3a3a3f 0 50%, #2a2a2e 0 75%, #3a3a3f 0)',
                      backgroundSize: '20px 20px',
                      imageRendering: 'pixelated',
                    }
                  : { background: background === 'black' ? '#000' : '#ff00ff', imageRendering: 'pixelated' }
              }
            >
              <img
                src={outputImage}
                alt="sprite sheet"
                className="block max-w-full max-h-[60vh]"
                onLoad={(e) => setDims({ w: e.target.naturalWidth, h: e.target.naturalHeight })}
                onError={() => setDims(null)}
              />
            </div>

            <p className="text-[11px] text-text-muted font-mono text-center">
              {columns}×{rowCount} grid · {frameCount} frames · {cellSize}px cells ·{' '}
              {columns * cellSize}×{rowCount * cellSize}px · transparent
              {dims ? ` · PNG ${dims.w}×${dims.h}` : ''}
            </p>

            <div className="flex flex-wrap items-center justify-center gap-1.5 max-w-2xl">
              {rows.map((r) => (
                <span
                  key={r.name}
                  className="text-[10px] font-mono px-2 py-0.5 rounded bg-bg-hover text-text-secondary"
                >
                  {r.name}
                </span>
              ))}
            </div>

            <div className="flex items-center gap-2 flex-wrap justify-center">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={downloadSheet}
                disabled={!!busy}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-accent hover:bg-accent-hover text-white shadow-lg shadow-accent/25 transition-colors disabled:opacity-60"
              >
                {busy === 'png' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                {name}.png
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={downloadTres}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-bg-hover hover:bg-white/10 text-text-secondary transition-colors"
                title="Godot 4 AnimatedSprite2D resource"
              >
                <FileCode2 size={15} />
                Godot .tres
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={downloadAtlas}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-bg-hover hover:bg-white/10 text-text-secondary transition-colors"
                title="JSON atlas (frame rects)"
              >
                <FileJson size={15} />
                Atlas .json
              </motion.button>
            </div>

            <p className="text-[10px] text-text-muted/70 text-center max-w-xl leading-snug">
              For Godot: save the PNG as <span className="font-mono">res://sprites/{name}.png</span>,
              drop the <span className="font-mono">.tres</span> beside it, then drag it onto an
              AnimatedSprite2D — each row becomes a named animation in SpriteFrames.
            </p>
          </motion.div>
        ) : (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center"
          >
            <div className="w-16 h-16 rounded-2xl bg-bg-hover flex items-center justify-center">
              <LayoutGrid size={30} className="text-text-muted" />
            </div>
            <p className="text-sm text-text-muted">Describe a character, pick animations, generate</p>
            <p className="text-[11px] max-w-sm leading-relaxed text-text-muted/70">
              Produces a transparent sprite sheet + a Godot SpriteFrames resource with one animation
              per row.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
