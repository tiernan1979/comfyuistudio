// ---------------------------------------------------------------------------
// Video-driven character sheets — WAN 2.2 i2v (A14B lightx2v 4-step Q4 GGUF).
//
// One keyframe (a Qwen-Image base pose, same subject prompt as pose mode)
// seeds a short WAN 2.2 animation per sheet row; the decoded frames go
// through the same BiRefNet + alpha chain the pose engine uses, so both
// engines end in transparent per-frame PNGs packed by the browser into the
// same sheet / .tres / .json contract.
//
// Sampling follows the reference pipeline
// (github.com/mor-o/comfyui-2d-character-pipeline): ModelSamplingSD3 shift 8,
// 4 steps split 0→2 on the high-noise expert with leftover noise kept,
// 2→∞ on the low-noise expert with no fresh noise, cfg 1, euler/simple —
// and their negative prompt verbatim (at cfg 1 it is inert, but it engages
// if cfg is ever raised, and it documents the reference).
//
// VRAM/RAM discipline: each GGUF expert is ~9.7 GB and this box has 17 GB of
// system RAM as well as 16 GB of VRAM, so the experts must never be resident
// together. The run is therefore split across separate prompts (stage 1
// SaveLatent → stage 2 LoadLatent) with an explicit POST /free between model
// families — NOT a single two-expander graph like the reference (they have a
// VRAMUnloadModel node we don't).
//
// Zero-copy handoffs: both stage transitions pass filenames annotated with
// "[output]" (e.g. "wan22_x/r0_00001_.latent [output]") — ComfyUI 0.42's
// SaveLatent writes into output/ and LoadLatent/LoadImageOutput validate and
// resolve annotated paths against output/. Proven live; no download/upload.
//
// Conditioning note: WanImageToVideo bakes the keyframe into the
// conditioning (concat_latent_image + concat_mask), so BOTH stages must
// rebuild identical conditioning — same keyframe, size and frame count.
//
// Frame rule: WAN latent length must satisfy 4n+1 (WanImageToVideo step 4):
// 9, 13, 17, 21, 25, 33, 49, 81.
// ---------------------------------------------------------------------------

import { SPRITE_ANIMATIONS, directionPhrase, spriteRows } from './workflows.js'

// Valid WAN frame counts (4n+1). Uniform across every row of a video sheet.
export const WAN_FRAME_COUNTS = [9, 13, 17, 21, 25, 33, 49, 81]
export const WAN_FPS = 16
export const WAN_SHIFT = 8
export const WAN_STEPS = 4

// Cells in one video-engine sheet (rows × frames). Pose mode caps at 48
// graphs; video rows pack cheaply but each row costs minutes of sampling,
// so keep accidental 4×81 monsters rare.
export const VIDEO_SHEET_MAX_CELLS = 96

// Defaults for the WAN stack — matches the files on this server; overridable
// via models.character (Settings → Models → Character video).
export const CHARACTER_MODEL_DEFAULTS = {
  high: 'wan2.2_i2v_A14b_high_noise_lightx2v_4step-Q4_K_M.gguf',
  low: 'wan2.2_i2v_A14b_low_noise_lightx2v_4step-Q4_K_M.gguf',
  clip: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
  vae: 'Wan2.1_VAE.safetensors',
}

// Node classes the video engine's graphs touch. Checked once per run with a
// readable install hint instead of letting a half-supported server die
// mid-chain (the chain has already spent minutes on the keyframe by then).
export const CHARACTER_NODES = [
  'UNETLoader',
  'CLIPLoader',
  'VAELoader',
  'CLIPTextEncode',
  'EmptySD3LatentImage',
  'KSampler',
  'UnetLoaderGGUF',
  'ModelSamplingSD3',
  'LoadImageOutput',
  'WanImageToVideo',
  'KSamplerAdvanced',
  'SaveLatent',
  'LoadLatent',
  'VAEDecode',
  'LoadBackgroundRemovalModel',
  'RemoveBackground',
  'ImageFromBatch',
  'InvertMask',
  'JoinImageWithAlpha',
  'ImageScale',
  'ImageBatch',
  'SaveImage',
]

