import { snap8, ASPECT_RATIOS } from './common.js'

export function buildImageWorkflow({
  prompt,
  negativePrompt = '',
  aspectRatio = '1:1',
  width: customWidth,
  height: customHeight,
  seed = -1,
  steps = 20,
  cfg = 4,
  turboMode = false,
  batchSize = 1,
  models,
  upscaleModel = '', // models/upscale_models/*.pth — 4x detail upscale after decode
}) {
  // Custom W×H (e.g. 100x100 for sprites) overrides the aspect-ratio preset.
  const { width, height } =
    customWidth && customHeight
      ? { width: snap8(customWidth), height: snap8(customHeight) }
      : ASPECT_RATIOS[aspectRatio] || ASPECT_RATIOS['1:1']
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
        batch_size: Math.max(1, Math.min(16, Math.round(batchSize) || 1)),
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
  maskName = '',
  seed = -1,
  steps = 20,
  cfg = 2.5,
  denoise = 1,
  models,
}) {
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

  // Masked edit (inpaint). Qwen-Image-Edit has no mask input, so the mask is
  // applied at the latent level: SetLatentNoiseMask keeps the unmasked latent
  // from the source encode and only denoises the painted region. The decoded
  // result is then composited through the same mask so pixels outside it are
  // bit-identical to the source. All three nodes are stock ComfyUI.
  if (maskName) {
    workflow['79'] = {
      class_type: 'LoadImageMask',
      inputs: {
        image: maskName,
        channel: 'red',
      },
    }
    workflow['89'] = {
      class_type: 'SetLatentNoiseMask',
      inputs: {
        samples: ['88', 0],
        mask: ['79', 0],
      },
    }
    workflow['3'].inputs.latent_image = ['89', 0]
    workflow['90'] = {
      class_type: 'ImageCompositeMasked',
      inputs: {
        destination: ['78', 0],
        source: ['8', 0],
        mask: ['79', 0],
        x: 0,
        y: 0,
        resize_source: false,
      },
    }
    workflow['60'].inputs.images = ['90', 0]
  }

  return workflow
}
