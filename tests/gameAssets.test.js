import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildTextureWorkflow,
  textureAssetPrompt,
} from '../src/lib/workflows/texture.js'
import { buildFlipbookWorkflow, flipbookPrompt } from '../src/lib/workflows/flipbook.js'
import { buildMaterialWorkflow, MATERIAL_NODES, materialPrompt } from '../src/lib/workflows/material.js'
import { describeQueuePrompt } from '../src/lib/comfyui/queueLabel.js'

const imageModels = {
  unet: 'qwen.safetensors',
  clip: 'qwen-clip.safetensors',
  vae: 'qwen-vae.safetensors',
}
const videoModels = {
  unet: 'wan.safetensors',
  clip: 'umt5.safetensors',
  vae: 'wan-vae.safetensors',
}

const node = (workflow, cls) =>
  Object.values(workflow).find((n) => n.class_type === cls)

test('texture prompt frames a tileable material', () => {
  const text = textureAssetPrompt('mossy stone wall', { kind: 'texture', seamless: true })
  assert.match(text, /seamless tileable/i)
  assert.match(text, /mossy stone wall/)
  const tiles = textureAssetPrompt('forest floor', { kind: 'tileset', grid: 3 })
  assert.match(tiles, /3x3 equal/i)
})

test('texture workflow uses the image stack, batch and texture prefix', () => {
  const wf = buildTextureWorkflow({
    prompt: 'mossy stone wall',
    kind: 'tileset',
    grid: 2,
    batchSize: 4,
    size: 1000,
    models: imageModels,
  })
  assert.equal(node(wf, 'EmptySD3LatentImage').inputs.batch_size, 4)
  assert.equal(node(wf, 'EmptySD3LatentImage').inputs.width, 1024)
  assert.equal(node(wf, 'SaveImage').inputs.filename_prefix, 'texture/tileset')
  assert.match(node(wf, 'CLIPTextEncode').inputs.text, /tileset sheet/i)
})

test('icon and terrain prompts describe their sheet layouts', () => {
  const icon = textureAssetPrompt('fantasy RPG potions', { kind: 'icon', grid: 3 })
  assert.match(icon, /3x3 equal square cells/i)
  assert.match(icon, /one centered icon per cell/i)
  assert.match(icon, /flat white background/i)
  const terrain = textureAssetPrompt('grass to dirt', { kind: 'terrain', grid: 4 })
  assert.match(terrain, /4x4/i)
  assert.match(terrain, /transition/i)
})

test('transparent icon packs cut the sheet with BiRefNet', () => {
  const wf = buildTextureWorkflow({
    prompt: 'RPG inventory icons',
    kind: 'icon',
    grid: 2,
    transparent: true,
    models: imageModels,
  })
  assert.ok(node(wf, 'LoadBackgroundRemovalModel'))
  assert.ok(node(wf, 'RemoveBackground'))
  assert.ok(node(wf, 'JoinImageWithAlpha'))
  assert.equal(node(wf, 'SaveImage').inputs.filename_prefix, 'texture/icon')
  assert.deepEqual(node(wf, 'SaveImage').inputs.images, ['92', 0])
  assert.match(node(wf, 'CLIPTextEncode').inputs.text, /icon sheet/i)
})

test('icon packs skip background removal when transparency is off', () => {
  const wf = buildTextureWorkflow({
    prompt: 'RPG inventory icons',
    kind: 'icon',
    transparent: false,
    models: imageModels,
  })
  assert.equal(node(wf, 'LoadBackgroundRemovalModel'), undefined)
  assert.deepEqual(node(wf, 'SaveImage').inputs.images, ['8', 0])
})

test('terrain sheets use their own save prefix and grid prompt', () => {
  const wf = buildTextureWorkflow({
    prompt: 'grass to dirt',
    kind: 'terrain',
    grid: 4,
    models: imageModels,
  })
  assert.equal(node(wf, 'SaveImage').inputs.filename_prefix, 'texture/terrain')
  assert.match(node(wf, 'CLIPTextEncode').inputs.text, /4x4/i)
})