export const CHARACTER_NODE_HINTS = {
  UnetLoaderGGUF: 'city96/ComfyUI-GGUF (loads the WAN 2.2 GGUF experts)',
  RemoveBackground: 'BiRefNet background removal (LoadBackgroundRemovalModel + RemoveBackground)',
  LoadBackgroundRemovalModel: 'BiRefNet background removal (LoadBackgroundRemovalModel + RemoveBackground)',
  LoadImageOutput: 'Load Image Output (ships with ComfyUI ≥ 0.36)',
  WanImageToVideo: 'Wan image-to-video nodes (ships with ComfyUI ≥ 0.3)',
  SaveLatent: 'Save/Load Latent (ships with ComfyUI)',
  LoadLatent: 'Save/Load Latent (ships with ComfyUI)',
  GGUF: 'city96/ComfyUI-GGUF',
}

// Reference negative prompt (verbatim). At cfg 1 the negative conditioning
// is unused; it exists for fidelity with the reference and for anyone who
// raises cfg.
export const WAN_NEGATIVE =
  'face, eyes, mouth, nose, ears, blush, blush marks, pink cheeks, peach cheeks, cheek dots, ' +
  'freckles, hair, hat, clothing, clothes, shirt, pants, shoes, accessories, jewelry, shadow, ' +
  'drop shadow, cast shadow, ground shadow, floor shadow, shading below feet, dark shape under ' +
  'character, ellipse on ground, ground, floor, horizon, surface, flicker, jitter, distorted, ' +
  'extra limbs, warped, color shift, artifacts, blurry'

// Continuous-motion phrasing per animation (the pose engine's hints are
// per-KEYFRAME poses; a video prompt describes the whole loop).
const WAN_MOTION = {
  idle:
    'standing still and breathing gently, chest rising and falling in a calm idle rhythm, ' +
    'weight settling subtly, arms relaxed at the sides, feet planted',
  walk:
    'walking on the spot in a steady repeating loop — contact and passing steps alternating, ' +
    'arms swinging naturally opposite the legs, upright posture',
  run:
    'running on the spot in a fast repeating loop — legs driving and cycling, body leaning ' +
    'slightly forward, arms pumping',
  jump:
    'jumping on the spot in a repeating loop — crouching, launching upward, tucking the legs ' +
    'in mid-air, landing softly with bent knees',
  attack:
    'performing a single melee attack in a repeating loop — wind-up, fast strike forward, ' +
    'then recovering back to guard',
  cast:
    'casting a spell in a repeating loop — arms gathering energy, rising, extending forward ' +
    'in release, then settling back to stance',
  hurt:
    'recoiling from a hit in a repeating loop — upper body snapping back, arms flung up, ' +
    'staggering, then recovering guard',
  death:
    'collapsing in a repeating loop — staggering backward, falling to the ground, going still',
  effect:
    'a small magical effect looping in place — sparks igniting, growing brighter, peaking, ' +
    'then dissipating',
  item: 'holding and presenting a small item with slight steady hand motion, product-shot framing',
  crouch:
    'crouching low in a repeating loop — knees deeply bent, body staying low to the ground, ' +
    'small balanced shifts in place',
  crawl:
    'crawling forward low to the ground in a repeating loop — hands and knees advancing, ' +
    'body staying close to the floor',
  sneak:
    'sneaking forward in a crouched pose in a repeating loop — slow quiet steps, body hunched low',
  climb:
    'climbing upward in a repeating loop — alternating hand and foot reaches, body close to the surface',
  swim:
    'swimming forward in a horizontal pose in a repeating loop — alternating arm strokes, legs kicking gently',
  fall:
    'falling through the air in a repeating loop — arms up and flailing, legs trailing, no ground contact',
  kick:
    'performing a single leg kick in a repeating loop — chambering the knee, snapping the leg forward, ' +
    'then recovering to stance',
  punch:
    'throwing a single punch in a repeating loop — pulling the fist back, driving it straight forward, ' +
    'then recovering to guard',
  block:
    'holding a defensive guard in a repeating loop — arms raised in front, body braced, small steady shifts',
  throw:
    'throwing an object in a repeating loop — drawing the arm back over the shoulder, swinging it forward, ' +
    'then following through',
  dodge:
    'dodging with a quick roll in a repeating loop — ducking low, tucking and rolling, then rising back to stance',
  dig:
    'digging with a shovel in a repeating loop — driving the shovel down into the ground, levering up soil, ' +
    'and tossing it aside',
  push:
    'pushing a heavy object in a repeating loop — leaning forward with both arms extended, straining and stepping',
  sit:
    'sitting down in a repeating loop — lowering to a seated pose, legs forward, small relaxed shifts',
  sleep:
    'lying down sleeping in a repeating loop — lying on the side, gentle slow breathing, staying still',
  wave:
    'waving in a repeating loop — raising one hand to the side and waving it back and forth',
  talk:
    'talking in a repeating loop — small hand gestures and subtle head movement while speaking',
  victory:
    'celebrating in a repeating loop — thrusting both arms up in triumph with a small joyful bounce',
  taunt:
    'taunting in a repeating loop — leaning forward and beckoning with one hand, then arms out wide',
  shoot:
    'firing a bow in a repeating loop — drawing the string back to aim, releasing, then recovering',
  charge:
    'charging up a heavy attack in a repeating loop — crouching and drawing the arms back as energy builds, ' +
    'then unwinding forward',
  knockdown:
    'being knocked down in a repeating loop — flung backward, falling, and lying dazed on the ground',
  getup:
    'getting up in a repeating loop — pushing up from the ground, rising to one knee, then standing',
  loot:
    'picking up an item in a repeating loop — bending down, grabbing an object, and standing back up',
  open:
    'opening a door or chest in a repeating loop — reaching forward, pushing or lifting it open, then stepping back',
  chop:
    'chopping with an axe in a repeating loop — raising the axe overhead and swinging it down',
  mine:
    'swinging a pickaxe in a repeating loop — raising it over the shoulder and driving it down',
  fish:
    'fishing in a repeating loop — holding a rod forward, waiting, then reeling in',
}

