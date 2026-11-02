import test from 'node:test'
import assert from 'node:assert/strict'

import {
  familyForRun,
  familyLabel,
  getLoadedFamily,
  setLoadedFamily,
} from '../src/lib/modelFamily.js'

const graph = (unet) => ({
  '37': { class_type: 'UNETLoader', inputs: { unet_name: unet } },
})

test('same image-mode family reuses weights across image/prompt flavours', () => {
  const image = familyForRun({ mode: 'image' }, { workflow: graph('qwen.safetensors') })
  const edit = familyForRun({ mode: 'edit' }, { workflow: graph('qwen.safetensors') })
  const parts = familyForRun({ mode: 'parts' }, { workflow: graph('qwen.safetensors') })
  assert.equal(image, edit)
  assert.equal(image, parts)
})

test('a different UNET or a different mode is a different family', () => {
  const qwen = familyForRun({ mode: 'image' }, { workflow: graph('qwen.safetensors') })
  const other = familyForRun({ mode: 'image' }, { workflow: graph('sdxl.safetensors') })
  const video = familyForRun({ mode: 'video' }, { workflow: graph('wan.safetensors') })
  assert.notEqual(qwen, other)
  assert.notEqual(qwen, video)
})

test('checkpoint graphs and character chains are tracked separately', () => {
  const sfx = familyForRun(
    { mode: 'sfx' },
    {
      workflow: {
        '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'stable_audio.safetensors' } },
      },
    },
  )
  assert.match(sfx, /^sfx:ckpt:stable_audio/)
  const chain = familyForRun(
    { mode: 'sprite', models: { character: { unet: 'wan22.safetensors' } } },
    { chainPlan: { phase: 'keyframe' } },
  )
  assert.equal(chain, 'character:wan22.safetensors')
})

test('loaded family tracker stores the last queued family', () => {
  setLoadedFamily('image:unet:qwen.safetensors')
  assert.equal(getLoadedFamily(), 'image:unet:qwen.safetensors')
  setLoadedFamily('')
  assert.equal(getLoadedFamily(), '')
  assert.equal(familyLabel('video:unet:wan'), 'video models')
  assert.equal(familyLabel('character:wan'), 'character animation models')
})
