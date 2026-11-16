// Zustand persist config: what survives reloads, and how old saves are
// upgraded to the current shape.

import {
  DEFAULT_LLM_CONFIGS,
  DEFAULT_MODELS,
  DEFAULT_PRESETS,
  DEFAULT_SPRITE_SETTINGS,
  DEFAULT_IMAGE_SETTINGS,
  DEFAULT_PIXEL_SETTINGS,
  DEFAULT_TEXTURE_SETTINGS,
  DEFAULT_FLIPBOOK_SETTINGS,
  DEFAULT_MATERIAL_SETTINGS,
  DEFAULT_SPLIT_SETTINGS,
  DEFAULT_PARTS_SETTINGS,
  DEFAULT_ACTIVE,
} from './defaults.js'
import { AUTOSPLIT_LABEL_PRESETS } from '../lib/workflows.js'

export const STORAGE_KEY = 'comfyui-studio-storage'
export const STORAGE_VERSION = 16

// v0/v1 stored a flat llmUrl/llmModel (Ollama era: port 11434 + "name:tag"
// ids). Fold them into the v2 per-provider config.
// v3 merges model groups against DEFAULT_MODELS so browsers saved before a
// group existed (music) get its defaults.
// v6 re-runs that merge (character group) and merges spriteSettings against
// DEFAULT_SPRITE_SETTINGS — the shallow persist merge replaces nested objects
// wholesale, so saved sprites settings predate the engine/videoFrames/videoRes
// fields.
// v7 adds the image/split/parts settings merge and refreshes the untouched
// anatomy split preset (elbow/knee limb segments).
// v8 merges editSettings (mask denoise) and imageSettings (batchCount) and
// adds the imported-workflow settings.
// v9 adds the H3 per-window length (windowSeconds) — the old 56-frame
// windows were outside the model's trained range and drifted.
// v10 adds the persisted episode shot list (long-form video projects).
// v11 merges the sprite expression fields (expression/animExpressions/
// frameExpressions/expressionRows) — the DEFAULT_SPRITE_SETTINGS merge below
// already supplies them, but the version bump marks saves that need it.
// v12 merges the Character Parts view direction (front/side/threeQuarter/
// back) via the partsSettings defaults merge below.
// v13 adds the Pixel Art settings/model group (SDXL + Pixel Art XL).
// v14 adds the Game Assets groups (texture/flipbook/material) — merged against
// their defaults because the shallow persist merge would drop nested map flags.
// v15 replaces the Patina-material fields with local PBR fields (cfg, metallic,
// roughness) and drops the old cloud-only upscale/promptExpansion keys.
// v16 adds image-model presets. Older saves get their current flat image stack
// copied into a "current" preset so upgrading does not change which files the
// image/texture/material modes load.
export function migrate(persisted) {
  const s = { ...persisted }

  if (s.llmConfigs) {
    const merged = {}
    for (const k of Object.keys(DEFAULT_LLM_CONFIGS)) {
      merged[k] = { ...DEFAULT_LLM_CONFIGS[k], ...(s.llmConfigs[k] || {}) }
    }
    s.llmConfigs = merged
  } else if (s.llmUrl !== undefined || s.llmModel !== undefined) {
    let url = s.llmUrl
    let model = s.llmModel
    if (url && url.includes(':11434')) {
      // was pointing at Ollama — start fresh on LM Studio defaults
      url = DEFAULT_LLM_CONFIGS.lmstudio.url
      model = ''
    }
    s.llmConfigs = {
      ...DEFAULT_LLM_CONFIGS,
      lmstudio: { url: url || DEFAULT_LLM_CONFIGS.lmstudio.url, model: model || '' },
    }
  } else {
    s.llmConfigs = { ...DEFAULT_LLM_CONFIGS }
  }
  delete s.llmUrl
  delete s.llmModel

  const modelGroups = {}
  for (const k of new Set([...Object.keys(DEFAULT_MODELS), ...Object.keys(s.models || {})])) {
    modelGroups[k] = { ...DEFAULT_MODELS[k], ...(s.models?.[k] || {}) }
  }
  s.models = modelGroups

  // Image presets arrived after the flat image group. Treat the files already
  // in use as the first preset so an upgrade keeps the same working stack.
  const hadImagePresets =
    Array.isArray(persisted?.presets?.image) && persisted.presets.image.length > 0

  // Named model presets (multi-model picker). Older saves won't have
  // them — seed from defaults and merge any existing entries.
  const presetGroups = {}
  for (const k of new Set([...Object.keys(DEFAULT_PRESETS), ...Object.keys(s.presets || {})])) {
    presetGroups[k] = s.presets?.[k]?.length ? s.presets[k] : DEFAULT_PRESETS[k]
  }
  if (!hadImagePresets) {
    const current = s.models.image || {}
    presetGroups.image = [
      {
        ...current,
        name: /2\.1/i.test(current.unet || '') ? 'Qwen-Image 2.1' : 'Qwen-Image',
      },
      ...(DEFAULT_PRESETS.image || []).filter((p) => p.unet !== current.unet),
    ]
  }
  // v5: Stable Audio 3 moved out of the Music engine list into its own
  // SFX mode. Drop any stable_audio engine preset an earlier build
  // seeded into `music`, and make sure the SFX presets exist.
  if (Array.isArray(presetGroups.music)) {
    presetGroups.music = presetGroups.music.filter((p) => p?.engine !== 'stable_audio')
  }
  if (!Array.isArray(presetGroups.sfx) || presetGroups.sfx.length === 0) {
    presetGroups.sfx = DEFAULT_PRESETS.sfx
  }
  s.presets = presetGroups

  if (!s.active || typeof s.active !== 'object') {
    s.active = { ...DEFAULT_ACTIVE }
  } else {
    if (s.active.sfx == null && (presetGroups.sfx || []).length > 0) s.active.sfx = 0
    // Clamp out-of-range indices (e.g. a preset was removed elsewhere).
    for (const k of Object.keys(DEFAULT_PRESETS)) {
      const list = presetGroups[k] || []
      if (s.active[k] != null && (s.active[k] < 0 || s.active[k] >= list.length)) {
        s.active[k] = list.length > 0 ? 0 : null
      }
    }
  }

  if (!hadImagePresets) s.active.image = 0

  // Sprite settings saved before the video engine existed (v6): layer
  // the new fields (engine/videoFrames/videoRes) under the old values.
  s.spriteSettings = { ...DEFAULT_SPRITE_SETTINGS, ...(s.spriteSettings || {}) }
  // v7: custom image size + the split/parts settings (nested objects are
  // replaced wholesale by the shallow persist merge).
  s.imageSettings = { ...(DEFAULT_IMAGE_SETTINGS || {}), ...(s.imageSettings || {}) }
  s.pixelSettings = { ...DEFAULT_PIXEL_SETTINGS, ...(s.pixelSettings || {}) }
  s.textureSettings = { ...DEFAULT_TEXTURE_SETTINGS, ...(s.textureSettings || {}) }
  s.flipbookSettings = { ...DEFAULT_FLIPBOOK_SETTINGS, ...(s.flipbookSettings || {}) }
  s.materialSettings = {
    ...DEFAULT_MATERIAL_SETTINGS,
    ...(s.materialSettings || {}),
    maps: { ...DEFAULT_MATERIAL_SETTINGS.maps, ...(s.materialSettings?.maps || {}) },
  }
  // Patina-era fields no longer exist; do not persist stale cloud settings.
  delete s.materialSettings.upscale
  delete s.materialSettings.promptExpansion
  s.editSettings = {
    seed: -1,
    steps: 20,
    cfg: 2.5,
    denoise: 1,
    ...(s.editSettings || {}),
  }
  s.customSettings = { seed: -1, ...(s.customSettings || {}) }
  s.videoSettings = { windowSeconds: 5.2, ...(s.videoSettings || {}) }
  s.episodeShots = Array.isArray(s.episodeShots) ? s.episodeShots : []
  s.splitSettings = { ...DEFAULT_SPLIT_SETTINGS, ...(s.splitSettings || {}) }
  s.partsSettings = { ...DEFAULT_PARTS_SETTINGS, ...(s.partsSettings || {}) }
  // The labels textarea flips labelPreset to 'custom' on edit, so
  // 'anatomy' still means "untouched default" and can be refreshed to
  // pick up the elbow/knee limb labels.
  if (s.splitSettings.labelPreset === 'anatomy') {
    s.splitSettings = {
      ...s.splitSettings,
      labels: AUTOSPLIT_LABEL_PRESETS.anatomy.join('\n'),
    }
  }
  return s
}

