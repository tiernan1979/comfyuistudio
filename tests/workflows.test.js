import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ASPECT_RATIOS,
  VIDEO_RESOLUTIONS,
  H3_MAX_SEGMENTS,
  H3_MIN_FRAMES,
  H3_MAX_FRAMES,
  H3_MIN_WINDOW_SECONDS,
  STABLE_AUDIO_MAX_SECONDS,
  snap8,
  buildImageWorkflow,
  buildEditWorkflow,
  buildVideoWorkflow,
  buildStableAudioWorkflow,
  buildSpriteWorkflow,
  spriteRows,
  h3LengthFrames,
  h3LengthFromSeconds,
  h3WindowSeconds,
  h3SegmentsForDuration,
  h3ChainedSeconds,
  normalizeLyrics,
} from '../src/lib/workflows/index.js'
import {
  EXPRESSION_KEYS,
  SPRITE_EXPRESSIONS,
  expressionNegative,
  expressionPhrase,
  normalizeExpression,
} from '../src/lib/expressions.js'
import { buildCharacterKeyframeWorkflow, characterMotionPrompt } from '../src/lib/character.js'

const imageModels = {
  unet: 'qwen-image.safetensors',
  clip: 'qwen-image-clip.safetensors',
  vae: 'qwen-image-vae.safetensors',
}
const videoModels = {
  unet: 'wan2.1-t2v-14b.safetensors',
  clip: 'umt5_xxl.safetensors',
  vae: 'wan_2.1_vae.safetensors',
}

test('snap8 rounds to the VAE stride and clamps to bounds', () => {
  assert.equal(snap8(100), 104)
  assert.equal(snap8(1005), 1008)
  assert.equal(snap8(2), 32)
  assert.equal(snap8(99999), 4096)
  assert.equal(snap8('nope'), 32)
})

test('image workflow uses the aspect-ratio preset and keeps the seed', () => {
  const wf = buildImageWorkflow({
    prompt: 'a lighthouse at dusk',
    negativePrompt: 'blurry',
    aspectRatio: '16:9',
    seed: 42,
    steps: 24,
    cfg: 5,
    models: imageModels,
  })
  assert.equal(wf['58'].inputs.width, ASPECT_RATIOS['16:9'].width)
  assert.equal(wf['58'].inputs.height, ASPECT_RATIOS['16:9'].height)
  assert.equal(wf['3'].inputs.seed, 42)
  assert.equal(wf['3'].inputs.steps, 24)
  assert.equal(wf['3'].inputs.cfg, 5)
  assert.equal(wf['7'].inputs.text, 'blurry')
  assert.equal(wf['37'].inputs.unet_name, imageModels.unet)
})

test('image workflow turbo mode uses the distilled sampler recipe', () => {
  const wf = buildImageWorkflow({
    prompt: 'test',
    turboMode: true,
    steps: 40,
    cfg: 9,
    seed: 1,
    models: imageModels,
  })
  assert.equal(wf['3'].inputs.steps, 8)
  assert.equal(wf['3'].inputs.cfg, 1)
})

test('image workflow custom size overrides the ratio and snaps to 8px', () => {
  const wf = buildImageWorkflow({
    prompt: 'test',
    aspectRatio: '16:9',
    width: 1005,
    height: 701,
    seed: 1,
    models: imageModels,
  })
  assert.equal(wf['58'].inputs.width, 1008)
  assert.equal(wf['58'].inputs.height, 704)
})

test('image workflow only adds an upscale pass when a model is supplied', () => {
  const plain = buildImageWorkflow({ prompt: 'x', seed: 1, models: imageModels })
  assert.equal(plain['9'], undefined)

  const upscaled = buildImageWorkflow({
    prompt: 'x',
    seed: 1,
    models: imageModels,
    upscaleModel: '4x-UltraSharp.pth',
  })
  assert.equal(upscaled['9'].class_type, 'UpscaleModelLoader')
  assert.equal(upscaled['9'].inputs.model_name, '4x-UltraSharp.pth')
  assert.deepEqual(upscaled['10'].inputs.image, ['8', 0])
})

test('video workflow maps the selected resolution', () => {
  const wf = buildVideoWorkflow({
    prompt: 'a wave',
    resolution: '720p',
    frames: 33,
    fps: 16,
    seed: 7,
    models: videoModels,
  })
  assert.ok(wf['37'], 'loads the video UNET')
  assert.equal(wf['3'].inputs.seed, 7)
  const latent = Object.values(wf).find((n) => n.class_type === 'EmptyHunyuanLatentVideo')
  assert.ok(latent, 'creates a video latent')
  assert.equal(latent.inputs.width, VIDEO_RESOLUTIONS['720p'].width)
  assert.equal(latent.inputs.height, VIDEO_RESOLUTIONS['720p'].height)
})

