const ASPECT_RATIOS = {
  '1:1': { width: 1328, height: 1328 },
  '16:9': { width: 1664, height: 928 },
  '9:16': { width: 928, height: 1664 },
  '4:3': { width: 1472, height: 1140 },
  '3:4': { width: 1140, height: 1472 },
  '3:2': { width: 1584, height: 1056 },
  '2:3': { width: 1056, height: 1584 },
}

const VIDEO_RESOLUTIONS = {
  '480p': { width: 832, height: 480 },
  '720p': { width: 1280, height: 720 },
  // Fast 1080p: sample at 960×544 (the official H3 "fast" size — 4× fewer
  // tokens than 1920×1088) and upscale with 4x-UltraSharp at the end.
  '1080p-fast': { width: 1920, height: 1080, genWidth: 960, genHeight: 544, upscale: '4x-UltraSharp.pth' },
  '1080p': { width: 1920, height: 1080 },
}

export function buildImageWorkflow({
  prompt,
  negativePrompt = '',
  aspectRatio = '1:1',
  seed = -1,
  steps = 20,
  cfg = 4,
  turboMode = false,
  models,
  upscaleModel = '', // models/upscale_models/*.pth — 4x detail upscale after decode
}) {
  const { width, height } = ASPECT_RATIOS[aspectRatio] || ASPECT_RATIOS['1:1']
  const actualSeed = seed === -1 ? Math.floor(Math.random() * 2 ** 48) : seed

  const workflow = {
    '37': {
      class_type: 'UNETLoader',
      inputs: {
        unet_name: models.unet,
        weight_dtype: 'default',
      },
    },
    '38': {
      class_type: 'CLIPLoader',
      inputs: {
        clip_name: models.clip,
        type: 'qwen_image',
        device: 'default',
      },
    },
    '39': {
      class_type: 'VAELoader',
      inputs: {
        vae_name: models.vae,
      },
    },
    '6': {
      class_type: 'CLIPTextEncode',
      inputs: {
        clip: ['38', 0],
        text: prompt,
      },
    },
    '7': {
      class_type: 'CLIPTextEncode',
      inputs: {
        clip: ['38', 0],
        text: negativePrompt,
      },
    },
    '58': {
      class_type: 'EmptySD3LatentImage',
      inputs: {
        width: width,
        height: height,
        batch_size: 1,
      },
    },
    '3': {
      class_type: 'KSampler',
      inputs: {
        model: ['37', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['58', 0],
        seed: actualSeed,
        control_after_generate: 'randomize',
        steps: turboMode ? 8 : steps,
        cfg: turboMode ? 1 : cfg,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1,
      },
    },
    '8': {
      class_type: 'VAEDecode',
      inputs: {
        samples: ['3', 0],
        vae: ['39', 0],
      },
    },
    '60': {
      class_type: 'SaveImage',
      inputs: {
        images: ['8', 0],
        filename_prefix: 'ComfyUI',
      },
    },
  }

  // If turbo mode, add LoRA and switch nodes
  if (turboMode && models.lora) {
    workflow['73'] = {
      class_type: 'LoraLoaderModelOnly',
      inputs: {
        model: ['37', 0],
        lora_name: models.lora,
        strength_model: 1,
      },
    }
    workflow['78'] = {
      class_type: 'ComfySwitchNode',
      inputs: {
        on_false: ['37', 0],
        on_true: ['73', 0],
        switch: true,
      },
    }
    workflow['66'] = {
      class_type: 'ModelSamplingAuraFlow',
      inputs: {
        model: ['78', 0],
        shift: 3.1,
      },
    }
    workflow['3'].inputs.model = ['66', 0]
  }

  // Optional post-decode detail upscale (API settings.upscale, e.g.
  // 4x-UltraSharp.pth) — same UpscaleModelLoader + ImageUpscaleWithModel
  // pair the video 1080p-fast preset uses.
  if (upscaleModel) {
    workflow['9'] = { class_type: 'UpscaleModelLoader', inputs: { model_name: upscaleModel } }
    workflow['10'] = {
      class_type: 'ImageUpscaleWithModel',
      inputs: { upscale_model: ['9', 0], image: ['8', 0] },
    }
    workflow['60'].inputs.images = ['10', 0]
  }

  return workflow
}

export function buildEditWorkflow({
  prompt,
  negativePrompt = '',
  imageName,
  seed = -1,
  steps = 20,
  cfg = 2.5,
  denoise = 1,
  models,
}) {
  const actualSeed = seed === -1 ? Math.floor(Math.random() * 2 ** 48) : seed

  return {
    '37': {
      class_type: 'UNETLoader',
      inputs: {
        unet_name: models.unet,
        weight_dtype: 'default',
      },
    },
    '38': {
      class_type: 'CLIPLoader',
      inputs: {
        clip_name: models.clip,
        type: 'qwen_image',
        device: 'default',
      },
    },
    '39': {
      class_type: 'VAELoader',
      inputs: {
        vae_name: models.vae,
      },
    },
    '78': {
      class_type: 'LoadImage',
      inputs: {
        image: imageName,
      },
    },
    '76': {
      class_type: 'TextEncodeQwenImageEdit',
      inputs: {
        clip: ['38', 0],
        vae: ['39', 0],
        image: ['78', 0],
        prompt: prompt,
      },
    },
    '77': {
      class_type: 'TextEncodeQwenImageEdit',
      inputs: {
        clip: ['38', 0],
        vae: ['39', 0],
        image: ['78', 0],
        prompt: negativePrompt,
      },
    },
    '88': {
      class_type: 'VAEEncode',
      inputs: {
        pixels: ['78', 0],
        vae: ['39', 0],
      },
    },
    '66': {
      class_type: 'ModelSamplingAuraFlow',
      inputs: {
        model: ['37', 0],
        shift: 3,
      },
    },
    '75': {
      class_type: 'CFGNorm',
      inputs: {
        model: ['66', 0],
        strength: 1,
      },
    },
    '3': {
      class_type: 'KSampler',
      inputs: {
        model: ['75', 0],
        positive: ['76', 0],
        negative: ['77', 0],
        latent_image: ['88', 0],
        seed: actualSeed,
        control_after_generate: 'randomize',
        steps: steps,
        cfg: cfg,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: denoise,
      },
    },
    '8': {
      class_type: 'VAEDecode',
      inputs: {
        samples: ['3', 0],
        vae: ['39', 0],
      },
    },
    '60': {
      class_type: 'SaveImage',
      inputs: {
        images: ['8', 0],
        filename_prefix: 'ComfyUI',
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Sprite sheets (game-ready). One graph:
//   base pose (Qwen-Image) → N pose edits (Qwen-Image-Edit, all from the SAME
//   base image so identity holds) → BiRefNet background removal → RGBA →
//   scale to a fixed cell → ImageGrid pack → SaveImage (transparent PNG).
// The edit model + base model are the same Qwen-Image file on this stack, so
// one UNETLoader feeds both branches.
// ---------------------------------------------------------------------------

// Animation presets: cyclic pose hints the per-frame editor turns into poses.
export const SPRITE_ANIMATIONS = {
  idle: { label: 'Idle', hints: ['subtle breathing, arms relaxed at sides', 'slight bob down, weight settling', 'arms relaxed, chest up', 'slight bob up, shoulders raised'] },
  walk: { label: 'Walk cycle', hints: ['contact — right foot forward, left arm forward', 'passing — legs together, body lifted', 'contact — left foot forward, right arm forward', 'passing — legs together, body lifted'] },
  run: { label: 'Run cycle', hints: ['right leg extended, left arm forward, leaning forward', 'airborne — both legs bent under body', 'left leg extended, right arm forward, leaning forward', 'airborne — legs tucked, arms pumping'] },
  jump: { label: 'Jump', hints: ['deep crouch, knees bent, arms back', 'launch — legs extending, arms swinging up', 'airborne — legs tucked, arms up', 'landing — knees bent, arms out for balance'] },
  attack: { label: 'Attack', hints: ['wind-up — weapon raised back', 'mid-swing — weapon sweeping forward', 'impact — weapon fully extended forward', 'recover — returning to guard'] },
  cast: { label: 'Cast spell', hints: ['arms lowered, gathering energy at hands', 'arms rising, energy building', 'arms extended forward, release', 'settling back to stance'] },
  hurt: { label: 'Hurt / hit', hints: ['recoil — head snapped back, torso back', 'arms flung up, off balance', 'stagger back a step', 'recovering, guard up'] },
  death: { label: 'Death', hints: ['stagger backward', 'falling — torso tilting back', 'down on knees', 'collapsed on the ground'] },
  effect: { label: 'VFX / effect', hints: ['first spark / ignition — small', 'building up — growing', 'peak — brightest and largest', 'dissipating — fading out'] },
  item: { label: 'Item / prop', hints: ['centered product shot'] },
  crouch: { label: 'Crouch', hints: ['crouching low, knees bent, weight on the balls of the feet', 'crouched, hands near the ground, staying low', 'crouched, slight bob, head up and alert', 'crouched, settling back down low'] },
  crawl: { label: 'Crawl', hints: ['on hands and knees, right arm and left knee forward', 'low to the ground, body stretched forward', 'on hands and knees, left arm and right knee forward', 'low to the ground, dragging forward'] },
  sneak: { label: 'Sneak', hints: ['crouched, right foot creeping forward quietly', 'crouched low, weight shifting forward', 'crouched, left foot creeping forward quietly', 'crouched, hunched low and still'] },
  climb: { label: 'Climb', hints: ['reaching up with the right hand, left foot raised', 'pulling up, body close to the surface', 'reaching up with the left hand, right foot raised', 'pulling up, legs pushing'] },
  swim: { label: 'Swim', hints: ['body horizontal, right arm reaching forward', 'arm pulling through the water, head turning', 'body horizontal, left arm reaching forward', 'arm pulling through, legs kicking'] },
  fall: { label: 'Fall', hints: ['airborne, arms up, legs slightly bent', 'falling, arms flailing, legs trailing', 'airborne, body upright, arms out', 'falling, legs tucked slightly'] },
  kick: { label: 'Kick', hints: ['wind-up — weight back, knee raised', 'extending — leg kicking forward fast', 'impact — leg fully extended forward', 'recover — leg returning to stance'] },
  punch: { label: 'Punch', hints: ['wind-up — fist pulled back, guard up', 'extending — arm punching straight forward', 'impact — arm fully extended forward', 'recover — pulling back to guard'] },
  block: { label: 'Block / guard', hints: ['arms raised in front, bracing', 'guard up, weight braced back slightly', 'arms crossed in front, holding', 'guard up, steady and braced'] },
  throw: { label: 'Throw', hints: ['wind-up — arm drawn back over the shoulder', 'mid-throw — arm swinging forward', 'release — arm extended forward', 'follow-through — arm settling down'] },
  dodge: { label: 'Dodge / roll', hints: ['ducking low, weight to one side', 'tucking down, rolling low', 'mid-roll, body curled', 'rising out of the roll back to stance'] },
  dig: { label: 'Dig', hints: ['holding a shovel, driving it into the ground', 'levering down, digging up soil', 'lifting the shovel with a load of dirt', 'tossing the dirt aside, resetting'] },
  push: { label: 'Push', hints: ['leaning forward, arms extended pushing', 'straining, weight into the push', 'arms extended, stepping forward', 'bracing, pushing steadily'] },
  sit: { label: 'Sit', hints: ['lowering down, knees bending to sit', 'seated, legs forward, hands resting', 'seated, slight lean back', 'seated, settling, hands on knees'] },
  sleep: { label: 'Sleep / lie down', hints: ['lying down on one side, eyes closed', 'lying still, breathing slowly', 'lying on the back, arms relaxed', 'lying still and peaceful'] },
  wave: { label: 'Wave', hints: ['raising one arm to the side', 'hand up high, waving', 'arm raised, waving back', 'lowering the arm back down'] },
  talk: { label: 'Talk', hints: ['small open-hand gesture while speaking', 'hands gesturing outward, mid-sentence', 'one hand raised, gesturing', 'hands lowering, finishing'] },
  victory: { label: 'Victory / celebrate', hints: ['arms thrust up in triumph', 'arms up, small jump of joy', 'arms up, chest out', 'arms coming down, pleased'] },
  taunt: { label: 'Taunt / emote', hints: ['leaning forward, beckoning with one hand', 'arms out wide, challenging', 'hands on hips, leaning back', 'gesturing dismissively'] },
  shoot: { label: 'Shoot (bow / ranged)', hints: ['drawing the bowstring back, aiming forward', 'fully drawn, steady aim', 'release — string snapping forward', 'lowering the bow, recovering'] },
  charge: { label: 'Charge attack', hints: ['crouched, gathering power, arms drawn back', 'energy building, body tensing', 'peak charge — arms pulled back, ready', 'unwinding forward on release'] },
  knockdown: { label: 'Knockdown', hints: ['struck, body flung backward', 'falling backward, arms up', 'hitting the ground on the back', 'lying dazed on the ground'] },
  getup: { label: 'Get up', hints: ['on the ground, pushing up with the arms', 'rising to one knee', 'standing up, unsteady', 'back on both feet, recovering'] },
  loot: { label: 'Loot / pick up', hints: ['bending down, reaching to the ground', 'hand on an object, about to grab', 'lifting the object up', 'standing back up with the item'] },
  open: { label: 'Open (door / chest)', hints: ['reaching forward, hand on the handle', 'pushing or lifting the lid open', 'leaning forward, opening wide', 'stepping back, now open'] },
  chop: { label: 'Chop (axe)', hints: ['raising the axe overhead', 'axe held high, ready', 'swinging the axe down fast', 'axe at the bottom, recovering'] },
  mine: { label: 'Mine (pickaxe)', hints: ['raising the pickaxe over the shoulder', 'pickaxe poised, ready', 'swinging the pickaxe down into the rock', 'recoiling, pulling the pickaxe free'] },
  fish: { label: 'Fish', hints: ['holding a fishing rod forward, line cast', 'rod steady, waiting', 'rod bending, reeling in', 'pulling the rod back, landing the catch'] },
}

// Animations that make sense in multiple directions (locomotion + idle).
// Each direction becomes its own ROW in the sheet.
export const DIRECTIONAL_ANIMS = new Set(['idle', 'walk', 'run', 'crawl', 'sneak', 'swim'])

function directionsFor(mode) {
  if (mode === '4way') return ['down', 'left', 'right', 'up']
  if (mode === 'lr') return ['right', 'left']
  return []
}

// Sensible default frame counts per animation (classic character sheets have
// rows of different lengths — idle 4, walk 6, run 8…). Used when multi mode
// doesn't specify its own per-animation counts.
export const SPRITE_ANIMATION_FRAMES = {
  idle: 4, walk: 6, run: 8, jump: 6, attack: 6, cast: 6, hurt: 4, death: 4, effect: 6, item: 1,
  crouch: 4, crawl: 6, sneak: 6, climb: 6, swim: 6, fall: 4, kick: 6, punch: 6, block: 4, throw: 6, dodge: 6, dig: 6, push: 6,
  sit: 4, sleep: 4, wave: 4, talk: 4, victory: 6, taunt: 6, shoot: 6, charge: 6, knockdown: 4, getup: 6, loot: 6, open: 6, chop: 6, mine: 6, fish: 6,
}

// "idle:4,walk:6,attack:6" → { idle:4, walk:6, attack:6 }
function parseFrameCounts(str) {
  const m = {}
  for (const part of String(str || '').split(',')) {
    const [k, v] = part.split(':')
    const key = (k || '').trim()
    const n = parseInt(v, 10)
    if (key && Number.isFinite(n)) m[key] = Math.max(1, Math.min(12, n))
  }
  return m
}

// Expand the sheet spec into rows — ONE animation (optionally per direction)
// per row, each with its OWN frame count (variable-length rows, left-aligned
// on a grid of width = the longest row). Shared by the graph builder AND the
// client-side packer so the two always agree on the layout.
//
// `forceFrames` pins every row to one count (the video engine: all rows are
// videos, all videos share the snapped 4n+1 length); `maxFrames` raises the
// per-row cap for those counts (default 12 = the pose engine's graph cap).
export function spriteRows({
  sheetMode = 'single',
  animation = 'walk',
  animations = [],
  directions = 'none',
  frames = 8,
  animFrames = '',
  forceFrames = 0,
  maxFrames = 12,
} = {}) {
  const overrides = parseFrameCounts(animFrames)
  const countOf = (a) => {
    if (forceFrames) return Math.max(1, Math.min(maxFrames, Math.round(forceFrames)))
    const n = overrides[a] ?? (sheetMode === 'multi' ? SPRITE_ANIMATION_FRAMES[a] : frames) ?? frames
    return Math.max(1, Math.min(maxFrames, Math.round(n)))
  }
  const mk = (anim, dir) => ({
    animation: anim,
    direction: dir,
    name: dir ? `${anim}-${dir}` : anim,
    frames: countOf(anim),
  })
  if (sheetMode !== 'multi') {
    const dirs = DIRECTIONAL_ANIMS.has(animation) ? directionsFor(directions) : []
    return dirs.length ? dirs.map((d) => mk(animation, d)) : [mk(animation, '')]
  }
  const list = (Array.isArray(animations) ? animations : String(animations || '').split(','))
    .map((s) => String(s).trim())
    .filter(Boolean)
  const rows = []
  for (const a of list) {
    const dirs = DIRECTIONAL_ANIMS.has(a) ? directionsFor(directions) : []
    if (dirs.length) for (const d of dirs) rows.push(mk(a, d))
    else rows.push(mk(a, ''))
  }
  return rows.length ? rows : [mk('walk', '')]
}

export function directionPhrase(dir) {
  switch (dir) {
    case 'right':
      return ' Side view — the character faces right.'
    case 'left':
      return ' Side view — the character faces left.'
    case 'down':
      return ' Top-down view — the character faces down (toward the camera).'
    case 'up':
      return ' Top-down view — the character faces up (away from the camera).'
    default:
      return ''
  }
}

function spriteFrameInstruction(subject, animation, i, frames, direction = '') {
  const anim = SPRITE_ANIMATIONS[animation]
  const hint = anim ? anim.hints[i % anim.hints.length] : `pose ${i + 1} of ${frames}`
  const label = anim?.label || 'animation'
  return (
    `${subject}. ${label}, frame ${i + 1} of ${frames} — ${hint}.${directionPhrase(direction)} ` +
    'Keep the EXACT same character: identical body shape, proportions, clothing/armour and colours ' +
    'as the source image; only the pose changes. Full body, single subject, centred, ' +
    'plain flat white background, game sprite.'
  )
}

export function buildSpriteWorkflow({
  subject = '',
  frames = 8,
  cellSize = 256,
  genSize = 1024,
  animation = 'walk',
  sheetMode = 'single',
  animations = [],
  directions = 'none',
  animFrames = '',
  framePrompts = null, // explicit per-frame prompts override the preset hints
  seed = -1,
  steps = 20,
  cfg = 4,
  editSteps = 20,
  editCfg = 2.5,
  models = {},
}) {
  const actualSeed = seed === -1 ? Math.floor(Math.random() * 2 ** 48) : seed
  const rows = spriteRows({ sheetMode, animation, animations, directions, frames, animFrames })
  const total = rows.reduce((n, r) => n + r.frames, 0)
  if (total > 48) {
    throw new Error(
      `Sprite sheet too large: ${rows.length} rows = ${total} frames ` +
        '(max 48). Reduce frames, animations, or directions.',
    )
  }
  const px = Math.max(32, Math.min(2048, Math.round(cellSize)))
  const gen = Math.max(256, Math.min(2048, Math.round(genSize / 8) * 8))
  const basePrompt =
    `${subject}, full body, neutral standing pose, centred, plain flat white background, ` +
    'single character, game sprite, high detail'
  const baseNeg =
    'multiple characters, duplicate, cropped, out of frame, extra limbs, extra arms, ' +
    'text, watermark, signature, busy background, scenery'

  const wf = {
    // Loaders (shared)
    u1: { class_type: 'UNETLoader', inputs: { unet_name: models.unet, weight_dtype: 'default' } },
    cl: { class_type: 'CLIPLoader', inputs: { clip_name: models.clip, type: 'qwen_image', device: 'default' } },
    ve: { class_type: 'VAELoader', inputs: { vae_name: models.vae } },
    bg: { class_type: 'LoadBackgroundRemovalModel', inputs: { bg_removal_name: 'birefnet.safetensors' } },
    // Base pose (Qwen-Image)
    bp: { class_type: 'CLIPTextEncode', inputs: { clip: ['cl', 0], text: basePrompt } },
    bn: { class_type: 'CLIPTextEncode', inputs: { clip: ['cl', 0], text: baseNeg } },
    bl: { class_type: 'EmptySD3LatentImage', inputs: { width: gen, height: gen, batch_size: 1 } },
    bk: {
      class_type: 'KSampler',
      inputs: {
        model: ['u1', 0], positive: ['bp', 0], negative: ['bn', 0], latent_image: ['bl', 0],
        seed: actualSeed, steps, cfg, sampler_name: 'euler', scheduler: 'simple', denoise: 1,
      },
    },
    bd: { class_type: 'VAEDecode', inputs: { samples: ['bk', 0], vae: ['ve', 0] } },
    // Shared edit conditioning (every frame edits the SAME base image)
    af: { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['u1', 0], shift: 3 } },
    cf: { class_type: 'CFGNorm', inputs: { model: ['af', 0], strength: 1 } },
    le: { class_type: 'VAEEncode', inputs: { pixels: ['bd', 0], vae: ['ve', 0] } },
    en: { class_type: 'TextEncodeQwenImageEdit', inputs: { clip: ['cl', 0], vae: ['ve', 0], image: ['bd', 0], prompt: baseNeg } },
  }

  // Frames are emitted row-major (row 0 left→right, then row 1…) so the app
  // can pack each row as its own animation.
  let batch = null
  let idx = 0
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    for (let c = 0; c < row.frames; c++) {
      const f = `f${r}_${c}`
      const text =
        framePrompts?.[idx] || spriteFrameInstruction(subject, row.animation, c, row.frames, row.direction)
      wf[`${f}p`] = { class_type: 'TextEncodeQwenImageEdit', inputs: { clip: ['cl', 0], vae: ['ve', 0], image: ['bd', 0], prompt: text } }
      wf[`${f}k`] = {
        class_type: 'KSampler',
        inputs: {
          model: ['cf', 0], positive: [`${f}p`, 0], negative: ['en', 0], latent_image: ['le', 0],
          seed: actualSeed, steps: editSteps, cfg: editCfg, sampler_name: 'euler', scheduler: 'simple', denoise: 1,
        },
      }
      wf[`${f}d`] = { class_type: 'VAEDecode', inputs: { samples: [`${f}k`, 0], vae: ['ve', 0] } }
      wf[`${f}m`] = { class_type: 'RemoveBackground', inputs: { bg_removal_model: ['bg', 0], image: [`${f}d`, 0] } }
      // RemoveBackground yields a mask that is HIGH (1) on the BACKGROUND and
      // low on the subject — JoinImageWithAlpha also zeroes RGB where alpha is
      // 0, so without inverting, the subject comes out transparent/black.
      wf[`${f}v`] = { class_type: 'InvertMask', inputs: { mask: [`${f}m`, 0] } }
      wf[`${f}a`] = { class_type: 'JoinImageWithAlpha', inputs: { image: [`${f}d`, 0], alpha: [`${f}v`, 0] } }
      wf[`${f}s`] = {
        class_type: 'ImageScale',
        inputs: { image: [`${f}a`, 0], upscale_method: 'lanczos', width: px, height: px, crop: 'disabled' },
      }
      if (batch === null) {
        batch = [`${f}s`, 0]
      } else {
        wf[`${f}b`] = { class_type: 'ImageBatch', inputs: { image1: batch, image2: [`${f}s`, 0] } }
        batch = [`${f}b`, 0]
      }
      idx++
    }
  }

  // Save the transparent per-frame PNGs (SaveImage writes one file per image
  // in the batch). The app packs them into the grid so the sheet KEEPS its
  // alpha channel — KJNodes ImageGrid flattens to RGB and would drop it.
  wf.save = { class_type: 'SaveImage', inputs: { images: batch, filename_prefix: 'sprite/frame' } }
  return wf
}

// ---------------------------------------------------------------------------
// Face-fix (settings toggle threeD.faceFix): face-focused Qwen-Image edit
// passes that run around the 3D pipeline. Faces get ~1-2% of the texels in a
// full-body texture bake, so sharpening the face at source (before mesh gen)
// and on the front paint view (before bake) is where the quality lands.
//
// When ComfyUI/models/detection/ has a MediaPipe face model, a precise
// landmark mask confines the edit to the face oval; otherwise a conservative
// whole-image pass is used and the prompt has to carry the "keep everything
// else identical" constraint.
// ---------------------------------------------------------------------------
export const FACE_ENHANCE_PROMPT =
  'Enhance the face in this image: sharpen the eyes, define the iris, eyelids and eyelashes, ' +
  'add natural fine skin texture, crisp lips and clean facial features. Keep the pose, expression, ' +
  'outfit, colors, lighting, background and composition exactly the same — photorealistic detail only, ' +
  'no style change.'
export const FACE_ENHANCE_NEG =
  'deformed face, warped features, asymmetric eyes, plastic or waxy skin, changed clothes, ' +
  'changed background, blurry, low quality'

const FACE_PAINT_PROMPT =
  'Refine this rendered character view: remove dark speckles, spots, blotches and rendering ' +
  'artifacts from skin, hands and clothing — restore even natural skin tone everywhere ' +
  'including fingertips, clean matte fabric. Photoreal face detail: crisp eyes with clear ' +
  'dark irises, visible pupils, defined eyelids, eyelashes and subtle catchlights, natural ' +
  'skin pores and fine skin texture, defined lips, realistic stubble or beard hair detail ' +
  'where present. Reduce hair and skin glossiness — matte natural finish, not plastic or ' +
  'shiny. Keep the identity, pose, expression, outfit, colors, lighting, framing and ' +
  'background exactly the same — cleanup and photoreal skin only, not a cartoon, painting ' +
  'or illustration.'
const FACE_PAINT_NEG =
  'dark spots, speckles, dirt, blotches, discoloration, dark fingertips, stains, ' +
  'deformed face, melted features, warped eyes, blank eyes, empty eyes, no iris, no pupil, ' +
  'plastic or waxy skin, overly shiny hair, glossy hair, cartoon, anime, painting, ' +
  'illustration, doll-like, airbrushed, changed outfit, changed pose, blur'


// Shared face-mask softening: MediaPipeFaceMask is a hard-edged polygon fill,
// which would leave a visible seam where the edit meets the untouched image.
// FeatherMask only softens the image border, so blur the mask instead.
function addFaceMask(wf, { landmarksNode }) {
  wf['13'] = { class_type: 'MediaPipeFaceMask', inputs: { face_landmarks: [landmarksNode, 0], regions: 'all' } }
  wf['14'] = { class_type: 'MaskToImage', inputs: { mask: ['13', 0] } }
  wf['15'] = { class_type: 'ImageBlur', inputs: { image: ['14', 0], blur_radius: 15, sigma: 2.5 } }
  wf['16'] = { class_type: 'ImageToMask', inputs: { image: ['15', 0], channel: 'red' } }
  return ['16', 0]
}

// First step of the local pipeline: sharpen the face of the source picture
// before the 3D generator ever sees it. Saves under outputName; the caller
// downloads the PNG and re-uploads it for the mesh workflow.
export function buildFaceEnhanceWorkflow({
  imageName,
  outputName = 'facefix',
  models,
  faceModelName = '',
  denoise,
  steps = 20,
  cfg = 2.5,
  seed = -1,
}) {
  const wf = buildEditWorkflow({
    prompt: FACE_ENHANCE_PROMPT,
    negativePrompt: FACE_ENHANCE_NEG,
    imageName,
    seed,
    steps,
    cfg,
    denoise: denoise ?? (faceModelName ? 0.55 : 0.4),
    models,
  })
  wf['60'].inputs.filename_prefix = outputName
  if (faceModelName) {
    wf['41'] = { class_type: 'LoadMediaPipeFaceLandmarker', inputs: { model_name: faceModelName } }
    wf['42'] = {
      class_type: 'MediaPipeFaceLandmarker',
      inputs: {
        face_detection_model: ['41', 0],
        image: ['78', 0],
        detector_variant: 'both',
        num_faces: 1,
        min_confidence: 0.3,
        missing_frame_fallback: 'empty',
      },
    }
    const mask = addFaceMask(wf, { landmarksNode: '42' })
    wf['61'] = {
      class_type: 'ImageCompositeMasked',
      inputs: {
        destination: ['78', 0],
        source: ['8', 0],
        x: 0,
        y: 0,
        resize_source: false,
        mask,
      },
    }
    wf['60'].inputs.images = ['61', 0]
  }
  return wf
}

// ---------------------------------------------------------------------------
// 3D workflows (optional feature, enabled in Settings → 3D Generation)
// ---------------------------------------------------------------------------

function randomHex(len) {
  let s = ''
  for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 16).toString(16)
  return s
}

// Local pipeline, step 1: image → textured GLB using ComfyUI's NATIVE
// Pixal3D / TRELLIS.2 nodes (built into ComfyUI ≥ 0.39 — no custom pack).
// Converted from the official 3d_pixal3d_trellis2_image_to_model template:
// bg-removal → crop → dual conditioning (switched by mode) → structure →
// shape → upsample → texture → remesh/decimate/unwrap → PBR bake → GLB.
export function buildMeshWorkflow({
  imageName,
  mode = 'pixal3d', // 'pixal3d' | 'trellis2'
  seed = Math.floor(Math.random() * 2 ** 32),
  steps = 20,
  guidance = 7.5,
  cameraRes = 1024,
  textureSize = 4096,
  decimation = 300000,
  remesh = true,
  enhance = 'none', // 'none' | 'sharpen' | 'esrgan' | 'magnific4x'
  enhanceModel = '', // upscale_models/*.pth name when enhance === 'esrgan'
  filenameBase = 'mesh',
}) {
  const wf = {

    '3': {
      "class_type": "KSampler",
      "inputs": {
        "model": [
          "108",
          0
        ],
        "seed": 56,
        "steps": 12,
        "cfg": 7.5,
        "sampler_name": "euler",
        "scheduler": "normal",
        "positive": [
          "314",
          0
        ],
        "negative": [
          "315",
          0
        ],
        "latent_image": [
          "87",
          0
        ],
        "denoise": 1
      }
    },
    '12': {
      "class_type": "KSampler",
      "inputs": {
        "model": [
          "318",
          0
        ],
        "seed": 43,
        "steps": 12,
        "cfg": 1,
        "sampler_name": "euler",
        "scheduler": "normal",
        "positive": [
          "98",
          0
        ],
        "negative": [
          "98",
          1
        ],
        "latent_image": [
          "98",
          2
        ],
        "denoise": 1
      }
    },
    '15': {
      "class_type": "CLIPVisionLoader",
      "inputs": {
        "clip_name": "dino_v3_L_naf_fp32.safetensors"
      }
    },
    '18': {
      "class_type": "KSampler",
      "inputs": {
        "model": [
          "126",
          0
        ],
        "seed": 42,
        "steps": 20,
        "cfg": 7.5,
        "sampler_name": "euler",
        "scheduler": "normal",
        "positive": [
          "91",
          0
        ],
        "negative": [
          "91",
          1
        ],
        "latent_image": [
          "91",
          2
        ],
        "denoise": 1
      }
    },
    '23': {
      "class_type": "KSampler",
      "inputs": {
        "model": [
          "126",
          0
        ],
        "seed": 42,
        "steps": 12,
        "cfg": 7.5,
        "sampler_name": "euler",
        "scheduler": "simple",
        "positive": [
          "94",
          0
        ],
        "negative": [
          "94",
          1
        ],
        "latent_image": [
          "94",
          2
        ],
        "denoise": 1
      }
    },
    '40': {
      "class_type": "UNETLoader",
      "inputs": {
        "unet_name": "trellis_2_int8_convrot.safetensors",
        "weight_dtype": "default"
      }
    },
    '87': {
      "class_type": "EmptyTrellis2LatentStructure",
      "inputs": {
        "batch_size": 1
      }
    },
    '91': {
      "class_type": "Trellis2ShapeStage",
      "inputs": {
        "positive": [
          "314",
          0
        ],
        "negative": [
          "315",
          0
        ],
        "voxel": [
          "119",
          0
        ]
      }
    },
    '92': {
      "class_type": "VaeDecodeShapeTrellis",
      "inputs": {
        "samples": [
          "23",
          0
        ],
        "vae": [
          "117",
          0
        ]
      }
    },
    '93': {
      "class_type": "VaeDecodeTextureTrellis",
      "inputs": {
        "samples": [
          "12",
          0
        ],
        "vae": [
          "118",
          0
        ],
        "shape_subdivides": [
          "92",
          1
        ]
      }
    },
    '94': {
      "class_type": "Trellis2UpsampleStage",
      "inputs": {
        "positive": [
          "91",
          0
        ],
        "negative": [
          "91",
          1
        ],
        "shape_latent": [
          "18",
          0
        ],
        "vae": [
          "117",
          0
        ],
        "target_resolution": 1536
      }
    },
    '98': {
      "class_type": "Trellis2TextureStage",
      "inputs": {
        "positive": [
          "94",
          0
        ],
        "negative": [
          "94",
          1
        ],
        "shape_latent": [
          "23",
          0
        ]
      }
    },
    // MoGe FOV branch (official workflow 920c795f693a): depth-estimate the
    // cropped input and derive the true horizontal FOV for Pixal3D
    // conditioning — a fixed 49.13° placeholder distorts geometry on most
    // photos. Runs only in pixal3d mode (TRELLIS.2's conditioning has no
    // camera input, so 298 never executes and these stay lazy).
    '55': {
      "class_type": "LoadMoGeModel",
      "inputs": {
        "model_name": "moge_2_vitl_normal_fp16.safetensors"
      }
    },
    '56': {
      "class_type": "MoGeInference",
      "inputs": {
        "moge_model": [
          "55",
          0
        ],
        "image": [
          "312",
          0
        ],
        "resolution_level": 9,
        "fov_x_degrees": 0,
        "batch_size": 4,
        "force_projection": true,
        "apply_mask": true,
        "refine_steps": 3
      }
    },
    '242': {
      "class_type": "MoGeGeometryToFOV",
      "inputs": {
        "moge_geometry": [
          "56",
          0
        ],
        "axis": "horizontal",
        "unit": "degrees"
      }
    },
    '108': {
      "class_type": "ModelSamplingSD3",
      "inputs": {
        "model": [
          "125",
          0
        ],
        "shift": 5
      }
    },
    '117': {
      "class_type": "VAELoader",
      "inputs": {
        "vae_name": "trellis_2_shape_vae_bf16.safetensors"
      }
    },
    '118': {
      "class_type": "VAELoader",
      "inputs": {
        "vae_name": "trellis_2_texture_vae_bf16.safetensors"
      }
    },
    '119': {
      "class_type": "VaeDecodeStructureTrellis2",
      "inputs": {
        "samples": [
          "3",
          0
        ],
        "vae": [
          "117",
          0
        ],
        "resolution": "32"
      }
    },
    '122': {
      "class_type": "LoadImage",
      "inputs": {
        "image": "cave_wall.png"
      }
    },
    '125': {
      "class_type": "RescaleCFG",
      "inputs": {
        "model": [
          "199",
          0
        ],
        "multiplier": 0.7
      }
    },
    '126': {
      "class_type": "RescaleCFG",
      "inputs": {
        "model": [
          "279",
          0
        ],
        "multiplier": 0.5
      }
    },
    '147': {
      "class_type": "BakeTextureFromVoxel",
      "inputs": {
        "mesh": [
          "196",
          0
        ],
        "voxel_colors": [
          "93",
          0
        ],
        "texture_size": [
          "288",
          0
        ],
        "reference_mesh": [
          "92",
          0
        ]
      }
    },
    '186': {
      "class_type": "DecimateMesh",
      "inputs": {
        "mesh": [
          "241",
          0
        ],
        "target_face_count": 700000,
        "placement_mode": "midpoint"
      }
    },
    '192': {
      "class_type": "RemoveBackground",
      "inputs": {
        "bg_removal_model": [
          "193",
          0
        ],
        "image": [
          "122",
          0
        ]
      }
    },
    '193': {
      "class_type": "LoadBackgroundRemovalModel",
      "inputs": {
        "bg_removal_name": "birefnet.safetensors"
      }
    },
    '196': {
      "class_type": "UnwrapMesh",
      "inputs": {
        "mesh": [
          "238",
          0
        ],
        "segmenter": "pec",
        "resolution": [
          "288",
          0
        ],
        "padding": 1,
        "weld_distance": 0.0002
      }
    },
    '199': {
      "class_type": "CFGOverride",
      "inputs": {
        "model": [
          "318",
          0
        ],
        "cfg": 1,
        "start_percent": 0.667,
        "end_percent": 1
      }
    },
    '202': {
      "class_type": "GetMeshInfo",
      "inputs": {
        "mesh": [
          "92",
          0
        ]
      }
    },
    '210': {
      "class_type": "ApplyTextureToMesh",
      "inputs": {
        "mesh": [
          "196",
          0
        ],
        "base_color": [
          "147",
          0
        ],
        "metallic": [
          "147",
          1
        ],
        "roughness": [
          "147",
          2
        ],
        "occlusion": [
          "233",
          0
        ],
        "normal_map": [
          "224",
          0
        ]
      }
    },
    '224': {
      "class_type": "BakeNormalMapFromMesh",
      "inputs": {
        "low_poly": [
          "196",
          0
        ],
        "high_poly": [
          "241",
          0
        ],
        "resolution": 2048,
        "cage_distance": 0.05,
        "ignore_backfaces": true
      }
    },
    '233': {
      "class_type": "BakeAmbientOcclusion",
      "inputs": {
        "low_poly": [
          "196",
          0
        ],
        "high_poly": [
          "241",
          0
        ],
        "resolution": 1024,
        "samples": 64,
        "max_distance": 0.71,
        "strength": 1,
        "bias": 0.01
      }
    },
    '238': {
      "class_type": "MeshSmoothNormals",
      "inputs": {
        "mesh": [
          "186",
          0
        ],
        "crease_angle": 180
      }
    },
    '241': {
      "class_type": "RemeshMesh",
      "inputs": {
        "mesh": [
          "202",
          0
        ],
        "resolution": 768,
        "sign_mode": "udf",
        "sign_mode.qef": false,
        "sign_mode.drop_inverted_components": false,
        "sign_mode.drop_enclosed_components": false,
        "band": 1,
        "project_back": 0,
        "fix_poles": false,
        "smooth_iters": 20,
        "drop_small_components": 0.01,
        "precluster_max_verts": 20000000
      }
    },
    '248': {
      "class_type": "ComfySwitchNode",
      "inputs": {
        "switch": true,
        "on_false": [
          "122",
          1
        ],
        "on_true": [
          "192",
          0
        ]
      }
    },
    '260': {
      "class_type": "MeshSmoothNormals",
      "inputs": {
        "mesh": [
          "210",
          0
        ],
        "crease_angle": 180
      }
    },
    '279': {
      "class_type": "CFGOverride",
      "inputs": {
        "model": [
          "318",
          0
        ],
        "cfg": 1,
        "start_percent": 0.769,
        "end_percent": 1
      }
    },
    '285': {
      "class_type": "MeshToFile3D",
      "inputs": {
        "mesh": [
          "260",
          0
        ]
      }
    },
    '288': {
      "class_type": "PrimitiveInt",
      "inputs": {
        "value": 4096
      }
    },
    '298': {
      "class_type": "Pixal3DConditioning",
      "inputs": {
        "clip_vision_model": [
          "15",
          0
        ],
        "image": [
          "312",
          0
        ],
        "camera_angle_x": [
          "242",
          0
        ]
      }
    },
    '299': {
      "class_type": "Trellis2Conditioning",
      "inputs": {
        "clip_vision_model": [
          "15",
          0
        ],
        "image": [
          "312",
          0
        ]
      }
    },
    '312': {
      "class_type": "ImageCropToMask",
      "inputs": {
        "images": [
          "122",
          0
        ],
        "masks": [
          "248",
          0
        ],
        "width": 1024,
        "height": 1024,
        "pad_factor": 1.1,
        "grow_mask": 0,
        "background": "#000000"
      }
    },
    '314': {
      "class_type": "ComfySwitchNode",
      "inputs": {
        "switch": [
          "316",
          0
        ],
        "on_false": [
          "298",
          0
        ],
        "on_true": [
          "299",
          0
        ]
      }
    },
    '315': {
      "class_type": "ComfySwitchNode",
      "inputs": {
        "switch": [
          "316",
          0
        ],
        "on_false": [
          "298",
          1
        ],
        "on_true": [
          "299",
          1
        ]
      }
    },
    '316': {
      "class_type": "PrimitiveBoolean",
      "inputs": {
        "value": false
      }
    },
    '318': {
      "class_type": "ComfySwitchNode",
      "inputs": {
        "switch": [
          "316",
          0
        ],
        "on_false": [
          "319",
          0
        ],
        "on_true": [
          "40",
          0
        ]
      }
    },
    '319': {
      "class_type": "UNETLoader",
      "inputs": {
        "unet_name": "pixal3d_int8_convrot.safetensors",
        "weight_dtype": "default"
      }
    },
    '322': {
      "class_type": "Save3DAdvanced",
      "inputs": {
        "model_3d": [
          "285",
          0
        ],
        "filename_prefix": "3d/ComfyUI",
        "viewport_state": "",
        "width": 1024,
        "height": 1024
      }
    },
  }

  // --- parameter injection -------------------------------------------------
  wf['122'].inputs.image = imageName
  // mode: false = pixal3D conditioning+UNET, true = TRELLIS.2 (lazy switches)
  wf['316'].inputs.value = mode === 'trellis2'
  // randomize every sampler (template ships fixed demo seeds)
  wf['3'].inputs.seed = seed
  wf['18'].inputs.seed = seed + 1
  wf['23'].inputs.seed = seed + 2
  wf['12'].inputs.seed = seed + 3
  // shape sampler follows the steps/guidance knobs; structure (12 @ 7.5),
  // upsample (12 @ 7.5) and texture (12 @ cfg 1) keep the official
  // template's tuned values — over-guiding the texture sampler (cfg > 1)
  // wrecks the baked colors.
  wf['18'].inputs.steps = steps
  wf['18'].inputs.cfg = guidance
  wf['23'].inputs.cfg = guidance
  wf['12'].inputs.cfg = 1
  const crop = Math.min(4096, Math.max(64, Math.round(cameraRes / 8) * 8))
  wf['312'].inputs.width = crop
  wf['312'].inputs.height = crop
  wf['288'].inputs.value = textureSize
  wf['186'].inputs.target_face_count = decimation
  wf['322'].inputs.filename_prefix = `3d/${filenameBase}`

  // voxel remesh off: bypass RemeshMesh, everything downstream reads the
  // raw dense mesh (GetMeshInfo is a pass-through)
  if (!remesh) {
    delete wf['241']
    wf['186'].inputs.mesh = ['202', 0]
    wf['224'].inputs.high_poly = ['202', 0]
    wf['233'].inputs.high_poly = ['202', 0]
  }

  // optional source pre-enhance — both the conditioning and the texture bake
  // sample this image, so a sharper input directly sharpens the face.
  if (enhance === 'sharpen') {
    wf['5'] = {
      class_type: 'ImageSharpen',
      inputs: { image: ['122', 0], sharpen_radius: 1, sigma: 1.0, alpha: 1.0 },
    }
    wf['192'].inputs.image = ['5', 0]
    wf['312'].inputs.images = ['5', 0]
  } else if (enhance === 'esrgan' && enhanceModel) {
    wf['5'] = { class_type: 'UpscaleModelLoader', inputs: { model_name: enhanceModel } }
    wf['6'] = {
      class_type: 'ImageUpscaleWithModel',
      inputs: { upscale_model: ['5', 0], image: ['122', 0] },
    }
    wf['192'].inputs.image = ['6', 0]
    wf['312'].inputs.images = ['6', 0]
  } else if (enhance === 'magnific4x') {
    wf['7'] = {
      class_type: 'MagnificImageUpscalerPreciseV2Node',
      inputs: {
        image: ['122', 0],
        scale_factor: '4x',
        flavor: 'photo',
        sharpen: 20,
        smart_grain: 7,
        ultra_detail: 50,
        auto_downscale: true,
      },
    }
    wf['192'].inputs.image = ['7', 0]
    wf['312'].inputs.images = ['7', 0]
  }

  return wf
}

// Local pipeline, step 2: mesh → MIA auto-rig (+ optional Mixamo
// animations). Loads via MeshToolsLoad's mesh_path STRING — a free path, so
// any uploaded name or existing server file works with NO ComfyUI restart
// (the old UniRigLoadMesh file_path dropdown was cached at startup).
export function buildMiaRigWorkflow({
  meshPath, // '3d/foo.glb' — preferred: free string path
  meshName, // legacy: bare name → '3d/<name>'
  precision = 'fp32',
  animationFile = '', // legacy single animation
  animationFiles = [], // multi: one UniRigApplyAnimation node each
  animationType = 'mixamo',
}) {
  const path = String(meshPath || (meshName ? `3d/${meshName}` : ''))
  const meshBase = path.split('/').pop().replace(/\.[^.]+$/, '')
  const anims = [
    ...[].concat(animationFiles || []),
    ...(animationFile ? [animationFile] : []),
  ].filter(Boolean)
  const workflow = {
    '41': {
      class_type: 'MIALoadModel',
      inputs: { precision, attn_backend: 'auto' },
    },
    '27': {
      class_type: 'MeshToolsLoad',
      inputs: { mesh_path: path },
    },
    '42': {
      class_type: 'MIAAutoRig',
      inputs: {
        trimesh: ['27', 0],
        model: ['41', 0],
        fbx_name: `mia_${meshBase}`,
        no_fingers: false,
        use_normal: false,
        reset_to_rest: true,
      },
    },
    '10': {
      class_type: 'UniRigPreviewRiggedMesh',
      inputs: { fbx_output_path: ['42', 0] },
    },
  }

  anims.forEach((file, i) => {
    const animBase = String(file).replace(/\.[^.]+$/, '')
    workflow[String(50 + i)] = {
      class_type: 'UniRigApplyAnimation',
      inputs: {
        model_fbx_path: ['42', 0],
        animation_type: animationType,
        animation_file: file,
        output_name: `${meshBase}_${animBase}`,
      },
    }
  })

  return workflow
}

// Tripo pipeline (cloud, needs ComfyUI signed in to comfy.org / Tripo API):
// one chain — image → model → rig → retarget a preset animation
// (walk/run/jump/…, 116 presets on this box).
// Output sockets (v0.37.0): model_file 0, task_id 1, GLB 2, FBX 3.
export function buildTripoWorkflow({
  imageName,
  modelVersion = 'v3.1-20260211',
  rigVersion = 'v1.0-20240301',
  rigType = 'auto',
  spec = 'tripo',
  outFormat = 'glb',
  preset = 'preset:walk',
  textureQuality = 'standard',
  geometryQuality = 'standard',
  textureAlignment = 'original_image',
  pbr = true,
}) {
  return {
    '1': {
      class_type: 'LoadImage',
      inputs: { image: imageName },
    },
    '2': {
      class_type: 'TripoImageToModelNode',
      inputs: {
        image: ['1', 0],
        model_version: modelVersion,
        texture: true,
        pbr,
        texture_quality: textureQuality,
        texture_alignment: textureAlignment,
        geometry_quality: geometryQuality,
        face_limit: -1,
      },
    },
    '3': {
      class_type: 'TripoRigNode',
      inputs: {
        original_model_task_id: ['2', 1],
        model_version: rigVersion,
        rig_type: rigType,
        // Retarget presets require the tripo spec (mixamo rigs can't take them)
        spec,
        out_format: outFormat,
      },
    },
    '4': {
      class_type: 'TripoRetargetNode',
      inputs: {
        original_model_task_id: ['3', 1],
        animation: preset,
        out_format: outFormat,
        export_with_geometry: true,
        animate_in_place: false,
      },
    },
  }
}

// UltraShape 1.0 mesh refine: coarse mesh + reference image → detailed mesh.
// The pack's own SaveGLB writes to disk but records nothing in history
// (ComfyUI v0.37 drops plain string outputs), so we finish with ComfyUI's
// core SaveGLB + Preview3D — both ui-serialize the FILE_3D so the app can
// download the result.
export function buildUltraShapeWorkflow({
  meshPath,
  imageName,
  checkpoint = 'ultrashape_v1.pt',
  config = 'infer_dit_refine.yaml',
  dtype = 'bfloat16',
  lowVram = true,
  steps = 20,
  guidance = 5.0,
  octree = 384,
  numChunks = 8000,
  numLatents = 16384,
  seed = 42,
  removeBg = false,
  filenamePrefix = '3d/ultrashape',
  bakeOriginalPath = null,
  bakeResolution = 1024,
  decimateTris = 0, // >0: slim the source in-workflow before UltraShape seeds from it
}) {
  const wf = {
    '1': {
      class_type: 'UltraShapeLoadModel',
      inputs: { checkpoint, config, dtype, low_vram: lowVram },
    },
    '3': {
      class_type: 'LoadImage',
      inputs: { image: imageName },
    },
  }
  if (decimateTris > 0) {
    // Dense source (e.g. a 956k-tri Pixal3D export): TRIMESH-chain slim it
    // inside this prompt — MeshToolsLoad reads any relative path (output/
    // included), Postprocess's pymeshlab QEM hits the face budget (the
    // meshlib decimate nodes need a pip package the box doesn't have), and
    // FromTrimesh hands UltraShape a clean coarse seed.
    wf['16'] = { class_type: 'MeshToolsLoad', inputs: { mesh_path: meshPath } }
    wf['17'] = {
      class_type: 'MeshToolsPostprocess',
      inputs: {
        trimesh: ['16', 0],
        remove_floaters: true,
        remove_degenerate_faces: true,
        reduce_faces: true,
        max_facenum: decimateTris,
        smooth_normals: false,
      },
    }
    wf['18'] = {
      class_type: 'UltraShapeLoadCoarseMeshFromTrimesh',
      inputs: { model: ['1', 0], trimesh: ['17', 0] },
    }
  } else {
    wf['2'] = {
      class_type: 'UltraShapeLoadCoarseMesh',
      inputs: { model: ['1', 0], mesh_path: meshPath, num_latents: numLatents },
    }
  }
  wf['4'] = {
    class_type: 'UltraShapeRefine',
    inputs: {
      model: ['1', 0],
      coarse_mesh: decimateTris > 0 ? ['18', 0] : ['2', 0],
      image: ['3', 0],
      steps,
      guidance_scale: guidance,
      octree_resolution: octree,
      num_chunks: numChunks,
      seed,
      remove_bg: removeBg,
    },
  }
  wf['5'] = {
    class_type: 'UltraShapeConvertToGLB',
    inputs: { refined_mesh: ['4', 0], file_format: 'glb' },
  }
  if (!bakeOriginalPath) {
    wf['6'] = {
      class_type: 'SaveGLB',
      inputs: { mesh: ['5', 0], filename_prefix: filenamePrefix },
    }
    wf['7'] = {
      class_type: 'Preview3D',
      inputs: { model_file: ['5', 0] },
    }
    return wf
  }
  // Textured source: UltraShape only outputs geometry, so we keep the
  // ORIGINAL mesh (UV atlas + PBR intact) and bake the refine's detail as
  // normal + AO maps onto its existing UVs. Get3DComponents loads both
  // meshes as editable MESH; ApplyTextureToMesh re-attaches the extracted
  // base/metal/rough maps plus the bakes for SaveGLB/Preview3D.
  Object.assign(wf, {
    '6': {
      class_type: 'Load3DAdvanced',
      inputs: { model_file: bakeOriginalPath, viewport_state: {}, width: 1024, height: 1024 },
    },
    '7': { class_type: 'Get3DComponents', inputs: { model_3d: ['6', 0] } },
    '8': { class_type: 'Get3DComponents', inputs: { model_3d: ['5', 0] } },
    '9': { class_type: 'MeshTextureToImage', inputs: { mesh: ['7', 0] } },
    '10': {
      class_type: 'BakeNormalMapFromMesh',
      inputs: {
        low_poly: ['7', 0],
        high_poly: ['8', 0],
        resolution: bakeResolution,
        cage_distance: 0.05,
        ignore_backfaces: true,
      },
    },
    '11': {
      class_type: 'BakeAmbientOcclusion',
      inputs: {
        low_poly: ['7', 0],
        high_poly: ['8', 0],
        resolution: bakeResolution,
        samples: 64,
        // UltraShape's old defaults (max_distance 0.5, bias 0.01, strength 1)
        // baked a half-black AO map — rays of half the bbox start inside the
        // surface and self-hit, then glTF occlusion darkened the albedo to
        // blotches. Verified on the character mesh: these values keep mean
        // ~178/255 with 0% near-black texels while still adding contact shade.
        max_distance: 0.15,
        strength: 0.85,
        bias: 0.03,
      },
    },
    '12': {
      class_type: 'ApplyTextureToMesh',
      inputs: {
        mesh: ['7', 0],
        base_color: ['9', 0],
        metallic: ['9', 1],
        roughness: ['9', 2],
        occlusion: ['11', 0],
        normal_map: ['10', 0],
      },
    },
    '13': { class_type: 'MeshToFile3D', inputs: { mesh: ['12', 0] } },
    '14': {
      class_type: 'SaveGLB',
      inputs: { mesh: ['13', 0], filename_prefix: filenamePrefix },
    },
    '15': { class_type: 'Preview3D', inputs: { model_file: ['13', 0] } },
  })
  return wf
}

// Hunyuan3D-Paint: skin a mesh (bare UltraShape output, imported GLB, …)
// from the source picture. MeshToolsLoad →6-view camera rig → multiview PBR
// diffusion → bake → inpaint → GLB. Wiring matches the validated smoke run.
export function buildPaintWorkflow({
  meshPath,
  imageName,
  paintModel = 'hunyuan3d-paintpbr-v2-1',
  viewSize = 512,
  steps = 10,
  guidance = 3.0,
  textureSize = 1024,
  seed = 42,
  outputName = 'painted',
  faceFix = null, // { faceModelName, editModels, denoise } | null
  viewUpscale = true, // detail-upscale views before the bake (face sharpness)
}) {
  const wf = {
    '1': { class_type: 'MeshToolsLoad', inputs: { mesh_path: meshPath } },
    '2': {
      class_type: 'Hy3D21CameraConfig',
      inputs: {
        camera_azimuths: '0, 90, 180, 270, 0, 180',
        camera_elevations: '0, 0, 0, 0, 90, -90',
        view_weights: '1, 0.1, 0.5, 0.1, 0.05, 0.05',
        ortho_scale: 1.0,
      },
    },
    '3': { class_type: 'LoadImage', inputs: { image: imageName } },
    '4': {
      class_type: 'Hy3DMultiViewsGenerator',
      inputs: {
        trimesh: ['1', 0],
        camera_config: ['2', 0],
        paint_model: paintModel,
        view_size: viewSize,
        image: ['3', 0],
        steps,
        guidance_scale: guidance,
        texture_size: textureSize,
        unwrap_mesh: true,
        seed,
        diffusion_backend: 'pytorch',
      },
    },
    '5': {
      class_type: 'Hy3DBakeMultiViews',
      inputs: {
        pipeline: ['4', 0],
        camera_config: ['2', 0],
        albedo: ['4', 1],
        mr: ['4', 2],
      },
    },
    '6': {
      class_type: 'Hy3DInPaint',
      inputs: {
        pipeline: ['5', 0],
        albedo: ['5', 1],
        albedo_mask: ['5', 2],
        mr: ['5', 3],
        mr_mask: ['5', 4],
        output_mesh_name: outputName,
      },
    },
  }
  if (faceFix) applyPaintFaceFix(wf, faceFix)
  if (viewUpscale) applyViewUpscale(wf, viewSize)
  return wf
}

// Detail-upscale of the baked views. The atlas only gives the face ~2.5% of
// 4096² (≈650² texels, fragmented islands), while the front view's face is
// ~300² px at view_size 768 — so the bake upsampled a soft view into a
// higher-density atlas and the face came out mushy. Feeding the bake views
// at 2× size with the face view sharpened by 4x-UltraSharp (local model)
// fills the atlas's real face density. The UltraSharp pass only runs for
// views ≤768px (its 4× output stays ≤3072² — larger inputs would OOM the
// conv); bigger views just get a lanczos 2× (they already carry the pixels).
function applyViewUpscale(wf, viewSize) {
  const target = Math.min(Math.max(viewSize * 2, 1024), 2048)
  const albedoSrc = wf['5'].inputs.albedo // ['4',1] or the faceFix-refined batch
  // Node ids: 7-9 + 17-21 — 10-16 belong to faceFix (13-16 = mediapipe mask).
  if (viewSize <= 768) {
    wf['7'] = { class_type: 'UpscaleModelLoader', inputs: { model_name: '4x-UltraSharp.pth' } }
    wf['8'] = { class_type: 'ImageFromBatch', inputs: { image: albedoSrc, batch_index: 0, length: 1 } }
    wf['9'] = { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['7', 0], image: ['8', 0] } }
    wf['17'] = {
      class_type: 'ImageScale',
      inputs: { image: ['9', 0], upscale_method: 'lanczos', width: target, height: target, crop: 'disabled' },
    }
    wf['18'] = { class_type: 'ImageFromBatch', inputs: { image: albedoSrc, batch_index: 1, length: 5 } }
    wf['19'] = {
      class_type: 'ImageScale',
      inputs: { image: ['18', 0], upscale_method: 'lanczos', width: target, height: target, crop: 'disabled' },
    }
    wf['20'] = { class_type: 'ImageBatch', inputs: { image1: ['17', 0], image2: ['19', 0] } }
    wf['5'].inputs.albedo = ['20', 0]
  } else {
    wf['20'] = {
      class_type: 'ImageScale',
      inputs: { image: albedoSrc, upscale_method: 'lanczos', width: target, height: target, crop: 'disabled' },
    }
    wf['5'].inputs.albedo = ['20', 0]
  }
  wf['21'] = {
    class_type: 'ImageScale',
    inputs: { image: ['4', 2], upscale_method: 'lanczos', width: target, height: target, crop: 'disabled' },
  }
  wf['5'].inputs.mr = ['21', 0]
}

// Face pass inside the paint run: after the 6 views are generated (node 4)
// and before they are baked (node 5), run a Qwen-Image face refine on the
// FRONT view only (camera azimuth list starts at 0), then rebuild the albedo
// batch so the bake sees the fixed view in slot 0. mr and pipeline are
// untouched. With a MediaPipe model the edit is confined to a blurred face
// mask; without one it's a low-denoise global refine of the front view
// (the front view dominates the bake at view weight 1.0).
function applyPaintFaceFix(wf, { faceModelName = '', editModels, denoise = 0.45 }) {
  wf['10'] = { class_type: 'ImageFromBatch', inputs: { image: ['4', 1], batch_index: 0, length: 1 } }

  let refined = ['78', 0]
  if (faceModelName) {
    wf['11'] = { class_type: 'LoadMediaPipeFaceLandmarker', inputs: { model_name: faceModelName } }
    wf['12'] = {
      class_type: 'MediaPipeFaceLandmarker',
      inputs: {
        face_detection_model: ['11', 0],
        image: ['10', 0],
        detector_variant: 'both',
        num_faces: 1,
        min_confidence: 0.3,
        missing_frame_fallback: 'empty',
      },
    }
    const mask = addFaceMask(wf, { landmarksNode: '12' })
    wf['61'] = {
      class_type: 'ImageCompositeMasked',
      inputs: { destination: ['10', 0], source: ['78', 0], x: 0, y: 0, resize_source: false, mask },
    }
    refined = ['61', 0]
  } else {
    // VAEDecode straight into ImageBatch deterministically poisons the bake's
    // raw texture output (diagnosed against the live server: direct path G/G2
    // byte-identical garbage, composite path Q/Q2 byte-identical clean with
    // identical pixel values). Materialize the refined pixels through a
    // full-opacity composite so the bake sees a fresh tensor; sized from the
    // view generator so non-512 view sizes still match.
    const vs = wf['4']?.inputs?.view_size ?? 512
    wf['64'] = { class_type: 'SolidMask', inputs: { value: 1, width: vs, height: vs } }
    wf['61'] = {
      class_type: 'ImageCompositeMasked',
      inputs: { destination: ['10', 0], source: ['78', 0], x: 0, y: 0, resize_source: false, mask: ['64', 0] },
    }
    refined = ['61', 0]
  }

  // Qwen-Image img2img on the front view (same verified stack as the edit tab).
  wf['37'] = { class_type: 'UNETLoader', inputs: { unet_name: editModels.unet, weight_dtype: 'default' } }
  wf['38'] = {
    class_type: 'CLIPLoader',
    inputs: { clip_name: editModels.clip, type: 'qwen_image', device: 'default' },
  }
  wf['39'] = { class_type: 'VAELoader', inputs: { vae_name: editModels.vae } }
  wf['76'] = {
    class_type: 'TextEncodeQwenImageEdit',
    inputs: { clip: ['38', 0], vae: ['39', 0], image: ['10', 0], prompt: FACE_PAINT_PROMPT },
  }
  wf['77'] = {
    class_type: 'TextEncodeQwenImageEdit',
    inputs: { clip: ['38', 0], vae: ['39', 0], image: ['10', 0], prompt: FACE_PAINT_NEG },
  }
  wf['88'] = { class_type: 'VAEEncode', inputs: { pixels: ['10', 0], vae: ['39', 0] } }
  wf['66'] = { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['37', 0], shift: 3 } }
  wf['75'] = { class_type: 'CFGNorm', inputs: { model: ['66', 0], strength: 1 } }
  wf['73'] = {
    class_type: 'KSampler',
    inputs: {
      model: ['75', 0],
      positive: ['76', 0],
      negative: ['77', 0],
      latent_image: ['88', 0],
      seed: 1234,
      control_after_generate: 'fixed',
      steps: 18,
      cfg: 2.5,
      sampler_name: 'euler',
      scheduler: 'simple',
      denoise,
    },
  }
  wf['78'] = { class_type: 'VAEDecode', inputs: { samples: ['73', 0], vae: ['39', 0] } }

  // Rebuild the 6-view albedo batch: refined front + views 1..5 untouched.
  wf['62'] = { class_type: 'ImageFromBatch', inputs: { image: ['4', 1], batch_index: 1, length: 5 } }
  wf['63'] = { class_type: 'ImageBatch', inputs: { image1: refined, image2: ['62', 0] } }
  wf['5'].inputs.albedo = ['63', 0]
}

