import { isAceStepModel, isStableAudioModel } from '../workflows.js'
import {
  getModelLists,
  isSupportedMusicModel,
  isSupportedVideoModel,
  listModels,
  resolveAceStepModels,
  resolveStableAudioModels,
} from './models.js'

// Throws when the WAN stack for the Sprites video engine (models.character:
// two A14B GGUF experts + umt5 text encoder + Wan 2.1 VAE) isn't on the
// server. The GGUF list is read straight from object_info — it changes the
// moment files land on disk, while the shared model-list cache can be minutes
// old. Silent when the server can't be interrogated (ComfyUI's own prompt
// rejection remains the fallback).
export async function assertCharacterModels(base, character = {}) {
  let lists
  try {
    lists = await getModelLists(base)
  } catch {
    return
  }
  const missing = []
  let gguf = []
  try {
    const res = await fetch(`${base}/object_info/GGUFLoaderKJ`)
    if (res.ok) {
      const data = await res.json()
      const spec = data?.GGUFLoaderKJ?.input?.required?.model_name
      gguf = Array.isArray(spec?.[0]) ? spec[0] : Array.isArray(spec?.[1]?.options) ? spec[1].options : []
    }
  } catch {
    /* unreachable — the check below reports it as an empty list */
  }
  if (gguf.length === 0) {
    missing.push(
      'the ComfyUI-GGUF node pack (GGUFLoaderKJ) isn\'t installed on the server — install it in custom_nodes/ and restart ComfyUI',
    )
  } else {
    if (character.high && !gguf.includes(character.high)) {
      missing.push(`high-noise expert "${character.high}" is not on the server — drop it into ComfyUI/models/unet/ (${listModels('have', gguf)})`)
    }
    if (character.low && !gguf.includes(character.low)) {
      missing.push(`low-noise expert "${character.low}" is not on the server — drop it into ComfyUI/models/unet/ (${listModels('have', gguf)})`)
    }
  }
  if (character.clip && Array.isArray(lists.clip) && lists.clip.length && !lists.clip.includes(character.clip)) {
    missing.push(`WAN text encoder "${character.clip}" is not on the server — put it in ComfyUI/models/text_encoders/ (${listModels('have', lists.clip)})`)
  }
  if (character.vae && Array.isArray(lists.vae) && lists.vae.length && !lists.vae.includes(character.vae)) {
    missing.push(`WAN VAE "${character.vae}" is not on the server — put it in ComfyUI/models/vae/ (${listModels('have', lists.vae)})`)
  }
  if (missing.length > 0) {
    throw new Error(`The Sprites video engine can't run — ${missing.join('; ')}.`)
  }
}