// Starting pose for the keyframe (the video's first frame). Standing works for
// most loops, but crawling/swimming/falling would otherwise morph in from a
// stance and never close the loop. Keyed by animation; missing → standing.
const WAN_START_POSE = {
  crouch: 'crouched low, knees deeply bent',
  crawl: 'down on hands and knees, body low and horizontal',
  sneak: 'crouched low, ready to creep forward',
  climb: 'gripping a surface, one arm reaching upward',
  swim: 'body horizontal and floating, arms reaching forward',
  fall: 'airborne, legs bent, arms up',
  dig: 'standing slightly bent forward, holding a shovel ready to dig',
  push: 'leaning forward, both arms extended as if pushing',
  dodge: 'low, weight shifted to one side, ready to roll',
  sit: 'seated, legs forward, hands resting',
  sleep: 'lying down on the side, eyes closed',
  knockdown: 'lying on the ground on the back',
  getup: 'on the ground, beginning to push up',
  chop: 'standing, holding an axe ready to swing',
  mine: 'standing, holding a pickaxe ready to swing',
  fish: 'standing, holding a fishing rod forward',
  shoot: 'standing, holding a bow, ready to draw',
  open: 'standing with one hand reaching forward',
  loot: 'standing, about to bend down',
  charge: 'standing, crouched, gathering power',
}

export function snapWanFrames(n) {
  const v = Math.round(Number(n) || 13)
  return WAN_FRAME_COUNTS.reduce((best, c) => (Math.abs(c - v) < Math.abs(best - v) ? c : best), WAN_FRAME_COUNTS[0])
}

// Uniform per-row frame count for the video engine (every row is one video,
// so all rows share one length — snapped to the 4n+1 rule).
export function videoFramesOf(sp = {}) {
  return snapWanFrames(sp.videoFrames || 13)
}

// Single source of truth for the sheet layout: used by the graph builders,
// the browser-side packer, the settings preview and the generate preflight.
// The video engine forces every row to the snapped video length (ignoring
// per-animation pose counts); pose mode keeps its ragged rows.
export function layoutRows(sp = {}) {
  const base = {
    sheetMode: sp.sheetMode,
    animation: sp.animation,
    animations: sp.animations,
    directions: sp.directions,
    frames: sp.frames,
    animFrames: sp.animFrames,
  }
  if (sp.engine === 'video') {
    return spriteRows({ ...base, forceFrames: videoFramesOf(sp), maxFrames: WAN_FRAME_COUNTS[WAN_FRAME_COUNTS.length - 1] })
  }
  return spriteRows(base)
}

// Positive prompt for one row's video: subject + continuous motion + framing.
export function characterMotionPrompt(subject, animation, direction = '') {
  const anim = SPRITE_ANIMATIONS[animation]
  const motion = WAN_MOTION[animation] || `performing a ${anim?.label || animation} animation loop`
  const who = String(subject || '').trim() || 'a game character'
  return (
    `${who}, ${motion}.${directionPhrase(direction)} Full body, single subject, centred in frame, ` +
    'plain flat white background, one consistent character throughout, clean 2D game sprite look, ' +
    'flat colours, even lighting, steady looping animation with no cuts or camera movement.'
  )
}

