// Pure helpers for the Studio REST API — no server I/O, unit-tested directly.
// Defaults mirror src/store/useStore.js (DEFAULT_MODELS + *Settings) so the
// API behaves exactly like the app's own defaults.

import {
  buildImageWorkflow,
  buildEditWorkflow,
  buildVideoWorkflow,
  buildMusicWorkflow,
  isMiniMaxH3,
  isAceStepModel,
} from '../../src/lib/workflows.js'
import { resolveAceStepModels } from '../../src/lib/comfyui.js'

export const MODES = ['image', 'edit', 'video', 'music', '3d', 'skin', 'meshupscale']

// Flow modes run long-lived multi-prompt pipelines (threed.js) instead of a
// single workflow graph — they always block until done and take no `prompt`.
export const FLOW_MODES = ['3d', 'skin', 'meshupscale']

export const DEFAULT_MODELS = {
  image: {
    unet: 'qwen_image_fp8_e4m3fn.safetensors',
    clip: 'qwen_2.5_vl_7b_fp8_scaled.safetensors',
    vae: 'qwen_image_vae.safetensors',
    lora: '',
  },
  edit: {
    unet: 'qwen_image_edit_fp8_e4m3fn.safetensors',
    clip: 'qwen_2.5_vl_7b_fp8_scaled.safetensors',
    vae: 'qwen_image_vae.safetensors',
    lora: '',
  },
  video: {
    unet: 'wan2.1_t2v_1.3B_bf16.safetensors',
    clip: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
    vae: 'wan_2.1_vae.safetensors',
    lora: '', // optional H3 turbo LoRA (4–8 steps)
  },
  music: {
    unet: 'minimax_music3_dit_int8_convrot.safetensors',
    clip: 'minimax_music3_text_encoder_pruned_int8_convrot.safetensors',
    vae: 'minimax_music3_dav.safetensors',
  },
  // Flow modes: node/model availability is validated by the pipeline itself
  // (assertWorkflowNodes); nothing to resolve up front.
  '3d': {},
  skin: {},
  meshupscale: {},
}

export const DEFAULT_SETTINGS = {
  image: { aspectRatio: '1:1', turboMode: false, seed: -1, steps: 20, cfg: 4, upscale: '' },
  edit: { seed: -1, steps: 20, cfg: 2.5 },
  video: { resolution: '480p', frames: 33, fps: 16, seed: -1, steps: 20, cfg: 6 },
  // duration: planner cap for both engines (MiniMax max_duration / ACE
  // planner max_duration; exact render length when no planner is
  // available). Default 300 = 5 minutes; range 10–360.
  music: { duration: 300, seed: -1, steps: 30, cfgScale: 1.7, quality: '320k' },
  // 3D flow defaults mirror src/store/useStore.js (threeD).
  '3d': {
    meshMode: 'pixal3d',
    pixalSteps: 20,
    pixalGuidance: 7.5,
    pixalCameraRes: 1024,
    pixalTextureSize: 4096,
    pixalDecimation: 300000,
    pixalRemesh: true,
    pixalEnhance: 'sharpen',
    pixalUpscaleModel: '',
    faceFix: true,
  },
  skin: {
    hunyuanPaintModel: 'hunyuan3d-paintpbr-v2-1',
    hunyuanViewSize: 768,
    hunyuanTextureSize: 4096,
    hunyuanPaintSteps: 12,
    hunyuanGuidance: 3,
    hunyuanViewUpscale: true,
    // Browser-only canvas blend — keep off server-side (the pipeline skips
    // it gracefully if a Node canvas ever becomes available).
    hunyuanSkinBlend: false,
  },
  meshupscale: {
    ultrashapeCheckpoint: 'ultrashape_v1.pt',
    ultrashapeDtype: 'bfloat16',
    ultrashapeLowVram: true,
    ultrashapeSteps: 20,
    ultrashapeGuidance: 5,
    ultrashapeOctree: 384,
    ultrashapeNumChunks: 8000,
    ultrashapeNumLatents: 16384,
  },
}

