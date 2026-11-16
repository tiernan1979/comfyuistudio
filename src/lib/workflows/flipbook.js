// VFX flipbooks: short WAN text-to-video runs whose frames are saved as
// transparent PNGs, then packed into a horizontal sheet in the browser. One
// graph = one effect loop; the viewer/player handles preview and export.

export const FLIPBOOK_FRAMES = [9, 17, 25, 33]

export const FLIPBOOK_NEGATIVE =
  'scene, background scenery, camera movement, cuts, text, watermark, logo, ' +
  'still frame, photo, realistic room, border, frame'

const snapFrames = (n) => {
  const raw = Math.max(5, Math.min(49, Math.round(Number(n) || 17)))
  return raw - ((raw - 1) % 4)
}

export function flipbookPrompt(text) {
  const base = String(text || '').trim()
  if (!base) return ''
  return (
    `${base}, animated visual effect, centered in frame, isolated on a plain black background, ` +
    'smooth looping motion, consistent shape and color across frames, no camera movement, ' +
    'no scene, no text, game VFX flipbook'
  )
}

export function buildFlipbookWorkflow({
  prompt,
  negativePrompt = '',
  frames = 17,
  resolution = 512,
  seed = -1,
  steps = 20,
  cfg = 6,
  transparent = true,
  models,
}) {
  const length = snapFrames(frames)
  const side = Math.max(256, Math.min(768, Math.round((Number(resolution) || 512) / 64) * 64))
  const actualSeed = seed === -1 || seed == null ? Math.floor(Math.random() * 2 ** 48) : seed

  const workflow = {
    '37': {
      class_type: 'UNETLoader',
      inputs: { unet_name: models.unet, weight_dtype: 'default' },
    },
    '38': {
      class_type: 'CLIPLoader',
      inputs: { clip_name: models.clip, type: 'wan', device: 'default' },
    },
    '39': {
      class_type: 'VAELoader',
      inputs: { vae_name: models.vae },
    },
    '6': {
      class_type: 'CLIPTextEncode',
      inputs: { clip: ['38', 0], text: flipbookPrompt(prompt) },
    },
    '7': {
      class_type: 'CLIPTextEncode',
      inputs: {
        clip: ['38', 0],
        text: negativePrompt?.trim() || FLIPBOOK_NEGATIVE,
      },
    },
    '40': {
      class_type: 'EmptyHunyuanLatentVideo',
      inputs: { width: side, height: side, length, batch_size: 1 },
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
        steps: Math.max(1, Math.min(60, Math.round(steps) || 20)),
        cfg: Math.max(0, Math.min(20, Number(cfg) || 6)),
        sampler_name: 'uni_pc',
        scheduler: 'simple',
        denoise: 1,
      },
    },
    '8': {
      class_type: 'VAEDecode',
      inputs: { samples: ['3', 0], vae: ['39', 0] },
    },
  }

  let framesOut = ['8', 0]
  if (transparent) {
    // BiRefNet returns a mask that is HIGH on the background. JoinImageWithAlpha
    // also clears RGB where alpha is zero, so invert first (same contract as
    // the sprite graph).
    workflow.bg = {
      class_type: 'LoadBackgroundRemovalModel',
      inputs: { bg_removal_name: 'birefnet.safetensors' },
    }
    workflow['10'] = {
      class_type: 'RemoveBackground',
      inputs: { bg_removal_model: ['bg', 0], image: ['8', 0] },
    }
    workflow['11'] = { class_type: 'InvertMask', inputs: { mask: ['10', 0] } }
    workflow['12'] = {
      class_type: 'JoinImageWithAlpha',
      inputs: { image: ['8', 0], alpha: ['11', 0] },
    }
    framesOut = ['12', 0]
  }

  workflow.save = {
    class_type: 'SaveImage',
    inputs: { images: framesOut, filename_prefix: 'flipbook/frame' },
  }
  return workflow
}