export function characterStartPose(animation) {
  return WAN_START_POSE[animation] || 'neutral standing pose'
}

// Stage 0 — the keyframe. Same base-pose generation pose mode starts from,
// but saved alone (flat per-run subfolder) so stage 1 can load it straight
// out of output/ with a "[output]" annotated path.
export function buildCharacterKeyframeWorkflow({
  subject = '',
  pose = 'neutral standing pose',
  genSize = 1024,
  seed = -1,
  steps = 20,
  cfg = 4,
  prefix = 'wan_key',
  models = {},
} = {}) {
  const actualSeed = seed === -1 ? Math.floor(Math.random() * 2 ** 48) : seed
  const gen = Math.max(256, Math.min(2048, Math.round(genSize / 8) * 8))
  const basePrompt =
    `${subject}, full body, ${pose}, centred, plain flat white background, ` +
    'single character, game sprite, high detail'
  const baseNeg =
    'multiple characters, duplicate, cropped, out of frame, extra limbs, extra arms, ' +
    'text, watermark, signature, busy background, scenery'
  return {
    u1: { class_type: 'UNETLoader', inputs: { unet_name: models.unet, weight_dtype: 'default' } },
    cl: { class_type: 'CLIPLoader', inputs: { clip_name: models.clip, type: 'qwen_image', device: 'default' } },
    ve: { class_type: 'VAELoader', inputs: { vae_name: models.vae } },
    bp: { class_type: 'CLIPTextEncode', inputs: { clip: ['cl', 0], text: basePrompt } },
    bn: { class_type: 'CLIPTextEncode', inputs: { clip: ['cl', 0], text: baseNeg } },
    bl: { class_type: 'EmptySD3LatentImage', inputs: { width: gen, height: gen, batch_size: 1 } },
    bk: {
      class_type: 'KSampler',
      inputs: {
        model: ['u1', 0],
        positive: ['bp', 0],
        negative: ['bn', 0],
        latent_image: ['bl', 0],
        seed: actualSeed,
        steps,
        cfg,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1,
      },
    },
    bd: { class_type: 'VAEDecode', inputs: { samples: ['bk', 0], vae: ['ve', 0] } },
    out: { class_type: 'SaveImage', inputs: { images: ['bd', 0], filename_prefix: prefix } },
  }
}

function ggufLoader(model_name) {
  // city96/ComfyUI-GGUF's own loader — the pack is required for GGUF WAN
  // experts regardless, and using its loader keeps the graph on one pack.
  return {
    class_type: 'UnetLoaderGGUF',
    inputs: { unet_name: model_name },
  }
}

// Shared conditioning block for stages 1 and 2 — must be IDENTICAL in both
// (the keyframe latents are concatenated into the conditioning), differing
// only in which model samples it.
function wanConditioning({ keyframe, motion, width, height, frames, clip, vae }) {
  return {
    cl: { class_type: 'CLIPLoader', inputs: { clip_name: clip, type: 'wan', device: 'default' } },
    ve: { class_type: 'VAELoader', inputs: { vae_name: vae } },
    kf: { class_type: 'LoadImageOutput', inputs: { image: keyframe } },
    tp: { class_type: 'CLIPTextEncode', inputs: { clip: ['cl', 0], text: motion } },
    tn: { class_type: 'CLIPTextEncode', inputs: { clip: ['cl', 0], text: WAN_NEGATIVE } },
    wv: {
      class_type: 'WanImageToVideo',
      inputs: {
        positive: ['tp', 0],
        negative: ['tn', 0],
        vae: ['ve', 0],
        width,
        height,
        length: frames,
        batch_size: 1,
        start_image: ['kf', 0],
      },
    },
  }
}

