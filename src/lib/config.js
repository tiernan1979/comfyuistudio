// Runtime deployment config: GET /config.json
//
// In production this file is baked into the image and nginx serves it
// (no-store); Settings → Save PUTs an updated copy back into the container
// via WebDAV so every browser shares it. In dev, Vite serves
// public/config.json. The app reads it once at startup and seeds ONLY
// fresh browsers (no saved settings yet) — per-browser localStorage wins
// afterwards unless the file carries `synced: true` (Settings → Update
// from server force-applies a synced file on demand).
//
// The file is persisted in a docker volume (docker-compose.yml) so a
// rebuild or image pull doesn't reset every browser back to defaults.
//
// API keys are deliberately never read from disk: they stay in the
// browser that typed them.

import { SEARCH_ENGINES } from './search.js'

const LLM_PROVIDERS = new Set(['lmstudio', 'openai', 'anthropic', 'custom'])
const MODEL_GROUPS = new Set(['image', 'video', 'edit', 'music'])

// Quality presets for the local native 3D pipeline (Pixal3D/TRELLIS.2).
// Each preset fills the individual pixal* fields below — the fields are
// always the source of truth at run time; the preset is a UI convenience
// ('custom' = hand-tuned).
//   standard — the proven baseline (matches earlier runs)
//   high     — sharper texture + more geometry, moderate slowdown
//   ultra    — every node-supported maximum for face/detail sharpness
export const QUALITY_PRESETS = {
  // Unified tiers: one pick configures the whole 3D pipeline together —
  // mesh generation (pixal*), Skin/Hunyuan3D paint (hunyuan*) and the
  // UltraShape Upscale refine (ultrashape*) — so every combination stays
  // correct-looking and VRAM-safe instead of only the gen stage.
  // Tuned against the template defaults (shape 20 steps @ cfg 7.5,
  // 4k texture bake): the distilled samplers gain nothing past ~30 steps,
  // and 8k PNG textures triple the GLB for zero visible gain. ~40 MB
  // outputs stay rig/upscale-friendly (the old high preset shipped
  // 159 MB monsters). Hardware knobs (ultrashapeLowVram, dtype,
  // checkpoint) are deliberately excluded — they depend on the GPU.
  standard: {
    pixalCameraRes: 1024,
    pixalTextureSize: 4096,
    pixalDecimation: 300000,
    pixalSteps: 20,
    pixalGuidance: 7.5,
    pixalRemesh: true,
    hunyuanViewSize: 512,
    hunyuanTextureSize: 2048,
    hunyuanPaintSteps: 15,
    hunyuanGuidance: 3.5,
    ultrashapeOctree: 384,
    ultrashapeSteps: 20,
    ultrashapeGuidance: 5,
    ultrashapeNumChunks: 8000,
    ultrashapeNumLatents: 16384,
  },
  high: {
    pixalCameraRes: 1024,
    pixalTextureSize: 4096,
    pixalDecimation: 400000,
    pixalSteps: 24,
    pixalGuidance: 7.5,
    pixalRemesh: true,
    hunyuanViewSize: 1024,
    hunyuanTextureSize: 2048,
    hunyuanPaintSteps: 25,
    hunyuanGuidance: 4.0,
    ultrashapeOctree: 448,
    ultrashapeSteps: 25,
    ultrashapeGuidance: 5,
    ultrashapeNumChunks: 8000,
    ultrashapeNumLatents: 16384,
  },
  ultra: {
    pixalCameraRes: 1536,
    pixalTextureSize: 8192,
    pixalDecimation: 500000,
    pixalSteps: 30,
    pixalGuidance: 8.0,
    // Stay on: without the voxel remesh the unwelded raw mesh fragments
    // the UV unwrap into ~23k charts (vs ~3k) — measured 11.8% seam jumps
    // close-up and 28.7% at mip2 (vs 4.5% / 9.3% with remesh) = visible
    // distance shimmer. The ~2mm smoothing cost is not worth that.
    pixalRemesh: true,
    hunyuanViewSize: 1024,
    hunyuanTextureSize: 4096,
    hunyuanPaintSteps: 40,
    hunyuanGuidance: 5.0,
    ultrashapeOctree: 512,
    ultrashapeSteps: 30,
    ultrashapeGuidance: 5,
    ultrashapeNumChunks: 8000,
    ultrashapeNumLatents: 16384,
  },
}

