import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildTextureWorkflow,
  textureAssetPrompt,
  textureNegative,
} from '../src/lib/workflows/texture.js'
import { buildFlipbookWorkflow, flipbookPrompt } from '../src/lib/workflows/flipbook.js'
import {
  buildH3ImageWorkflow,
  H3_IMAGE_NODES,
  H3_IMAGE_SIZES,
  isH3ImageModel,
  isH3ImageClip,
  isH3ImageVae,
} from '../src/lib/workflows/h3image.js'
import { buildMaterialWorkflow, MATERIAL_NODES, materialPrompt } from '../src/lib/workflows/material.js'
import { describeQueuePrompt } from '../src/lib/comfyui/queueLabel.js'
import { resolveWanVideoModels } from '../src/lib/comfyui/models.js'

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

test('MiniMax H3 Image graph uses its own stack and a fixed 6-step schedule', () => {
  const wf = buildH3ImageWorkflow({
    prompt: 'a small clay dragon on a desk',
    size: 1024,
    seed: 7,
    models: {
      unet: 'minimax_h3_image_pruned_w4a8.safetensors',
      clip: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
      vae: 'minimax_h3_image_vae_fp16.safetensors',
    },
  })
  assert.equal(node(wf, 'UNETLoader').inputs.unet_name, 'minimax_h3_image_pruned_w4a8.safetensors')
  assert.equal(node(wf, 'CLIPLoader').inputs.type, 'minimax')
  assert.equal(node(wf, 'VAELoader').inputs.vae_name, 'minimax_h3_image_vae_fp16.safetensors')
  const conditioning = node(wf, 'MiniMaxH3ImageConditioning')
  assert.equal(conditioning.inputs.width, 1024)
  assert.equal(conditioning.inputs.height, 1024)
  assert.equal(conditioning.inputs.prompt, 'a small clay dragon on a desk')
  const sampler = node(wf, 'KSampler')
  assert.equal(sampler.inputs.steps, 6)
  assert.equal(sampler.inputs.cfg, 1)
  assert.equal(sampler.inputs.sampler_name, 'euler')
  assert.equal(sampler.inputs.scheduler, 'simple')
  assert.deepEqual(node(wf, 'ConditioningZeroOut').inputs.conditioning, ['6', 0])
  assert.equal(node(wf, 'SaveImage').inputs.filename_prefix, 'h3image/image')
})

test('H3 image nodes and sizes are declared for the UI', () => {
  assert.deepEqual(H3_IMAGE_NODES, ['MiniMaxH3ImageConditioning'])
  assert.deepEqual(H3_IMAGE_SIZES, [1024, 2048, 3072, 4096])
})

test('H3 image accepts independent width and height on a 32px grid', () => {
  const wf = buildH3ImageWorkflow({
    prompt: 'wide mountain valley',
    width: 1328,
    height: 928,
    seed: 1,
    models: {
      unet: 'minimax_h3_image_pruned_w4a8.safetensors',
      clip: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
      vae: 'minimax_h3_image_vae_fp16.safetensors',
    },
  })
  const conditioning = node(wf, 'MiniMaxH3ImageConditioning')
  assert.equal(conditioning.inputs.width, 1344)
  assert.equal(conditioning.inputs.height, 928)
})

test('H3 image model helpers identify the MiniMax stack', () => {
  assert.equal(isH3ImageModel('minimax_h3_image_pruned_w4a8.safetensors'), true)
  assert.equal(isH3ImageModel('qwen_image_2.1_int8_convrot.safetensors'), false)
  assert.equal(isH3ImageClip('qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors'), true)
  assert.equal(isH3ImageClip('qwen3vl_8b_w4a8.safetensors'), false)
  assert.equal(isH3ImageVae('minimax_h3_image_vae_fp16.safetensors'), true)
  assert.equal(isH3ImageVae('minimax_h3_video_vae_fp16.safetensors'), false)
})

test('texture prompt frames a tileable material', () => {
  const text = textureAssetPrompt('mossy stone wall', { kind: 'texture', seamless: true })
  assert.match(text, /seamless tileable/i)
  assert.match(text, /mossy stone wall/)
  const tiles = textureAssetPrompt('forest floor', { kind: 'tileset', grid: 3 })
  assert.match(tiles, /3x3 equal/i)
})

test('seamless texture strips sheet/variant wording that causes a framed board', () => {
  const text = textureAssetPrompt(
    'seamless tileable game texture of pixel art dirt block tile sheet, 16x16 style, 4 variants, earthy brown, seamless, top-down orthographic, edge-to-edge pattern, no perspective, no border, flat even lighting, high detail, game-ready material',
    { kind: 'texture' },
  )
  assert.match(text, /one continuous material/i)
  assert.match(text, /pixel art dirt block/i)
  const subject = text.split(', one continuous material')[0]
  assert.doesNotMatch(subject, /tile sheet|variants/i)
  assert.doesNotMatch(text, /4 variants/i)
  assert.doesNotMatch(text, / ,/)
  assert.match(textureNegative('texture'), /lighter border/i)
  assert.match(textureNegative('texture'), /darker center/i)
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

test('flipbook model resolution prefers a Wan T2V checkpoint over H3 and GGUF', () => {
  const lists = {
    unet: [
      'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
      'wan2.2_i2v_A14b_high_noise_lightx2v_4step-Q4_K_M.gguf',
      'wan2.1_t2v_1.3B_bf16.safetensors',
    ],
    clip: ['qwen3vl_8b_w4a8.safetensors', 'umt5_xxl_fp8_e4m3fn_scaled.safetensors'],
    vae: ['minimax_h3_video_vae_fp16.safetensors', 'Wan2.1_VAE.safetensors'],
  }
  const out = resolveWanVideoModels(
    lists,
    {
      unet: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
      clip: 'qwen3vl_8b_w4a8.safetensors',
      vae: 'minimax_h3_video_vae_fp16.safetensors',
    },
    { requireT2V: true },
  )
  assert.equal(out.unet, 'wan2.1_t2v_1.3B_bf16.safetensors')
  assert.equal(out.clip, 'umt5_xxl_fp8_e4m3fn_scaled.safetensors')
  assert.equal(out.vae, 'Wan2.1_VAE.safetensors')
})

test('flipbook model resolution names the missing T2V checkpoint', () => {
  const lists = {
    unet: ['wan2.2_i2v_A14b_high_noise_lightx2v_4step-Q4_K_M.gguf'],
    clip: ['umt5_xxl_fp8_e4m3fn_scaled.safetensors'],
    vae: ['Wan2.1_VAE.safetensors'],
  }
  assert.throws(
    () => resolveWanVideoModels(lists, {}, { requireT2V: true }),
    /wan2\.1_t2v_1\.3B/i,
  )
})
