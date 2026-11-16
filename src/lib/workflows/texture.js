// 2D game assets: seamless materials, tileset sheets, icon/UI packs and
// terrain transition sheets. All use the local image stack; icon packs
// optionally cut a solid background with BiRefNet so the PNGs keep alpha.

import { buildImageWorkflow } from './image.js'

export const TEXTURE_NEGATIVE =
  'blurry, photo of a room, perspective, horizon, vignette, gradient lighting, spotlight, ' +
  'lighter border, darker center, outer border, frame, margin, uneven lighting, text, watermark, ' +
  'signature'

// A user prompt like "dirt block tile sheet, 4 variants" fights the seamless
// texture graph: the image model draws a framed sheet/display board instead of
// one continuous surface. Scrub that boilerplate for the single-texture mode
// (sheet words are meaningful for tileset/terrain/icon and stay there).
const PROMPT_BOILERPLATE = [
  /^(?:a\s+)?(?:seamless\s+)?(?:tileable\s+)?(?:game\s+)?(?:texture|material)\s+of\s+/i,
  /\b(?:seamless|tileable|tiling)\b/gi,
  /\b(?:top[-\s]?down|orthographic)\b/gi,
  /\b(?:edge[-\s]?to[-\s]?edge|full[-\s]?frame)\b/gi,
  /\bno (?:perspective|border|borders|frame|shadow|shadows|scene)\b/gi,
  /\bflat even lighting\b/gi,
  /\bhigh detail\b/gi,
  /\bgame[-\s]?ready (?:material|texture|asset)\b/gi,
]

const SHEET_WORDS =
  /\b(?:tile[-\s]?sheet|tileset|sprite[-\s]?sheet|contact[-\s]?sheet|sheet|variants?|grid|cells?|multiple (?:tiles|variants)|\d+\s*(?:variants?|tiles?|cells?))\b/gi

function cleanPrompt(text, kind) {
  let out = String(text || '').trim()
  for (const re of PROMPT_BOILERPLATE) out = out.replace(re, ' ')
  if (kind === 'texture') out = out.replace(SHEET_WORDS, ' ')
  return out
    .replace(/\s*,\s*(?=,|$)/g, '')
    .replace(/\s+([,;])/g, '$1')
    .replace(/^[\s,;]+|[\s,;]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// The single-texture graph is the only one that must not show a frame or a
// lighting gradient; sheets/intentional cells need different negatives.
export function textureNegative(kind = 'texture') {
  if (kind === 'icon') {
    return `${TEXTURE_NEGATIVE}, drop shadow, bevel, labels, mixed art styles, closed frame`
  }
  if (kind === 'tileset' || kind === 'terrain') {
    return `${TEXTURE_NEGATIVE}, grid lines, labels, mixed art styles, different scales, outer board`
  }
  return (
    `${TEXTURE_NEGATIVE}, tile sheet, grid, cells, variants, display board, contact sheet, ` +
    'multiple panels, centered object, tiling seams'
  )
}

const clampSide = (n) => Math.max(512, Math.min(1024, Math.round((Number(n) || 1024) / 64) * 64))
const clampGrid = (n) => Math.max(2, Math.min(4, Math.round(n) || 2))

// Sheet prompts ask for equal cells because the viewer crops them at exactly
// 1/N of the image. The icon variant deliberately uses a flat background so
// BiRefNet can produce a clean alpha channel.
export function textureAssetPrompt(text, { kind = 'texture', seamless = true, grid = 2 } = {}) {
  const raw = String(text || '').trim()
  if (!raw) return ''
  const base = cleanPrompt(raw, kind) || raw
  const cells = clampGrid(grid)
  if (kind === 'tileset') {
    return (
      `game tileset sheet of ${base}, top-down orthographic view, exactly ${cells}x${cells} equal ` +
      'square tiles, each tile fills its cell edge to edge, no gaps, no outer border, no margin, ' +
      'no labels, flat even lighting, uniform brightness, consistent scale, seamless game art'
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
      'each tile fills its cell edge to edge, seamless tile edges, no gaps, no outer border, no margin, ' +
      'no labels, flat even lighting, uniform brightness, consistent scale'
    )
  }
  const tiling = seamless ? 'seamless tileable game texture of ' : 'game texture of '
  return (
    `${tiling}${base}, one continuous material filling the entire square from edge to edge, ` +
    'no tile sheet, no grid, no cells, no variants, no centered object, no board, no frame, ' +
    'no border, no vignette, uniform brightness and density corner to corner, flat even lighting, ' +
    'top-down orthographic, high detail, game-ready material'
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
    negativePrompt: negativePrompt?.trim() || textureNegative(kind),
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
