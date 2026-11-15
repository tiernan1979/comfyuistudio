// Offline prompt enhancement: style presets that expand a user's plain words
// into a rich ComfyUI-ready prompt plus a matching negative prompt.
// No network, no API keys — just curated quality tags per style.

export const STYLES = {
  none: {
    label: 'None (raw)',
    suffix: '',
    negative: '',
  },
  // Ground textures fail in a very specific way: a prompt like "soil" reads
  // as an object, so the model draws a centred pile (or a dark vignette)
  // instead of a flat surface. Keep the prompt as a plain close-up photo and
  // put "covering the entire frame" up front — long keyword chains such as
  // "seamless tileable texture of …" made Qwen frame the material like a
  // product shot. The negative is deliberately short; a long list of "no …"
  // tags produced a dark border instead of removing one.
  ground: {
    label: 'Seamless Ground',
    prefix: 'a photograph of',
    suffix:
      ', covering the entire frame, taken from directly above, even daylight, sharp focus, high detail',
    negative: 'blurry, low quality, text, watermark, logo',
  },
  photoreal: {
    label: 'Photoreal',
    suffix:
      ', ultra-detailed, sharp focus, professional photography, natural lighting, realistic texture, 8k',
    negative:
      'cartoon, anime, painting, illustration, 3d render, blurry, low quality, deformed, watermark, text, signature',
  },
  cinematic: {
    label: 'Cinematic',
    suffix:
      ', cinematic film still, dramatic lighting, shallow depth of field, subtle film grain, epic composition, 35mm',
    negative:
      'cartoon, anime, blurry, low quality, amateur snapshot, watermark, text',
  },
  anime: {
    label: 'Anime',
    suffix:
      ', anime style, vibrant colors, clean line art, detailed background, studio quality',
    negative:
      'photorealistic, real photo, blurry, low quality, watermark, deformed, ugly',
  },
  digital: {
    label: 'Digital Art',
    suffix:
      ', digital painting, concept art, intricate details, vibrant colors, dramatic atmosphere',
    negative:
      'blurry, low quality, photograph, watermark, deformed, dull',
  },
  fantasy: {
    label: 'Fantasy',
    suffix:
      ', fantasy art, magical atmosphere, glowing details, epic scale, highly detailed',
    negative:
      'boring, plain, blurry, low quality, watermark, deformed',
  },
  portrait: {
    label: 'Portrait',
    suffix:
      ', portrait photography, 85mm lens, soft bokeh background, studio lighting, sharp focus on eyes',
    negative:
      'full body, blurry, deformed face, cartoon, watermark, bad anatomy',
  },
}

export const DEFAULT_STYLE = 'photoreal'

const collapse = (text) => (text || '').trim().replace(/\s+/g, ' ')

function styleTags(style) {
  return {
    prefix: (style?.prefix || '').trim(),
    suffix: (style?.suffix || '').trim(),
  }
}

// Remove every known style's prefix/suffix. Switching styles (or picking
// "None") must not stack quality tags; old prompts can also contain more
// than one style's suffix, so repeat until stable.
export function stripStyleTags(text) {
  let clean = collapse(text)
  let changed = true
  let guard = 0
  while (changed && guard < 8) {
    changed = false
    guard += 1
    for (const style of Object.values(STYLES)) {
      const { prefix, suffix } = styleTags(style)
      if (prefix && clean.toLowerCase().startsWith(prefix.toLowerCase())) {
        clean = clean.slice(prefix.length).trim()
        changed = true
      }
      if (suffix && clean.toLowerCase().endsWith(suffix.toLowerCase())) {
        clean = clean.slice(0, clean.length - suffix.length).trim()
        changed = true
      }
    }
  }
  return clean
}

// Expand plain user words with the style's prefix/suffix quality tags.
// Idempotent: applying the same style twice won't duplicate anything.
export function enhancePrompt(text, styleKey) {
  const clean = stripStyleTags(text)
  if (!clean) return ''
  const { prefix, suffix } = styleTags(STYLES[styleKey])
  let out = clean
  if (prefix && !out.toLowerCase().startsWith(prefix.toLowerCase())) out = `${prefix} ${out}`
  if (suffix && !out.toLowerCase().endsWith(suffix.toLowerCase())) out = out + suffix
  return out
}
