// Local PBR material packs. The base colour is rendered with the normal image
// stack; normal and height come from ComfyUI's local depth/normal
// preprocessors, and roughness/metalness are derived from the base colour
// (approximate, but fully offline — no cloud node and no extra model files).

import { buildImageWorkflow } from './image.js'

export const MATERIAL_MAP_KEYS = ['basecolor', 'normal', 'roughness', 'metalness', 'height']

export const MATERIAL_SIZE_OPTIONS = [
  { value: '1:1 (512x512)', label: '512²' },
  { value: '1:1 (1024x1024)', label: '1024²' },
]

// Nodes the local graph calls. `prepareRun` preflights these so an old
// ComfyUI build fails with a clear message instead of a dead prompt.
export const MATERIAL_NODES = [
  'DSINE-NormalMapPreprocessor',
  'MiDaS-DepthMapPreprocessor',
  'ImageRGBToYUV',
  'ImageToMask',
  'MaskToImage',
  'AdjustBrightness',
  'AdjustContrast',
  'ImageBlur',
  'EmptyImage',
  'SaveImage',
]

export const MATERIAL_NEGATIVE =
  'blurry, photo of a room, perspective, horizon, vignette, border, frame, text, watermark, ' +
  'signature, uneven lighting, harsh shadows, specular highlights, reflections, tiling seams'

const clampSide = (n) => (Number(n) === 512 ? 512 : 1024)

// The image model renders the albedo only. The wording is deliberately
// explicit: otherwise it paints a framed "texture sample" with perspective.
export function materialPrompt(text, { tiling = 'both' } = {}) {
  const base = String(text || '').trim()
  if (!base) return ''
  const direction =
    tiling === 'horizontal'
      ? 'seamless left-to-right'
      : tiling === 'vertical'
        ? 'seamless top-to-bottom'
        : 'seamless in both directions'
  return (
    `PBR base color texture of ${base}, ${direction}, top-down orthographic, edge-to-edge ` +
    'pattern, no perspective, no border, flat even diffuse lighting, no shadows, no highlights, ' +
    'no reflections, high detail, game-ready material'
  )
}

// Grey constant for the metalness map. Most dielectrics are 0; a value above
// zero paints a uniform metal mask, which is enough for simple game props.
function metalColor(value) {
  const g = Math.max(0, Math.min(255, Math.round((Number(value) || 0) * 2.55)))
  return (g << 16) | (g << 8) | g
}

export function buildMaterialWorkflow({
  prompt,
  negativePrompt = '',
  size = '1:1 (1024x1024)',
  maps = {},
  tiling = 'both',
  steps = 20,
  cfg = 4,
  seed = -1,
  metallic = 0,
  roughness = 50,
  models,
}) {
  const enabled = MATERIAL_MAP_KEYS.filter((k) => maps[k] !== false)
  if (!enabled.length) throw new Error('Enable at least one PBR map.')
  const side = clampSide(String(size).includes('512') ? 512 : 1024)
  const want = new Set(enabled)

  const workflow = buildImageWorkflow({
    prompt: materialPrompt(prompt, { tiling }),
    negativePrompt: negativePrompt?.trim() || MATERIAL_NEGATIVE,
    width: side,
    height: side,
    seed,
    steps,
    cfg,
    models,
    filenamePrefix: 'material/basecolor',
  })
  // The image builder already added a SaveImage for the base colour. Drop it
  // and write every enabled map from one place so node ids are predictable.
  delete workflow['60']

  if (want.has('normal')) {
    workflow['101'] = {
      class_type: 'DSINE-NormalMapPreprocessor',
      inputs: {
        image: ['8', 0],
        fov: 60,
        iterations: 5,
        resolution: side,
      },
    }
  }

  if (want.has('height')) {
    // MiDaS outputs inverse depth (bright = near), which is exactly what a
    // bump/parallax height map expects for a flat surface.
    workflow['102'] = {
      class_type: 'MiDaS-DepthMapPreprocessor',
      inputs: {
        image: ['8', 0],
        a: 6.283185307179586,
        bg_threshold: 0.1,
        resolution: side,
      },
    }
  }

  if (want.has('roughness')) {
    // Roughness starts from luminance: YUV's Y channel is the perceptual
    // brightness of the albedo. Convert it back to a grayscale image, then
    // bias and slightly blur so the map reads as a surface finish rather
    // than a copy of the colour texture.
    const bias = Math.max(0, Math.min(100, Number(roughness) || 0))
    workflow['103'] = {
      class_type: 'ImageRGBToYUV',
      inputs: { image: ['8', 0] },
    }
    workflow['104'] = {
      class_type: 'ImageToMask',
      inputs: { image: ['103', 0], channel: 'red' },
    }
    workflow['105'] = {
      class_type: 'MaskToImage',
      inputs: { mask: ['104', 0] },
    }
    workflow['106'] = {
      class_type: 'AdjustBrightness',
      inputs: {
        images: ['105', 0],
        factor: 0.5 + bias / 100,
      },
    }
    workflow['107'] = {
      class_type: 'AdjustContrast',
      inputs: {
        images: ['106', 0],
        factor: 0.75 + bias / 200,
      },
    }
    workflow['108'] = {
      class_type: 'ImageBlur',
      inputs: {
        image: ['107', 0],
        blur_radius: 1,
        sigma: 1,
      },
    }
  }

  if (want.has('metalness')) {
    workflow['109'] = {
      class_type: 'EmptyImage',
      inputs: {
        width: side,
        height: side,
        batch_size: 1,
        color: metalColor(metallic),
      },
    }
  }

  const save = (key, images) => {
    workflow[`save_${key}`] = {
      class_type: 'SaveImage',
      inputs: {
        images,
        filename_prefix: `material/${key}`,
      },
    }
  }

  if (want.has('basecolor')) save('basecolor', ['8', 0])
  if (want.has('normal')) save('normal', ['101', 0])
  if (want.has('roughness')) save('roughness', ['108', 0])
  if (want.has('metalness')) save('metalness', ['109', 0])
  if (want.has('height')) save('height', ['102', 0])

  return { workflow, maps: enabled }
}
