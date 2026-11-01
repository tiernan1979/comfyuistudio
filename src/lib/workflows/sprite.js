// ---------------------------------------------------------------------------
// Sprite sheets (game-ready). One graph:
//   base pose (Qwen-Image) → N pose edits (Qwen-Image-Edit, all from the SAME
//   base image so identity holds) → BiRefNet background removal → RGBA →
//   scale to a fixed cell → ImageGrid pack → SaveImage (transparent PNG).
// The edit model + base model are the same Qwen-Image file on this stack, so
// one UNETLoader feeds both branches.
// ---------------------------------------------------------------------------

import {
  EXPRESSION_KEYS,
  expressionNegative,
  expressionPhrase,
  normalizeExpression,
} from '../expressions.js'

// Animation presets: cyclic pose hints the per-frame editor turns into poses.
export const SPRITE_ANIMATIONS = {
  idle: { label: 'Idle', hints: ['subtle breathing, arms relaxed at sides', 'slight bob down, weight settling', 'arms relaxed, chest up', 'slight bob up, shoulders raised'] },
  walk: { label: 'Walk cycle', hints: [
    'contact — right heel strikes forward, left arm forward, left leg back',
    'down — weight dropping onto the right leg, left heel lifting behind',
    'passing — left leg swinging under the hips, body at its lowest',
    'up — pushing off the right toe, body rising, left leg reaching forward',
    'contact — left heel strikes forward, right arm forward, right leg back',
    'down — weight dropping onto the left leg, right heel lifting behind',
    'passing — right leg swinging under the hips, body at its lowest',
    'up — pushing off the left toe, body rising, right leg reaching forward',
  ] },
  run: { label: 'Run cycle', hints: [
    'contact — right foot lands forward, left arm forward, strong forward lean',
    'compression — right knee bends under the weight, left leg trailing back',
    'push-off — right leg extending, body rising, left knee driving forward',
    'airborne — both feet off the ground, legs passing under the body',
    'contact — left foot lands forward, right arm forward, strong forward lean',
    'compression — left knee bends under the weight, right leg trailing back',
    'push-off — left leg extending, body rising, right knee driving forward',
    'airborne — both feet off the ground, legs passing under the body',
  ] },
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

// "happy,angry" → ['happy', 'angry'] — unknown keys are dropped instead of
// being normalised to neutral (that would silently add duplicate rows).
function parseExpressions(str) {
  const out = []
  for (const part of String(str || '').split(',')) {
    const key = part.trim().toLowerCase()
    if (EXPRESSION_KEYS.includes(key) && !out.includes(key)) out.push(key)
  }
  return out
}

// Expand the sheet spec into rows — ONE animation (optionally per direction)
// per row, each with its OWN frame count (variable-length rows, left-aligned
// on a grid of width = the longest row). Shared by the graph builder AND the
// client-side packer so the two always agree on the layout.
//
// `forceFrames` pins every row to one count (the video engine: all rows are
// videos, all videos share the snapped 4n+1 length); `maxFrames` raises the
// per-row cap for those counts (default 12 = the pose engine's graph cap).
//
// Expressions resolve in three layers: a per-animation override
// (`animExpressions`) wins over the global `expression`, and a
// `frameExpressions[animation]` array can override any single frame (empty
// slots inherit the row's expression). `expressionRows` appends one
// expression-only idle row per expression key — useful for portraits/emotes
// baked into the same sheet; their names are unique (`idle-happy`) because
// the Godot export keys animations by row name.
export function spriteRows({
  sheetMode = 'single',
  animation = 'walk',
  animations = [],
  directions = 'none',
  frames = 8,
  animFrames = '',
  expression = 'neutral',
  animExpressions = {},
  frameExpressions = {},
  expressionRows = '',
  forceFrames = 0,
  maxFrames = 12,
} = {}) {
  const overrides = parseFrameCounts(animFrames)
  const globalExpr = normalizeExpression(expression)
  const animExpr = animExpressions && typeof animExpressions === 'object' ? animExpressions : {}
  const frameExpr = frameExpressions && typeof frameExpressions === 'object' ? frameExpressions : {}
  const expressionFor = (a) => normalizeExpression(animExpr[a] || globalExpr)
  const countOf = (a) => {
    if (forceFrames) return Math.max(1, Math.min(maxFrames, Math.round(forceFrames)))
    const n = overrides[a] ?? (sheetMode === 'multi' ? SPRITE_ANIMATION_FRAMES[a] : frames) ?? frames
    return Math.max(1, Math.min(maxFrames, Math.round(n)))
  }
  const mk = (anim, dir) => {
    const row = {
      animation: anim,
      direction: dir,
      expression: expressionFor(anim),
      name: dir ? `${anim}-${dir}` : anim,
      frames: countOf(anim),
    }
    const perFrame = frameExpr[anim]
    if (Array.isArray(perFrame) && perFrame.length) row.frameExpressions = perFrame
    return row
  }
  // Expression-only rows reuse the idle hints (a face-only row still needs
  // some subtle body language). The video engine pins them to the snapped
  // video length like every other row, otherwise 4 frames would break WAN's
  // 4n+1 rule.
  const expressionOnlyRows = () =>
    parseExpressions(expressionRows).map((expr) => ({
      animation: 'idle',
      direction: '',
      expression: expr,
      name: `idle-${expr}`,
      frames: forceFrames ? countOf('idle') : 4,
      expressionOnly: true,
    }))
  if (sheetMode !== 'multi') {
    const dirs = DIRECTIONAL_ANIMS.has(animation) ? directionsFor(directions) : []
    const base = dirs.length ? dirs.map((d) => mk(animation, d)) : [mk(animation, '')]
    return [...base, ...expressionOnlyRows()]
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
  if (!rows.length) rows.push(mk('walk', ''))
  return [...rows, ...expressionOnlyRows()]
}

export function directionPhrase(dir) {
  switch (dir) {
    case 'right':
      return ' Turn the whole body into a 90-degree side profile facing right — head, torso, hips and feet all point right; do not face the camera.'
    case 'left':
      return ' Turn the whole body into a 90-degree side profile facing left — head, torso, hips and feet all point left; do not face the camera.'
    case 'down':
      return ' Top-down view — the character faces down (toward the camera); head and shoulders are seen from above.'
    case 'up':
      return ' Top-down view — the character faces up (away from the camera); head and shoulders are seen from behind.'
    default:
      return ''
  }
}

// Pick a distinct instruction for every frame. Cycling `i % hints.length`
// made walk sheets repeat the same four poses when the user asked for 6–8
// frames; short cycles keep an in-between pose instead, and longer hint sets
// (walk/run) sample the full cycle.
function frameHint(hints, i, frames) {
  if (!hints.length) return `pose ${i + 1} of ${frames}`
  if (frames <= 1) return hints[0]
  if (frames <= hints.length) {
    const idx = Math.round((i * (hints.length - 1)) / (frames - 1))
    return hints[idx]
  }
  const pos = (i * hints.length) / frames
  const a = Math.floor(pos) % hints.length
  const b = (a + 1) % hints.length
  return `in-between — moving from "${hints[a]}" toward "${hints[b]}"`
}

// `expression` goes straight after the subject/direction: the base image is
// generated per direction+expression, and repeating the phrase at the front
// of every edit keeps the face stable across the row instead of drifting.
function spriteFrameInstruction(subject, animation, i, frames, direction = '', expression = 'neutral') {
  const anim = SPRITE_ANIMATIONS[animation]
  const hint = frameHint(anim?.hints || [], i, frames)
  const label = anim?.label || 'animation'
  // The phrase starts a sentence here, so capitalise it — the catalog keeps
  // lowercase fragments for mid-sentence use elsewhere.
  const phrase = expressionPhrase(expression)
  const expressionText = phrase.charAt(0).toUpperCase() + phrase.slice(1)
  return (
    `${subject}.${directionPhrase(direction)} ${expressionText}, ${label}, ` +
    `frame ${i + 1} of ${frames} — ${hint}. ` +
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
  expression = 'neutral',
  animExpressions = {},
  frameExpressions = {},
  expressionRows = '',
  framePrompts = null, // explicit per-frame prompts override the preset hints
  seed = -1,
  steps = 20,
  cfg = 4,
  editSteps = 20,
  editCfg = 2.5,
  models = {},
}) {
  const actualSeed = seed === -1 ? Math.floor(Math.random() * 2 ** 48) : seed
  const rows = spriteRows({
    sheetMode,
    animation,
    animations,
    directions,
    frames,
    animFrames,
    expression,
    animExpressions,
    frameExpressions,
    expressionRows,
  })
  const total = rows.reduce((n, r) => n + r.frames, 0)
  if (total > 48) {
    throw new Error(
      `Sprite sheet too large: ${rows.length} rows = ${total} frames ` +
        '(max 48). Reduce frames, animations, expressions, or directions.',
    )
  }
  const px = Math.max(32, Math.min(2048, Math.round(cellSize)))
  const gen = Math.max(256, Math.min(2048, Math.round(genSize / 8) * 8))
  const basePromptFor = (direction, expr) => {
    const phrase = expressionPhrase(expr)
    return direction
      ? `${subject},${directionPhrase(direction)} ${phrase}, full body, centred, plain flat white background, single character, game sprite, high detail`
      : `${subject}, ${phrase}, full body, neutral standing pose, centred, plain flat white background, ` +
          'single character, game sprite, high detail'
  }
  const baseNeg =
    'multiple characters, duplicate, cropped, out of frame, extra limbs, extra arms, ' +
    'text, watermark, signature, busy background, scenery'
  const negativeFor = (expr) => `${baseNeg}, ${expressionNegative(expr)}`

  const wf = {
    // Loaders (shared)
    u1: { class_type: 'UNETLoader', inputs: { unet_name: models.unet, weight_dtype: 'default' } },
    cl: { class_type: 'CLIPLoader', inputs: { clip_name: models.clip, type: 'qwen_image', device: 'default' } },
    ve: { class_type: 'VAELoader', inputs: { vae_name: models.vae } },
    bg: { class_type: 'LoadBackgroundRemovalModel', inputs: { bg_removal_name: 'birefnet.safetensors' } },
    // Shared edit conditioning (every frame edits its row's base image)
    af: { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['u1', 0], shift: 3 } },
    cf: { class_type: 'CFGNorm', inputs: { model: ['af', 0], strength: 1 } },
  }

  // Direction is decided by the BASE pose, not by text appended to an edit of
  // a front-facing base: Qwen-Image-Edit preserved the front-facing source and
  // produced left-facing "right" rows. Generate one base per direction group
  // instead, then edit every frame from that row's base.
  //
  // The expression is baked into the base as well, so bases are grouped by
  // direction + expression (a happy walk row needs a happy base, otherwise the
  // editor fights the neutral face it was given).
  //
  // Left rows are generated from the canonical RIGHT base and mirrored after
  // scaling (ImageFlip), so both rows are guaranteed to face opposite ways.
  const baseKeyFor = (direction, expr) =>
    `${direction === 'left' ? 'right' : direction || 'front'}|${normalizeExpression(expr)}`
  const baseGroups = new Map()
  for (const row of rows) {
    const key = baseKeyFor(row.direction, row.expression)
    if (!baseGroups.has(key)) {
      baseGroups.set(key, {
        direction: row.direction === 'left' ? 'right' : row.direction,
        expression: row.expression,
      })
    }
  }
  const baseKeys = [...baseGroups.keys()]
  const baseIndex = new Map(baseKeys.map((key, i) => [key, i]))

  baseKeys.forEach((key, bi) => {
    const group = baseGroups.get(key)
    const dir = group.direction || ''
    const text = basePromptFor(dir, group.expression)
    const neg = negativeFor(group.expression)
    wf[`b${bi}p`] = { class_type: 'CLIPTextEncode', inputs: { clip: ['cl', 0], text } }
    wf[`b${bi}n`] = { class_type: 'CLIPTextEncode', inputs: { clip: ['cl', 0], text: neg } }
    wf[`b${bi}l`] = { class_type: 'EmptySD3LatentImage', inputs: { width: gen, height: gen, batch_size: 1 } }
    wf[`b${bi}k`] = {
      class_type: 'KSampler',
      inputs: {
        model: ['u1', 0], positive: [`b${bi}p`, 0], negative: [`b${bi}n`, 0], latent_image: [`b${bi}l`, 0],
        seed: actualSeed, steps, cfg, sampler_name: 'euler', scheduler: 'simple', denoise: 1,
      },
    }
    wf[`b${bi}d`] = { class_type: 'VAEDecode', inputs: { samples: [`b${bi}k`, 0], vae: ['ve', 0] } }
    wf[`b${bi}e`] = { class_type: 'VAEEncode', inputs: { pixels: [`b${bi}d`, 0], vae: ['ve', 0] } }
    wf[`b${bi}en`] = { class_type: 'TextEncodeQwenImageEdit', inputs: { clip: ['cl', 0], vae: ['ve', 0], image: [`b${bi}d`, 0], prompt: neg } }
  })

  // Frames are emitted row-major (row 0 left→right, then row 1…) so the app
  // can pack each row as its own animation.
  let batch = null
  let idx = 0
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    const bi = baseIndex.get(baseKeyFor(row.direction, row.expression))
    // Left rows are generated from the right-facing base and mirrored below,
    // so never ask the editor for a left profile (that is what drifted).
    const genDirection = row.direction === 'left' ? 'right' : row.direction
    for (let c = 0; c < row.frames; c++) {
      const f = `f${r}_${c}`
      // An explicit per-frame expression ("" = inherit) wins over the row's
      // expression, which came from the per-animation override or the global.
      const expr = normalizeExpression(row.frameExpressions?.[c] || row.expression)
      const text =
        framePrompts?.[idx] ||
        spriteFrameInstruction(subject, row.animation, c, row.frames, genDirection, expr)
      wf[`${f}p`] = { class_type: 'TextEncodeQwenImageEdit', inputs: { clip: ['cl', 0], vae: ['ve', 0], image: [`b${bi}d`, 0], prompt: text } }
      // A frame that changes expression must also swap the expression-specific
      // negatives; the base negative would otherwise suppress the new face
      // (e.g. neutral's "exaggerated expression" fighting an angry frame).
      let negative = [`b${bi}en`, 0]
      if (expr !== row.expression) {
        wf[`${f}n`] = {
          class_type: 'TextEncodeQwenImageEdit',
          inputs: { clip: ['cl', 0], vae: ['ve', 0], image: [`b${bi}d`, 0], prompt: negativeFor(expr) },
        }
        negative = [`${f}n`, 0]
      }
      wf[`${f}k`] = {
        class_type: 'KSampler',
        inputs: {
          model: ['cf', 0], positive: [`${f}p`, 0], negative, latent_image: [`b${bi}e`, 0],
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
      let out = [`${f}s`, 0]
      if (row.direction === 'left') {
        wf[`${f}flip`] = {
          class_type: 'ImageFlip',
          inputs: { image: out, flip_method: 'y-axis: horizontally' },
        }
        out = [`${f}flip`, 0]
      }
      if (batch === null) {
        batch = out
      } else {
        wf[`${f}b`] = { class_type: 'ImageBatch', inputs: { image1: batch, image2: out } }
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
