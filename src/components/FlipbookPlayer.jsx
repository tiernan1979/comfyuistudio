import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Download, FileCode2, FileJson, Loader2, Pause, Play, Sparkles } from 'lucide-react'
import useStore from '../store/useStore'
import {
  buildAtlas,
  buildGodotSpriteFrames,
  downloadBlob,
  downloadText,
  spriteSlug,
} from '../lib/sprite'

export default function FlipbookPlayer() {
  const outputImage = useStore((s) => s.outputImage)
  const history = useStore((s) => s.history)
  const generating = useStore((s) => s.generating)
  const progress = useStore((s) => s.progress)
  const progressLabel = useStore((s) => s.progressLabel)
  const elapsedTime = useStore((s) => s.elapsedTime)
  const prompt = useStore((s) => s.prompt)
  const liveSettings = useStore((s) => s.flipbookSettings)
  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [busy, setBusy] = useState(false)

  const entry = outputImage
    ? history.find((h) => h.type === 'flipbook' && h.data === outputImage)
    : null
  const settings = entry?.settings || liveSettings
  const frameCount = entry?.frames?.length || settings.frames || 17
  const fps = settings.fps || 12
  const cellSize = settings.cellSize || settings.resolution || 512
  const columns = settings.columns || frameCount
  const name = spriteSlug(prompt) || 'flipbook'
  const previewCell = Math.max(96, Math.min(220, cellSize))
  const meta = {
    name,
    columns,
    cellSize,
    rows: [{ name: 'effect', frames: frameCount }],
    fps,
  }

  useEffect(() => {
    setFrame(0)
  }, [outputImage])

  useEffect(() => {
    if (!playing || !entry) return
    const id = setInterval(
      () => setFrame((f) => (f + 1) % Math.max(1, frameCount)),
      Math.max(40, 1000 / Math.max(1, fps)),
    )
    return () => clearInterval(id)
  }, [playing, entry, frameCount, fps])

  const downloadSheet = async () => {
    if (!outputImage) return
    setBusy(true)
    try {
      const res = await fetch(outputImage)
      downloadBlob(await res.blob(), `${name}.png`)
    } finally {
      setBusy(false)
    }
  }

  if (generating && !entry) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 rounded-2xl border border-border bg-bg-card p-8">
        <Loader2 size={28} className="animate-spin text-accent" />
        <p className="text-sm text-text-secondary">
          {progressLabel ? `${progressLabel}…` : `Generating ${frameCount} flipbook frames…`}
        </p>
        {progress && (
          <p className="font-mono text-xs text-text-muted">
            {progress.max > 0 ? Math.round((progress.step / progress.max) * 100) : 0}% ·{' '}
            {Math.floor(elapsedTime)}s
          </p>
        )}
        <p className="max-w-sm text-center text-[11px] leading-relaxed text-text-muted/70">
          WAN is rendering the loop, then BiRefNet cuts the background from each frame.
        </p>
      </div>
    )
  }

  if (!entry) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-bg-card p-8 text-center">
        <Sparkles size={30} className="text-text-muted" />
        <p className="text-sm text-text-muted">Describe a looping visual effect, then generate</p>
        <p className="max-w-sm text-[11px] leading-relaxed text-text-muted/70">
          Explosions, portals, fire, magic, impacts. The frames are packed into one sheet with a
          JSON atlas and a Godot SpriteFrames resource.
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col items-center gap-4 overflow-auto rounded-2xl border border-border bg-bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 self-stretch">
        <div>
          <p className="text-sm font-medium text-text-primary">VFX flipbook</p>
          <p className="text-[10px] text-text-muted">
            {frameCount} frames · {fps} fps · {(frameCount / fps).toFixed(2)}s loop
          </p>
        </div>
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-bg-hover px-3 py-1.5 text-[11px] text-text-secondary hover:text-text-primary"
        >
          {playing ? <Pause size={12} /> : <Play size={12} />}
          {playing ? 'Pause' : 'Play'}
        </button>
      </div>

      <div
        className="relative overflow-hidden rounded-xl border border-border"
        style={{
          width: previewCell,
          height: previewCell,
          backgroundImage:
            'conic-gradient(#2a2a2e 0 25%, #3a3a3f 0 50%, #2a2a2e 0 75%, #3a3a3f 0)',
          backgroundSize: '20px 20px',
        }}
      >
        <img
          src={outputImage}
          alt="flipbook sheet"
          style={{
            position: 'absolute',
            left: -frame * previewCell,
            top: 0,
            width: columns * previewCell,
            height: previewCell,
            imageRendering: 'pixelated',
          }}
        />
      </div>

      <input
        type="range"
        min={0}
        max={Math.max(0, frameCount - 1)}
        value={frame}
        onChange={(e) => {
          setPlaying(false)
          setFrame(Number(e.target.value))
        }}
        className="w-full max-w-md accent-accent"
        aria-label="Flipbook frame"
      />
      <p className="font-mono text-[10px] text-text-muted">
        frame {frame + 1} / {frameCount} · sheet {columns * cellSize}×{cellSize}px
      </p>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={downloadSheet}
          disabled={busy}
          className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-accent/25 hover:bg-accent-hover disabled:opacity-60"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
          {name}.png
        </motion.button>
        <button
          type="button"
          onClick={() =>
            downloadText(JSON.stringify(buildAtlas(meta), null, 2), `${name}.json`, 'application/json')
          }
          className="flex items-center gap-2 rounded-xl bg-bg-hover px-4 py-2.5 text-sm font-medium text-text-secondary hover:text-text-primary"
        >
          <FileJson size={15} /> Atlas .json
        </button>
        <button
          type="button"
          onClick={() => downloadText(buildGodotSpriteFrames(meta), `${name}.tres`)}
          className="flex items-center gap-2 rounded-xl bg-bg-hover px-4 py-2.5 text-sm font-medium text-text-secondary hover:text-text-primary"
        >
          <FileCode2 size={15} /> Godot .tres
        </button>
      </div>

      <p className="max-w-xl text-center text-[10px] leading-relaxed text-text-muted/70">
        The sheet is one horizontal row. Drop the PNG into a sprite/animation importer, or use the
        atlas JSON for TexturePacker-style engines.
      </p>
    </div>
  )
}
