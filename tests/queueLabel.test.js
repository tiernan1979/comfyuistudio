import test from 'node:test'
import assert from 'node:assert/strict'

import { describeQueuePrompt } from '../src/lib/comfyui/queueLabel.js'

const graph = (nodes) => nodes

test('labels a plain text-to-image graph and shortens the positive prompt', () => {
  const g = graph({
    '3': { class_type: 'KSampler', inputs: { positive: ['6', 0], negative: ['7', 0] } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: 'a lone lighthouse on a rocky cliff at sunset' } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, watermark' } },
    '58': { class_type: 'EmptySD3LatentImage', inputs: {} },
  })
  const out = describeQueuePrompt(g)
  assert.equal(out.label, 'Image')
  assert.equal(out.snippet, 'a lone lighthouse on a rocky…')
  assert.match(out.text, /lighthouse/)
  assert.doesNotMatch(out.snippet, /blurry/)
})

test('follows the wiring to the positive prompt, not the first text node', () => {
  const g = graph({
    '6': { class_type: 'CLIPTextEncode', inputs: { text: 'negative filler words here' } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: 'the real positive description' } },
    '3': { class_type: 'KSampler', inputs: { positive: ['7', 0], negative: ['6', 0] } },
  })
  assert.equal(describeQueuePrompt(g).snippet, 'the real positive description')
})

test('detects the pipeline from distinctive node classes', () => {
  assert.equal(describeQueuePrompt(graph({ '1': { class_type: 'SaveVideo', inputs: {} } })).label, 'Video')
  assert.equal(
    describeQueuePrompt(graph({ '1': { class_type: 'EmptyMiniMaxMusic3LatentAudio', inputs: {} } })).label,
    'Music',
  )
  assert.equal(
    describeQueuePrompt(graph({ '1': { class_type: 'ConditioningStableAudio', inputs: {} } })).label,
    'SFX',
  )
  assert.equal(describeQueuePrompt(graph({ '1': { class_type: 'SaveGLB', inputs: {} } })).label, '3D')
  assert.equal(
    describeQueuePrompt(graph({ '1': { class_type: 'LoadImageMask', inputs: {} }, '2': { class_type: 'CLIPTextEncode', inputs: { text: 'x' } } })).label,
    'Image edit',
  )
  assert.equal(
    describeQueuePrompt(graph({ '1': { class_type: 'MediaPipeFaceLandmarker', inputs: {} } })).label,
    'Sprite',
  )
})

test('an unknown graph degrades gracefully', () => {
  const out = describeQueuePrompt(graph({ '1': { class_type: 'SomeCustomNode', inputs: {} } }))
  assert.equal(out.label, 'Unknown')
  assert.equal(out.snippet, '')
})
