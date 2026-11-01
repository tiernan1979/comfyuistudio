import { useEffect, useState } from 'react'
import { Box, Download, Loader2 } from 'lucide-react'
import { BTN_GHOST } from './MeshActionRow'

// <model-viewer> comes from a CDN on demand; offline the panel falls back to
// a filename card (nothing here blocks generation).
function useModelViewer() {
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined' && window.customElements?.get('model-viewer')) {
      setReady(true)
      return
    }
    let loaded = false
    const el = document.createElement('script')
    el.type = 'module'
    el.src = 'https://unpkg.com/@google/model-viewer@3.5.0/dist/model-viewer.min.js'
    el.onload = () => {
      loaded = true
      setReady(true)
    }
    el.onerror = () => setFailed(true) // offline — filename card instead
    document.head.appendChild(el)
    const t = setTimeout(() => {
      if (!loaded) setFailed(true)
    }, 10000)
    return () => clearTimeout(t)
  }, [])

  return { ready, failed }
}

function PickBanner({ t }) {
  if (!t.pickStage) return null
  return (
    <div className="absolute inset-x-0 top-0 z-10 flex flex-wrap items-center justify-center gap-2 bg-black/75 px-3 py-2 text-xs text-white">
      <span className="font-medium">
        {t.pickStage === 1
          ? 'Click the LEFT eye on the character'
          : 'Click the RIGHT eye on the character'}
      </span>
      <button
        type="button"
        onClick={() => t.finishPick([])}
        className="rounded bg-white/15 px-2 py-0.5 transition-colors hover:bg-white/30"
        title="Skip the eye pick — the idle clip will breathe only"
      >
        Breathing only
      </button>
      {t.pickStage === 2 && (
        <button
          type="button"
          onClick={t.redoLeftEye}
          className="rounded bg-white/15 px-2 py-0.5 transition-colors hover:bg-white/30"
        >
          Redo left eye
        </button>
      )}
      <button
        type="button"
        onClick={t.cancelPick}
        className="rounded bg-red-500/40 px-2 py-0.5 transition-colors hover:bg-red-500/60"
      >
        Cancel
      </button>
    </div>
  )
}

export default function ThreeDViewer({ t, run }) {
  const { ready, failed } = useModelViewer()

  return (
    <div className="flex min-h-[50vh] flex-1 flex-col gap-3 p-3 sm:p-4 md:min-h-0 md:overflow-hidden">
      <div
        data-testid="glb-frame"
        className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-border bg-bg-card"
      >
        <PickBanner t={t} />

        {t.preview ? (
          ready && !failed ? (
            <model-viewer
              ref={t.mvRef}
              src={t.preview.url}
              camera-controls
              auto-rotate
              rotation-per-second="24deg"
              shadow-intensity="1"
              exposure="0.95"
              data-testid="glb-preview"
              onClick={(e) => t.onViewerClick(e, t.mvRef.current)}
              style={{
                width: '100%',
                height: '100%',
                display: 'block',
                backgroundColor: 'transparent',
              }}
            ></model-viewer>
          ) : failed ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
              <Box size={34} className="text-text-muted/50" />
              <p className="text-xs text-text-secondary">
                Interactive preview unavailable (the viewer library needs internet)
              </p>
              <p className="max-w-sm break-all font-mono text-[11px] text-text-muted">
                {t.preview.name}
              </p>
              <p className="text-[11px] text-text-muted">
                Use the Download buttons to open it in Blender / Godot / Unity.
              </p>
            </div>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
              <Loader2 size={18} className="animate-spin text-accent" />
              <p className="text-xs text-text-secondary">Loading 3D preview…</p>
            </div>
          )
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <Box size={40} className="text-text-muted/50" />
            <p className="text-sm text-text-secondary">No mesh yet</p>
            <p className="max-w-xs text-[11px] leading-relaxed text-text-muted">
              Upload a character image and press Generate — the model preview appears here, with
              Skin, Upscale and Rig in the panel on the left.
            </p>
          </div>
        )}

        {t.preview && (
          <span className="absolute bottom-2 left-2 max-w-[70%] truncate rounded bg-black/60 px-2 py-1 font-mono text-[10px] text-white/80">
            {t.preview.name}
          </span>
        )}
      </div>

      {run.results.length > 0 && (
        <div className="shrink-0 space-y-2 rounded-xl border border-border bg-bg-card p-4">
          <p className="text-xs font-semibold text-text-primary">Results</p>
          {run.results.map((r, i) => (
            <div
              key={`${r.type}/${r.subfolder}/${r.filename}/${i}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-secondary px-3 py-2"
            >
              <span className="truncate font-mono text-xs text-text-secondary">{r.filename}</span>
              <button
                type="button"
                onClick={() => t.download(r)}
                className={BTN_GHOST}
                disabled={t.busy}
              >
                <Download size={13} />
                Download
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="shrink-0 text-[11px] text-text-muted">
        Files are saved in ComfyUI's output folder on the server — downloads here are a convenience
        copy.
      </p>
    </div>
  )
}
