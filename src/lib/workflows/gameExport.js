// Game-ready 3D export: clean the mesh, reduce it to a triangle budget and
// emit one GLB/OBJ per LOD plus an optional low-poly collision proxy. All of
// this runs on the local ComfyUI MeshTools nodes — no cloud service and no
// extra model downloads.

export const GAME_EXPORT_PRESETS = [
  { value: 'mobile', label: 'Mobile', faces: 5000, collisionFaces: 150 },
  { value: 'desktop', label: 'Desktop', faces: 20000, collisionFaces: 500 },
  { value: 'hero', label: 'Hero', faces: 50000, collisionFaces: 1000 },
]

export const GAME_EXPORT_FORMATS = [
  { value: 'glb', label: 'GLB' },
  { value: 'obj', label: 'OBJ' },
]

export const GAME_EXPORT_LODS = [1, 2, 3]

// Nodes the export graph calls; `prepare`-style preflight in the runner gives
// a clear message on ComfyUI builds without the MeshTools pack.
export const GAME_EXPORT_NODES = [
  'MeshToolsLoad',
  'MeshToolsPostprocess',
  'MeshToolsExport',
]

export function gameExportPreset(value) {
  return GAME_EXPORT_PRESETS.find((p) => p.value === value) || GAME_EXPORT_PRESETS[1]
}

// LOD0 keeps the full budget, each following LOD halves it. Four is the
// practical floor for a recognizable mesh, so tiny custom budgets don't
// collapse to a single triangle.
export function lodFaceCounts(targetFaces, lods = 3) {
  const base = Math.max(32, Math.round(Number(targetFaces) || 20000))
  const count = Math.max(1, Math.min(3, Math.round(Number(lods) || 3)))
  return Array.from({ length: count }, (_, i) => Math.max(4, Math.round(base / 2 ** i)))
}

export function collisionFaceCount(targetFaces, collisionFaces) {
  const explicit = Number(collisionFaces)
  if (explicit > 0) return Math.max(4, Math.round(explicit))
  return Math.max(50, Math.min(1000, Math.round((Number(targetFaces) || 20000) * 0.02)))
}

export function buildGameExportWorkflow({
  meshPath,
  prefixRoot = 'game/export',
  format = 'glb',
  targetFaces = 20000,
  lods = 3,
  collision = true,
  collisionFaces = 0,
  unwrap = false,
  smoothNormals = true,
  cleanup = true,
}) {
  if (!meshPath) throw new Error('No mesh path for game export.')
  const fmt = format === 'obj' ? 'obj' : 'glb'
  const targets = lodFaceCounts(targetFaces, lods)
  const workflow = {
    load: {
      class_type: 'MeshToolsLoad',
      inputs: { mesh_path: meshPath },
    },
  }
  const outputs = []

  // Each pass branches from the previous cleaned mesh, so LOD1/2 are
  // quadric decimations of an already-decimated mesh instead of three
  // independent jobs on the full-resolution source.
  let previous = ['load', 0]
  targets.forEach((faces, i) => {
    const cleanId = `clean${i}`
    workflow[cleanId] = {
      class_type: 'MeshToolsPostprocess',
      inputs: {
        trimesh: previous,
        remove_floaters: cleanup,
        remove_degenerate_faces: true,
        reduce_faces: true,
        max_facenum: faces,
        smooth_normals: smoothNormals,
      },
    }
    let meshOut = [cleanId, 0]
    if (unwrap) {
      const uvId = `uv${i}`
      workflow[uvId] = {
        class_type: 'MeshToolsUVWrap',
        inputs: { trimesh: meshOut },
      }
      meshOut = [uvId, 0]
    }
    const prefix = `${prefixRoot}/lod${i}`
    workflow[`export${i}`] = {
      class_type: 'MeshToolsExport',
      inputs: {
        trimesh: meshOut,
        filename_prefix: prefix,
        file_format: fmt,
        save_file: true,
      },
    }
    outputs.push({
      key: `lod${i}`,
      label: `LOD${i}`,
      subfolder: prefixRoot,
      filename: `lod${i}_00001_.${fmt}`,
      faces,
    })
    previous = [cleanId, 0]
  })

  if (collision) {
    const faces = collisionFaceCount(targetFaces, collisionFaces)
    workflow.collision = {
      class_type: 'MeshToolsPostprocess',
      inputs: {
        trimesh: previous,
        remove_floaters: cleanup,
        remove_degenerate_faces: true,
        reduce_faces: true,
        max_facenum: faces,
        smooth_normals: false,
      },
    }
    const prefix = `${prefixRoot}/collision`
    workflow.exportCollision = {
      class_type: 'MeshToolsExport',
      inputs: {
        trimesh: ['collision', 0],
        filename_prefix: prefix,
        file_format: fmt,
        save_file: true,
      },
    }
    outputs.push({
      key: 'collision',
      label: 'Collision',
      subfolder: prefixRoot,
      filename: `collision_00001_.${fmt}`,
      faces,
    })
  }

  return { workflow, outputs }
}
