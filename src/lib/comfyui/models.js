import { isAceStepModel, isStableAudioModel } from '../workflows.js'

let modelListCache = { at: 0, data: null }
const MODEL_LIST_TTL_MS = 5 * 60 * 1000

export async function getModelLists(base, { force = false } = {}) {
  if (!force && modelListCache.data && Date.now() - modelListCache.at < MODEL_LIST_TTL_MS) {
    return modelListCache.data
  }
  const targets = {
    unet: ['UNETLoader', 'unet_name'],
    clip: ['CLIPLoader', 'clip_name'],
    vae: ['VAELoader', 'vae_name'],
    lora: ['LoraLoaderModelOnly', 'lora_name'],
    // GGUF diffusion models (ComfyUI-GGUF/Kijai) — the video character
    // engine's WAN 2.2 experts live here.
    gguf: ['GGUFLoaderKJ', 'model_name'],
    // AIO checkpoints (e.g. ace_step_1.5_turbo_aio) load unet+clip+vae in one
    // file — needed to resolve ACE-Step music on servers without split encoders.
    checkpoint: ['CheckpointLoaderSimple', 'ckpt_name'],
    // Detail upscale models (image settings.upscale, video 1080p-fast, 3D).
    upscale: ['UpscaleModelLoader', 'model_name'],
  }
  const entries = await Promise.all(
    Object.entries(targets).map(async ([key, [cls, field]]) => {
      try {
        const res = await fetch(`${base}/object_info/${cls}`)
        if (!res.ok) return [key, []]
        const data = await res.json()
        // Both combo spec shapes: [optionsArray, config] (CheckpointLoader…)
        // and ["COMBO", {options}] (UpscaleModelLoader) — same handling as
        // getNodeComboOptions below.
        const spec = data?.[cls]?.input?.required?.[field]
        const list = Array.isArray(spec?.[0]) ? spec[0] : Array.isArray(spec?.[1]?.options) ? spec[1].options : []
        return [key, Array.isArray(list) ? list : []]
      } catch {
        return [key, []]
      }
    })
  )
  const data = Object.fromEntries(entries)
  modelListCache = { at: Date.now(), data }
  return data
}

// ---------------------------------------------------------------------------
// Preflight checks — fail with a readable message BEFORE a prompt is queued,
// instead of surfacing a cryptic server-side crash later.
// ---------------------------------------------------------------------------

// Does this diffusion-model filename look like a VIDEO model? Video runs
// fed an image model die inside the net with "too many values to unpack
// (expected 4)" (image models unpack B,C,H,W; video latents are B,C,T,H,W).
export function looksLikeVideoModel(name) {
  // minimax_h3 / hailuo: the MiniMax H3 video dit (e.g.
  // minimax_h3_fl2va_pruned_int8_convrot.safetensors) — kept in sync with
  // H3_VIDEO_RE in workflows.js (unit test asserts they agree).
  return /(^|[^a-z])(wan|hunyuan[-_ ]?video|cogvideo|ltx[-_ ]?v|mochi|svd|animatediff|t2v|i2v|v2v|vid2vid|video|minimax[-_ ]?h\d|hailuo)([^a-z]|$)/i.test(
    String(name || '')
  )
}

// Music models (a music unet fed image/video conditioning fails the same
// cryptic way). Matches MiniMax Music 3, YuE, ACE-Step, Stable Audio,
// DiffRhythm, MusicGen, InspireMusic, Suno/Udio-style dumps, …
export function looksLikeMusicModel(name) {
  return /(^|[^a-z])(minimax[-_ ]?music|music3|music[-_ ]?dit|yue[-_ ]?2?|ace[-_ ]?step|stable[-_ ]?audio|diff[-_ ]?rhythm|musicgen|stemma|inspire[-_ ]?music|music)([^a-z]|$)/i.test(
    String(name || '')
  )
}

// Resolve the ACE-Step 1.5 assets for the selected music unet against the
// server's file lists. Two supported graph shapes (see buildAceStepWorkflow):
//   split — DualCLIPLoader(qwen_0.6b_ace15 + qwen_1.7b/4b_ace15, type 'ace')
//           + UNETLoader + ace VAE
//   aio   — CheckpointLoaderSimple(ace_step_1.5_*_aio) carries unet+clip+vae
// Prefers split (the official template) when the full encoder set exists;
// falls back to the AIO checkpoint — the only shape runnable on servers that
// only have the 1.7B encoder (single-clip split fails server-side with
// "'NoneType' object has no attribute 'shape'").
export function resolveAceStepModels(lists, selected = {}) {
  const clips = Array.isArray(lists?.clip) ? lists.clip : []
  const ckpts = Array.isArray(lists?.checkpoint) ? lists.checkpoint : []
  const vaes = Array.isArray(lists?.vae) ? lists.vae : []
  const enc06 = clips.find((m) => /qwen[^/]*0\.6b[^/]*ace|qwen[^/]*ace[^/]*0\.6b/i.test(m))
  const encBig = clips.find((m) => /qwen[^/]*(?:1\.7b|4b)[^/]*ace|qwen[^/]*ace[^/]*(?:1\.7b|4b)/i.test(m))
  const aceVae = vaes.find((m) => /ace[^/]*vae/i.test(m))
  // Optional: the MiniMax music3 text encoder doubles as the AR structure
  // planner that auto-sizes ACE track length (buildAceStepWorkflow adds the
  // planner node only when this is present; absent → exact-duration mode).
  // Skip the planner when duration > 360s — the planner node hard-caps
  // max_duration at 360, so ACE's own TE (up to 2000s) is the only path
  // for longer tracks. The caller (useComfyUI) passes forceDirect.
  const plannerClip = clips.find((m) => /minimax[^/]*music3[^/]*text/i.test(m))
  const planner = plannerClip && !selected.forceDirect ? { plannerClip } : {}
  if (enc06 && encBig && aceVae && selected.unet) {
    return { kind: 'split', unet: selected.unet, clip1: enc06, clip2: encBig, vae: aceVae, ...planner }
  }
  const aio = ckpts.find((m) => /ace[^/]*aio/i.test(m))
  if (aio) return { kind: 'aio', checkpoint: aio, ...planner }
  throw new Error(
    'ACE-Step music needs ACE text-encoder/VAE files on the ComfyUI server: either the AIO ' +
      'checkpoint (models/checkpoints/ace_step_1.5_*_aio*.safetensors) or the split set ' +
      '(qwen_0.6b_ace15 + qwen_1.7b_ace15/4b text encoders + ace_1.5_vae). ' +
      `This server has — ACE checkpoints: ${ckpts.filter((m) => /ace/i.test(m)).join(', ') || 'none'}; ` +
      `ACE encoders: ${clips.filter((m) => /ace/i.test(m)).join(', ') || 'none'}; ` +
      `ACE VAE: ${aceVae || 'none'}.`
  )
}