test('H3 window maths clamp to the segment budget', () => {
  assert.ok(h3WindowSeconds(33, 16) > 0)
  assert.equal(h3SegmentsForDuration(1, 33, 16), 1)
  assert.ok(h3SegmentsForDuration(30, 33, 16) > 1)
  assert.equal(h3SegmentsForDuration(9999, 33, 16), H3_MAX_SEGMENTS)
  assert.ok(h3ChainedSeconds(3, 33, 16) > h3ChainedSeconds(1, 33, 16))
  assert.equal(h3ChainedSeconds(9999, 33, 16), h3ChainedSeconds(H3_MAX_SEGMENTS, 33, 16))
})

test('H3 windows stay inside the trained frame range', () => {
  // The old 56-frame windows were outside the model's 124–362 training range
  // and drifted within seconds. Every path must clamp up to 124.
  assert.equal(h3LengthFrames(33, 16), H3_MIN_FRAMES)
  assert.equal(h3LengthFromSeconds(1), H3_MIN_FRAMES)
  assert.equal(h3LengthFromSeconds(5.2), H3_MIN_FRAMES)
  assert.equal(h3LengthFromSeconds(99), H3_MAX_FRAMES)
  assert.ok(h3LengthFrames(81, 16) >= H3_MIN_FRAMES)
  assert.ok(h3LengthFrames(81, 16) <= H3_MAX_FRAMES)
  assert.ok(h3WindowSeconds(33, 16) >= H3_MIN_WINDOW_SECONDS)
  // Duration → segment count must use the same clamped window length.
  assert.equal(h3SegmentsForDuration(5, 33, 16), 1)
  assert.ok(h3SegmentsForDuration(60, 33, 16) > 1)
})

test('H3 workflow uses the selected window length and chains by duration', () => {
  const wf = buildVideoWorkflow({
    prompt: 'a fox in snow',
    duration: 12,
    windowSeconds: 5.2,
    models: {
      unet: 'minimax_h3_fl2va.safetensors',
      clip: 'qwen3vl.safetensors',
      vae: 'h3_video_vae.safetensors',
      vaeAudio: 'h3_audio_vae.safetensors',
    },
  })
  assert.equal(wf['h3-0'].inputs.length, H3_MIN_FRAMES)
  // 12s at ~5.2s/window → 3 windows (last frame of each feeds the next).
  assert.ok(wf['h3-1'], 'chains a second window')
  assert.deepEqual(wf['h3-1'].inputs.first_frame, ['lf-0', 0])
  assert.equal(wf['28'].class_type, 'SaveVideo')
})

test('H3 image-to-video seeds window 0 from the uploaded still', () => {
  const wf = buildVideoWorkflow({
    prompt: 'a fox in snow',
    duration: 12,
    windowSeconds: 5.2,
    firstFrameName: 'first-frame.png',
    models: {
      unet: 'minimax_h3_fl2va.safetensors',
      clip: 'qwen3vl.safetensors',
      vae: 'h3_video_vae.safetensors',
      vaeAudio: 'h3_audio_vae.safetensors',
    },
  })
  assert.equal(wf.ff.class_type, 'LoadImage')
  assert.equal(wf.ff.inputs.image, 'first-frame.png')
  assert.deepEqual(wf['h3-0'].inputs.first_frame, ['ff', 0])
  // Later windows still chain from the previous window, not the still.
  assert.deepEqual(wf['h3-1'].inputs.first_frame, ['lf-0', 0])
})

test('stable audio clamps the duration and honours the output folder', () => {
  const wf = buildStableAudioWorkflow({
    caption: 'rain on a tin roof',
    duration: 500,
    quality: 'wav',
    subfolder: 'music',
    models: { stable: { checkpoint: 'stable_audio_3.safetensors', clip: 't5gemma.safetensors' } },
  })
  assert.equal(wf.s4.inputs.seconds_total, STABLE_AUDIO_MAX_SECONDS)
  assert.equal(wf.s5.inputs.seconds, STABLE_AUDIO_MAX_SECONDS)
  assert.equal(wf.s8.inputs.filename_prefix, 'music/stable_audio')
  assert.equal(wf.s8.class_type, 'SaveAudio')
})

test('stable audio rejects a missing checkpoint', () => {
  assert.throws(
    () => buildStableAudioWorkflow({ caption: 'x', models: {} }),
    /needs models\.stable/,
  )
})

