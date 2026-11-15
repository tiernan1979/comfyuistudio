// Pixel-art asset path: SDXL base + Pixel Art XL LoRA.
//
// The Qwen-Image stack is excellent at photographic/material prompts but does
// not produce a 16-bit pixel look, and the Pixel Art XL LoRA is SDXL-only.
// This builder is deliberately separate from buildImageWorkflow: checkpoint
// loading, sampler defaults (30 steps / CFG 7) and prompt framing all differ.
//
// Output is a square image (SDXL is trained at 1024). The viewer's 32×32 tile
// export handles the final game-resolution downsample.

export const PIXEL_NEGATIVE =
  'blurry, 3d, realistic, photo, text, watermark, logo, border, frame, perspective, anti-aliasing, smooth gradients'

// Keep the asset type in the user's words, but nudge the checkpoint/LoRA into
// the 16-bit look. An already-pixel prompt is left alone so the user can tune
// the wording without the suffix fighting them.
export function pixelAssetPrompt(text) {
  const base = String(text || '').trim()
  if (!base) return ''
  if (/pixel\s*art/i.test(base)) return base
  return `pixel art 2D game asset of ${base}, 16-bit, crisp hard pixels, limited palette, flat lighting, clean edges, no text, no watermark`
}

export function buildPixelArtWorkflow({
  prompt,
  negativePrompt = '',
  size = 1024,
  seed = -1,
  steps = 30,
  cfg = 7,
  batchSize = 1,
  loraStrength = 1,
  models = {},
}) {
  // SDXL likes multiples of 64; 512–1536 covers game assets without letting a
  // stray value request a poster-sized latent.
  const side = Math.max(512, Math.min(1536, Math.round((Number(size) || 1024) / 64) * 64))
  const actualSeed = seed === -1 || seed == null ? Math.floor(Math.random() * 2 ** 48) : seed
  const batch = Math.max(1, Math.min(16, Math.round(batchSize) || 1))
  const strength = Number.isFinite(Number(loraStrength))
    ? Math.max(0, Math.min(2, Number(loraStrength)))
    : 1
  const ckpt = models.ckpt || 'sd_xl_base_1.0_0.9vae.safetensors'

  const workflow = {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: ckpt },
    },
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: {
        clip: ['1', 1],
        text: pixelAssetPrompt(prompt),
      },
    },
    '4': {
      class_type: 'CLIPTextEncode',
      inputs: {
        clip: ['1', 1],
        text: negativePrompt?.trim() || PIXEL_NEGATIVE,
      },
    },
    '5': {
      class_type: 'EmptyLatentImage',
      inputs: { width: side, height: side, batch_size: batch },
    },
    '6': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['3', 0],
        negative: ['4', 0],
        latent_image: ['5', 0],
        seed: actualSeed,
        steps: Math.max(1, Math.min(100, Math.round(steps) || 30)),
        cfg: Math.max(0, Math.min(30, Number(cfg) || 7)),
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1,
      },
    },
    '7': {
      class_type: 'VAEDecode',
      inputs: { samples: ['6', 0], vae: ['1', 2] },
    },
    '8': {
      class_type: 'SaveImage',
      inputs: { images: ['7', 0], filename_prefix: 'pixelart' },
    },
  }

  if (models.lora) {
    workflow['2'] = {
      class_type: 'LoraLoaderModelOnly',
      inputs: {
        model: ['1', 0],
        lora_name: models.lora,
        strength_model: strength,
      },
    }
    workflow['6'].inputs.model = ['2', 0]
  }

  return workflow
}
