import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveModels } from '../api/src/lib.mjs'
import { resolveH3VideoModels } from '../src/lib/comfyui/models.js'

const H3_UNET = 'minimax_h3_fl2va_pruned_int8_convrot.safetensors'
const H3_CLIP = 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors'
const H3_VIDEO_VAE = 'minimax_h3_video_vae_fp16.safetensors'
const H3_AUDIO_VAE = 'minimax_h3_audio_vae_fp32.safetensors'
const WAN_CLIP = 'umt5_xxl_fp8_e4m3fn_scaled.safetensors'
const WAN_VAE = 'Wan2.1_VAE.safetensors'

const lists = {
  unet: [H3_UNET],
  clip: [WAN_CLIP, H3_CLIP],
  vae: [WAN_VAE, H3_VIDEO_VAE, H3_AUDIO_VAE],
  lora: [],
}

test('API H3 run does not fall back to the Wan clip/VAE defaults', () => {
  const out = resolveModels(lists, 'video', { unet: H3_UNET })
  assert.equal(out.clip, H3_CLIP)
  assert.equal(out.vae, H3_VIDEO_VAE)
  assert.equal(out.vaeAudio, H3_AUDIO_VAE)
})

test('H3 video VAE wins even when the audio VAE is listed first', () => {
  const audioFirst = { ...lists, vae: [H3_AUDIO_VAE, H3_VIDEO_VAE, WAN_VAE] }

  const ui = resolveH3VideoModels(audioFirst, { unet: H3_UNET })
  assert.equal(ui.vae, H3_VIDEO_VAE)
  assert.equal(ui.vaeAudio, H3_AUDIO_VAE)

  const api = resolveModels(audioFirst, 'video', { unet: H3_UNET })
  assert.equal(api.vae, H3_VIDEO_VAE)
  assert.equal(api.vaeAudio, H3_AUDIO_VAE)
})

test('API honours explicit H3 clip/VAE/audio-VAE picks', () => {
  const out = resolveModels(lists, 'video', {
    unet: H3_UNET,
    clip: H3_CLIP,
    vae: H3_VIDEO_VAE,
    vaeAudio: H3_AUDIO_VAE,
  })
  assert.equal(out.clip, H3_CLIP)
  assert.equal(out.vae, H3_VIDEO_VAE)
  assert.equal(out.vaeAudio, H3_AUDIO_VAE)
})

test('API rejects a Wan encoder pinned on an H3 run', () => {
  assert.throws(
    () => resolveModels(lists, 'video', { unet: H3_UNET, clip: WAN_CLIP }),
    /not a MiniMax H3 text encoder/,
  )
  assert.throws(
    () => resolveModels(lists, 'video', { unet: H3_UNET, vae: WAN_VAE }),
    /not a MiniMax H3 video VAE/,
  )
})

test('UI resolver honours configured H3 assets and repairs stale ones', () => {
  const honoured = resolveH3VideoModels(lists, {
    unet: H3_UNET,
    clip: H3_CLIP,
    vae: H3_VIDEO_VAE,
    vaeAudio: H3_AUDIO_VAE,
  })
  assert.equal(honoured.clip, H3_CLIP)
  assert.equal(honoured.vae, H3_VIDEO_VAE)
  assert.equal(honoured.vaeAudio, H3_AUDIO_VAE)

  // Old saved presets carry the Wan encoder/vae — generation must not use
  // them for H3, and the caller writes the corrected set back to the store.
  const repaired = resolveH3VideoModels(lists, {
    unet: H3_UNET,
    clip: WAN_CLIP,
    vae: WAN_VAE,
    vaeAudio: '',
  })
  assert.equal(repaired.clip, H3_CLIP)
  assert.equal(repaired.vae, H3_VIDEO_VAE)
  assert.equal(repaired.vaeAudio, H3_AUDIO_VAE)
})

test('UI resolver explains exactly which H3 asset is missing', () => {
  assert.throws(
    () => resolveH3VideoModels({ clip: [WAN_CLIP], vae: [WAN_VAE] }, { unet: H3_UNET }),
    /H3 text encoder.*H3 video VAE.*H3 audio VAE/s,
  )
})