test('normalizeLyrics treats a structure-only map as instrumental', () => {
  const empty = normalizeLyrics('')
  assert.equal(empty.instrumental, true, 'default structure tags contain no sung words')
  assert.ok(empty.text.includes('[Intro]'))

  const tagsOnly = normalizeLyrics('[Intro]\n[Chorus]')
  assert.equal(tagsOnly.instrumental, true)

  const sung = normalizeLyrics('[Verse]\nwe ride at dawn')
  assert.equal(sung.instrumental, false)
})

test('image workflow batch size is clamped and reaches the latent', () => {
  const wf = buildImageWorkflow({
    prompt: 'grid',
    batchSize: 4,
    models: imageModels,
  })
  assert.equal(wf['58'].inputs.batch_size, 4)

  const clamped = buildImageWorkflow({ prompt: 'x', batchSize: 999, models: imageModels })
  assert.equal(clamped['58'].inputs.batch_size, 16)
})

test('edit workflow without a mask keeps the plain img2img graph', () => {
  const wf = buildEditWorkflow({
    prompt: 'make it blue',
    imageName: 'source.png',
    models: { ...imageModels, unet: 'qwen-edit.safetensors' },
  })
  assert.equal(wf['78'].inputs.image, 'source.png')
  assert.equal(wf['3'].inputs.latent_image[0], '88')
  assert.equal(wf['60'].inputs.images[0], '8')
  assert.equal(wf['79'], undefined)
})

test('masked edit adds the latent mask + source composite', () => {
  const wf = buildEditWorkflow({
    prompt: 'repaint the sky',
    imageName: 'source.png',
    maskName: 'mask.png',
    denoise: 0.8,
    models: { ...imageModels, unet: 'qwen-edit.safetensors' },
  })
  assert.equal(wf['79'].class_type, 'LoadImageMask')
  assert.equal(wf['79'].inputs.image, 'mask.png')
  assert.deepEqual(wf['89'], {
    class_type: 'SetLatentNoiseMask',
    inputs: { samples: ['88', 0], mask: ['79', 0] },
  })
  assert.equal(wf['3'].inputs.latent_image[0], '89')
  assert.equal(wf['3'].inputs.denoise, 0.8)
  assert.equal(wf['90'].class_type, 'ImageCompositeMasked')
  assert.equal(wf['60'].inputs.images[0], '90')
})

test('sprite directions produce distinct left/right rows', () => {
  const wf = buildSpriteWorkflow({
    subject: 'a knight',
    animation: 'walk',
    frames: 8,
    directions: 'lr',
    models: imageModels,
  })
  const right = wf.f0_0p.inputs.prompt
  const left = wf.f1_0p.inputs.prompt
  assert.match(right, /side profile facing right/i)
  // Both rows are generated from the canonical right-facing base; only the
  // left row is mirrored afterwards. Asking the editor for a left profile
  // from a front-facing base produced left-facing "right" rows.
  assert.match(left, /side profile facing right/i)
  assert.equal(wf.b0p.inputs.text.match(/side profile facing right/i)?.length, 1)
  assert.equal(wf.f0_0flip, undefined)
  assert.equal(wf.f1_0flip.class_type, 'ImageFlip')
  assert.equal(wf.f1_0flip.inputs.flip_method, 'y-axis: horizontally')

  // Every frame in a row must ask for a different phase, not repeat the
  // same four walk poses twice.
  const rowPrompts = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => wf[`f0_${i}p`].inputs.prompt)
  assert.equal(new Set(rowPrompts).size, 8)
})

test('sprite frames stay distinct when the requested count exceeds the hint list', () => {
  const wf = buildSpriteWorkflow({
    subject: 'a knight',
    animation: 'attack',
    frames: 6,
    models: imageModels,
  })
  const prompts = [0, 1, 2, 3, 4, 5].map((i) => wf[`f0_${i}p`].inputs.prompt)
  assert.equal(new Set(prompts).size, 6)
  assert.ok(prompts.some((p) => /in-between/i.test(p)))
})

test('expression catalog exposes phrases and negatives', () => {
  assert.deepEqual(EXPRESSION_KEYS, [
    'neutral',
    'happy',
    'angry',
    'sad',
    'surprised',
    'determined',
    'pained',
    'scared',
  ])
  for (const key of EXPRESSION_KEYS) {
    assert.ok(SPRITE_EXPRESSIONS[key].label)
    assert.match(expressionPhrase(key), /facial expression/i)
    assert.ok(expressionNegative(key).length > 3)
  }
  // Unknown/empty keys never leak into a prompt.
  assert.equal(normalizeExpression('nonsense'), 'neutral')
  assert.equal(normalizeExpression(''), 'neutral')
  assert.equal(expressionPhrase('nonsense'), SPRITE_EXPRESSIONS.neutral.phrase)
})

