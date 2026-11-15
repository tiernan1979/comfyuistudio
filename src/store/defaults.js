// Persisted defaults for a fresh install. Persisted stores are merged against
// these in migrate() so newly added modes/fields appear in browsers saved
// before they existed.

import { STRUCTURE_TAGS, AUTOSPLIT_LABEL_PRESETS } from '../lib/workflows.js'
import { CHARACTER_MODEL_DEFAULTS } from '../lib/character.js'

// Defaults for the AI prompt writer (used by fresh installs and migrations)
export const DEFAULT_LLM_CONFIGS = {
  lmstudio: { url: 'http://host.docker.internal:1234', model: '' },
  openai: { key: '', model: 'gpt-4o-mini' },
  anthropic: { key: '', model: 'claude-haiku-4-5' },
  custom: { url: '', key: '', model: '' },
}

// Default model files per mode.
export const DEFAULT_MODELS = {
  image: {
    unet: 'qwen_image_fp8_e4m3fn.safetensors',
    clip: 'qwen_2.5_vl_7b_fp8_scaled.safetensors',
    vae: 'qwen_image_vae.safetensors',
    lora: '',
  },
  // Pixel Art mode uses an SDXL checkpoint + Pixel Art XL, not the Qwen
  // Image stack. Both files live under models/checkpoints and models/loras.
  pixel: {
    ckpt: 'sd_xl_base_1.0_0.9vae.safetensors',
    lora: 'pixel-art-xl.safetensors',
  },
  video: {
    unet: 'wan2.1_t2v_1.3B_bf16.safetensors',
    clip: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
    vae: 'wan_2.1_vae.safetensors',
    lora: '', // optional H3 turbo LoRA (Settings → Models → Video)
  },
  edit: {
    unet: 'qwen_image_edit_fp8_e4m3fn.safetensors',
  },
  music: {
    unet: 'minimax_music3_dit_int8_convrot.safetensors',
    clip: 'minimax_music3_text_encoder_pruned_int8_convrot.safetensors',
    vae: 'minimax_music3_dav.safetensors',
  },
  sfx: {
    // Stable Audio 3 — a checkpoint in models/checkpoints plus a T5Gemma
    // text encoder loaded via CLIPLoader type 'stable_audio'.
    unet: 'stable_audio_3_small_sfx.safetensors',
    clip: 't5gemma_b_b_ul2.safetensors',
    vae: '',
  },
  // WAN 2.2 i2v stack for the Sprites video engine (two A14B lightx2v 4-step
  // Q4 experts + umt5 + Wan 2.1 VAE). Names mirror the reference pipeline's
  // downloads; see Settings → Models → Character video.
  character: { ...CHARACTER_MODEL_DEFAULTS },
}

// Sprite-sheet settings (game-ready). One base pose, then a per-frame pose
// edit of it (identity-consistent), background removed and packed — or, with
// engine 'video', one WAN 2.2 animation video per row from a shared keyframe.
// `multi` mode renders several animations, one per row.
export const DEFAULT_SPRITE_SETTINGS = {
  engine: 'pose', // 'pose' (per-frame edits) | 'video' (WAN 2.2 i2v rows)
  sheetMode: 'single', // 'single' | 'multi'
  animation: 'walk', // single mode: SPRITE_ANIMATIONS key
  animations: 'idle,walk,attack', // multi mode: CSV of animation keys
  directions: 'none', // 'none' | 'lr' | '4way' (locomotion rows)
  frames: 8, // single mode: frames (columns); multi uses per-animation counts
  animFrames: 'idle:4,walk:6,run:8,jump:6,attack:6,cast:6,hurt:4,death:4,effect:6,item:1', // "anim:count,…"
  background: 'transparent', // 'transparent' | 'black' | 'magenta'
  // Facial expressions (src/lib/expressions.js). The global default is baked
  // into every frame; `animExpressions` overrides one animation, and
  // `frameExpressions` ({ walk: ['neutral', 'happy', …] }) overrides single
  // frames ('' = inherit the row's expression). `expressionRows` is a CSV of
  // expression-only idle rows appended to the sheet (e.g. 'happy,angry').
  expression: 'neutral',
  animExpressions: {},
  frameExpressions: {},
  expressionRows: '',
  cellSize: 256,
  genSize: 1024,
  fps: 12,
  seed: -1,
  steps: 20,
  cfg: 4,
  // Video engine only: frames per row (snapped to WAN's 4n+1 rule) and the
  // square render size WAN samples at before cells are scaled down.
  videoFrames: 13,
  videoRes: 512,
}