// Throws when the configured models for this mode aren't on the server.
// Returns silently when the server can't be interrogated (unreachable /
// empty lists) — ComfyUI's own rejection then remains the fallback.
export async function assertModelsAvailable(base, mode, models) {
  let lists
  try {
    lists = await getModelLists(base)
  } catch {
    return
  }
  if (!lists || lists.unet.length === 0) return

  const wants = (() => {
    if (mode === 'edit') {
      return [
        ['unet', models.edit?.unet, 'Edit model'],
        ['clip', models.image?.clip, 'Text encoder'],
        ['vae', models.image?.vae, 'VAE'],
      ]
    }
    if (mode === 'video') {
      return [
        ['unet', models.video?.unet, 'Video model'],
        ['clip', models.video?.clip, 'Video text encoder'],
        ['vae', models.video?.vae, 'Video VAE'],
        // Optional H3 turbo LoRA — only validated when one is picked.
        ...(models.video?.lora ? [['lora', models.video.lora, 'Turbo LoRA']] : []),
      ]
    }
    if (mode === 'music') {
      // Fall back to the MiniMax Music 3 defaults when the store predates
      // the group (migrate fills them, this covers direct calls too).
      const unet = models.music?.unet || 'minimax_music3_dit_int8_convrot.safetensors'
      // ACE-Step carries clip/vae inside its own assets (AIO checkpoint or
      // split qwen encoders) — resolveAceStepModels checks those below
      // instead of requiring the MiniMax trio.
      if (isAceStepModel(unet)) return [['unet', unet, 'Music model']]
      // Stable Audio 3 is a checkpoint + a separate T5Gemma encoder — the
      // `unet` field holds the checkpoint name (see resolveStableAudioModels).
      if (isStableAudioModel(unet) || models.music?.engine === 'stable_audio') {
        return [
          ['checkpoint', unet, 'Stable Audio checkpoint'],
          ['clip', models.music?.clip || 't5gemma_b_b_ul2.safetensors', 'Stable Audio text encoder'],
        ]
      }
      return [
        ['unet', unet, 'Music model'],
        ['clip', models.music?.clip || 'minimax_music3_text_encoder_pruned_int8_convrot.safetensors', 'Music text encoder'],
        ['vae', models.music?.vae || 'minimax_music3_dav.safetensors', 'Music VAE'],
      ]
    }
    if (mode === 'sfx') {
      // Stable Audio 3: `unet` holds the checkpoint name (see
      // resolveStableAudioModels); the T5Gemma encoder is a separate file.
      const unet = models.sfx?.unet || 'stable_audio_3_small_sfx.safetensors'
      return [
        ['checkpoint', unet, 'Stable Audio checkpoint'],
        ['clip', models.sfx?.clip || 't5gemma_b_b_ul2.safetensors', 'Stable Audio text encoder'],
      ]
    }
    if (mode === 'sprite') {
      // Sprites share the image stack (base pose + instruction edits).
      return [
        ['unet', models.image?.unet, 'Sprite diffusion model'],
        ['clip', models.image?.clip, 'Sprite text encoder'],
        ['vae', models.image?.vae, 'Sprite VAE'],
      ]
    }
    return [
      ['unet', models.image?.unet, 'Diffusion model'],
      ['clip', models.image?.clip, 'Text encoder'],
      ['vae', models.image?.vae, 'VAE'],
    ]
  })()

  const missing = wants
    .filter(([key, value]) => value && !lists[key].includes(value))
    .map(([key, value, label]) => `${label} "${value}" is not on the server (${listModels(key, lists[key])})`)

  if (mode === 'video') {
    const unet = String(models.video?.unet || '')
    const sameAsImage = unet && (unet === models.image?.unet || unet === models.edit?.unet)
    // MiniMax H3 decodes an audio-video latent — it needs BOTH H3 VAEs.
    if (/minimax[-_ ]?h\d|hailuo/i.test(unet) && !lists.vae.some((n) => /audio[-_ ]?vae/i.test(n))) {
      missing.push(
        `MiniMax H3 video needs an audio VAE on the server (minimax_h3_audio_vae_*.safetensors) — ` +
          `have: ${lists.vae.join(', ') || 'none'}.`
      )
    }
    if (unet && (sameAsImage || !isSupportedVideoModel(unet))) {
      missing.push(
        `"${unet}" is not a supported video model — this build renders Wan 2.1/2.2 or MiniMax H3. ` +
          (lists.unet.some(isSupportedVideoModel)
            ? `Your server has: ${lists.unet.filter(isSupportedVideoModel).join(', ')} — pick it in Settings → Video Models.`
            : `Your ComfyUI has no supported video model installed — drop a Wan or MiniMax H3 model into ComfyUI/models/unet/ and set it in Settings → Video Models.`)
      )
    }
  }

  if (mode === 'music') {
    const unet = String(models.music?.unet || 'minimax_music3_dit_int8_convrot.safetensors')
    if (isAceStepModel(unet)) {
      // The unet file itself is validated by `wants` above; also require a
      // runnable ACE text-encoder/VAE set (same resolver the builder uses).
      try {
        resolveAceStepModels(lists, { unet })
      } catch (err) {
        missing.push(err.message)
      }
    } else if (isStableAudioModel(unet) || models.music?.engine === 'stable_audio') {
      // Stable Audio: the `unet` field holds the checkpoint; also require the
      // T5Gemma encoder (same resolver the builder feeds).
      try {
        resolveStableAudioModels(lists, models.music || {})
      } catch (err) {
        missing.push(err.message)
      }
    } else if (!isSupportedMusicModel(unet)) {
      missing.push(
        `"${unet}" is not a supported music model — this build renders MiniMax Music 3, ACE-Step or Stable Audio. ` +
          (lists.unet.some(isSupportedMusicModel)
            ? `Your server has: ${lists.unet.filter(isSupportedMusicModel).join(', ')} — pick it in Settings → Music Models.`
            : `Your ComfyUI has no supported music model installed — add MiniMax Music 3, ACE-Step or Stable Audio and set it in Settings → Music Models.`)
      )
    }
  }

  if (mode === 'sfx') {
    // Stable Audio 3 needs a checkpoint + the T5Gemma encoder — same resolver
    // the builder feeds, so the error names the missing file.
    try {
      resolveStableAudioModels(lists, models.sfx || {})
    } catch (err) {
      missing.push(err.message)
    }
  }

  if (missing.length > 0) {
    const what =
      mode === 'video'
        ? 'Video generation'
        : mode === 'edit'
          ? 'Image editing'
          : mode === 'music'
            ? 'Music generation'
            : mode === 'sfx'
              ? 'SFX generation'
              : mode === 'sprite'
                ? 'Sprite generation'
                : 'Image generation'
    const fileIssues = missing.some((m) => m.includes('is not on the server'))
    let tail = fileIssues ? ' Fix them in Settings → Models.' : ''
    if (mode === 'video' && fileIssues && !missing.some((m) => m.includes('is not a supported video model'))) {
      const vids = lists.unet.filter(isSupportedVideoModel)
      tail += vids.length
        ? ` ComfyUI supports video natively — install one of these video models or select an existing one in Settings → Models: ${vids.join(', ')}.`
        : ' This build supports Wan 2.1/2.2 and MiniMax H3 video models — this server has none installed yet; add one to ComfyUI/models/unet/ and select it in Settings → Video Models.'
    }
    if (mode === 'music' && fileIssues && !missing.some((m) => m.includes('is not a supported music model'))) {
      const music = lists.unet.filter(isSupportedMusicModel)
      tail += music.length
        ? ` Your server has: ${music.join(', ')} — select it in Settings → Music Models.`
        : ' No supported music model found in ComfyUI/models/unet/ — install MiniMax Music 3, ACE-Step or Stable Audio, then set it in Settings → Music Models.'
    }
    throw new Error(`${what} can't run — ${missing.join(' ')}${tail}`)
  }
}