// Stage 1 — high-noise expert, first half of the schedule (0→2 of 4 steps),
// leftover noise kept, latent parked in output/.
export function buildCharacterStage1Workflow({
  keyframe = '',
  motion = '',
  width = 512,
  height = 512,
  frames = 13,
  seed = 1,
  prefix = 'wan22/stage',
  character = {},
} = {}) {
  const c = { ...CHARACTER_MODEL_DEFAULTS, ...character }
  return {
    uh: ggufLoader(c.high),
    ms: { class_type: 'ModelSamplingSD3', inputs: { model: ['uh', 0], shift: WAN_SHIFT } },
    ...wanConditioning({ keyframe, motion, width, height, frames, clip: c.clip, vae: c.vae }),
    ks: {
      class_type: 'KSamplerAdvanced',
      inputs: {
        model: ['ms', 0],
        add_noise: 'enable',
        noise_seed: seed,
        steps: WAN_STEPS,
        cfg: 1,
        sampler_name: 'euler',
        scheduler: 'simple',
        positive: ['wv', 0],
        negative: ['wv', 1],
        latent_image: ['wv', 2],
        start_at_step: 0,
        end_at_step: 2,
        return_with_leftover_noise: 'enable',
      },
    },
    out: { class_type: 'SaveLatent', inputs: { samples: ['ks', 0], filename_prefix: prefix } },
  }
}

// Stage 2 — low-noise expert continues the same noise trajectory (2→∞, no
// fresh noise), then decodes the video straight into the transparent-frame
// tail: split the decoded batch into frames, BiRefNet background removal,
// invert (RemoveBackground's mask is HIGH on the background), join alpha,
// scale to the sheet cell, re-batch, save row-major like pose mode.
export function buildCharacterStage2Workflow({
  keyframe = '',
  motion = '',
  width = 512,
  height = 512,
  frames = 13,
  latent = '',
  seed = 1,
  cellSize = 256,
  character = {},
} = {}) {
  const c = { ...CHARACTER_MODEL_DEFAULTS, ...character }
  const px = Math.max(32, Math.min(2048, Math.round(cellSize)))
  const wf = {
    ul: ggufLoader(c.low),
    ms: { class_type: 'ModelSamplingSD3', inputs: { model: ['ul', 0], shift: WAN_SHIFT } },
    ...wanConditioning({ keyframe, motion, width, height, frames, clip: c.clip, vae: c.vae }),
    ld: { class_type: 'LoadLatent', inputs: { latent } },
    ks: {
      class_type: 'KSamplerAdvanced',
      inputs: {
        model: ['ms', 0],
        add_noise: 'disable',
        noise_seed: seed,
        steps: WAN_STEPS,
        cfg: 1,
        sampler_name: 'euler',
        scheduler: 'simple',
        positive: ['wv', 0],
        negative: ['wv', 1],
        latent_image: ['ld', 0],
        start_at_step: 2,
        end_at_step: 10000,
        return_with_leftover_noise: 'disable',
      },
    },
    dc: { class_type: 'VAEDecode', inputs: { samples: ['ks', 0], vae: ['ve', 0] } },
    bg: { class_type: 'LoadBackgroundRemovalModel', inputs: { bg_removal_name: 'birefnet.safetensors' } },
  }

  // Per-frame tail. Frames are emitted in batch order = row-major order the
  // packer expects (SaveImage writes one file per batch element, in order).
  let batch = null
  for (let i = 0; i < frames; i++) {
    wf[`i${i}`] = { class_type: 'ImageFromBatch', inputs: { image: ['dc', 0], batch_index: i, length: 1 } }
    wf[`m${i}`] = { class_type: 'RemoveBackground', inputs: { bg_removal_model: ['bg', 0], image: [`i${i}`, 0] } }
    // RemoveBackground's mask is HIGH on the background; JoinImageWithAlpha
    // zeroes RGB where alpha is 0 — without InvertMask the subject blacks out.
    wf[`v${i}`] = { class_type: 'InvertMask', inputs: { mask: [`m${i}`, 0] } }
    wf[`a${i}`] = { class_type: 'JoinImageWithAlpha', inputs: { image: [`i${i}`, 0], alpha: [`v${i}`, 0] } }
    wf[`s${i}`] = {
      class_type: 'ImageScale',
      inputs: { image: [`a${i}`, 0], upscale_method: 'lanczos', width: px, height: px, crop: 'disabled' },
    }
    if (batch === null) {
      batch = [`s${i}`, 0]
    } else {
      wf[`b${i}`] = { class_type: 'ImageBatch', inputs: { image1: batch, image2: [`s${i}`, 0] } }
      batch = [`b${i}`, 0]
    }
  }
  wf.out = { class_type: 'SaveImage', inputs: { images: batch, filename_prefix: 'sprite/frame' } }
  return wf
}