// 3D feature config: type or enum whitelist per field.
const THREE_D_PIPELINES = new Set(['local', 'tripo'])
const THREE_D_FIELDS = {
  enabled: 'boolean',
  pipeline: THREE_D_PIPELINES,
  // which native engine the local pipeline uses (both built into ComfyUI)
  meshMode: new Set(['pixal3d', 'trellis2']),
  qualityPreset: new Set(['standard', 'high', 'ultra', 'custom']),
  // numeric ranges [min, max]
  pixalCameraRes: [256, 2048],
  pixalTextureSize: [512, 8192],
  pixalDecimation: [5000, 5000000],
  pixalSteps: [1, 100],
  pixalGuidance: [0, 20],
  pixalRemesh: 'boolean',
  pixalEnhance: new Set(['none', 'sharpen', 'esrgan', 'magnific4x']),
  pixalUpscaleModel: 'string',
  // Face fix: source-image enhance + front-view paint refine (threed.js)
  faceFix: 'boolean',
  // Hunyuan3D paint (Skin button) — quality presets set these too
  hunyuanPaintModel: 'string',
  hunyuanViewSize: [128, 1024],
  hunyuanTextureSize: [256, 8192],
  hunyuanPaintSteps: [1, 100],
  hunyuanGuidance: [0, 20],
  hunyuanSkinBlend: 'boolean',
  hunyuanViewUpscale: 'boolean',
  // UltraShape 1.0 mesh upscale (local refine)
  ultrashapeCheckpoint: 'string',
  ultrashapeDtype: new Set(['float16', 'bfloat16', 'float32']),
  ultrashapeLowVram: 'boolean',
  ultrashapeSteps: [10, 200],
  ultrashapeGuidance: [1, 15],
  ultrashapeOctree: [256, 2048],
  ultrashapeNumChunks: [1000, 50000],
  ultrashapeNumLatents: [0, 131072],
  miaPrecision: new Set(['auto', 'bf16', 'fp16', 'fp32']),
  localAnimationFile: 'string',
  tripoModelVersion: 'string',
  tripoRigVersion: 'string',
  tripoRigType: 'string',
  tripoSpec: new Set(['mixamo', 'tripo']),
  tripoOutFormat: new Set(['glb', 'fbx']),
  tripoPreset: 'string',
  tripoTextureQuality: new Set(['standard', 'detailed', 'extreme']),
  tripoGeometryQuality: new Set(['standard', 'detailed']),
  tripoTextureAlignment: new Set(['original_image', 'geometry']),
  tripoPbr: 'boolean',
}

// Per-mode generation settings (image/video/edit/music panels) — shared
// so tuning steps/cfg/seeds on one device shows up on every other one.
// Rules mirror THREE_D_FIELDS: 'boolean' | 'string' | 'number' (finite),
// a Set of allowed strings, or [min, max] for bounded numbers.
const MODE_SETTING_FIELDS = {
  imageSettings: {
    aspectRatio: 'string',
    turboMode: 'boolean',
    seed: 'number',
    steps: [1, 100],
    cfg: [0, 30],
  },
  videoSettings: {
    resolution: 'string',
    frames: [1, 4096],
    fps: [1, 60],
    seed: 'number',
    steps: [1, 100],
    cfg: [0, 30],
  },
  editSettings: {
    seed: 'number',
    steps: [1, 100],
    cfg: [0, 30],
  },
  // musicSettings: `duration` is the planner cap (10–360s, default 300) —
  // the model sizes the song itself; whitelist it so the knob syncs.
  musicSettings: {
    seed: 'number',
    steps: [1, 100],
    cfgScale: [0, 10],
    quality: new Set(['wav', '320k', 'V0', '128k']),
    duration: [10, 360],
  },
}

function sanitizeModeSettings(raw, out) {
  for (const [section, fields] of Object.entries(MODE_SETTING_FIELDS)) {
    const rawSection = raw[section]
    if (!rawSection || typeof rawSection !== 'object') continue
    const sectionOut = {}
    for (const [k, rule] of Object.entries(fields)) {
      const v = rawSection[k]
      if (v === undefined) continue
      if (rule === 'boolean') {
        if (typeof v === 'boolean') sectionOut[k] = v
      } else if (rule === 'string') {
        if (typeof v === 'string') sectionOut[k] = v
      } else if (rule === 'number') {
        if (typeof v === 'number' && Number.isFinite(v)) sectionOut[k] = v
      } else if (rule instanceof Set) {
        if (typeof v === 'string' && rule.has(v)) sectionOut[k] = v
      } else if (Array.isArray(rule)) {
        if (typeof v === 'number' && Number.isFinite(v) && v >= rule[0] && v <= rule[1]) sectionOut[k] = v
      }
    }
    if (Object.keys(sectionOut).length > 0) out[section] = sectionOut
  }
}