// Preference order when the exact default file isn't on the server —
// strongest match first (mirrors useComfyUI's edit-mode resolver).
export const MODEL_PREFS = {
  image: {
    unet: [/qwen.*image/i, /flux/i],
    // Never a MiniMax hybrid TE — plain Qwen-VL only (the 32b_minimax_h3
    // file belongs to the H3 video pipeline and breaks image KSampler).
    clip: [/qwen_2\.5_vl/i, /qwen3vl_8b/i, /qwen3vl(?!.*minimax)/i, /qwen(?!.*minimax)/i],
    vae: [/qwen.*image.*vae/i, /qwen.*vae/i],
  },
  edit: {
    unet: [/qwen.*edit/i, /qwen.*2.*int8/i, /qwen/i],
    clip: [/qwen_2\.5_vl/i, /qwen3vl_8b/i, /qwen3vl(?!.*minimax)/i, /qwen(?!.*minimax)/i],
    vae: [/qwen.*image.*vae/i, /qwen.*vae/i],
  },
  video: {
    unet: [/wan/i, /ltx/i, /hunyuan[-_ ]?video/i, /cogvideo/i, /minimax[-_ ]?h3/i],
    clip: [/umt5/i, /minimax[-_ ]?h3/i, /qwen3vl.*minimax/i],
    vae: [/wan.*vae/i, /video.*vae/i, /minimax.*video/i],
  },
  music: {
    unet: [/minimax[-_ ]?music3[-_ ]?dit/i, /minimax.*dit/i, /music/i],
    clip: [/minimax.*text.*encoder/i, /minimax/i],
    vae: [/minimax[-_ ]?music3[-_ ]?dav/i, /dav/i, /music/i],
  },
}

const STEM_RE = /\.(safetensors|ckpt|pt|sft|bin)$/i

function stem(name) {
  return String(name || '').replace(STEM_RE, '')
}

export function pickModel(list, want, prefs) {
  const arr = Array.isArray(list) ? list : []
  if (want) {
    if (arr.includes(want)) return want
    const w = stem(want)
    const fuzzy = arr.find((m) => stem(m) === w)
    if (fuzzy) return fuzzy
  }
  // Preference regexes only — NO blind first-entry fallback: picking a
  // music/audio model for image/video mode fails deep inside KSampler
  // with an unreadable shape error. Misses surface as null → throw.
  for (const re of prefs || []) {
    const hit = arr.find((m) => re.test(String(m)))
    if (hit) return hit
  }
  return null
}

