import test from 'node:test'
import assert from 'node:assert/strict'

import { migrate, partialize, STORAGE_VERSION } from '../src/store/persist.js'
import { resolvePresetModels } from '../src/store/helpers.js'
import { DEFAULT_MODELS, DEFAULT_PRESETS, DEFAULT_ACTIVE } from '../src/store/defaults.js'
import { AUTOSPLIT_LABEL_PRESETS } from '../src/lib/workflows.js'

test('migrate seeds a fresh save from the defaults', () => {
  const s = migrate({})
  assert.equal(typeof STORAGE_VERSION, 'number')
  assert.deepEqual(Object.keys(s.models).sort(), Object.keys(DEFAULT_MODELS).sort())
  assert.deepEqual(Object.keys(s.llmConfigs).sort(), ['anthropic', 'custom', 'lmstudio', 'openai'])
  assert.equal(typeof s.active, 'object')
  assert.ok(s.splitSettings.labels.includes(AUTOSPLIT_LABEL_PRESETS.anatomy[0]))
  assert.ok(Array.isArray(s.presets.sfx) && s.presets.sfx.length > 0)
})

test('migrate merges a saved model group under the new defaults', () => {
  const s = migrate({ models: { image: { unet: 'custom.safetensors' } } })
  assert.equal(s.models.image.unet, 'custom.safetensors')
  assert.equal(s.models.image.clip, DEFAULT_MODELS.image.clip)
})

test('migrate drops pre-v5 stable-audio music presets and keeps sfx presets', () => {
  const s = migrate({
    presets: {
      music: [{ name: 'SA', engine: 'stable_audio' }, { name: 'ACE', engine: 'ace' }],
      sfx: [],
    },
  })
  assert.deepEqual(
    s.presets.music.map((p) => p.name),
    ['ACE'],
  )
  assert.deepEqual(s.presets.sfx, DEFAULT_PRESETS.sfx)
})

test('migrate clamps an out-of-range active preset index', () => {
  const s = migrate({ active: { ...DEFAULT_ACTIVE, music: 99 } })
  const list = DEFAULT_PRESETS.music
  assert.equal(s.active.music, list.length > 0 ? 0 : null)
})

test('preflight resolves the active video preset over the flat group', () => {
  const state = {
    models: { video: { unet: 'wan2.1_t2v_1.3B_bf16.safetensors' } },
    presets: {
      video: [
        {
          name: 'MiniMax H3',
          unet: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
          clip: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
          vae: 'minimax_h3_video_vae_fp16.safetensors',
        },
      ],
    },
    active: { video: 0 },
  }
  const resolved = resolvePresetModels(state)
  assert.equal(resolved.video.unet, 'minimax_h3_fl2va_pruned_int8_convrot.safetensors')
  assert.equal(resolved.video.clip, 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors')
  // Flat fields absent from the preset still fall through.
  assert.equal(resolved.video.lora, undefined)
})

test('preflight falls back to the flat group with no active preset', () => {
  const flat = 'wan2.1_t2v_1.3B_bf16.safetensors'
  const resolved = resolvePresetModels({
    models: { video: { unet: flat } },
    presets: { video: [] },
    active: { video: null },
  })
  assert.equal(resolved.video.unet, flat)
})

test('partialize keeps settings and drops transient run state', () => {
  const state = {
    serverUrl: 'http://x:8188',
    editSettings: { steps: 4 },
    history: [{ id: 'a' }],
    generating: true,
    progress: 42,
    showSettings: true,
    previewImage: 'blob:123',
  }
  const saved = partialize(state)
  assert.equal(saved.editSettings.steps, 4)
  assert.equal(saved.serverUrl, 'http://x:8188')
  assert.deepEqual(saved.history, [{ id: 'a' }])
  assert.equal('generating' in saved, false)
  assert.equal('progress' in saved, false)
  assert.equal('showSettings' in saved, false)
  assert.equal('previewImage' in saved, false)
})
