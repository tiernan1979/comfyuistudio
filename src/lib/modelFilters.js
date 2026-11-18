// Model dropdown filtering. ComfyUI exposes one flat file list per type, so
// every settings picker used to show image, video, music, audio and 3D models
// together. These matchers keep each section to files its pipeline can load;
// they are deliberately separate from the API's resolver preferences, which
// still need a fallback when a saved filename has drifted.

import { isSupportedVideoModel } from './comfyui/models.js'

const matches = (matcher, name) =>
  typeof matcher === 'function' ? matcher(name) : matcher.test(name)

const only = (match, exclude) => (name) => {
  const value = String(name || '')
  if (!matches(match, value)) return false
  return !(exclude && matches(exclude, value))
}

const FILTERS = {
  // Image models cover both text-to-image families: Qwen-Image and MiniMax
  // H3 Image. Qwen-Image-Edit has its own section because the plain image
  // graph cannot supply its reference conditioning.
  image: {
    unet: only(/qwen.*image|minimax.*h3.*image/i, /edit/i),
    clip: only(/qwen.*(?:vl|2\.5|3[._]5)/i, /ace|music/i),
    vae: only(/qwen.*vae|minimax.*h3.*image.*vae/i, /trellis|minimax.*(?:audio|video)|ace/i),
    lora: only(/qwen|lightning/i, /pixel|sdxl|offset/i),
  },
  // MiniMax H3 Image — a dedicated 16MP text-to-image stack separate from
  // Qwen. The text encoder is the H3 32B model, not the Qwen3.5 prompt
  // expander, and the VAE is H3's image VAE.
  h3image: {
    unet: only(/minimax.*h3.*image/i),
    clip: only(/qwen3vl_32b_minimax_h3/i),
    vae: only(/minimax.*h3.*image.*vae/i),
  },
  // SDXL checkpoint + Pixel Art XL LoRA.
  pixel: {
    checkpoint: only(/sd[-_ ]?xl|sdxl/i, /lora|offset/i),
    lora: only(/pixel.?art|sd[-_ ]?xl|sdxl/i, /offset/i),
  },
  // Edit also accepts the plain Qwen-Image fallback because the app resolves
  // to it when no dedicated edit model is installed.
  edit: {
    unet: only(/qwen.*(?:edit|image)/i, /minimax|music|ace|trellis/i),
  },
  // Wan / MiniMax H3 video. GGUF experts are i2v-only and live in the Sprites
  // section instead; LongCat needs a graph this build does not implement.
  video: {
    unet: only(isSupportedVideoModel, /gguf|music|audio|h3.*image/i),
    clip: only(/umt5|(?:qwen|vl).*h\d|h\d.*(?:qwen|vl)/i, /music|ace/i),
    vae: only(/wan.*vae|(?:minimax|h\d).*video.*vae/i, /audio|music|ace/i),
    vaeAudio: only(/(?:minimax|h\d).*audio.*vae/i),
    lora: only(/(?:minimax|h\d)|wan.*lora|lightning/i, /longcat|music|audio/i),
  },
  // Sprites video engine: WAN 2.2 image-to-video GGUF experts.
  character: {
    gguf: only(/wan.*i2v|wan2\.2.*i2v/i),
    clip: only(/umt5/i),
    vae: only(/wan.*vae/i),
  },
  // MiniMax Music 3 and ACE-Step 1.5 (split encoders or AIO checkpoint).
  music: {
    unet: only(/minimax.*music|ace.*step/i),
    clip: only(/minimax.*music|qwen.*ace/i),
    vae: only(/minimax.*music.*dav|ace.*vae/i),
  },
  // Stable Audio 3 SFX.
  sfx: {
    checkpoint: only(/stable.*audio/i),
    clip: only(/t5gemma/i),
  },
}

// Returns the subset of `list` that belongs to a section/slot. Unknown
// sections or slots keep the full list, matching the old behaviour.
export function filterModelOptions(section, slot, list = []) {
  const filter = FILTERS[section]?.[slot]
  const items = Array.isArray(list) ? list : []
  return filter ? items.filter((name) => filter(String(name || ''))) : items.slice()
}
