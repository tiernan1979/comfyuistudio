import { Brush, Eye, Loader2, Maximize2, Download, X } from 'lucide-react'

export const BTN = 'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40'
export const BTN_PRIMARY = `${BTN} bg-accent text-white hover:bg-accent-hover`
export const BTN_GHOST = `${BTN} bg-bg-hover text-text-secondary hover:bg-accent/20 hover:text-accent`

// Skin / Upscale / Idle (+ optional Download or Clear) for the current mesh.
// Both the generated-mesh card and the imported-mesh card render this row,
// so the actions and their tooltips can never drift apart.
export default function MeshActionRow({ t, showDownload = false, onClear }) {
  const disabled = t.busy || t.pickLock
  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        onClick={t.handlePaint}
        disabled={!t.image || disabled}
        className={BTN_GHOST}
        title="Skin the mesh with the character picture — Hunyuan3D-Paint PBR textures (local, free)"
      >
        {t.paintBusy ? <Loader2 size={13} className="animate-spin" /> : <Brush size={13} />}
        Skin
      </button>
      <button
        type="button"
        onClick={t.handleMeshUpscale}
        disabled={disabled}
        className={BTN_GHOST}
        title="Refine the mesh with UltraShape 1.0 using the character image above (local, free)"
      >
        {t.usBusy ? <Loader2 size={13} className="animate-spin" /> : <Maximize2 size={13} />}
        Upscale
      </button>
      <button
        type="button"
        onClick={t.startIdle}
        disabled={disabled || t.idleBusy}
        className={BTN_GHOST}
        title="Add a looping idle animation — breathing plus eye blinks. You click both eyes on the preview (or skip to breathing only). Runs entirely in the browser."
      >
        {t.idleBusy || t.pickLock ? (
          <Loader2 size={13} className="animate-spin" />
        ) : (
          <Eye size={13} />
        )}
        Idle
      </button>
      {showDownload && (
        <button type="button" onClick={t.downloadMesh} className={BTN_GHOST} disabled={t.busy}>
          <Download size={13} />
          Download
        </button>
      )}
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          disabled={t.busy || t.pickLock}
          className={BTN_GHOST}
          title="Remove imported mesh"
        >
          <X size={13} />
        </button>
      )}
    </div>
  )
}