// Image settings. sizeMode 'ratio' uses the aspect-ratio presets; 'custom'
// generates at an exact W×H (snapped to a multiple of 8) in buildImageWorkflow.
export const DEFAULT_IMAGE_SETTINGS = {
  aspectRatio: '1:1',
  sizeMode: 'ratio', // 'ratio' | 'custom'
  width: 1024,
  height: 1024,
  turboMode: false,
  seed: -1,
  steps: 20,
  cfg: 4,
  // One ComfyUI job can decode several latents in a single batch; the
  // results arrive as one history entry per image and render as a grid.
  batchCount: 1,
}

// Pixel Art mode: SDXL + Pixel Art XL. Square output only — 32×32 game
// assets are downscaled from this in the viewer; 512–1024 is the useful
// range (SDXL was trained at 1024).
export const DEFAULT_PIXEL_SETTINGS = {
  size: 1024,
  seed: -1,
  steps: 30,
  cfg: 7,
  batchCount: 1,
  loraStrength: 1,
}

// 2D part splitting (ComfyUI-AutoSplit-Orchestrator + SAM 3): turn one flat
// character image into named, z-ordered part PNGs.
export const DEFAULT_SPLIT_SETTINGS = {
  labelPreset: 'anatomy',
  labels: AUTOSPLIT_LABEL_PRESETS.anatomy.join('\n'),
  characterName: 'character',
  outputDirectory: 'split_parts_sam3',
  padding: 8,
  confidence: 0.3,
  retryConfidence: 0.2,
  sam3Model: 'sam3.pt',
  depthModel: 'depth_anything_v2_vitl.pth',
}

// Character parts library: generate many variants of a slot (armour, head,
// hair, body…) so the player can pick, then split/adjust in Godot.
export const DEFAULT_PARTS_SETTINGS = {
  slot: 'armour',
  direction: 'front', // front | side | threeQuarter | back
  base: 'cute stylized soft matte clay 3D game character',
  negative: '',
  count: 4,
  width: 512,
  height: 512,
  seed: -1,
  steps: 20,
  cfg: 4,
}

// Default named presets for the multi-model pickers. `presets` (per mode)
// is a list of { name, unet, clip, vae, lora?, engine? } saved alongside the
// flat group; `active` picks which one generation uses (null = the flat
// group, i.e. the old single-model behaviour).
export const DEFAULT_PRESETS = {
  video: [
    {
      name: 'Wan 2.1 t2v 1.3B',
      unet: 'wan2.1_t2v_1.3B_bf16.safetensors',
      clip: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
      vae: 'wan_2.1_vae.safetensors',
      lora: '',
    },
  ],
  music: [
    {
      name: 'MiniMax Music 3',
      unet: 'minimax_music3_dit_int8_convrot.safetensors',
      clip: 'minimax_music3_text_encoder_pruned_int8_convrot.safetensors',
      vae: 'minimax_music3_dav.safetensors',
    },
  ],
  // SFX mode — Stable Audio 3 (sound effects, not music). The checkpoint
  // (models/checkpoints) sits in `unet` by convention; the T5Gemma text
  // encoder is resolved by resolveStableAudioModels.
  sfx: [
    {
      name: 'Stable Audio 3 (SFX)',
      engine: 'stable_audio',
      unet: 'stable_audio_3_small_sfx.safetensors',
      clip: 't5gemma_b_b_ul2.safetensors',
      vae: '',
    },
    {
      name: 'Stable Audio 3 Medium',
      engine: 'stable_audio',
      unet: 'stable_audio_3_medium.safetensors',
      clip: 't5gemma_b_b_ul2.safetensors',
      vae: '',
    },
  ],
}

export const DEFAULT_ACTIVE = { video: 0, music: 0, sfx: 0 }

// Sung lyrics for music mode. Default = the section-tag map (also the
// visible example in the box); tag-only = instrumental at generate time.
// Not persisted across reloads, so the default always resurfaces.
export const DEFAULT_LYRICS = STRUCTURE_TAGS

// Per-mode generation settings that config.json can override.
export const SETTING_GROUPS = [
  'imageSettings',
  'pixelSettings',
  'videoSettings',
  'editSettings',
  'musicSettings',
  'sfxSettings',
  'spriteSettings',
]

// Fields applyServerConfig() accepts from a sanitized config.json.
export const CONFIG_FIELDS = [
  'serverUrl',
  'useProxy',
  'autoUnload',
  'vramGuard',
  'style',
  'searchUrl',
  'searchEngine',
  'searchApiKey',
  'searchCseId',
  'llmProvider',
]
