// Runtime deployment config: GET /config.json
//
// In production this file is baked into the image and nginx serves it
// (no-store); Settings → Save PUTs an updated copy back into the container
// via WebDAV so every browser shares it. In dev, Vite serves
// public/config.json. The app reads it once at startup and seeds ONLY
// fresh browsers (no saved settings yet) — per-browser localStorage wins
// afterwards unless the file carries `synced: true`.
//
// API keys are deliberately never read from disk: they stay in the
// browser that typed them.

import { SEARCH_ENGINES } from './search'

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
  // Tuned against the template defaults (shape 20 steps @ cfg 7.5,
  // 4k texture bake): the distilled samplers gain nothing past ~30 steps,
  // and 8k PNG textures triple the GLB for zero visible gain. ~40 MB
  // outputs stay rig/upscale-friendly (the old high preset shipped
  // 159 MB monsters).
  standard: {
    pixalCameraRes: 1024,
    pixalTextureSize: 4096,
    pixalDecimation: 300000,
    pixalSteps: 20,
    pixalGuidance: 7.5,
    pixalRemesh: true,
  },
  high: {
    pixalCameraRes: 1024,
    pixalTextureSize: 4096,
    pixalDecimation: 400000,
    pixalSteps: 24,
    pixalGuidance: 7.5,
    pixalRemesh: true,
  },
  ultra: {
    pixalCameraRes: 1536,
    pixalTextureSize: 8192,
    pixalDecimation: 600000,
    pixalSteps: 30,
    pixalGuidance: 8.0,
    // false skips the voxel remesh that otherwise smooths fine facial
    // geometry at export — flip back on if rigging ever rejects the mesh
    pixalRemesh: false,
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