export function partialize(state) {
  return {
    serverUrl: state.serverUrl,
    useProxy: state.useProxy,
    autoUnload: state.autoUnload,
    vramGuard: state.vramGuard,
    style: state.style,
    llmProvider: state.llmProvider,
    llmConfigs: state.llmConfigs,
    searchUrl: state.searchUrl,
    searchEngine: state.searchEngine,
    searchApiKey: state.searchApiKey,
    searchCseId: state.searchCseId,
    models: state.models,
    presets: state.presets,
    active: state.active,
    customWorkflows: state.customWorkflows,
    customWorkflowId: state.customWorkflowId,
    customSettings: state.customSettings,
    threeD: state.threeD,
    imageSettings: state.imageSettings,
    pixelSettings: state.pixelSettings,
    videoSettings: state.videoSettings,
    editSettings: state.editSettings,
    episodeShots: state.episodeShots,
    musicSettings: state.musicSettings,
    sfxSettings: state.sfxSettings,
    spriteSettings: state.spriteSettings,
    textureSettings: state.textureSettings,
    flipbookSettings: state.flipbookSettings,
    materialSettings: state.materialSettings,
    splitSettings: state.splitSettings,
    partsSettings: state.partsSettings,
    history: state.history,
    hiddenHistoryIds: state.hiddenHistoryIds,
    outputAudio: state.outputAudio,
    // AI titles ('Platform Nine') survive reloads so the current
    // output's download name doesn't fall back to track_00001.mp3.
    titles: state.titles,
    // Which tab/mode you were on — a new tab (e.g. the Studio's own
    // window) should come back where you left off.
    mode: state.mode,
    savedPrompts: state.savedPrompts,
    sidebarWidth: state.sidebarWidth,
    controlsWidth: state.controlsWidth,
  }
}

