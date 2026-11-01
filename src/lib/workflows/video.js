import { VIDEO_RESOLUTIONS } from './common.js'

// MiniMax H3 (Hailuo) video dit — matches minimax_h3_* / hailuo files.
// Shared with comfyui.js (validation) and useComfyUI.js (audio-VAE pick).
export const H3_VIDEO_RE = /minimax[-_ ]?h\d|hailuo/i
// Upper bound on chained H3 windows. Each window is a full sampling pass and
// the graph concatenates every decoded frame in RAM before SaveVideo, so 12
// windows is already the safe limit on a 16GB box: ~1 minute with the default
// 5.2s windows, ~3 minutes with the 15.1s maximum. Longer videos need
// job-level chunking — not a bigger single graph.
export const H3_MAX_SEGMENTS = 12

// H3 samples at 24fps on a 17k+5 frame grid. The UI speaks per-window
// frames/fps, so convert to the model's 24fps frame count and snap UP to the
// grid (same maths as the template's python-style modulo). Exported so the
// settings UI can show the same duration the builder will actually produce.
export function h3LengthFrames(frames = 33, fps = 16) {
  const raw = Math.round(((frames || 33) / (fps || 16)) * 24)
  const f = Math.max(H3_MIN_FRAMES, Math.min(H3_MAX_FRAMES, raw))
  return Math.min(H3_MAX_FRAMES, snapH3Frames(f))
}
// One window's real duration on screen (seconds at 24fps).
export function h3WindowSeconds(frames = 33, fps = 16, windowSeconds = 0) {
  return (windowSeconds ? h3LengthFromSeconds(windowSeconds) : h3LengthFrames(frames, fps)) / 24
}
// Chained windows drop one duplicate boundary frame per join, so the total is
// length + (n-1)(length-1). This is the honest achieved duration.
export function h3ChainedSeconds(segments, frames = 33, fps = 16, windowSeconds = 0) {
  const length = windowSeconds ? h3LengthFromSeconds(windowSeconds) : h3LengthFrames(frames, fps)
  const n = Math.max(1, Math.min(H3_MAX_SEGMENTS, Math.round(segments || 1)))
  return (length + (n - 1) * (length - 1)) / 24
}
// Fewest windows whose chained length reaches `duration` seconds (clamped to
// [1, H3_MAX_SEGMENTS]). Drives the duration slider → segment count.
export function h3SegmentsForDuration(duration, frames = 33, fps = 16, windowSeconds = 0) {
  const length = windowSeconds ? h3LengthFromSeconds(windowSeconds) : h3LengthFrames(frames, fps)
  const d24 = Math.max(1, Math.floor((duration || 0) * 24))
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
  windowSeconds = 0,
  firstFrameName = '',
  models,
}) {
  if (isMiniMaxH3(models?.unet)) return buildH3VideoWorkflow({ prompt, resolution, frames, fps, windowSeconds, firstFrameName, seed, steps, models, segments, duration, crossfade })
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
//
// H3 was trained on 124–362 frame windows (≈5.2–15.1s at 24fps). Shorter
// windows fall outside the trained grid and produce incoherent, drifting
// clips — the old defaults generated 56-frame windows, which is why anything
// beyond a couple of seconds fell apart. `windowSeconds` is the UI control;
// frames/fps remain the legacy fallback for saved settings.
export const H3_MIN_FRAMES = 124
export const H3_MAX_FRAMES = 362
export const H3_MIN_WINDOW_SECONDS = H3_MIN_FRAMES / 24
export const H3_MAX_WINDOW_SECONDS = H3_MAX_FRAMES / 24

function snapH3Frames(f) {
  // Valid H3 lengths are 17k+5 (124, 141, … 362). Pick the nearest one:
  // rounding 5.2s up to 141 frames would make a "5s" window 15% longer and
  // overshoot during long chains.
  const down = f - ((f - 5) % 17)
  const up = down + 17
  return f - down <= up - f ? down : up
}

export function h3LengthFromSeconds(seconds) {
  const f = Math.max(
    H3_MIN_FRAMES,
    Math.min(H3_MAX_FRAMES, Math.round((Number(seconds) || H3_MIN_WINDOW_SECONDS) * 24)),
  )
  return Math.min(H3_MAX_FRAMES, snapH3Frames(f))
}

function buildH3VideoWorkflow({
  prompt,
  resolution,
  frames,
  fps,
  windowSeconds = 0,
  seed,
  steps,
  models,
  segments = 1,
  duration = 0,
  crossfade = 0,
  firstFrameName = '',
}) {
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
  const length = windowSeconds > 0 ? h3LengthFromSeconds(windowSeconds) : h3LengthFrames(frames, fps)
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
      ? h3SegmentsForDuration(duration, frames, fps, windowSeconds)
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
  // An uploaded still seeds window 0 (image-to-video); later windows keep
  // chaining from the previous window's last frame.
  if (firstFrameName) {
    wf['ff'] = { class_type: 'LoadImage', inputs: { image: firstFrameName } }
  }

  const rawFrames = [] // node ids producing a full window's decoded frames
  const audios = [] // node ids producing a window's decoded audio
  for (let i = 0; i < segCount; i++) {
    const h3Inputs = { clip: ['38', 0], vae: ['39', 0], prompt, width: genWidth, height: genHeight, length }
    // Windows after the first continue from the previous window's last frame;
    // window 0 uses the uploaded still when one was provided.
    if (i > 0) h3Inputs.first_frame = [`lf-${i - 1}`, 0]
    else if (firstFrameName) h3Inputs.first_frame = ['ff', 0]
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