test('spriteRows resolves global/per-animation/per-frame expressions and expression rows', () => {
  const rows = spriteRows({
    sheetMode: 'multi',
    animations: 'idle,walk',
    animFrames: 'idle:2,walk:3',
    expression: 'neutral',
    animExpressions: { walk: 'angry' },
    frameExpressions: { idle: ['', 'happy'] },
    expressionRows: 'happy,scared,unknown',
  })
  assert.deepEqual(
    rows.map((r) => r.name),
    ['idle', 'walk', 'idle-happy', 'idle-scared'],
  )
  assert.equal(new Set(rows.map((r) => r.name)).size, rows.length)
  assert.deepEqual(
    rows.map((r) => r.expression),
    ['neutral', 'angry', 'happy', 'scared'],
  )
  // Only the animation with a frame override carries the array; unknown CSV
  // keys are dropped instead of becoming neutral duplicates.
  assert.deepEqual(rows[0].frameExpressions, ['', 'happy'])
  assert.equal(rows[1].frameExpressions, undefined)
  assert.equal(rows[2].expressionOnly, true)
  assert.equal(rows[2].frames, 4)

  // The video engine pins expression-only rows to the snapped WAN length.
  const video = spriteRows({ expressionRows: 'happy', forceFrames: 13, maxFrames: 81 })
  assert.equal(video[1].frames, 13)
})

test('sprite prompts bake the expression into the base and every frame', () => {
  const wf = buildSpriteWorkflow({
    subject: 'a knight',
    animation: 'walk',
    frames: 3,
    expression: 'happy',
    frameExpressions: { walk: ['', 'angry'] },
    models: imageModels,
  })
  assert.match(wf.f0_0p.inputs.prompt, /happy cheerful facial expression/i)
  // Per-frame override wins over the row's (global) expression.
  assert.match(wf.f0_1p.inputs.prompt, /angry furious facial expression/i)
  assert.doesNotMatch(wf.f0_1p.inputs.prompt, /happy cheerful facial expression/i)
  assert.match(wf.f0_2p.inputs.prompt, /happy cheerful facial expression/i)
  // Base pose + negative conditioning carry the expression too.
  assert.match(wf.b0p.inputs.text, /happy cheerful facial expression/i)
  assert.match(wf.b0n.inputs.text, /frowning, sad, angry, blank expression/i)
  assert.match(wf.b0en.inputs.prompt, /frowning, sad, angry, blank expression/i)
})

test('sprite expression-only rows and per-animation overrides get their own base', () => {
  const multi = buildSpriteWorkflow({
    subject: 'a knight',
    sheetMode: 'multi',
    animations: 'idle,walk',
    animFrames: 'idle:2,walk:2',
    expression: 'neutral',
    animExpressions: { walk: 'angry' },
    models: imageModels,
  })
  // Row 0 = idle (neutral base), row 1 = walk (its own angry base).
  assert.match(multi.b0p.inputs.text, /relaxed neutral facial expression/i)
  assert.match(multi.b1p.inputs.text, /angry furious facial expression/i)
  assert.match(multi.f1_0p.inputs.prompt, /angry furious facial expression/i)

  const emotes = buildSpriteWorkflow({
    subject: 'a knight',
    animation: 'idle',
    frames: 2,
    expressionRows: 'happy,angry',
    models: imageModels,
  })
  // Front neutral base + one base per expression-only row.
  assert.match(emotes.b0p.inputs.text, /relaxed neutral facial expression/i)
  assert.match(emotes.b1p.inputs.text, /happy cheerful facial expression/i)
  assert.match(emotes.b1n.inputs.text, /frowning, sad, angry, blank expression/i)
  assert.match(emotes.b2p.inputs.text, /angry furious facial expression/i)
  // 2 idle frames + 4 frames per expression row.
  assert.ok(emotes.f2_3p, 'expression-only rows keep their own frame nodes')
})

test('video engine prompts carry the expression into motion and keyframe', () => {
  assert.match(
    characterMotionPrompt('a knight', 'walk', 'right', 'happy'),
    /happy cheerful facial expression/i,
  )
  const keyframe = buildCharacterKeyframeWorkflow({
    subject: 'a knight',
    expression: 'scared',
    models: imageModels,
  })
  assert.match(keyframe.bp.inputs.text, /scared fearful facial expression/i)
  assert.match(keyframe.bn.inputs.text, /smiling, laughing, calm expression/i)
})
