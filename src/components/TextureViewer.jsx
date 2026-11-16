import { useState } from 'react'
import { Download, Grid2x2, Layers, Loader2 } from 'lucide-react'
import useStore from '../store/useStore'
import { downloadBlob } from '../lib/sprite'

const cell = 'max-h-[62vh] max-w-full'

const KIND_LABELS = {
  texture: 'Seamless texture',
  tileset: 'Tileset',
  icon: 'Icon / UI pack',
  terrain: 'Terrain auto-tiles',
}

// Checkerboard behind icon sheets so a transparent background is obvious
// instead of reading as a flat white cell.
const CHECKER =
  'repeating-conic-gradient(#2a2a2e 0% 25%, #1b1b1f 0% 50%) 50% / 24px 24px'

function TextureCanvas({ url, repeat, grid, showGrid, checker }) {
  const backgroundStyle =
    repeat > 1
      ? {
          backgroundImage: `url("${url}")`,
          backgroundSize: `${100 / repeat}% ${100 / repeat}%`,
          backgroundRepeat: 'repeat',
        }
      : checker
        ? { background: CHECKER }
        : undefined
  return (
    <div
      className="relative mx-auto overflow-hidden rounded-xl border border-border"
      style={{
        width: 'min(100%, 70vh)',
        aspectRatio: '1 / 1',
        ...(backgroundStyle || {}),
      }}
    >
      {repeat > 1 ? null : (
        <img src={url} alt="game texture" className={`block h-full w-full object-contain ${cell}`} />
      )}
      {showGrid && grid > 1 && (
        <div className="pointer-events-none absolute inset-0">
          {Array.from({ length: grid - 1 }).map((_, i) => (
            <span
              key={`v${i}`}
              className="absolute top-0 h-full w-px bg-accent/70"
              style={{ left: `${((i + 1) / grid) * 100}%` }}
            />
          ))}
          {Array.from({ length: grid - 1 }).map((_, i) => (
            <span
              key={`h${i}`}
              className="absolute left-0 h-px w-full bg-accent/70"
              style={{ top: `${((i + 1) / grid) * 100}%` }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function TextureViewer() {
  const outputImage = useStore((s) => s.outputImage)
  const batchImages = useStore((s) => s.batchImages)
  const setOutputImage = useStore((s) => s.setOutputImage)
  const history = useStore((s) => s.history)
  const generating = useStore((s) => s.generating)
  const progress = useStore((s) => s.progress)
  const progressLabel = useStore((s) => s.progressLabel)
  const liveSettings = useStore((s) => s.textureSettings)
  const [repeat, setRepeat] = useState(2)
  const [showGrid, setShowGrid] = useState(true)
  const [busy, setBusy] = useState(false)

  const entry = outputImage
    ? history.find((h) => h.type === 'texture' && h.data === outputImage)
    : null
  const settings = entry?.settings || liveSettings
  const kind = KIND_LABELS[settings.kind] ? settings.kind : 'texture'
  const grid = Math.max(2, Math.min(4, Number(settings.grid) || 2))
  const isSheet = kind !== 'texture'
  const isIcon = kind === 'icon'
  const canRepeat = kind === 'texture'
  const label = KIND_LABELS[kind]
  const urls = batchImages?.length ? batchImages : outputImage ? [outputImage] : []

  const downloadSheet = async () => {
    if (!outputImage) return
    const res = await fetch(outputImage)
    downloadBlob(await res.blob(), `${kind}-${Date.now()}.png`)
  }

  const downloadTiles = async () => {
    if (!outputImage) return
    setBusy(true)
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image()
        i.onload = () => resolve(i)
        i.onerror = reject
        i.src = outputImage
      })
      const cw = Math.floor(img.naturalWidth / grid)
      const ch = Math.floor(img.naturalHeight / grid)
      const prefix = isIcon ? 'icon' : 'tile'
      for (let r = 0; r < grid; r += 1) {
        for (let c = 0; c < grid; c += 1) {
          const canvas = document.createElement('canvas')
          canvas.width = cw
          canvas.height = ch
          canvas.getContext('2d').drawImage(img, c * cw, r * ch, cw, ch, 0, 0, cw, ch)
          const blob = await new Promise((res) =>
            canvas.toBlob((b) => (b ? res(b) : res(null)), 'image/png'),
          )
          if (blob) downloadBlob(blob, `${prefix}-${r + 1}-${c + 1}.png`)
        }
      }
    } finally {
      setBusy(false)
    }
  }

  if (generating && !outputImage) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 rounded-2xl border border-border bg-bg-card p-8">
        <Loader2 size={28} className="animate-spin text-accent" />
        <p className="text-sm text-text-secondary">
          {progressLabel ? `${progressLabel}…` : `Generating ${label.toLowerCase()}…`}
        </p>
        {progress && (
          <p className="font-mono text-xs text-text-muted">
            {progress.max > 0 ? Math.round((progress.step / progress.max) * 100) : 0}%
          </p>
        )}
      </div>
    )
  }

  if (!outputImage) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-bg-card p-8 text-center">
        <Layers size={30} className="text-text-muted" />
        <p className="text-sm text-text-muted">Describe a surface or asset sheet, then generate</p>
        <p className="max-w-sm text-[11px] leading-relaxed text-text-muted/70">
          Seamless textures, tilesets, transparent icon packs and terrain transition sheets — all
          rendered locally with the image model.
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto rounded-2xl border border-border bg-bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-text-primary">
            {isSheet ? `${label} · ${grid}×${grid}` : label}
          </p>
          <p className="text-[10px] text-text-muted">
            {settings.size || 1024}px square · {urls.length} variant{urls.length === 1 ? '' : 's'}
            {isIcon && settings.transparent !== false ? ' · transparent' : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {canRepeat && (
            <button
              type="button"
              onClick={() => setRepeat((r) => (r === 2 ? 3 : r === 3 ? 1 : 2))}
              className="rounded-lg border border-border bg-bg-hover px-2.5 py-1.5 text-[11px] text-text-secondary hover:text-text-primary"
            >
              <Grid2x2 size={12} className="mr-1 inline" />
              {repeat > 1 ? `Repeat ${repeat}×${repeat}` : 'Single'}
            </button>
          )}
          {isSheet && (
            <button
              type="button"
              onClick={() => setShowGrid((v) => !v)}
              className="rounded-lg border border-border bg-bg-hover px-2.5 py-1.5 text-[11px] text-text-secondary hover:text-text-primary"
            >
              {showGrid ? 'Hide grid' : 'Show grid'}
            </button>
          )}
          <button
            type="button"
            onClick={downloadSheet}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-accent-hover"
          >
            <Download size={12} /> PNG
          </button>
          {isSheet && (
            <button
              type="button"
              onClick={downloadTiles}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-bg-hover px-3 py-1.5 text-[11px] text-text-secondary hover:text-text-primary disabled:opacity-50"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Grid2x2 size={12} />}
              {isIcon ? 'Icon PNGs' : 'Tile PNGs'}
            </button>
          )}
        </div>
      </div>

      <TextureCanvas
        url={outputImage}
        repeat={canRepeat ? repeat : 1}
        grid={grid}
        showGrid={isSheet && showGrid}
        checker={isIcon}
      />

      {urls.length > 1 && (
        <div className="flex flex-wrap justify-center gap-2 border-t border-border pt-3">
          {urls.map((url, i) => (
            <button
              key={url}
              type="button"
              onClick={() => setOutputImage(url)}
              className={
                'h-14 w-14 overflow-hidden rounded-lg border transition-colors ' +
                (url === outputImage ? 'border-accent' : 'border-border hover:border-text-muted')
              }
              title={`Variant ${i + 1}`}
            >
              <img src={url} alt={`variant ${i + 1}`} className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}

      <p className="text-center text-[10px] leading-relaxed text-text-muted/70">
        {isIcon
          ? 'Each icon is cropped from the sheet at an equal cell size. Transparent packs keep an alpha channel, ready for a UI atlas.'
          : kind === 'terrain'
            ? 'Each cell is an edge or corner transition. Crop the PNGs and import them into your tilemap’s autotile rules.'
            : kind === 'tileset'
              ? 'Each tile is cropped from the sheet at equal size. Download the sheet for an atlas workflow, or individual PNGs for a tilemap.'
              : 'The repeat preview is a fast tiling check. Real seams mean the prompt needs a stronger edge-to-edge material description.'}
      </p>
    </div>
  )
}