// localStorage rejects writes once the origin hits its quota (typically 5MB).
// History thumbnails are the biggest offender: a few 3D captures can push a
// long session over the limit, and persist would otherwise throw on every
// state change. Retry with thumbnails stripped, then with history emptied —
// the live in-memory history is untouched, only the saved copy is trimmed.
const isQuotaError = (err) =>
  err &&
  (err.name === 'QuotaExceededError' ||
    err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    err.code === 22 ||
    err.code === 1014)

function withState(value, mutate) {
  try {
    const data = JSON.parse(value)
    if (!data?.state) return null
    if (!mutate(data.state)) return null
    return JSON.stringify(data)
  } catch {
    return null
  }
}

const withoutThumbnails = (value) =>
  withState(value, (state) => {
    if (!Array.isArray(state.history)) return false
    let changed = false
    state.history = state.history.map((entry) => {
      if (!entry?.thumbnail) return entry
      changed = true
      const { thumbnail, ...rest } = entry
      return rest
    })
    return changed
  })

const withoutHistory = (value) =>
  withState(value, (state) => {
    if (!Array.isArray(state.history) || state.history.length === 0) return false
    state.history = []
    return true
  })

// Zustand persist calls setItem on every store update. Progress arrives
// several times per second during a render, and each write serializes the
// whole history (including large 3D thumbnails). Keep the first write
// immediate, then coalesce bursts into one trailing write so the main
// thread isn't stringifying the same state dozens of times per second.
const WRITE_DELAY_MS = 300
let pendingWrite = null
let writeTimer = null
let lastWriteAt = 0

function writeItem(name, value) {
  lastWriteAt = Date.now()
  try {
    window.localStorage.setItem(name, value)
    return
  } catch (err) {
    if (!isQuotaError(err)) {
      console.warn('[studio] could not save settings', err)
      return
    }
  }
  const trimmed = withoutThumbnails(value)
  if (trimmed) {
    try {
      window.localStorage.setItem(name, trimmed)
      console.warn('[studio] localStorage full — saved history without 3D thumbnails')
      return
    } catch {
      /* still too big — fall through */
    }
  }
  const minimal = withoutHistory(value)
  if (minimal) {
    try {
      window.localStorage.setItem(name, minimal)
      console.warn('[studio] localStorage full — saved settings with an empty history')
      return
    } catch {
      /* give up; the session keeps working in memory */
    }
  }
  console.warn('[studio] localStorage is full — settings will not persist until space is freed')
}

function flushSafeStorage() {
  if (writeTimer) {
    clearTimeout(writeTimer)
    writeTimer = null
  }
  if (!pendingWrite) return
  const { name, value } = pendingWrite
  pendingWrite = null
  writeItem(name, value)
}

export const safeStorage = {
  getItem: (name) => {
    // Hydration should see a queued write from the same page load.
    flushSafeStorage()
    try {
      return window.localStorage.getItem(name)
    } catch {
      return null
    }
  },
  setItem: (name, value) => {
    if (!writeTimer && Date.now() - lastWriteAt >= WRITE_DELAY_MS) {
      writeItem(name, value)
      return
    }
    pendingWrite = { name, value }
    if (!writeTimer) writeTimer = setTimeout(flushSafeStorage, WRITE_DELAY_MS)
  },
  removeItem: (name) => {
    if (pendingWrite?.name === name) {
      pendingWrite = null
      if (writeTimer) {
        clearTimeout(writeTimer)
        writeTimer = null
      }
    }
    try {
      window.localStorage.removeItem(name)
    } catch {
      /* ignore */
    }
  },
}

// Don't lose the last progress/state change when the tab closes or is
// backgrounded while a trailing write is still queued.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushSafeStorage)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSafeStorage()
  })
}