// ---------------------------------------------------------------------------
// Music workflow — MiniMax Music 3 (DiT + Music3 text encoder + audio VAE).
// Verified live against ComfyUI 0.37: UNETLoader + CLIPLoader(type 'minimax')
// → MiniMaxMusic3TextEncode (guidance lives HERE, so the sampler runs cfg 1.0
// with a zeroed negative) → KSampler → VAEDecodeAudio → SaveAudio/MP3.
// 8s of music generates in ~20s on an RTX 5060 Ti 16GB.
// ---------------------------------------------------------------------------
// AI-part caption builder: wraps a raw part description ("baseline dum
// dum…", "isolated guitar loop") in a solo-stem production description
// with a hard vocal ban — MiniMax Music 3 otherwise hallucinates singing
// from a bare prompt even with empty lyrics.
const PART_INSTRUMENTAL_BAN =
  'Strictly instrumental — no vocals, no singing, no lyrics, no vocal samples, no choir, no ad-libs.'

export function buildPartCaption(text) {
  const raw = (text || '').trim().replace(/[.\s]+$/, '')
  if (!raw) return ''
  const hasBan = /no vocals|no singing|strictly instrumental|instrumental only/i.test(raw)
  return (
    `${raw} — a soloed stem-like part for a modern track, only the instrument(s) ` +
    `described above, clean dry studio recording, tight and in-tune, continuous ` +
    `loopable phrase, modern mix, high quality production.` +
    (hasBan ? '' : ` ${PART_INSTRUMENTAL_BAN}`)
  )
}

