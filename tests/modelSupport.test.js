import test from 'node:test'
import assert from 'node:assert/strict'

import {
  isSupportedMusicModel,
  isSupportedVideoModel,
} from '../src/lib/comfyui/models.js'

test('video preflight only accepts families this build can render', () => {
  assert.equal(isSupportedVideoModel('wan2.1_t2v_1.3B_bf16.safetensors'), true)
  assert.equal(isSupportedVideoModel('minimax_h3_fl2va_pruned_int8_convrot.safetensors'), true)
  assert.equal(isSupportedVideoModel('hailuo_video.safetensors'), true)
  assert.equal(isSupportedVideoModel('qwen_image_2.1_int8_convrot.safetensors'), false)
  assert.equal(isSupportedVideoModel('cogvideox_5b.safetensors'), false)
  assert.equal(isSupportedVideoModel('hunyuan_video_t2v.safetensors'), false)
  assert.equal(isSupportedVideoModel('ltx-video-2b.safetensors'), false)
})

test('music preflight only accepts families this build can render', () => {
  assert.equal(isSupportedMusicModel('minimax_music3_dit_int8_convrot.safetensors'), true)
  assert.equal(isSupportedMusicModel('acestep_v1.5_xl_turbo_bf16.safetensors'), true)
  assert.equal(isSupportedMusicModel('stable_audio_3_medium.safetensors'), true)
  assert.equal(isSupportedMusicModel('yue_1.5.safetensors'), false)
  assert.equal(isSupportedMusicModel('musicgen_large.safetensors'), false)
  assert.equal(isSupportedMusicModel('diffrhythm_full.safetensors'), false)
})
