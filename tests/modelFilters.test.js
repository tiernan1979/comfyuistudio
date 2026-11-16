import test from 'node:test'
import assert from 'node:assert/strict'

import { filterModelOptions } from '../src/lib/modelFilters.js'

// The ComfyUI 0.44 inventory this app was built against. Keeping the test on
// the real names catches a filter that silently starts hiding the only
// installed model for a pipeline.
const unets = [
  'LongCat_TI2V_comfy_fp8_e4m3fn_scaled_KJ.safetensors',
  'MelBandRoformer_fp16.safetensors',
  'acestep_v1.5_xl_turbo_bf16.safetensors',
  'minimax_h3_fl2va_pruned_int4_convrot.safetensors',
  'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
  'minimax_music3_dit_int8_convrot.safetensors',
  'pixal3d_int8_convrot.safetensors',
  'qwen_image_2.1_int8_convrot.safetensors',
  'qwen_image_edit_fp8_e4m3fn.safetensors',
  'trellis_2_int8_convrot.safetensors',
  'wan2.1_t2v_1.3B_bf16.safetensors',
]

const clips = [
  'minimax_music3_text_encoder_pruned_int8_convrot.safetensors',
  'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
  'qwen3vl_8b_w4a8.safetensors',
  'qwen_0.6b_ace15.safetensors',
  'qwen_1.7b_ace15.safetensors',
  't5gemma_b_b_ul2.safetensors',
  'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
]

const vaes = [
  'Wan2.1_VAE.safetensors',
  'ace_1.5_vae.safetensors',
  'minimax_h3_audio_vae_fp32.safetensors',
  'minimax_h3_video_vae_fp16.safetensors',
  'minimax_music3_dav.safetensors',
  'qwen_image_2.1_vae_bf16.safetensors',
  'trellis_2_shape_vae_bf16.safetensors',
  'trellis_2_texture_vae_bf16.safetensors',
]

const checkpoints = [
  'ace_step_1.5_turbo_aio.safetensors',
  'hunyuan_3d_v2.1.safetensors',
  'pixel-art-xl.safetensors',
  'sd_xl_base_1.0_0.9vae.safetensors',
  'sd_xl_offset_example-lora_1.0.safetensors',
  'stable_audio_3_medium.safetensors',
  'stable_audio_3_small_sfx.safetensors',
]

const loras = [
  'LongCat_distill_lora_alpha64_bf16.safetensors',
  'minimax_h3_turbo_v4_step600_ema_pruned_comfyui.safetensors',
  'pixel-art-xl.safetensors',
]

const ggufs = [
  'wan2.2_i2v_A14b_high_noise_lightx2v_4step-Q4_K_M.gguf',
  'wan2.2_i2v_A14b_low_noise_lightx2v_4step-Q4_K_M.gguf',
]

const pick = (section, slot, list) => filterModelOptions(section, slot, list)

test('image filters keep Qwen-Image files and hide other pipelines', () => {
  assert.deepEqual(pick('image', 'unet', unets), ['qwen_image_2.1_int8_convrot.safetensors'])
  assert.deepEqual(pick('image', 'clip', clips), ['qwen3vl_8b_w4a8.safetensors'])
  assert.deepEqual(pick('image', 'vae', vaes), ['qwen_image_2.1_vae_bf16.safetensors'])
  assert.deepEqual(pick('image', 'lora', loras), [])
})

test('pixel art only lists SDXL checkpoints and the pixel LoRA', () => {
  assert.deepEqual(pick('pixel', 'checkpoint', checkpoints), [
    'sd_xl_base_1.0_0.9vae.safetensors',
  ])
  assert.deepEqual(pick('pixel', 'lora', loras), ['pixel-art-xl.safetensors'])
})

test('edit accepts Qwen-Image and Qwen-Image-Edit but not other engines', () => {
  assert.deepEqual(pick('edit', 'unet', unets), [
    'qwen_image_2.1_int8_convrot.safetensors',
    'qwen_image_edit_fp8_e4m3fn.safetensors',
  ])
})

test('video filters keep Wan and MiniMax H3 files only', () => {
  assert.deepEqual(pick('video', 'unet', [...unets, ...ggufs]), [
    'minimax_h3_fl2va_pruned_int4_convrot.safetensors',
    'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
    'wan2.1_t2v_1.3B_bf16.safetensors',
  ])
  assert.deepEqual(pick('video', 'clip', clips), [
    'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
    'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
  ])
  assert.deepEqual(pick('video', 'vae', vaes), [
    'Wan2.1_VAE.safetensors',
    'minimax_h3_video_vae_fp16.safetensors',
  ])
  assert.deepEqual(pick('video', 'vaeAudio', vaes), ['minimax_h3_audio_vae_fp32.safetensors'])
  assert.deepEqual(pick('video', 'lora', loras), [
    'minimax_h3_turbo_v4_step600_ema_pruned_comfyui.safetensors',
  ])
})

test('character video only lists WAN 2.2 i2v GGUF experts and their stack', () => {
  assert.deepEqual(pick('character', 'gguf', ggufs), ggufs)
  assert.deepEqual(pick('character', 'clip', clips), ['umt5_xxl_fp8_e4m3fn_scaled.safetensors'])
  assert.deepEqual(pick('character', 'vae', vaes), ['Wan2.1_VAE.safetensors'])
})

test('music filters keep MiniMax Music and ACE-Step assets', () => {
  assert.deepEqual(pick('music', 'unet', [...unets, ...checkpoints]), [
    'acestep_v1.5_xl_turbo_bf16.safetensors',
    'minimax_music3_dit_int8_convrot.safetensors',
    'ace_step_1.5_turbo_aio.safetensors',
  ])
  assert.deepEqual(pick('music', 'clip', clips), [
    'minimax_music3_text_encoder_pruned_int8_convrot.safetensors',
    'qwen_0.6b_ace15.safetensors',
    'qwen_1.7b_ace15.safetensors',
  ])
  assert.deepEqual(pick('music', 'vae', vaes), [
    'ace_1.5_vae.safetensors',
    'minimax_music3_dav.safetensors',
  ])
})

test('sfx filters keep Stable Audio 3 and its T5Gemma encoder', () => {
  assert.deepEqual(pick('sfx', 'checkpoint', checkpoints), [
    'stable_audio_3_medium.safetensors',
    'stable_audio_3_small_sfx.safetensors',
  ])
  assert.deepEqual(pick('sfx', 'clip', clips), ['t5gemma_b_b_ul2.safetensors'])
})

test('unknown sections and slots fall back to the full list', () => {
  assert.deepEqual(pick('nope', 'unet', unets), unets)
  assert.deepEqual(pick('image', 'nope', unets), unets)
  const original = filterModelOptions('image', 'unet', unets)
  assert.notEqual(original, unets)
})