// MiniMax Music3 has NO text negative prompt — the text encoder only takes
// caption + lyrics. (The graph's negative is a zeroed conditioning sampled
// at the official cfg 1.7: guidance amplification, not a text negative.) Users coming from other tools paste "Negative Prompt: ..." blocks
// into the caption; the model would read that list as POSITIVE description
// (literally conditioning on "vocals, singing, ..." — the opposite of the
// intent). Split that section out and re-phrase it as an in-caption ban,
// which is the phrasing that works for this model.
export function splitNegativeSection(text) {
  const s = (text || '').trim()
  const m = s.match(/(?:^|\n|[.!?][ \t]+)(?:negative\s*prompt|avoid)\s*:[ \t]*([\s\S]+)$/i)
  if (!m) return { caption: text || '', banned: [] }
  const banned = m[1]
    .split(/[,;\n]+/)
    .map((x) => x.trim().replace(/[.\s]+$/, ''))
    .filter(Boolean)
  return { caption: s.slice(0, m.index).trim(), banned }
}

function bannedClause(items, existing) {
  const hay = (existing || '').toLowerCase()
  const fresh = []
  for (const raw of items || []) {
    const word = raw.replace(/^no\s+/i, '').trim()
    if (!word || hay.includes(word.toLowerCase())) continue
    fresh.push(word)
  }
  if (!fresh.length) return ''
  const words = fresh.map((w) => 'no ' + w)
  const clause = words.join(', ')
  return ' ' + clause.charAt(0).toUpperCase() + clause.slice(1) + '.'
}

