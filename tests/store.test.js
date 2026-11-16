import test from 'node:test'
import assert from 'node:assert/strict'

import { migrate, partialize, STORAGE_VERSION } from '../src/store/persist.js'
import { resolvePresetModels } from '../src/store/helpers.js'
import { applyServerConfig } from '../src/store/configSync.js'
import { createHistoryActions } from '../src/store/historyActions.js'
import { DEFAULT_MODELS, DEFAULT_PRESETS, DEFAULT_ACTIVE } from '../src/store/defaults.js'
import { AUTOSPLIT_LABEL_PRESETS } from '../src/lib/workflows.js'

function historyStore(initial = {}) {
  let state = {
    history: [],
    hiddenHistoryIds: [],
    deletedUrls: [],
    selectedHistoryId: null,
    outputImage: null,
    outputVideo: null,
    outputAudio: null,
    ...initial,
  }
  const set = (patch) => {
    state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
  }
  const get = () => state
  return { actions: createHistoryActions(set, get), get: () => state }
}

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

test('migrate turns a saved flat image stack into an active preset', () => {
  const s = migrate({ models: { image: { unet: 'custom-qwen.safetensors' } } })
  assert.equal(s.presets.image[0].unet, 'custom-qwen.safetensors')
  assert.equal(s.active.image, 0)
  assert.ok(s.presets.image.some((p) => /2\.1/.test(p.unet)))
})

test('preflight resolves the active image preset over the flat group', () => {
  const resolved = resolvePresetModels({
    models: { image: { unet: 'flat.safetensors', clip: 'flat-clip.safetensors' } },
    presets: {
      image: [{ name: 'Preset', unet: 'preset.safetensors', clip: 'preset-clip.safetensors' }],
    },
    active: { image: 0 },
  })
  assert.equal(resolved.image.unet, 'preset.safetensors')
  assert.equal(resolved.image.clip, 'preset-clip.safetensors')
})

test('server config without image presets falls back to its flat image group', () => {
  let state = {
    models: { image: { unet: 'local.safetensors' } },
    presets: { image: [{ name: 'Local', unet: 'local.safetensors' }] },
    active: { image: 0 },
    llmConfigs: {},
  }
  const set = (patch) => {
    state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
  }
  applyServerConfig(
    set,
    {
      synced: true,
      models: { image: { unet: 'server.safetensors', clip: 'server-clip.safetensors' } },
    },
    { force: true },
  )
  assert.equal(state.models.image.unet, 'server.safetensors')
  assert.equal(state.active.image, null)
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

test('history delete keeps a string id and blocks the next server merge', () => {
  const store = historyStore({ history: [{ id: 'abc', data: '/view/abc.png' }] })
  store.actions.removeFromHistory('abc')
  assert.deepEqual(store.get().hiddenHistoryIds, ['abc'])
  assert.equal(store.get().history.length, 0)

  // Server history can echo a just-deleted entry; it must stay gone.
  store.actions.mergeServerHistory([{ id: 'abc', data: '/view/abc.png' }])
  assert.equal(store.get().history.length, 0)
})

test('history delete normalises numeric ids against string server ids', () => {
  const store = historyStore({ history: [{ id: 123, data: '/view/123.png' }] })
  store.actions.removeFromHistory(123)
  assert.deepEqual(store.get().hiddenHistoryIds, ['123'])

  store.actions.mergeServerHistory([{ id: '123', data: '/view/123.png' }])
  assert.equal(store.get().history.length, 0)
})

test('a late completion cannot re-add a deleted history entry', () => {
  const store = historyStore({ hiddenHistoryIds: ['abc'] })
  store.actions.addToHistory({ id: 'abc', data: '/view/abc.png' })
  assert.equal(store.get().history.length, 0)
})

test('clearHistory stores hidden ids as strings', () => {
  const store = historyStore({
    history: [{ id: 1, data: '/view/1.png' }, { id: 2, data: '/view/2.png' }],
    hiddenHistoryIds: [3],
  })
  store.actions.clearHistory()
  assert.deepEqual(store.get().hiddenHistoryIds, ['3', '1', '2'])
})