// Resolve the { unet, clip, vae, lora } set for a mode against the files
// actually on the server. Explicit overrides must exist on the server
// (loud failure, like the app's assertModelsAvailable); defaults fall back
// through MODEL_PREFS so a renamed file doesn't hard-fail the API.
export function resolveModels(lists, mode, overrides = {}) {
  const base = DEFAULT_MODELS[mode]
  if (!base) throw new Error(`Unknown mode "${mode}"`)
  const prefs = MODEL_PREFS[mode] || {}
  const out = {}
  for (const group of Object.keys(base)) {
    if (group === 'lora') {
      out.lora = overrides.lora !== undefined ? overrides.lora : base.lora
      continue
    }
    // ACE-Step music: clip/vae ride inside the ACE assets (AIO checkpoint or
    // split qwen encoders) — resolved below, so don't force the MiniMax
    // defaults to exist on the server (an ACE-only install has no MiniMax).
    if (mode === 'music' && group !== 'unet' && out.unet && isAceStepModel(out.unet)) {
      out[group] = overrides[group] || base[group]
      continue
    }
    if (overrides[group]) {
      const arr = Array.isArray(lists?.[group]) ? lists[group] : []
      const hit = arr.find((m) => m === overrides[group]) || arr.find((m) => stem(m) === stem(overrides[group]))
      if (!hit) throw new Error(`Model not on server (${group}): ${overrides[group]}`)
      out[group] = hit
      continue
    }
    const arr = Array.isArray(lists?.[group]) ? lists[group] : []
    const picked = pickModel(arr, base[group], prefs[group])
    if (!picked) {
      if (arr.length === 0) {
        throw new Error(`No ${group} models found on the ComfyUI server — is it reachable?`)
      }
      throw new Error(
        `No suitable ${group} model for ${mode} on the ComfyUI server ` +
          `(have: ${arr.slice(0, 5).join(', ')}${arr.length > 5 ? ', …' : ''})`,
      )
    }
    out[group] = picked
  }
  // ACE-Step music: attach the resolved asset set (AIO checkpoint or split
  // encoders) the workflow builder needs; split also corrects clip/vae.
  if (mode === 'music' && isAceStepModel(out.unet)) {
    const ace = resolveAceStepModels(lists, out)
    if (ace.kind === 'split') {
      out.clip = ace.clip2
      out.vae = ace.vae
      out.clip1 = ace.clip1
    }
    out.ace = ace
  }
  // MiniMax H3 video additionally needs the H3 audio VAE (AV latent decode).
  // Not a settings group — resolve it straight from the server's VAE list.
  if (mode === 'video' && isMiniMaxH3(out.unet)) {
    const vaes = Array.isArray(lists?.vae) ? lists.vae : []
    const audio = vaes.find((m) => /audio[-_ ]?vae/i.test(m))
    if (!audio) {
      throw new Error(
        'MiniMax H3 video needs the H3 audio VAE (minimax_h3_audio_vae_*.safetensors) on the ComfyUI server — install it or pick another video model.'
      )
    }
    out.vaeAudio = audio
  }
  return out
}

// Body `models` overrides accept both shapes: flat ({ unet, clip, vae, lora })
// and mode-nested ({ music: { unet } } — what the MCP server sends, e.g.
// video turbo LoRA). Nested wins when the mode key is present, so a flat
// { video: { lora } } maps correctly for mode 'video'.
export function pickModelOverrides(mode, bodyModels) {
  if (!bodyModels || typeof bodyModels !== 'object') return {}
  const nested = bodyModels[mode]
  return nested && typeof nested === 'object' ? nested : bodyModels
}

// Resolve settings.upscale against the server's UpscaleModelLoader list.
// Accepts ''/false/'none' (off), true/'auto'/'4x' (pick 4x-UltraSharp or any
// ESRGAN), or an exact/fuzzy filename. Throws readable on misses.
export function resolveUpscaleModel(lists, want) {
  if (want === undefined || want === null || want === '' || want === false || want === 'none') return ''
  const list = Array.isArray(lists?.upscale) ? lists.upscale : []
  if (want === true || want === 'auto' || want === '4x' || want === '4x-ultrasharp') {
    const hit =
      list.find((m) => /ultrasharp/i.test(m)) ||
      list.find((m) => /esrgan/i.test(m)) ||
      list[0]
    if (!hit) {
      throw new Error(
        'No upscale model on the ComfyUI server — drop a free .pth (e.g. 4x-UltraSharp.pth) into ' +
          'ComfyUI/models/upscale_models/ and restart ComfyUI.',
      )
    }
    return hit
  }
  const name = String(want)
  const hit = list.find((m) => m === name) || list.find((m) => stem(m) === stem(name))
  if (!hit) {
    throw new Error(
      `Upscale model not on server: ${name} (have: ${list.slice(0, 6).join(', ') || 'none'})`,
    )
  }
  return hit
}