// Resolve the Stable Audio 3 assets for the selected music preset. The
// checkpoint (stable_audio_3_*) lives in models/checkpoints/ and the T5Gemma
// text encoder in models/text_encoders/ — neither is in the UNET list, so the
// preset stores the checkpoint name in its `unet` field by convention.
// Returns { checkpoint, clip } for buildStableAudioWorkflow.
export function resolveStableAudioModels(lists, selected = {}) {
  const ckpts = Array.isArray(lists?.checkpoint) ? lists.checkpoint : []
  const clips = Array.isArray(lists?.clip) ? lists.clip : []
  const wanted = selected.checkpoint || selected.unet
  const stableCkpts = ckpts.filter((m) => isStableAudioModel(m))
  const checkpoint =
    (wanted && ckpts.includes(wanted) ? wanted : null) ||
    stableCkpts.find((m) => /sfx/i.test(m)) ||
    stableCkpts[0]
  const t5 = clips.filter((m) => /t5gemma/i.test(m))
  const clip = (selected.clip && clips.includes(selected.clip) ? selected.clip : null) || t5[0]
  const missing = []
  if (!checkpoint) missing.push('checkpoint (stable_audio_3_*.safetensors in models/checkpoints/)')
  if (!clip) missing.push('text encoder (t5gemma_b_b_ul2.safetensors in models/text_encoders/)')
  if (missing.length) {
    throw new Error(
      `Stable Audio 3 needs its ${missing.join(' and ')} on the ComfyUI server. ` +
        `Have — Stable Audio checkpoints: ${stableCkpts.join(', ') || 'none'}; ` +
        `T5Gemma encoders: ${t5.join(', ') || 'none'}.`
    )
  }
  return { checkpoint, clip }
}

// Resolve the MiniMax H3 video assets for the selected video unet against the
// server's file lists. The H3 graph is picky: the DiT expects the H3 text
// encoder (Qwen3-VL-32B, hidden 5120) in the clip slot and decodes an AV
// latent with BOTH an H3 video VAE and an H3 audio VAE. Presets that only
// carry the DiT — or that were saved with the music encoder / audio VAE
// sitting in the clip/vae slots (the classic "mat1 and mat2 shapes cannot be
// multiplied (… 32768 and 5120 …)" crash in the sampler's preprocess_text_embeds)
// — are corrected here rather than trusted. Mirrors resolveAceStepModels:
// throws with concrete install guidance when a file is genuinely absent.
export function resolveH3VideoModels(lists, selected = {}) {
  const clips = Array.isArray(lists?.clip) ? lists.clip : []
  const vaes = Array.isArray(lists?.vae) ? lists.vae : []
  const clip = clips.find((m) => /(qwen|vl).*h\d|h\d.*(qwen|vl)/i.test(m))
  const vae = vaes.find((m) => /video[-_ ]?vae/i.test(m))
  const vaeAudio = vaes.find((m) => /audio[-_ ]?vae/i.test(m))
  const missing = []
  if (!clip) missing.push('H3 text encoder (qwen3vl_32b_minimax_h3_*.safetensors)')
  if (!vae) missing.push('H3 video VAE (minimax_h3_video_vae_*.safetensors)')
  if (!vaeAudio) missing.push('H3 audio VAE (minimax_h3_audio_vae_*.safetensors)')
  if (missing.length) {
    throw new Error(
      `MiniMax H3 video needs ${missing.join(', ')} on the ComfyUI server. ` +
        `Have — text encoders: ${clips.join(', ') || 'none'}; VAEs: ${vaes.join(', ') || 'none'}.`
    )
  }
  return { ...selected, clip, vae, vaeAudio }
}

export function listModels(label, names) {
  return names.length > 0 ? `${label}: ${names.join(', ')}` : `${label}: none`
}

export async function getNodeComboOptions(base, classType, field, kind = 'required') {
  try {
    const res = await fetch(`${base}/object_info/${classType}`)
    if (!res.ok) return []
    const data = await res.json()
    const spec = data?.[classType]?.input?.[kind]?.[field]
    if (!spec) return []
    if (Array.isArray(spec[0])) return spec[0]
    if (Array.isArray(spec[1]?.options)) return spec[1].options
    return []
  } catch {
    return []
  }
}
