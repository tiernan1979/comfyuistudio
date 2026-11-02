import test from 'node:test'
import assert from 'node:assert/strict'

import { workflowFor, DEFAULT_SETTINGS } from '../api/src/lib.mjs'

const models = {
  unet: 'qwen-image.safetensors',
  clip: 'qwen-image-clip.safetensors',
  vae: 'qwen-image-vae.safetensors',
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
