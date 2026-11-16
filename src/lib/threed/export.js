// Local game-ready 3D export: clean + decimate a GLB into LODs and, when
// asked, a low-poly collision proxy. The work runs on ComfyUI's MeshTools
// nodes; the browser only uploads the source and downloads the results.

import { assertWorkflowNodes, pollHistory, queuePrompt, uploadMeshFile } from '../comfyui.js'
import { buildGameExportWorkflow, gameExportPreset } from '../workflows.js'
import { fetchOutputBlob } from './assets.js'

const clampLods = (n) => Math.max(1, Math.min(3, Math.round(Number(n) || 3)))

export async function runGameExport(
  base,
  { meshEntry, meshFile, cfg = {} },
  onStatus,
) {
  const blob = meshFile || (meshEntry ? await fetchOutputBlob(base, meshEntry) : null)
  if (!blob) throw new Error('Generate or import a mesh first.')

  onStatus?.('Uploading mesh for game export…')
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const stored = await uploadMeshFile(base, `game-export-${stamp}.glb`, blob)

  const preset = gameExportPreset(cfg.gameExportPreset)
  const lods = clampLods(cfg.gameExportLods)
  const format = cfg.gameExportFormat === 'obj' ? 'obj' : 'glb'
  const { workflow, outputs } = buildGameExportWorkflow({
    meshPath: `3d/${stored}`,
    prefixRoot: `game/${stamp}`,
    format,
    targetFaces: preset.faces,
    lods,
    collision: cfg.gameExportCollision !== false,
    collisionFaces: preset.collisionFaces,
    unwrap: cfg.gameExportUnwrap === true,
    smoothNormals: cfg.gameExportSmooth !== false,
    cleanup: cfg.gameExportCleanup !== false,
  })

  await assertWorkflowNodes(base, workflow, { label: 'Game export' })
  onStatus?.(
    `Decimating to ${preset.faces.toLocaleString()} faces and exporting ${outputs.length} ` +
      `file${outputs.length === 1 ? '' : 's'}…`
  )
  const promptId = await queuePrompt(base, workflow)
  await pollHistory(base, promptId, { label: 'game export', timeoutMs: 900000 })

  return outputs.map((o) => ({
    filename: o.filename,
    subfolder: o.subfolder,
    type: 'output',
    label: o.label,
    faces: o.faces,
    blob: null,
  }))
}