// data URL or raw base64 → bytes + mime (whitespace/newlines tolerated).
export function decodeDataUrl(input) {
  let s = String(input || '')
  let mime = 'image/png'
  if (s.startsWith('data:')) {
    const comma = s.indexOf(',')
    if (comma < 0) throw new Error('imageBase64 data URL is malformed (no comma)')
    const head = s.slice(5, comma)
    const [type, ...encs] = head.split(';')
    if (type) mime = type
    if (encs.length && !encs.includes('base64')) {
      throw new Error(`Unsupported data URL encoding: ${encs.join(';')}`)
    }
    s = s.slice(comma + 1)
  }
  const clean = s.replace(/\s+/g, '')
  if (!clean) throw new Error('imageBase64 is empty')
  const buf = Buffer.from(clean, 'base64')
  if (!buf.length) throw new Error('imageBase64 did not decode to any bytes')
  return { buf, mime }
}

// Build the workflow graph for a mode (same builders the app uses).
export function workflowFor(mode, { prompt, negativePrompt = '', lyrics = '', settings = {}, models, imageName }) {
  const s = { ...DEFAULT_SETTINGS[mode], ...settings }
  if (mode === 'image') {
    return buildImageWorkflow({
      prompt,
      negativePrompt,
      aspectRatio: s.aspectRatio,
      seed: s.seed,
      steps: s.steps,
      cfg: s.cfg,
      turboMode: !!s.turboMode,
      upscaleModel: models.upscale || '',
      models,
    })
  }
  if (mode === 'edit') {
    return buildEditWorkflow({
      prompt,
      negativePrompt,
      imageName,
      seed: s.seed,
      steps: s.steps,
      cfg: s.cfg,
      models,
    })
  }
  if (mode === 'video') {
    return buildVideoWorkflow({
      prompt,
      negativePrompt,
      resolution: s.resolution,
      frames: s.frames,
      fps: s.fps,
      seed: s.seed,
      steps: s.steps,
      cfg: s.cfg,
      models,
    })
  }
  if (mode === 'music') {
    return buildMusicWorkflow({
      caption: prompt,
      negativePrompt,
      lyrics,
      duration: s.duration,
      seed: s.seed,
      steps: s.steps,
      cfgScale: s.cfgScale,
      quality: s.quality,
      models,
    })
  }
  throw new Error(
    FLOW_MODES.includes(mode)
      ? `Mode "${mode}" runs as a long-lived flow (threed.js pipeline), not a single workflow graph`
      : `Unsupported mode "${mode}" — use one of: ${MODES.join(', ')}`,
  )
}

const OUTPUT_BUCKETS = [
  ['image', 'images'],
  ['video', 'gifs'],
  ['video', 'videos'],
  ['music', 'audio'],
  ['3d', 'model_3d'],
]

export function hasOutputs(item) {
  return Object.values(item?.outputs || {}).some((node) =>
    OUTPUT_BUCKETS.some(([, key]) => Array.isArray(node?.[key]) && node[key].some((f) => f?.filename)),
  )
}

// History outputs → flat list with API-proxied + direct ComfyUI URLs.
export function outputsOf(entry, fileBase = '/api/file', comfyuiUrl = '') {
  const out = []
  for (const [nodeId, node] of Object.entries(entry?.outputs || {})) {
    for (const [kind, key] of OUTPUT_BUCKETS) {
      const list = node?.[key]
      if (!Array.isArray(list)) continue
      for (const f of list) {
        if (!f?.filename) continue
        // SaveVideo (MiniMax H3) files mp4s under `images` with
        // animated:[true] — classify as video, not image.
        const outKind =
          key === 'images' &&
          (node.animated?.[0] || /\.(mp4|webm|mov)\b/i.test(f.filename))
            ? 'video'
            : kind
        const params = new URLSearchParams({
          filename: f.filename,
          subfolder: f.subfolder || '',
          type: f.type || 'output',
        })
        out.push({
          kind: outKind,
          nodeId,
          filename: f.filename,
          subfolder: f.subfolder || '',
          type: f.type || 'output',
          url: `${fileBase}?${params.toString()}`,
          comfyuiUrl: comfyuiUrl ? `${comfyuiUrl}/view?${params.toString()}` : '',
        })
      }
    }
  }
  return out
}
