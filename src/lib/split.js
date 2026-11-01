// Helpers for the 2D part splitter (ComfyUI-AutoSplit-Orchestrator runs).

// The orchestrator returns `ui.autosplit = [{ metadata, folder, pass, run_id }]`
// where `folder` is an absolute path on the ComfyUI host. ComfyUI's /view
// wants the path relative to its output root — pull the tail after /output/.
export function autosplitSubfolder(folder, outputDirectory, runId) {
  const rel = String(folder || '').replace(/\\/g, '/')
  const marker = '/output/'
  const idx = rel.lastIndexOf(marker)
  if (idx >= 0 && rel.slice(idx + marker.length)) return rel.slice(idx + marker.length)
  return [outputDirectory, runId].filter(Boolean).join('/')
}

// Scan a history entry for the orchestrator's ui payload.
export function findAutosplitResult(entry) {
  for (const nodeOut of Object.values(entry?.outputs || {})) {
    const arr = nodeOut?.autosplit
    if (Array.isArray(arr) && arr[0]) return arr[0]
  }
  return null
}

// parts_metadata.json (schema 2) → a Godot-friendly manifest. Each part gets
// the PNG's top-left in full-image space + draw order (0 = back-most → Godot
// z_index). Pivots are set per bone in Godot; the browser has no rig.
export function buildPartsManifest(meta, character = '') {
  const [W, H] = meta?.image_size || [0, 0]
  const parts = (meta?.parts || [])
    .slice()
    .sort((a, b) => (a.draw_index ?? 0) - (b.draw_index ?? 0))
    .map((p) => {
      const [x0, y0, x1, y1] = p.xyxy_full || p.xyxy || [0, 0, 0, 0]
      return {
        name: p.tag,
        file: p.file,
        offset: [Math.round(x0), Math.round(y0)],
        size: [Math.round(x1 - x0), Math.round(y1 - y0)],
        z: p.draw_index ?? 0,
        score: p.score ?? null,
      }
    })
  return {
    canvas: [W, H],
    character: character || meta?.character || '',
    parts,
    missing: meta?.missing || [],
  }
}
