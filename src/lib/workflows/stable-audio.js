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
  // Output folder: SFX mode and music mode share this graph, so callers pass
  // the destination instead of everything landing in sfx/.
  subfolder = 'sfx',
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
    wf.s8 = {
      class_type: 'SaveAudio',
      inputs: { audio: ['s7', 0], filename_prefix: `${subfolder}/stable_audio` },
    }
  } else {
    wf.s8 = {
      class_type: 'SaveAudioMP3',
      inputs: {
        audio: ['s7', 0],
        filename_prefix: `${subfolder}/stable_audio`,
        quality: quality === 'V0' || quality === '128k' || quality === '320k' ? quality : '320k',
      },
    }
  }
  return wf
}