// Default section map used when the lyrics box is empty (and shown as the
// box's default text). MiniMax Music3 treats [Tag] lines as executable song
// structure; a section map is what makes the AR planner actually USE the
// requested duration instead of ending after 15-40s.
import { plannerCapDuration } from './llm.js'

export const STRUCTURE_TAGS = '[Intro]\n\n[Verse]\n\n[Pre-Chorus]\n\n[Chorus]\n\n[Post-Chorus]\n\n[Bridge]\n\n[Instrumental]\n\n[Solo]\n\n[Outro]'

function stripStructureTags(text) {
  return (text || '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim()
}

// Lyrics semantics: empty → inject the default section map; tag-only input
// counts as INSTRUMENTAL (the vocal ban still applies — tags describe
// structure, not vocals); real words → sung lyrics, caption left alone.
export function normalizeLyrics(lyrics, structure = true) {
  const t = (lyrics || '').trim()
  const text = t || (structure ? STRUCTURE_TAGS : '')
  return { text, instrumental: stripStructureTags(text) === '' }
}

// Loudness post-processing: the raw decode comes out quiet and thin. When
// the server has the core audio nodes, chain a 3-band EQ (bass boost) and a
// volume lift between decode and save. Values are conservative — bass shelf
// +4dB at 100Hz for depth, +2dB overall gain — enough to feel loud without
// clipping. IDs start at 70 to clear the 55–60 save/trim nodes. Returns the
// updated audioRef plus the next free id.
function applyLoudness(wf, startId, audioRef, models) {
  let id = startId
  let ref = audioRef
  if (models.loudEq) {
    wf[String(id)] = {
      class_type: 'AudioEqualizer3Band',
      inputs: {
        audio: ref,
        low_gain_dB: 4.0,
        low_freq: 100,
        mid_gain_dB: 0.0,
        mid_freq: 1000,
        mid_q: 0.7,
        high_gain_dB: 1.0,
        high_freq: 5000,
      },
    }
    ref = [String(id), 0]
    id++
  }
  if (models.loudVolume) {
    wf[String(id)] = {
      class_type: 'AudioAdjustVolume',
      inputs: { audio: ref, volume: 2 },
    }
    ref = [String(id), 0]
    id++
  }
  return { audioRef: ref, nextId: id }
}

export function buildMusicWorkflow({
  caption, // style / instrumentation description (the main prompt)
  negativePrompt = '', // merged into an in-caption "no X, no Y" ban clause
  lyrics = '', // sung lyrics; '' = default section map (instrumental)
  structure = true, // inject STRUCTURE_TAGS when lyrics are empty
  // Cap in seconds for the AR structure planner (the music "Max length"
  // knob, 10–360). The planner ends the song when the music is done —
  // this only bounds how long it may keep planning (default 5 minutes).
  // Part/stem generation passes its own short duration explicitly.
  duration = 300,
  seed = -1,
  steps = 30, // official template default
  cfgScale = 1.7, // MiniMaxMusic3TextEncode.cfg_scale (official template)
  quality = '320k', // 'wav' | '320k' | 'V0' | '128k'
  // ACE-Step only: uploaded reference-audio filename (timbre/style source).
  referenceAudio = '',
  // SFX (Studio mode "sfx"): require the ACE-Step engine — MiniMax Music 3
  // cannot render sound effects, so a MiniMax-resolved model is an error.
  forceAce = false,
  // Sound-effect mode: keep the prompt LITERAL. The music caption assembly
  // (the "strictly instrumental — no vocals…" ban clause and folding the
  // negative into the positive) reads as music direction to the audio model
  // and measurably hurts sound-effect fidelity, so SFX uses the raw caption
  // and passes the negative through the engine's own negative conditioning.
  sfx = false,
  models,
}) {
  const actualSeed = seed === -1 ? Math.floor(Math.random() * 2 ** 48) : seed

  // Empty lyrics = instrumental. The model still hallucinates vocals from
  // bare prompts, so pin the intent down in the caption itself (skipped
  // when the caller already bans vocals, e.g. buildPartCaption).
  const { text: lyricText, instrumental } = normalizeLyrics(lyrics, structure)
  const { caption: rawCaption, banned: sectionBanned } = splitNegativeSection(caption)
  const trimmedCaption = (rawCaption || '').trim()
  const hasBan = /no vocals|no singing|strictly instrumental/i.test(trimmedCaption)
  const baseCaption = !instrumental
    ? trimmedCaption
    : hasBan || !trimmedCaption
      ? trimmedCaption || `${PART_INSTRUMENTAL_BAN}`
      : `${trimmedCaption.replace(/[.\s]+$/, '')}. ${PART_INSTRUMENTAL_BAN}`
  const negItems = [
    ...sectionBanned,
    ...(negativePrompt || '').split(/[,;\n]+/).map((x) => x.trim().replace(/[.\s]+$/, '')).filter(Boolean),
  ]
  // SFX keeps the caption literal (no ban clause / negative folding).
  const fullCaption = sfx ? trimmedCaption : baseCaption + bannedClause(negItems, baseCaption)

  // ACE-Step 1.5 (ComfyUI-ACE-Step) shares the MiniMax music slot but has a
  // completely different stack (qwen ACE text encoders / AIO checkpoint, its
  // own latent + encoder). Detect it and build its graph from the resolved
  // { ace } assets instead of the MiniMax trio.
  if (forceAce && !isAceStepModel(models.unet) && !models.ace) {
    throw new Error(
      'SFX needs the ACE-Step engine — no ACE-Step model resolved on the ComfyUI server. ' +
        'Install ace_step_1.5_turbo_aio.safetensors in models/checkpoints/.',
    )
  }
  if (isAceStepModel(models.unet) || models.ace) {
    if (!models.ace) {
      throw new Error(
        `ACE-Step music model "${models.unet}" needs its text encoder/VAE resolved on the ComfyUI server — ` +
          'either the AIO checkpoint (ace_step_1.5_*_aio*.safetensors) or the split set ' +
          '(qwen_0.6b_ace15 + qwen_1.7b_ace15 text encoders + ace_1.5_vae). ' +
          'Install the missing files or pick MiniMax Music 3 in Settings → Music Models.',
      )
    }
    return buildAceStepWorkflow({
      caption: fullCaption, lyrics: lyricText, duration, seed: actualSeed, quality, cfgScale, referenceAudio, models,
    })
  }

  // Stable Audio 3 — the SFX-oriented engine. Shares the music slot but has a
  // completely different native-node stack (CheckpointLoaderSimple + a T5Gemma
  // text encoder via CLIPLoader type 'stable_audio' + ConditioningStableAudio).
  // Its `stable` assets are resolved by resolveStableAudioModels in comfyui.js.
  if (isStableAudioModel(models.unet) || models.engine === 'stable_audio') {
    if (!models.stable) {
      throw new Error(
        'Stable Audio 3 needs its checkpoint + text encoder resolved on the ComfyUI server — ' +
          'stable_audio_3_*.safetensors in models/checkpoints/ and t5gemma_b_b_ul2.safetensors ' +
          'in models/text_encoders/. Pick it in Settings → Models → Music.',
      )
    }
    return buildStableAudioWorkflow({
      caption: fullCaption,
      negativePrompt: (negativePrompt || '').trim(),
      duration,
      seed: actualSeed,
      quality,
      models,
    })
  }

  const wf = {
    '37': {
      class_type: 'UNETLoader',
      inputs: {
        unet_name: models.unet,
        weight_dtype: 'default',
      },
    },
    '38': {
      class_type: 'CLIPLoader',
      inputs: {
        clip_name: models.clip,
        type: 'minimax',
        device: 'default',
      },
    },
    '39': {
      class_type: 'VAELoader',
      inputs: {
        vae_name: models.vae,
      },
    },
    '40': {
      class_type: 'MiniMaxMusic3TextEncode',
      inputs: {
        clip: ['38', 0],
        caption: fullCaption,
        lyrics: lyricText,
        seed: actualSeed,
        // Cap set ABOVE the requested length (see plannerCapDuration): the
        // planner ends the song when the music is done, so a cap pinned at
        // the request makes the cap the limiter — a 240s ask came back 2:47.
        // The section count drives the real length; headroom just stops the
        // ceiling from cutting it short.
        max_duration: plannerCapDuration(duration),
        cfg_scale: cfgScale,
        top_k: 50,
      },
    },
    '41': {
      class_type: 'EmptyMiniMaxMusic3LatentAudio',
      inputs: {
        // Linked to the text encoder's `seconds` output: the AR structure
        // planner inside MiniMaxMusic3TextEncode can end the song BEFORE
        // max_duration (`<|audio_end|>`). If the latent is sized to the
        // REQUESTED duration instead of the PLANNED one, the DiT samples
        // tens of seconds with no structure plan behind them — the weird,
        // drifting tail users hear in the last 30-60s of a 2-minute mp3.
        // The encode runs first (it feeds the KSampler anyway), so comfy
        // resolves this as a plain float at execution time.
        seconds: ['40', 1],
        batch_size: 1,
      },
    },
    '42': {
      class_type: 'ConditioningZeroOut',
      inputs: {
        conditioning: ['40', 0],
      },
    },
    '3': {
      class_type: 'KSampler',
      inputs: {
        model: ['37', 0],
        positive: ['40', 0],
        negative: ['42', 0],
        latent_image: ['41', 0],
        seed: actualSeed,
        control_after_generate: 'randomize',
        steps,
        // Official ComfyUI template: euler + simple scheduler, cfg 1.7
        // against the zeroed negative (flow-matching model — the old
        // cfg 1.0/normal pairing suppressed CFG entirely).
        cfg: 1.7,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1,
      },
    },
    '8': {
      // Tiled audio decode: the plain VAEDecodeAudio OOMs at the final
      // decode on a 16 GB card (TE + DIT still resident), which burns
      // minutes in failed cudaMalloc retries before ComfyUI falls back
      // to tiling anyway. Tiling from the start is the same result,
      // without the VRAM death spiral.
      class_type: 'VAEDecodeAudioTiled',
      inputs: {
        samples: ['3', 0],
        vae: ['39', 0],
        // Official template value: fewer, longer tiles than the old 512;
        // still far below a full-track decode, which OOMs on 16 GB with
        // the TE + DIT resident.
        tile_size: 1536,
        overlap: 64,
      },
    },
  }

  // Dead-air trim (custom node comfy_nodes/AudioTailTrim.py): MiniMax fills
  // the planned length exactly, so when the song is musically done early
  // the tail is silence codes (measured up to 7.5s on a 30s track). Trim
  // before save so the stored mp3 every client downloads is clean.
  let saveAudio = ['8', 0]
  const loud = applyLoudness(wf, 70, saveAudio, models)
  saveAudio = loud.audioRef
  if (models.trimAudio) {
    wf['55'] = {
      class_type: 'AudioTailTrim',
      inputs: { audio: saveAudio, threshold_db: -50, min_silence: 0.4, keep_tail: 0.3 },
    }
    saveAudio = ['55', 0]
  }

  if (quality === 'wav') {
    wf['60'] = {
      class_type: 'SaveAudio',
      inputs: {
        audio: saveAudio,
        filename_prefix: 'music/track',
      },
    }
  } else {
    wf['60'] = {
      class_type: 'SaveAudioMP3',
      inputs: {
        audio: saveAudio,
        filename_prefix: 'music/track',
        quality: quality === 'V0' || quality === '128k' || quality === '320k' ? quality : '320k',
      },
    }
  }

  return wf
}

// ACE-Step 1.5 family (ComfyUI-ACE-Step pack) — the other music model that
// lives in ComfyUI/models/unet (or diffusion_models) and is selected via
// Settings → Music Models. Kept in sync with looksLikeMusicModel in
// comfyui.js (suite test asserts the families agree).
export const ACE_STEP_RE = /(^|[^a-z])(ace[-_ ]?step|acestep)([^a-z]|$)/i
export function isAceStepModel(name) {
  return ACE_STEP_RE.test(String(name || ''))
}

// Stable Audio 3 — matches stable_audio_3_small_sfx / stable_audio_3_medium
// checkpoints. Kept in sync with looksLikeMusicModel in comfyui.js.
export const STABLE_AUDIO_RE = /(^|[^a-z])(stable[-_ ]?audio|stableaudio)([^a-z]|$)/i
export function isStableAudioModel(name) {
  return STABLE_AUDIO_RE.test(String(name || ''))
}

// ACE-Step 1.5 graph — mirrors the official workflow templates
// (audio_ace_step_1_5_split / _checkpoint): loader → ModelSamplingAuraFlow(3)
// → TextEncodeAceStepAudio1.5 → ConditioningZeroOut → EmptyAceStep1.5LatentAudio
// → KSampler (8 / euler / simple / cfg 1) → VAEDecodeAudio → SaveAudio*.
// Two shapes:
//   { kind: 'split', unet, clip1, clip2, vae }  — UNETLoader + DualCLIPLoader(type 'ace')
//   { kind: 'aio', checkpoint }                 — CheckpointLoaderSimple carries all three
// Optional `ace.plannerClip` (MiniMax music3 text encoder, resolved by
// resolveAceStepModels when the server has it) adds the MiniMax AR structure
// planner node — it outputs a planned length, auto-sizing the track like
// MiniMax (no hard-set time). `duration` then becomes the planner's
// max_duration CAP; without the planner node it stays the exact render length.
export function buildAceStepWorkflow({
  caption = '',
  lyrics = '',
  // Planned-length cap in seconds when the AR planner node is present
  // (MiniMax semantics — model may end earlier, e.g. 24s for a two-line
  // lyric); exact render length otherwise. TE duration and the latent
  // window stay linked either way (official templates wire both from one
  // PrimitiveNode). Default 300 = 5-minute app default; non-positive
  // values (e.g. the -1 auto-sentinel, which ComfyUI's schema rejects at
  // min 0 anyway) fall back to 300.
  duration = 300,
  seed = -1,
  quality = '320k',
  // Planning CFG for the MiniMax AR structure planner (matches the MiniMax
  // path's TE cfg; ACE's own sampler cfg stays distilled at 1).
  cfgScale = 1.7,
  // Uploaded reference-audio filename (LoadAudio combo value in input/).
  // When set, the graph encodes it with the ACE VAE and injects it as
  // timbre conditioning (ReferenceTimbreAudio) — the model uses it as a
  // style/voice reference while still following the caption + lyrics.
  referenceAudio = '',
  models = {},
}) {
  const ace = models.ace
  if (!ace) throw new Error('buildAceStepWorkflow needs models.ace — resolve the ACE assets first')
  const actualSeed = seed === -1 ? Math.floor(Math.random() * 2 ** 48) : seed
  const dur = Number(duration) > 0 ? Number(duration) : 300
  // ACE always uses its own TE for exact duration — the MiniMax AR planner
  // cuts songs short (section-count driven, ends when the form "feels
  // complete"). ACE's TE fills the exact duration you set; AudioTailTrim
  // culls the silence tail when the song ends early.
  const hasPlanner = false
  // AR planner length (node a11 output 1: FLOAT seconds) drives both the
  // TE duration and the latent window; static `dur` otherwise.
  const planned = hasPlanner ? ['a11', 1] : dur
  const wf = {}
  let modelSrc, clipSrc, vaeSrc
  if (ace.kind === 'aio') {
    wf['a1'] = { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ace.checkpoint } }
    modelSrc = ['a1', 0]
    clipSrc = ['a1', 1]
    vaeSrc = ['a1', 2]
  } else {
    wf['a1'] = { class_type: 'UNETLoader', inputs: { unet_name: ace.unet, weight_dtype: 'default' } }
    wf['a2'] = {
      class_type: 'DualCLIPLoader',
      inputs: { clip_name1: ace.clip1, clip_name2: ace.clip2, type: 'ace', device: 'default' },
    }
    wf['a3'] = { class_type: 'VAELoader', inputs: { vae_name: ace.vae } }
    modelSrc = ['a1', 0]
    clipSrc = ['a2', 0]
    vaeSrc = ['a3', 0]
  }
  wf['a4'] = { class_type: 'ModelSamplingAuraFlow', inputs: { model: modelSrc, shift: 3 } }
  if (hasPlanner) {
    // MiniMax AR structure planner (same node the MiniMax music path uses):
    // output 1 is a planned FLOAT length. Live probe: tiny lyric → 24s,
    // full song → 151s, both from one 360s cap. The planner's output feeds
    // ONLY a5.duration + a7.seconds — conditioning stays on the ACE chain.
    wf['a10'] = {
      class_type: 'CLIPLoader',
      inputs: { clip_name: ace.plannerClip, type: 'minimax', device: 'default' },
    }
    wf['a11'] = {
      class_type: 'MiniMaxMusic3TextEncode',
      inputs: {
        clip: ['a10', 0],
        caption,
        lyrics,
        seed: actualSeed,
        // Headroom cap — same as the MiniMax path. The section count drives
        // the real length; this stops the ceiling from cutting it short.
        max_duration: plannerCapDuration(dur),
        cfg_scale: cfgScale,
        top_k: 50,
      },
    }
  }
  wf['a5'] = {
    class_type: 'TextEncodeAceStepAudio1.5',
    inputs: {
      clip: clipSrc,
      tags: caption,
      lyrics,
      seed: actualSeed,
      bpm: 120,
      duration: planned,
      timesignature: '4',
      language: 'en',
      keyscale: 'C major',
      // With a reference latent wired the LLM's audio codes are discarded
      // server-side anyway (pass_audio_codes=False) — skip generating them.
      generate_audio_codes: !referenceAudio,
      // Official template: TE cfg 2 (independent of KSampler cfg below).
      cfg_scale: 2,
      temperature: 0.85,
      top_p: 0.9,
      top_k: 0,
      min_p: 0,
    },
  }
  wf['a6'] = { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['a5', 0] } }
  wf['a7'] = {
    class_type: 'EmptyAceStep1.5LatentAudio',
    inputs: { seconds: planned, batch_size: 1 },
  }
  // Reference-timbre branch (ACE 1.5 only): LoadAudio → [ReferenceAudioPrep]
  // → VAEEncodeAudio → ReferenceTimbreAudio. The encoded latent is attached
  // to the positive conditioning; the sampler then uses it as timbre/structure
  // context while the caption + lyrics still steer content. Experimental native
  // node (ReferenceTimbreAudio) — present in ComfyUI ≥ 0.39 built-ins.
  // ReferenceAudioPrep (custom, comfy_nodes/ReferenceAudioPrep.py) samples
  // three windows from long clips so the whole track's timbre is captured;
  // without it the full file is encoded and truncated to the generation length.
  let positiveSrc = ['a5', 0]
  if (referenceAudio) {
    wf['a12'] = { class_type: 'LoadAudio', inputs: { audio: referenceAudio } }
    const encodeSrc = models.prepReference ? ['a12b', 0] : ['a12', 0]
    if (models.prepReference) {
      wf['a12b'] = {
        class_type: 'ReferenceAudioPrep',
        inputs: { audio: ['a12', 0], window_seconds: 10.0 },
      }
    }
    wf['a13'] = { class_type: 'VAEEncodeAudio', inputs: { audio: encodeSrc, vae: vaeSrc } }
    wf['a14'] = {
      class_type: 'ReferenceTimbreAudio',
      inputs: { conditioning: ['a5', 0], latent: ['a13', 0] },
    }
    positiveSrc = ['a14', 0]
  }
  wf['a8'] = {
    class_type: 'KSampler',
    inputs: {
      model: ['a4', 0],
      positive: positiveSrc,
      negative: ['a6', 0],
      latent_image: ['a7', 0],
      seed: actualSeed,
      control_after_generate: 'randomize',
      // Official ACE-Step 1.5 templates (turbo family): 8 steps, cfg 1 —
      // CFG is baked into the distilled model; MiniMax's steps/cfg knobs
      // don't apply.
      steps: 8,
      cfg: 1,
      sampler_name: 'euler',
      scheduler: 'simple',
      denoise: 1,
    },
  }
  wf['a9'] = {
    // Tiled like the MiniMax path (node 8): plain VAEDecodeAudio on a 16 GB
    // card OOMs/aborts at the final decode when decoding a long track with
    // TE + DIT still resident — a 360s ACE render hard-crashed the Windows
    // prompt worker (Fatal Python error in the audio VAE conv). Same
    // 1536/64 tiling as the MiniMax template.
    class_type: 'VAEDecodeAudioTiled',
    inputs: { samples: ['a8', 0], vae: vaeSrc, tile_size: 1536, overlap: 64 },
  }
  // Dead-air trim (custom node comfy_nodes/AudioTailTrim.py): the LM is
  // force-filled to the planned length, so when the song ends early the
  // tail is silence codes. Trim before save → stored mp3 ends with music.
  let saveAudio = applyLoudness(wf, 'a70', ['a9', 0], models).audioRef
  if (models.trimAudio) {
    wf['a95'] = {
      class_type: 'AudioTailTrim',
      inputs: { audio: saveAudio, threshold_db: -50, min_silence: 0.4, keep_tail: 0.3 },
    }
    saveAudio = ['a95', 0]
  }
  if (quality === 'wav') {
    wf['60'] = { class_type: 'SaveAudio', inputs: { audio: saveAudio, filename_prefix: 'music/track' } }
  } else {
    wf['60'] = {
      class_type: 'SaveAudioMP3',
      inputs: {
        audio: saveAudio,
        filename_prefix: 'music/track',
        quality: quality === 'V0' || quality === '128k' || quality === '320k' ? quality : '320k',
      },
    }
  }
  return wf
}