// Which node packs must be present for a feature, given class types.
// Returns { missing: [classType], unreachable: bool }.
export async function checkNodes(base, classTypes) {
  const missing = []
  let unreachable = false
  let busy = false
  await Promise.all(
    classTypes.map(async (cls) => {
      try {
        const res = await fetch(`${base}/object_info/${cls}`)
        if (!res.ok) {
          // A wedged/busy ComfyUI answers 4xx/5xx for every node at once.
          // Only a real 404 means "this node isn't installed" — anything
          // else is the server failing to answer, not a missing pack.
          if (res.status === 404) missing.push(cls)
          else busy = true
          return
        }
        const data = await res.json()
        if (!data?.[cls]) missing.push(cls)
      } catch {
        unreachable = true
      }
    })
  )
  return { missing: [...new Set(missing)], unreachable, busy }
}

// Throwing variant: used by the 3D pipelines before queueing, so a missing
// node pack errors out with install instructions instead of a dead prompt.
export async function assertNodes(base, classTypes, { label = 'This feature', describe = (c) => c } = {}) {
  const { missing, unreachable } = await checkNodes(base, classTypes)
  if (unreachable) {
    throw new Error(`Could not reach ComfyUI to verify ${label} — check the server URL in Settings.`)
  }
  if (missing.length > 0) {
    throw new Error(
      `${label} needs node pack(s) that aren't installed on your ComfyUI server: ` +
        missing.map(describe).join('; ') +
        '. Install them in custom_nodes/ (then restart ComfyUI), or pick a different pipeline in Settings → 3D.'
    )
  }
}

