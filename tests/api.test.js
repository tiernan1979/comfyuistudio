import test from 'node:test'
import assert from 'node:assert/strict'

import { workflowFor, DEFAULT_SETTINGS, MODES, apiCapabilities, canonicalMode } from '../api/src/lib.mjs'

const models = {
  unet: 'qwen-image.safetensors',
  clip: 'qwen-image-clip.safetensors',
  vae: 'qwen-image-vae.safetensors',
}

const videoModels = {
  unet: 'wan2.1_t2v_1.3B_bf16.safetensors',
  clip: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
  vae: 'Wan2.1_VAE.safetensors',
}

const latentBatch = (workflow) =>
  Object.values(workflow).find((n) => n.class_type === 'EmptySD3LatentImage')?.inputs.batch_size

test('image API exposes batchCount to the graph', () => {
  assert.equal(DEFAULT_SETTINGS.image.batchCount, 1)

  const single = workflowFor('image', { prompt: 'a fox', settings: {}, models })
  assert.equal(latentBatch(single), 1)

  const batch = workflowFor('image', {
    prompt: 'a fox',
    settings: { batchCount: 4 },
    models,
  })
  assert.equal(latentBatch(batch), 4)
})

test('image API clamps an oversized batch', () => {
  const workflow = workflowFor('image', {
    prompt: 'a fox',
    settings: { batchCount: 999 },
    models,
  })
  assert.equal(latentBatch(workflow), 16)
})

test('API discovery exposes game-asset modes and the pbr alias', () => {
  assert.ok(MODES.includes('texture'))
  assert.ok(MODES.includes('flipbook'))
  assert.ok(MODES.includes('material'))
  assert.equal(canonicalMode('pbr'), 'material')
  assert.equal(canonicalMode('TEXTURE'), 'texture')

  const caps = apiCapabilities()
  const texture = caps.modes.find((m) => m.mode === 'texture')
  const material = caps.modes.find((m) => m.mode === 'material')
  assert.equal(texture.modelGroup, 'image')
  assert.equal(texture.defaults.kind, 'texture')
  assert.deepEqual(material.aliases, ['pbr'])
  assert.deepEqual(material.defaults.maps, DEFAULT_SETTINGS.material.maps)
})

test('texture API builds the image stack and keeps sheet metadata', () => {
  const workflow = workflowFor('texture', {
    prompt: 'mossy stone',
    settings: { kind: 'icon', grid: 3, transparent: false },
    models,
  })
  assert.equal(
    Object.values(workflow).find((n) => n.class_type === 'UNETLoader').inputs.unet_name,
    models.unet,
  )
  assert.equal(workflow['60'].inputs.filename_prefix, 'texture/icon')
  assert.equal(workflow['60'].inputs.images[0], '8')
})

test('texture API wraps icon sheets with the local transparency chain', () => {
  const workflow = workflowFor('texture', {
    prompt: 'inventory icons',
    settings: { kind: 'icon', grid: 2, transparent: true },
    models,
  })
  assert.equal(workflow['60'].inputs.images[0], '92')
  assert.equal(workflow['91'].class_type, 'RemoveBackground')
  assert.equal(workflow['91'].inputs.image[0], '8')
})

test('flipbook API uses the Wan T2V stack and snaps frame count', () => {
  const workflow = workflowFor('flipbook', {
    prompt: 'blue fire loop',
    settings: { frames: 20, fps: 12, resolution: 512, transparent: false },
    models: videoModels,
  })
  assert.equal(
    Object.values(workflow).find((n) => n.class_type === 'UNETLoader').inputs.unet_name,
    videoModels.unet,
  )
  assert.equal(workflow['40'].inputs.length, 17)
  assert.equal(workflow.save.inputs.filename_prefix, 'flipbook/frame')
})

test('material API derives and saves the selected PBR maps', () => {
  const workflow = workflowFor('material', {
    prompt: 'rusted steel',
    settings: {
      maps: { basecolor: true, normal: true, roughness: false, metalness: false, height: true },
      tiling: 'horizontal',
    },
    models,
  })
  assert.ok(Object.values(workflow).find((n) => n.class_type === 'DSINE-NormalMapPreprocessor'))
  assert.ok(Object.values(workflow).find((n) => n.class_type === 'MiDaS-DepthMapPreprocessor'))
  assert.equal(workflow.save_basecolor.inputs.filename_prefix, 'material/basecolor')
  assert.equal(workflow.save_normal.inputs.filename_prefix, 'material/normal')
  assert.equal(workflow.save_height.inputs.filename_prefix, 'material/height')
  assert.equal(workflow.save_roughness, undefined)
  assert.equal(workflow.save_metalness, undefined)
})