// Stable Audio 3 graph — native ComfyUI nodes only:
//   CheckpointLoaderSimple(stable_audio_3_*)      → MODEL + VAE
//   CLIPLoader(t5gemma_b_b_ul2, type 'stable_audio') → CLIP
//   CLIPTextEncode ×2 → ConditioningStableAudio(seconds_start/total)
//   → EmptyLatentAudio → KSampler → VAEDecodeAudio → SaveAudio*.
// The checkpoint carries the DiT and the audio VAE but NOT the text encoder,
// so the T5Gemma encoder is loaded separately. Stable Audio 3 checkpoints are
// DISTILLED (LCM): the official ComfyUI template samples with the `lcm`
// sampler, 8 steps, cfg 1, `simple` scheduler — that fixed recipe is used here
// (the MiniMax steps/guidance knobs don't apply). `duration` is clamped to the
// model's window.
export const STABLE_AUDIO_MAX_SECONDS = 47
export function buildStableAudioWorkflow({
  caption = '',
  negativePrompt = '',
  duration = 6,
  seed = -1,
  quality = 'wav',
  models = {},
}) {
  const stable = models.stable
  if (!stable?.checkpoint) {
    throw new Error(
      'buildStableAudioWorkflow needs models.stable — resolve the Stable Audio assets first',
    )
  }
  const actualSeed = seed === -1 ? Math.floor(Math.random() * 2 ** 48) : seed
  const dur = Math.min(
    Math.max(1, Number(duration) > 0 ? Number(duration) : 6),
    STABLE_AUDIO_MAX_SECONDS,
  )
  // No baked-in negative. The previous default banned "noisy"/"distorted" —
  // exactly the texture that impacts (thunder cracks, crashes, breaking glass)
  // are made of — which suppressed the very sounds SFX mode exists for. Use
  // the caller's negative verbatim; empty means no negative conditioning.
  const neg = (negativePrompt || '').trim()
  const wf = {
    s1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: stable.checkpoint } },
    s0: {
      class_type: 'CLIPLoader',
      inputs: { clip_name: stable.clip, type: 'stable_audio', device: 'default' },
    },
    s2: { class_type: 'CLIPTextEncode', inputs: { clip: ['s0', 0], text: caption } },
    s3: { class_type: 'CLIPTextEncode', inputs: { clip: ['s0', 0], text: neg } },
    s4: {
      class_type: 'ConditioningStableAudio',
      inputs: { positive: ['s2', 0], negative: ['s3', 0], seconds_start: 0, seconds_total: dur },
    },
    s5: { class_type: 'EmptyLatentAudio', inputs: { seconds: dur, batch_size: 1 } },
    s6: {
      class_type: 'KSampler',
      inputs: {
        model: ['s1', 0],
        positive: ['s4', 0],
        negative: ['s4', 1],
        latent_image: ['s5', 0],
        seed: actualSeed,
        // Stable Audio 3 ships DISTILLED (LCM) checkpoints — the official
        // ComfyUI template samples with the lcm sampler, 8 steps, cfg 1,
        // simple scheduler. Using a normal 50-step SDE sampler at cfg 7
        // (as for Stable Audio Open) produces the noise/glitch artifacts
        // people hit; cfg > 1 also collapses a distilled model.
        steps: 8,
        cfg: 1,
        sampler_name: 'lcm',
        scheduler: 'simple',
        denoise: 1,
      },
    },
    s7: { class_type: 'VAEDecodeAudio', inputs: { samples: ['s6', 0], vae: ['s1', 2] } },
  }
  if (quality === 'wav') {
    wf.s8 = { class_type: 'SaveAudio', inputs: { audio: ['s7', 0], filename_prefix: 'sfx/stable_audio' } }
  } else {
    wf.s8 = {
      class_type: 'SaveAudioMP3',
      inputs: {
        audio: ['s7', 0],
        filename_prefix: 'sfx/stable_audio',
        quality: quality === 'V0' || quality === '128k' || quality === '320k' ? quality : '320k',
      },
    }
  }
  return wf
}

