// 2D game assets: seamless materials, tileset sheets, icon/UI packs and
// terrain transition sheets. All use the local image stack; icon packs
// optionally cut a solid background with BiRefNet so the PNGs keep alpha.

import { buildImageWorkflow } from './image.js'

export const TEXTURE_NEGATIVE =
  'blurry, photo of a room, perspective, horizon, vignette, border, frame, text, watermark, ' +
  'signature, uneven lighting, tiling seams'

const clampSide = (n) => Math.max(512, Math.min(1024, Math.round((Number(n) || 1024) / 64) * 64))
const clampGrid = (n) => Math.max(2, Math.min(4, Math.round(n) || 2))

// Sheet prompts ask for equal cells because the viewer crops them at exactly
// 1/N of the image. The icon variant deliberately uses a flat background so
// BiRefNet can produce a clean alpha channel.
export function textureAssetPrompt(text, { kind = 'texture', seamless = true, grid = 2 } = {}) {
  const base = String(text || '').trim()
  if (!base) return ''
  const cells = clampGrid(grid)
  if (kind === 'tileset') {
    return (
      `game tileset sheet of ${base}, top-down orthographic view, exactly ${cells}x${cells} equal ` +
      'square tiles, each tile fills its cell edge to edge, no gaps, no borders, no labels, ' +
      'flat even lighting, consistent scale, seamless game art'
    )
  }
  if (kind === 'icon') {
    return (
      `game UI icon sheet of ${base}, exactly ${cells}x${cells} equal square cells, one centered ` +
      'icon per cell, consistent silhouette, scale and art style, clean flat white background, ' +
      'no labels, no text, no borders, no shadows, no perspective, crisp game-ready icons'
    )
  }
  if (kind === 'terrain') {
    return (
      `game terrain autotile sheet of ${base}, top-down orthographic view, exactly ${cells}x${cells} ` +
      'equal tiles showing edge and corner transitions between the main terrain and its neighbour, ' +
      'each tile fills its cell edge to edge, seamless tile edges, no gaps, no borders, no labels, ' +
      'flat even lighting, consistent scale'
    )
  }
  const tiling = seamless ? 'seamless tileable game texture of ' : 'game texture of '
  return (
    `${tiling}${base}, top-down orthographic, edge-to-edge pattern, ` +
    'no perspective, no border, flat even lighting, high detail, game-ready material'
  )
}

function prefixFor(kind) {
  if (kind === 'tileset') return 'texture/tileset'
  if (kind === 'icon') return 'texture/icon'
  if (kind === 'terrain') return 'texture/terrain'
  return 'texture/material'
}

export function buildTextureWorkflow({
  prompt,
  negativePrompt = '',
  kind = 'texture',
  seamless = true,
  grid = 2,
  size = 1024,
  seed = -1,
  steps = 20,
  cfg = 4,
  batchSize = 1,
  transparent = false,
  models,
}) {
  const side = clampSide(size)
  const workflow = buildImageWorkflow({
    prompt: textureAssetPrompt(prompt, { kind, seamless, grid }),
    negativePrompt: negativePrompt?.trim() || TEXTURE_NEGATIVE,
    width: side,
    height: side,
    seed,
    steps,
    cfg,
    batchSize,
    models,
    filenamePrefix: prefixFor(kind),
  })

  if (kind === 'icon' && transparent) {
    // Solid-background icon sheet -> BiRefNet mask -> RGBA PNG. The sheet is
    // packed client-side later, exactly like sprite frames, so alpha survives.
    delete workflow['60']
    workflow['90'] = {
      class_type: 'LoadBackgroundRemovalModel',
      inputs: { bg_removal_name: 'birefnet.safetensors' },
    }
    workflow['91'] = {
      class_type: 'RemoveBackground',
      inputs: { bg_removal_model: ['90', 0], image: ['8', 0] },
    }
    workflow['92'] = {
      class_type: 'JoinImageWithAlpha',
      inputs: { image: ['8', 0], alpha: ['91', 0] },
    }
    workflow['60'] = {
      class_type: 'SaveImage',
      inputs: { images: ['92', 0], filename_prefix: prefixFor(kind) },
    }
  }

  return workflow
}
