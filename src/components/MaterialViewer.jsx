import { useEffect, useState } from 'react'
import { Download, Grid2x2, Loader2, Palette } from 'lucide-react'
import useStore from '../store/useStore'
import { MATERIAL_MAP_KEYS } from '../lib/workflows'
import { downloadBlob } from '../lib/sprite'

const LABELS = {
  basecolor: 'Base colour',
  normal: 'Normal',
  roughness: 'Roughness',
  metalness: 'Metalness',
  height: 'Height',
}

export default function MaterialViewer() {
  const outputImage = useStore((s) => s.outputImage)
  const history = useStore((s) => s.history)
  const generating = useStore((s) => s.generating)
  const progress = useStore((s) => s.progress)
  const progressLabel = useStore((s) => s.progressLabel)
  const prompt = useStore((s) => s.prompt)
  const liveSettings = useStore((s) => s.materialSettings)
  const [selected, setSelected] = useState('basecolor')
  const [repeat, setRepeat] = useState(false)
  const [busy, setBusy] = useState(false)

  const entry = outputImage
    ? history.find((h) => h.type === 'material' && h.data === outputImage)
    : null
  const settings = entry?.settings || liveSettings
  const maps = settings.maps || {}
  const keys = MATERIAL_MAP_KEYS.filter((k) => maps[k])
  const active = maps[selected] ? selected : keys[0] || 'basecolor'
  const url = maps[active] || outputImage
  const name = String(prompt || 'material')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'material'

  useEffect(() => {
    setSelected('basecolor')
    setRepeat(false)
  }, [outputImage])

  const download = async (mapKey = active) => {
    if (!maps[mapKey]) return
    setBusy(true)
    try {
      const res = await fetch(maps[mapKey])
      downloadBlob(await res.blob(), `${name}-${mapKey}.png`)
    } finally {
      setBusy(false)
    }
  }

  const downloadAll = async () => {
    setBusy(true)
    try {
      for (const key of keys) {
        const res = await fetch(maps[key])
        downloadBlob(await res.blob(), `${name}-${key}.png`)
      }
    } finally {
      setBusy(false)
    }
  }

  if (generating && !entry) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 rounded-2xl border border-border bg-bg-card p-8">
        <Loader2 size={28} className="animate-spin text-accent" />
        <p className="text-sm text-text-secondary">
          {progressLabel ? `${progressLabel}…` : 'Generating PBR material maps…'}
        </p>
        {progress && (
          <p className="font-mono text-xs text-text-muted">
            {progress.max > 0 ? Math.round((progress.step / progress.max) * 100) : 0}%
          </p>
        )}
        <p className="max-w-sm text-center text-[11px] leading-relaxed text-text-muted/70">
          Rendering the base colour, then deriving normal, height, roughness and metalness locally.
        </p>
      </div>
    )
  }

  if (!entry) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-bg-card p-8 text-center">
        <Palette size={30} className="text-text-muted" />
        <p className="text-sm text-text-muted">Describe a material, then generate a PBR pack</p>
        <p className="max-w-sm text-[11px] leading-relaxed text-text-muted/70">
          Base colour, normal, roughness, metalness and height — seamlessly tiling and ready for
          Blender, Unity or Unreal.
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto rounded-2xl border border-border bg-bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-text-primary">Local PBR material pack</p>
          <p className="text-[10px] text-text-muted">
            {keys.length} maps · {settings.size || '1024²'} · {settings.tiling || 'both'} tiling
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setRepeat((r) => !r)}
            className="flex items-center gap-1 rounded-lg border border-border bg-bg-hover px-2.5 py-1.5 text-[11px] text-text-secondary hover:text-text-primary"
          >
            <Grid2x2 size={12} /> {repeat ? 'Single' : 'Tile 2×2'}
          </button>
          <button
            type="button"
            onClick={() => download()}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            {LABELS[active]}
          </button>
          <button
            type="button"
            onClick={downloadAll}
            disabled={busy || keys.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-bg-hover px-3 py-1.5 text-[11px] text-text-secondary hover:text-text-primary disabled:opacity-50"
          >
            <Download size={12} /> All maps
          </button>
        </div>
      </div>

      <div
        className="relative mx-auto overflow-hidden rounded-xl border border-border"
        style={{
          width: 'min(100%, 62vh)',
          aspectRatio: '1 / 1',
          ...(repeat
            ? {
                backgroundImage: `url("${url}")`,
                backgroundSize: '50% 50%',
                backgroundRepeat: 'repeat',
              }
            : {}),
        }}
      >
        {!repeat && <img src={url} alt={active} className="block h-full w-full object-contain" />}
      </div>

      <div className="flex flex-wrap justify-center gap-2 border-t border-border pt-3">
        {keys.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setSelected(key)}
            className={
              'w-[76px] overflow-hidden rounded-lg border text-left transition-colors ' +
              (key === active ? 'border-accent' : 'border-border hover:border-text-muted')
            }
            title={LABELS[key]}
          >
            <img src={maps[key]} alt={LABELS[key]} className="h-16 w-full object-cover" />
            <span className="block truncate bg-bg-hover px-1 py-0.5 text-[9px] text-text-secondary">
              {LABELS[key]}
            </span>
          </button>
        ))}
      </div>

      <p className="text-center text-[10px] leading-relaxed text-text-muted/70">
        Normal maps use OpenGL convention (green up). Height is estimated from depth; roughness and
        metalness are local approximations. Import the maps into your engine's material graph.
      </p>
    </div>
  )
}