// MiniMax H3 (Hailuo) video dit — matches minimax_h3_* / hailuo files.
// Shared with comfyui.js (validation) and useComfyUI.js (audio-VAE pick).
export const H3_VIDEO_RE = /minimax[-_ ]?h\d|hailuo/i
// Upper bound on chained H3 windows. Each window is a full sampling pass, so
// the graph grows (and the render time with it) roughly linearly — 12 windows
// ≈ a minute of 24fps video, already a long render on the 16GB box.
export const H3_MAX_SEGMENTS = 12

// H3 samples at 24fps on a 17k+5 frame grid. The UI speaks per-window
// frames/fps, so convert to the model's 24fps frame count and snap UP to the
// grid (same maths as the template's python-style modulo). Exported so the
// settings UI can show the same duration the builder will actually produce.
export function h3LengthFrames(frames = 33, fps = 16) {
  const f = Math.max(5, Math.round(((frames || 33) / (fps || 16)) * 24))
  return f + ((((5 - (f % 17)) % 17) + 17) % 17)
}
// One window's real duration on screen (seconds at 24fps).
export function h3WindowSeconds(frames = 33, fps = 16) {
  return h3LengthFrames(frames, fps) / 24
}
// Chained windows drop one duplicate boundary frame per join, so the total is
// length + (n-1)(length-1). This is the honest achieved duration.
export function h3ChainedSeconds(segments, frames = 33, fps = 16) {
  const length = h3LengthFrames(frames, fps)
  const n = Math.max(1, Math.min(H3_MAX_SEGMENTS, Math.round(segments || 1)))
  return (length + (n - 1) * (length - 1)) / 24
}
// Fewest windows whose chained length reaches `duration` seconds (clamped to
// [1, H3_MAX_SEGMENTS]). Drives the duration slider → segment count.
export function h3SegmentsForDuration(duration, frames = 33, fps = 16) {
  const length = h3LengthFrames(frames, fps)
  const d24 = Math.max(1, Math.round((duration || 0) * 24))
  if (d24 <= length) return 1
  const n = 1 + Math.ceil((d24 - length) / Math.max(1, length - 1))
  return Math.max(1, Math.min(H3_MAX_SEGMENTS, n))
}
export function isMiniMaxH3(name) {
  return H3_VIDEO_RE.test(String(name || ''))
}

