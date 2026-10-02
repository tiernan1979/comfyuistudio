// Offline prompt enhancement: style presets that expand a user's plain words
// into a rich ComfyUI-ready prompt plus a matching negative prompt.
// No network, no API keys — just curated quality tags per style.

export const STYLES = {
  none: {
    label: 'None (raw)',
    suffix: '',
    negative: '',
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

// Expand plain user words with the style's quality tags.
// Idempotent: clicking Enhance twice won't double-append.
export function enhancePrompt(text, styleKey) {
  const clean = (text || '').trim().replace(/\s+/g, ' ')
  if (!clean) return ''
  const suffix = (STYLES[styleKey]?.suffix || '').trim()
  if (!suffix) return clean
  if (clean.toLowerCase().endsWith(suffix.toLowerCase())) return clean
  return clean + suffix
}
