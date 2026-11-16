import test from 'node:test'
import assert from 'node:assert/strict'

import {
  GAME_EXPORT_PRESETS,
  buildGameExportWorkflow,
  collisionFaceCount,
  gameExportPreset,
  lodFaceCounts,
} from '../src/lib/workflows/gameExport.js'

const nodesOf = (workflow, cls) =>
  Object.values(workflow).filter((n) => n.class_type === cls)

test('LOD face budgets halve per level and never collapse below 4', () => {
  assert.deepEqual(lodFaceCounts(20000, 3), [20000, 10000, 5000])
  assert.deepEqual(lodFaceCounts(5000, 1), [5000])
  assert.deepEqual(lodFaceCounts(100, 3), [100, 50, 25])
  assert.deepEqual(lodFaceCounts(1, 3), [32, 16, 8])
})

test('game export presets resolve and fall back to desktop', () => {
  assert.equal(gameExportPreset('mobile').faces, 5000)
  assert.equal(gameExportPreset('hero').faces, 50000)
  assert.equal(gameExportPreset('nope').value, 'desktop')
  assert.equal(GAME_EXPORT_PRESETS.length, 3)
})

test('collision budget is explicit or 2% of the LOD budget', () => {
  assert.equal(collisionFaceCount(20000, 500), 500)
  assert.equal(collisionFaceCount(20000, 0), 400)
  assert.equal(collisionFaceCount(5000, 0), 100)
  assert.equal(collisionFaceCount(100, 0), 50)
})

test('three-LOD export chains postprocess nodes and saves each GLB', () => {
  const { workflow, outputs } = buildGameExportWorkflow({
    meshPath: '3d/source.glb',
    prefixRoot: 'game/abc',
    targetFaces: 20000,
    lods: 3,
    collision: true,
  })

  assert.equal(workflow.load.class_type, 'MeshToolsLoad')
  assert.equal(workflow.load.inputs.mesh_path, '3d/source.glb')
  assert.equal(nodesOf(workflow, 'MeshToolsPostprocess').length, 4)
  assert.equal(nodesOf(workflow, 'MeshToolsExport').length, 4)

  // Each LOD branches from the previous cleaned mesh.
  assert.deepEqual(workflow.clean1.inputs.trimesh, ['clean0', 0])
  assert.deepEqual(workflow.clean2.inputs.trimesh, ['clean1', 0])
  assert.deepEqual(workflow.collision.inputs.trimesh, ['clean2', 0])

  assert.deepEqual(
    ['clean0', 'clean1', 'clean2', 'collision'].map((id) => workflow[id].inputs.max_facenum),
    [20000, 10000, 5000, 400],
  )
  assert.equal(workflow.export0.inputs.filename_prefix, 'game/abc/lod0')
  assert.equal(workflow.export1.inputs.filename_prefix, 'game/abc/lod1')
  assert.equal(workflow.export2.inputs.filename_prefix, 'game/abc/lod2')
  assert.equal(workflow.exportCollision.inputs.filename_prefix, 'game/abc/collision')
  assert.equal(workflow.export0.inputs.file_format, 'glb')
  assert.equal(workflow.export0.inputs.save_file, true)
  assert.deepEqual(
    outputs.map((o) => o.filename),
    ['lod0_00001_.glb', 'lod1_00001_.glb', 'lod2_00001_.glb', 'collision_00001_.glb'],
  )
  assert.ok(outputs.every((o) => o.subfolder === 'game/abc'))
})

test('one LOD without collision exports only the cleaned source', () => {
  const { workflow, outputs } = buildGameExportWorkflow({
    meshPath: '3d/source.glb',
    lods: 1,
    collision: false,
  })
  assert.equal(workflow.clean1, undefined)
  assert.equal(workflow.collision, undefined)
  assert.equal(nodesOf(workflow, 'MeshToolsPostprocess').length, 1)
  assert.equal(nodesOf(workflow, 'MeshToolsExport').length, 1)
  assert.deepEqual(outputs.map((o) => o.key), ['lod0'])
})

test('UV unwrap inserts one MeshToolsUVWrap per LOD and OBJ changes the suffix', () => {
  const { workflow, outputs } = buildGameExportWorkflow({
    meshPath: '3d/source.glb',
    prefixRoot: 'game/uv',
    lods: 2,
    collision: false,
    unwrap: true,
    format: 'obj',
  })
  assert.equal(nodesOf(workflow, 'MeshToolsUVWrap').length, 2)
  assert.deepEqual(workflow.uv0.inputs.trimesh, ['clean0', 0])
  assert.deepEqual(workflow.export0.inputs.trimesh, ['uv0', 0])
  assert.equal(workflow.export0.inputs.file_format, 'obj')
  assert.deepEqual(outputs.map((o) => o.filename), ['lod0_00001_.obj', 'lod1_00001_.obj'])
})

test('game export requires a mesh path', () => {
  assert.throws(() => buildGameExportWorkflow({}), /mesh path/i)
})