function sanitizeThreeD(raw) {
  if (!raw || typeof raw !== 'object') return undefined
  const out = {}
  for (const [k, rule] of Object.entries(THREE_D_FIELDS)) {
    const v = raw[k]
    if (v === undefined) continue
    if (rule === 'boolean') {
      if (typeof v === 'boolean') out[k] = v
    } else if (rule === 'string') {
      if (typeof v === 'string') out[k] = v
    } else if (rule instanceof Set) {
      if (typeof v === 'string' && rule.has(v)) out[k] = v
    } else if (Array.isArray(rule)) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= rule[0] && v <= rule[1]) out[k] = v
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

// Whitelist + type-check everything; unknown fields are dropped and any
// `key` fields are stripped so a shared config file can't leak secrets.
function sanitize(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object') return out

  if (raw.synced === true) out.synced = true
  if (typeof raw.serverUrl === 'string') out.serverUrl = raw.serverUrl
  if (typeof raw.useProxy === 'boolean') out.useProxy = raw.useProxy
  if (typeof raw.autoUnload === 'boolean') out.autoUnload = raw.autoUnload
  if (typeof raw.style === 'string') out.style = raw.style
  if (typeof raw.searchUrl === 'string') out.searchUrl = raw.searchUrl
  // searchEngine/searchCseId are shareable; searchApiKey stays browser-only
  // (same rule as llmConfigs[].key — config.json must never hold secrets).
  if (typeof raw.searchEngine === 'string' && SEARCH_ENGINES.some((e) => e.value === raw.searchEngine)) {
    out.searchEngine = raw.searchEngine
  }
  if (typeof raw.searchCseId === 'string') out.searchCseId = raw.searchCseId
  if (typeof raw.llmProvider === 'string' && LLM_PROVIDERS.has(raw.llmProvider)) {
    out.llmProvider = raw.llmProvider
  }

  if (raw.llmConfigs && typeof raw.llmConfigs === 'object') {
    const configs = {}
    for (const [name, c] of Object.entries(raw.llmConfigs)) {
      if (!LLM_PROVIDERS.has(name) || !c || typeof c !== 'object') continue
      const entry = {}
      if (typeof c.url === 'string') entry.url = c.url
      if (typeof c.model === 'string') entry.model = c.model
      // note: c.key intentionally ignored — keys are browser-only
      configs[name] = entry
    }
    if (Object.keys(configs).length > 0) out.llmConfigs = configs
  }

  if (raw.models && typeof raw.models === 'object') {
    const models = {}
    for (const [mode, group] of Object.entries(raw.models)) {
      if (!MODEL_GROUPS.has(mode) || !group || typeof group !== 'object') continue
      const entries = {}
      for (const [k, v] of Object.entries(group)) {
        if (typeof v === 'string') entries[k] = v
      }
      models[mode] = entries
    }
    if (Object.keys(models).length > 0) out.models = models
  }

  const threeD = sanitizeThreeD(raw.threeD)
  if (threeD) out.threeD = threeD

  sanitizeModeSettings(raw, out)

  return out
}

export async function fetchRuntimeConfig() {
  try {
    const res = await fetch('/config.json', { cache: 'no-store' })
    if (!res.ok) return {}
    return sanitize(await res.json())
  } catch {
    // No config.json (e.g. plain `docker run` without the mount) is fine —
    // the built-in defaults still work.
    return {}
  }
}

// Build the shareable config from current store state.
// API keys are deliberately excluded — they never leave the browser.
export function configFromState(state) {
  const llmConfigs = {}
  for (const [name, c] of Object.entries(state.llmConfigs || {})) {
    const entry = {}
    if (typeof c?.url === 'string') entry.url = c.url
    if (typeof c?.model === 'string') entry.model = c.model
    llmConfigs[name] = entry
  }
  return {
    synced: true,
    serverUrl: state.serverUrl,
    useProxy: state.useProxy,
    autoUnload: state.autoUnload,
    style: state.style,
    searchUrl: state.searchUrl,
    searchEngine: state.searchEngine || 'searxng',
    searchCseId: state.searchCseId || '',
    llmProvider: state.llmProvider,
    llmConfigs,
    models: JSON.parse(JSON.stringify(state.models || {})),
    threeD: JSON.parse(JSON.stringify(state.threeD || {})),
    // Per-mode generation settings — flat objects of primitives, so a
    // shallow spread is enough (the sanitizer in applyServerConfig clamps
    // each field against MODE_SETTING_FIELDS).
    imageSettings: { ...(state.imageSettings || {}) },
    videoSettings: { ...(state.videoSettings || {}) },
    editSettings: { ...(state.editSettings || {}) },
    musicSettings: { ...(state.musicSettings || {}) },
  }
}

// Save the config back to disk (nginx WebDAV PUT). Throws with a
// human-readable message on failure so Settings can surface it.
export async function pushRuntimeConfig(config) {
  let res
  try {
    res = await fetch('/config.json', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config, null, 2),
    })
  } catch (err) {
    throw new Error(`couldn't reach the server to save config (${err.message})`)
  }
  if (!res.ok) {
    throw new Error(`server rejected the config save (HTTP ${res.status})`)
  }
}