test('flipbook keeps transparent frames and snaps the WAN frame count', () => {
  const wf = buildFlipbookWorkflow({
    prompt: 'orange explosion',
    frames: 18,
    models: videoModels,
  })
  assert.equal(node(wf, 'EmptyHunyuanLatentVideo').inputs.length, 17)
  assert.ok(node(wf, 'LoadBackgroundRemovalModel'))
  assert.ok(node(wf, 'RemoveBackground'))
  assert.ok(node(wf, 'JoinImageWithAlpha'))
  assert.equal(node(wf, 'SaveImage').inputs.filename_prefix, 'flipbook/frame')
  assert.match(node(wf, 'CLIPTextEncode').inputs.text, /explosion/)
})

test('flipbook can skip background removal', () => {
  const wf = buildFlipbookWorkflow({
    prompt: 'fire',
    transparent: false,
    models: videoModels,
  })
  assert.equal(node(wf, 'LoadBackgroundRemovalModel'), undefined)
  assert.deepEqual(node(wf, 'SaveImage').inputs.images, ['8', 0])
})

test('local material prompt asks for a seamless albedo surface', () => {
  const text = materialPrompt('rusted steel', { tiling: 'horizontal' })
  assert.match(text, /base color texture/i)
  assert.match(text, /seamless left-to-right/i)
  assert.match(text, /no perspective/i)
  assert.ok(MATERIAL_NODES.includes('DSINE-NormalMapPreprocessor'))
  assert.ok(MATERIAL_NODES.includes('MiDaS-DepthMapPreprocessor'))
})

test('local material graph derives and saves the selected PBR maps', () => {
  const { workflow, maps } = buildMaterialWorkflow({
    prompt: 'rusted steel',
    maps: { basecolor: true, normal: true, roughness: true, metalness: false, height: true },
    size: '1:1 (1024x1024)',
    tiling: 'horizontal',
    steps: 6,
    cfg: 4,
    models: imageModels,
  })
  assert.equal(node(workflow, 'UNETLoader').inputs.unet_name, imageModels.unet)
  assert.ok(node(workflow, 'DSINE-NormalMapPreprocessor'))
  assert.ok(node(workflow, 'MiDaS-DepthMapPreprocessor'))
  assert.ok(node(workflow, 'ImageRGBToYUV'))
  assert.equal(node(workflow, 'EmptyImage'), undefined)
  assert.deepEqual(maps, ['basecolor', 'normal', 'roughness', 'height'])
  assert.equal(workflow.save_basecolor.inputs.filename_prefix, 'material/basecolor')
  assert.equal(workflow.save_normal.inputs.filename_prefix, 'material/normal')
  assert.equal(workflow.save_roughness.inputs.filename_prefix, 'material/roughness')
  assert.equal(workflow.save_height.inputs.filename_prefix, 'material/height')
  assert.equal(workflow.save_metalness, undefined)
  assert.match(node(workflow, 'CLIPTextEncode').inputs.text, /rusted steel/i)
})

test('local material graph renders a uniform metalness map when enabled', () => {
  const { workflow } = buildMaterialWorkflow({
    prompt: 'polished chrome',
    maps: { basecolor: true, normal: false, roughness: false, metalness: true, height: false },
    metallic: 100,
    models: imageModels,
  })
  assert.equal(node(workflow, 'DSINE-NormalMapPreprocessor'), undefined)
  assert.equal(node(workflow, 'EmptyImage').inputs.color, 0xffffff)
  assert.equal(workflow.save_metalness.inputs.filename_prefix, 'material/metalness')
  assert.equal(workflow.save_basecolor.inputs.filename_prefix, 'material/basecolor')
})

test('material graph rejects an empty map selection', () => {
  assert.throws(
    () =>
      buildMaterialWorkflow({
        prompt: 'x',
        maps: {
          basecolor: false,
          normal: false,
          roughness: false,
          metalness: false,
          height: false,
        },
        models: imageModels,
      }),
    /at least one/i,
  )
})

test('queue labels identify flipbook, texture and material jobs', () => {
  assert.equal(
    describeQueuePrompt({ '1': { class_type: 'SaveImage', inputs: { filename_prefix: 'flipbook/frame' } } }).label,
    'Flipbook',
  )
  assert.equal(
    describeQueuePrompt({ '1': { class_type: 'SaveImage', inputs: { filename_prefix: 'texture/material' } } }).label,
    'Texture',
  )
  const material = describeQueuePrompt({
    '1': { class_type: 'SaveImage', inputs: { filename_prefix: 'material/basecolor' } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: 'rusted steel plates' } },
  })
  assert.equal(material.label, 'Material')
  assert.equal(material.snippet, 'rusted steel plates')
})
