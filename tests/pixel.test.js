import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PIXEL_NEGATIVE,
  buildPixelArtWorkflow,
  pixelAssetPrompt,
} from '../src/lib/workflows/pixel.js'

const MODELS = { ckpt: 'sd_xl_base_1.0_0.9vae.safetensors', lora: 'pixel-art-xl.safetensors' }

const node = (wf, type) => Object.values(wf).find((n) => n.class_type === type)

test('pixel prompt gets the 16-bit suffix once', () => {
  const prompt = pixelAssetPrompt('grass and dirt terrain tileset')
  assert.match(prompt, /^pixel art 2D game asset of grass and dirt terrain tileset/)
  assert.match(prompt, /16-bit/)
  assert.equal(pixelAssetPrompt(prompt), prompt)
})

test('pixel workflow loads SDXL + Pixel Art XL and samples from the LoRA', () => {
  const wf = buildPixelArtWorkflow({
    prompt: 'mossy stone tiles',
    size: 1024,
    seed: 123,
    steps: 30,
    cfg: 7,
    models: MODELS,
  })
  assert.equal(node(wf, 'CheckpointLoaderSimple').inputs.ckpt_name, MODELS.ckpt)
  assert.equal(node(wf, 'LoraLoaderModelOnly').inputs.lora_name, MODELS.lora)
  assert.deepEqual(node(wf, 'KSampler').inputs.model, ['2', 0])
  assert.equal(node(wf, 'EmptyLatentImage').inputs.width, 1024)
  assert.equal(node(wf, 'EmptyLatentImage').inputs.height, 1024)
  assert.equal(node(wf, 'KSampler').inputs.seed, 123)
})

test('pixel workflow omits the LoRA when none is configured', () => {
  const wf = buildPixelArtWorkflow({
    prompt: 'grass tile',
    models: { ckpt: MODELS.ckpt, lora: '' },
  })
  assert.equal(node(wf, 'LoraLoaderModelOnly'), undefined)
  assert.deepEqual(node(wf, 'KSampler').inputs.model, ['1', 0])
})

test('pixel workflow clamps size, batch, seed and uses the default negative', () => {
  const wf = buildPixelArtWorkflow({
    prompt: 'lava rock',
    size: 2000,
    seed: -1,
    batchSize: 99,
    models: MODELS,
  })
  assert.equal(node(wf, 'EmptyLatentImage').inputs.width, 1536)
  assert.equal(node(wf, 'EmptyLatentImage').inputs.batch_size, 16)
  assert.ok(Number.isFinite(node(wf, 'KSampler').inputs.seed))
  assert.equal(node(wf, 'CLIPTextEncode').inputs.text !== undefined, true)
  assert.equal(
    Object.values(wf).filter((n) => n.class_type === 'CLIPTextEncode')[1].inputs.text,
    PIXEL_NEGATIVE,
  )
})