// Is the AudioTailTrim custom node installed? (comfy_nodes/AudioTailTrim.py —
// trims the dead-air tail ACE/MiniMax leave when the song ends before the
// planned duration; the music builders wire it between decode and save).
// Memoized per server for 60s — checked on every music generation.
const trimNodeCache = new Map()
export async function hasAudioTailTrim(base) {
  const hit = trimNodeCache.get(base)
  if (hit && Date.now() - hit.t < 60000) return hit.v
  let v = false
  try {
    const res = await fetch(`${base}/object_info/AudioTailTrim`)
    if (res.ok) {
      const data = await res.json()
      v = !!data?.AudioTailTrim
    }
  } catch {
    // unreachable → keep false; generation will surface connectivity itself
  }
  trimNodeCache.set(base, { t: Date.now(), v })
  return v
}

// Are the loudness post-processing nodes available? AudioEqualizer3Band and
// AudioAdjustVolume ship with ComfyUI's core audio nodes (≥0.36), but a
// stripped build may lack them — probe both so the music builders can chain
// EQ + volume only when the server can actually run them (graphs stay stock
// otherwise). Memoized per server for 60s, like the other music probes.
const loudNodeCache = new Map()
export async function hasAudioLoudnessNodes(base) {
  const hit = loudNodeCache.get(base)
  if (hit && Date.now() - hit.t < 60000) return hit.v
  const probe = async (cls) => {
    try {
      const res = await fetch(`${base}/object_info/${cls}`)
      if (!res.ok) return false
      const data = await res.json()
      return !!data?.[cls]
    } catch {
      return false
    }
  }
  const v = {
    eq: await probe('AudioEqualizer3Band'),
    volume: await probe('AudioAdjustVolume'),
  }
  loudNodeCache.set(base, { t: Date.now(), v })
  return v
}

// Is the ReferenceAudioPrep custom node installed? (comfy_nodes/ReferenceAudioPrep.py —
// samples three windows from a long reference clip so the whole track's
// timbre is captured; without it the full file is encoded and truncated).
const refPrepNodeCache = new Map()
export async function hasReferenceAudioPrep(base) {
  const hit = refPrepNodeCache.get(base)
  if (hit && Date.now() - hit.t < 60000) return hit.v
  let v = false
  try {
    const res = await fetch(`${base}/object_info/ReferenceAudioPrep`)
    if (res.ok) {
      const data = await res.json()
      v = !!data?.ReferenceAudioPrep
    }
  } catch {
    // unreachable → keep false
  }
  refPrepNodeCache.set(base, { t: Date.now(), v })
  return v
}

// Are the bundled seam-blend custom nodes installed? (comfy_nodes/
// AudioCrossfade.py + comfy_nodes/VideoCrossfade.py.) Together they blend a
// chained H3 video's per-window soundtracks AND frames at each join, removing
// the audio clicks and keeping A/V locked (both give up the same duration).
// Without them the builder hard-cuts: AudioConcat audio, dropped boundary frame.
const seamNodeCache = new Map()
async function hasNode(base, className) {
  const key = `${base}|${className}`
  const hit = seamNodeCache.get(key)
  if (hit && Date.now() - hit.t < 60000) return hit.v
  let v = false
  try {
    const res = await fetch(`${base}/object_info/${className}`)
    if (res.ok) {
      const data = await res.json()
      v = !!data?.[className]
    }
  } catch {
    // unreachable → keep false; the graph falls back to a hard cut
  }
  seamNodeCache.set(key, { t: Date.now(), v })
  return v
}
export function hasAudioCrossfade(base) {
  return hasNode(base, 'AudioCrossfade')
}
export function hasVideoCrossfade(base) {
  return hasNode(base, 'VideoCrossfade')
}

// Verify every node class used by a built workflow exists on the server
// BEFORE queueing — a missing pack then reads as an install hint rather
// than ComfyUI's "value not in list" / node-does-not-exist rejection.
export async function assertWorkflowNodes(base, workflow, opts = {}) {
  const classes = [...new Set(Object.values(workflow || {}).map((n) => n?.class_type).filter(Boolean))]
  if (classes.length === 0) return
  await assertNodes(base, classes, opts)
}
