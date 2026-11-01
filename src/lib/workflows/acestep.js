import { applyLoudness } from './loudness.js'

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
  // Planning CFG for the MiniMax AR structure planner. ACE renders with its
  // own text encoder at an exact duration, so this is accepted for API/settings
  // parity but not used by this graph.
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
  // culls the silence tail when the song ends early. `ace.plannerClip` is
  // still resolved so the model picker can report it, but it is deliberately
  // not wired into this graph.
  const planned = dur
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