export function buildVideoWorkflow({
  prompt,
  negativePrompt = '',
  resolution = '480p',
  frames = 33,
  fps = 16,
  seed = -1,
  steps = 20, // sampler is the bottleneck on 16GB RAM — 20 (was 30) default
  cfg = 6,
  segments = 1,
  duration = 0,
  crossfade = 0,
  models,
}) {
  if (isMiniMaxH3(models?.unet)) return buildH3VideoWorkflow({ prompt, resolution, frames, fps, seed, steps, models, segments, duration, crossfade })
  const { width, height } = VIDEO_RESOLUTIONS[resolution] || VIDEO_RESOLUTIONS['480p']
  const actualSeed = seed === -1 ? Math.floor(Math.random() * 2 ** 48) : seed

  return {
    '37': {
      class_type: 'UNETLoader',
      inputs: {
        unet_name: models.unet,
        weight_dtype: 'default',
      },
    },
    '38': {
      class_type: 'CLIPLoader',
      inputs: {
        clip_name: models.clip,
        type: 'wan',
        device: 'default',
      },
    },
    '39': {
      class_type: 'VAELoader',
      inputs: {
        vae_name: models.vae,
      },
    },
    '6': {
      class_type: 'CLIPTextEncode',
      inputs: {
        clip: ['38', 0],
        text: prompt,
      },
    },
    '7': {
      class_type: 'CLIPTextEncode',
      inputs: {
        clip: ['38', 0],
        text: negativePrompt || 'Overexposure, static, blurred details, subtitles, paintings, pictures, still, overall gray, worst quality, low quality',
      },
    },
    '40': {
      class_type: 'EmptyHunyuanLatentVideo',
      inputs: {
        width: width,
        height: height,
        length: frames,
        batch_size: 1,
      },
    },
    '3': {
      class_type: 'KSampler',
      inputs: {
        model: ['37', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['40', 0],
        seed: actualSeed,
        control_after_generate: 'randomize',
        steps: steps,
        cfg: cfg,
        sampler_name: 'uni_pc',
        scheduler: 'simple',
        denoise: 1,
      },
    },
    '8': {
      class_type: 'VAEDecode',
      inputs: {
        samples: ['3', 0],
        vae: ['39', 0],
      },
    },
    '28': {
      class_type: 'SaveAnimatedWEBP',
      inputs: {
        images: ['8', 0],
        filename_prefix: 'ComfyUI',
        fps: fps,
        lossless: false,
        quality: 90,
        method: 'default',
      },
    },
  }
}

// MiniMax H3 native graph (comfy_extras.nodes_minimax_h3). Ground truth:
// official template video_minimax_h3_t2v.json (Comfy-Org/workflow_templates),
// probed live on 0.37 — SaveVideo accepts {format:'auto', codec:'auto'} and
// reports the mp4 under outputs.images with animated:[true].
//   - MiniMaxH3ImageToVideo preps prompt + empty AV latent (no source image)
//   - BasicGuider: the model is guidance-embedded — no CFG, no negative
//   - res_multistep + simple scheduler (official docs: every local H3 workflow)
//   - AV latent decodes to frames + stereo audio, muxed by CreateVideo/SaveVideo
function buildH3VideoWorkflow({ prompt, resolution, frames, fps, seed, steps, models, segments = 1, duration = 0, crossfade = 0 }) {
  if (!models?.vaeAudio) {
    throw new Error(
      'MiniMax H3 video needs the H3 audio VAE (minimax_h3_audio_vae_*.safetensors) — it was not found on the server.'
    )
  }
  const raw = VIDEO_RESOLUTIONS[resolution] || VIDEO_RESOLUTIONS['480p']
  // Sample size (fast paths declare a smaller genWidth/genHeight), snapped
  // to H3's multiple-of-32 requirement (e.g. 720 → 736). The final size is
  // what the saved video comes out as after the optional upscale chain.
  const genWidth = Math.max(32, Math.round((raw.genWidth || raw.width) / 32) * 32)
  const genHeight = Math.max(32, Math.round((raw.genHeight || raw.height) / 32) * 32)
  const finalWidth = Math.max(32, Math.round(raw.width / 32) * 32)
  const finalHeight = Math.max(32, Math.round(raw.height / 32) * 32)
  const upscale = !!(raw.upscale && (genWidth !== finalWidth || genHeight !== finalHeight))
  const actualSeed = seed === -1 ? Math.floor(Math.random() * 2 ** 48) : seed
  // Frame count at 24fps, snapped to H3's 17k+5 grid (shared with the UI so
  // its duration readout matches what we build).
  const length = h3LengthFrames(frames, fps)
  // Optional turbo LoRA sits between the loader and the sampler.
  const baseSrc = models.lora ? '52' : '37'
  // Chain N windows end-to-end: window i>0 is conditioned on the last frame
  // of window i-1 (H3's first_frame input — the reason the model file is
  // "fl2va"), so motion continues across the cut. Frames are concatenated
  // with ImageBatch and the per-window soundtracks with AudioCrossfade (when
  // the custom node is present) or AudioConcat, then a single CreateVideo
  // muxes the whole thing. segCount=1 reproduces the old single-clip graph.
  // A target `duration` (seconds) picks the window count for you; an explicit
  // `segments` is used when no duration is given.
  const segCount =
    duration > 0
      ? h3SegmentsForDuration(duration, frames, fps)
      : Math.max(1, Math.min(H3_MAX_SEGMENTS, Math.round(segments || 1)))

  const wf = {
    '37': { class_type: 'UNETLoader', inputs: { unet_name: models.unet, weight_dtype: 'default' } },
    '38': { class_type: 'CLIPLoader', inputs: { clip_name: models.clip, type: 'minimax', device: 'default' } },
    '39': { class_type: 'VAELoader', inputs: { vae_name: models.vae } },
    '391': { class_type: 'VAELoader', inputs: { vae_name: models.vaeAudio } },
    '42': { class_type: 'KSamplerSelect', inputs: { sampler_name: 'res_multistep' } },
    // Comfy Kitchen INT8 attention: measured 201s vs 316-341s pytorch on the
    // 5060 Ti (1.6-1.7×, same seed/output quality in A/B tests). Shared by
    // every window's scheduler/guider — the model is loaded once.
    '53': { class_type: 'ModelAttentionBackend', inputs: { model: [baseSrc, 0], attention: 'comfy kitchen attention' } },
  }
  if (models.lora) {
    wf['52'] = {
      class_type: 'LoraLoaderModelOnly',
      inputs: { model: ['37', 0], lora_name: models.lora, strength_model: models.loraStrength ?? 1 },
    }
  }

  const rawFrames = [] // node ids producing a full window's decoded frames
  const audios = [] // node ids producing a window's decoded audio
  for (let i = 0; i < segCount; i++) {
    const h3Inputs = { clip: ['38', 0], vae: ['39', 0], prompt, width: genWidth, height: genHeight, length }
    // Windows after the first continue from the previous window's last frame.
    if (i > 0) h3Inputs.first_frame = [`lf-${i - 1}`, 0]
    wf[`h3-${i}`] = { class_type: 'MiniMaxH3ImageToVideo', inputs: h3Inputs }
    wf[`rn-${i}`] = {
      class_type: 'RandomNoise',
      // Distinct, deterministic seed per window (13th term of a small cycle
      // avoids the 2**48 wraparound colliding adjacent windows).
      inputs: { noise_seed: (actualSeed + i * 7919) % 2 ** 48 },
    }
    wf[`sch-${i}`] = { class_type: 'BasicScheduler', inputs: { model: ['53', 0], scheduler: 'simple', steps, denoise: 1 } }
    wf[`gd-${i}`] = { class_type: 'BasicGuider', inputs: { model: ['53', 0], conditioning: [`h3-${i}`, 0] } }
    wf[`sm-${i}`] = {
      class_type: 'SamplerCustomAdvanced',
      inputs: { noise: [`rn-${i}`, 0], guider: [`gd-${i}`, 0], sampler: ['42', 0], sigmas: [`sch-${i}`, 0], latent_image: [`h3-${i}`, 1] },
    }
    wf[`vd-${i}`] = { class_type: 'VAEDecode', inputs: { samples: [`sm-${i}`, 0], vae: ['39', 0] } }
    wf[`va-${i}`] = { class_type: 'VAEDecodeAudio', inputs: { samples: [`sm-${i}`, 0], vae: ['391', 0] } }
    if (i < segCount - 1) {
      // Last frame (batch_index -1) is the next window's first_frame.
      wf[`lf-${i}`] = { class_type: 'ImageFromBatch', inputs: { image: [`vd-${i}`, 0], batch_index: -1, length: 1 } }
    }
    rawFrames.push(`vd-${i}`)
    audios.push(`va-${i}`)
  }

  // Video seam join. Two modes:
  //  - crossfade (both bundled nodes present): overlap the last `fadeFrames`
  //    of the running batch with the first `fadeFrames` of the next window and
  //    blend them. The video therefore loses exactly `fadeFrames` (= the
  //    audio's fadeFrames/24 seconds) per join, so A/V stay locked frame-for-
  //    frame — the audio crossfade shortens its timeline by the same amount.
  //  - hard cut (nodes absent): window i repeats window i-1's last frame as its
  //    first; drop that one duplicate so nothing freezes at the join.
  const fadeFrames = crossfade > 0 ? Math.max(1, Math.round(crossfade * 24)) : 0
  let curFrames
  if (fadeFrames > 0) {
    curFrames = rawFrames[0]
    for (let i = 1; i < rawFrames.length; i++) {
      wf[`vx-${i}`] = {
        class_type: 'VideoCrossfade',
        inputs: { images1: [curFrames, 0], images2: [rawFrames[i], 0], fade_frames: fadeFrames, curve: 'linear' },
      }
      curFrames = `vx-${i}`
    }
  } else {
    const frameSrcs = rawFrames.map((id, i) => {
      if (i === 0) return id
      wf[`tr-${i}`] = { class_type: 'ImageFromBatch', inputs: { image: [id, 0], batch_index: 1, length: 4096 } }
      return `tr-${i}`
    })
    curFrames = frameSrcs[0]
    for (let i = 1; i < frameSrcs.length; i++) {
      wf[`ib-${i}`] = { class_type: 'ImageBatch', inputs: { image1: [curFrames, 0], image2: [frameSrcs[i], 0] } }
      curFrames = `ib-${i}`
    }
  }
  let curAudio = audios[0]
  for (let i = 1; i < audios.length; i++) {
    if (fadeFrames > 0) {
      // Overlap the tail of the running mix with the head of the next window
      // and blend — the per-window soundtracks are otherwise independent, so
      // a plain concat clicks at every seam. Duration is derived from
      // fadeFrames (not `crossfade`) so it matches the video exactly.
      wf[`ac-${i}`] = {
        class_type: 'AudioCrossfade',
        inputs: { audio1: [curAudio, 0], audio2: [audios[i], 0], fade_seconds: fadeFrames / 24, curve: 'equal_power' },
      }
    } else {
      wf[`ac-${i}`] = { class_type: 'AudioConcat', inputs: { audio1: [curAudio, 0], audio2: [audios[i], 0], direction: 'after' } }
    }
    curAudio = `ac-${i}`
  }

  // H3 is a 24fps model — never the UI's fps (would change playback speed).
  wf['48'] = { class_type: 'CreateVideo', inputs: { images: [upscale ? '51' : curFrames, 0], audio: [curAudio, 0], fps: 24 } }
  wf['28'] = {
    class_type: 'SaveVideo',
    inputs: { video: ['48', 0], filename_prefix: 'video/ComfyUI', format: 'auto', codec: 'auto' },
  }
  if (upscale) {
    // ESRGAN 4× on the decoded frames, then lanczos down to the exact final
    // size (960×544 → 3840×2176 → 1920×1088). Tiled internally by the node,
    // so it stays inside 16GB VRAM. Runs once over the whole concatenated
    // batch, after the join, to keep the memory cost flat per window.
    wf['49'] = { class_type: 'UpscaleModelLoader', inputs: { model_name: raw.upscale } }
    wf['50'] = { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['49', 0], image: [curFrames, 0] } }
    wf['51'] = {
      class_type: 'ImageScale',
      inputs: { image: ['50', 0], upscale_method: 'lanczos', width: finalWidth, height: finalHeight, crop: 'disabled' },
    }
  }
  return wf
}
