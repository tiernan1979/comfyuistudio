// MiniMax H3 Image — a dedicated text-to-image engine beside the Qwen stack.
// The model is distilled to a fixed 6-step schedule at CFG 1, so the graph is
// deliberately simple: one conditioning node produces both the positive
// conditioning and the latent, and the negative branch is just a zeroed-out
// copy of the positive (the template's own wiring).

export const H3_IMAGE_NODES = ['MiniMaxH3ImageConditioning']

export const H3_IMAGE_SIZES = [1024, 2048, 3072, 4096]

// H3 Image accepts any side on a 32px grid. 4096² is the native 16MP target;
// 2048² is the sweet spot for 16–24GB cards.
const snap32 = (n) => Math.max(256, Math.min(4096, Math.round((Number(n) || 2048) / 32) * 32))

// Active image presets can point at H3 instead of Qwen. The image dropdowns
// list both families, so the run path detects the UNET rather than relying on
// the preset having a separate engine flag.
export const isH3ImageModel = (name) => /minimax.*h3.*image/i.test(String(name || ''))
export const isH3ImageClip = (name) =>
  /qwen3vl_32b_minimax_h3|minimax.*h3.*(?:text|clip|encoder)/i.test(String(name || ''))
export const isH3ImageVae = (name) => /minimax.*h3.*image.*vae/i.test(String(name || ''))

export function buildH3ImageWorkflow({
  prompt,
  size = 2048,
  width,
  height,
  seed = -1,
  models,
}) {
  if (!models?.unet || !models?.clip || !models?.vae) {
    throw new Error(
      'MiniMax H3 Image needs a diffusion model, text encoder and VAE — set them in Settings → Models → H3 Image.'
    )
  }
  const side = snap32(width || size)
  const sideY = snap32(height || size)
  const actualSeed =
    seed === -1 || seed == null ? Math.floor(Math.random() * 2 ** 48) : Math.max(0, Math.round(seed))

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
    '6': {
      class_type: 'MiniMaxH3ImageConditioning',
      inputs: {
        clip: ['38', 0],
        vae: ['39', 0],
        prompt: String(prompt || ''),
        width: side,
        height: sideY,
      },
    },
    '7': {
      class_type: 'ConditioningZeroOut',
      inputs: {
        conditioning: ['6', 0],
      },
    },
    '3': {
      class_type: 'KSampler',
      inputs: {
        model: ['37', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['6', 1],
        seed: actualSeed,
        control_after_generate: 'randomize',
        steps: 6,
        cfg: 1,
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
        filename_prefix: 'h3image/image',
      },
    },
  }
}
