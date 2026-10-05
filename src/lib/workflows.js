const ASPECT_RATIOS = {
  '1:1': { width: 1328, height: 1328 },
  '16:9': { width: 1664, height: 928 },
  '9:16': { width: 928, height: 1664 },
  '4:3': { width: 1472, height: 1140 },
  '3:4': { width: 1140, height: 1472 },
  '3:2': { width: 1584, height: 1056 },
  '2:3': { width: 1056, height: 1584 },
}

const VIDEO_RESOLUTIONS = {
  '480p': { width: 832, height: 480 },
  '720p': { width: 1280, height: 720 },
}

export function buildImageWorkflow({
  prompt,
  negativePrompt = '',
  aspectRatio = '1:1',
  seed = -1,
  steps = 20,
  cfg = 4,
  turboMode = false,
  models,
}) {
  const { width, height } = ASPECT_RATIOS[aspectRatio] || ASPECT_RATIOS['1:1']
  const actualSeed = seed === -1 ? Math.floor(Math.random() * 2 ** 48) : seed

  const workflow = {
    '37': {
      class_type: 'UNETLoader',
      inputs: {
        unet_name: models.unet,
        weight_dtype: 'default',
      },
    },
    '38': {
      class_type: 'CLIPLoader',
      inputs: {
        clip_name: models.clip,
        type: 'qwen_image',
        device: 'default',
      },
    },
    '39': {
      class_type: 'VAELoader',
      inputs: {
        vae_name: models.vae,
      },
    },
    '6': {
      class_type: 'CLIPTextEncode',
      inputs: {
        clip: ['38', 0],
        text: prompt,
      },
    },
    '7': {
      class_type: 'CLIPTextEncode',
      inputs: {
        clip: ['38', 0],
        text: negativePrompt,
      },
    },
    '58': {
      class_type: 'EmptySD3LatentImage',
      inputs: {
        width: width,
        height: height,
        batch_size: 1,
      },
    },
    '3': {
      class_type: 'KSampler',
      inputs: {
        model: ['37', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['58', 0],
        seed: actualSeed,
        control_after_generate: 'randomize',
        steps: turboMode ? 8 : steps,
        cfg: turboMode ? 1 : cfg,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1,
      },
    },
    '8': {
      class_type: 'VAEDecode',
      inputs: {
        samples: ['3', 0],
        vae: ['39', 0],
      },
    },
    '60': {
      class_type: 'SaveImage',
      inputs: {
        images: ['8', 0],
        filename_prefix: 'ComfyUI',
      },
    },
  }

  // If turbo mode, add LoRA and switch nodes
  if (turboMode && models.lora) {
    workflow['73'] = {
      class_type: 'LoraLoaderModelOnly',
      inputs: {
        model: ['37', 0],
        lora_name: models.lora,
        strength_model: 1,
      },
    }
    workflow['78'] = {
      class_type: 'ComfySwitchNode',
      inputs: {
        on_false: ['37', 0],
        on_true: ['73', 0],
        switch: true,
      },
    }
    workflow['66'] = {
      class_type: 'ModelSamplingAuraFlow',
      inputs: {
        model: ['78', 0],
        shift: 3.1,
      },
    }
    workflow['3'].inputs.model = ['66', 0]
  }

  return workflow
}

export function buildEditWorkflow({
  prompt,
  negativePrompt = '',
  imageName,
  seed = -1,
  steps = 20,
  cfg = 2.5,
  models,
}) {
  const actualSeed = seed === -1 ? Math.floor(Math.random() * 2 ** 48) : seed

  return {
    '37': {
      class_type: 'UNETLoader',
      inputs: {
        unet_name: models.unet,
        weight_dtype: 'default',
      },
    },
    '38': {
      class_type: 'CLIPLoader',
      inputs: {
        clip_name: models.clip,
        type: 'qwen_image',
        device: 'default',
      },
    },
    '39': {
      class_type: 'VAELoader',
      inputs: {
        vae_name: models.vae,
      },
    },
    '78': {
      class_type: 'LoadImage',
      inputs: {
        image: imageName,
      },
    },
    '76': {
      class_type: 'TextEncodeQwenImageEdit',
      inputs: {
        clip: ['38', 0],
        vae: ['39', 0],
        image: ['78', 0],
        prompt: prompt,
      },
    },
    '77': {
      class_type: 'TextEncodeQwenImageEdit',
      inputs: {
        clip: ['38', 0],
        vae: ['39', 0],
        image: ['78', 0],
        prompt: negativePrompt,
      },
    },
    '88': {
      class_type: 'VAEEncode',
      inputs: {
        pixels: ['78', 0],
        vae: ['39', 0],
      },
    },
    '66': {
      class_type: 'ModelSamplingAuraFlow',
      inputs: {
        model: ['37', 0],
        shift: 3,
      },
    },
    '75': {
      class_type: 'CFGNorm',
      inputs: {
        model: ['66', 0],
        strength: 1,
      },
    },
    '3': {
      class_type: 'KSampler',
      inputs: {
        model: ['75', 0],
        positive: ['76', 0],
        negative: ['77', 0],
        latent_image: ['88', 0],
        seed: actualSeed,
        control_after_generate: 'randomize',
        steps: steps,
        cfg: cfg,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1,
      },
    },
    '8': {
      class_type: 'VAEDecode',
      inputs: {
        samples: ['3', 0],
        vae: ['39', 0],
      },
    },
    '60': {
      class_type: 'SaveImage',
      inputs: {
        images: ['8', 0],
        filename_prefix: 'ComfyUI',
      },
    },
  }
}

// ---------------------------------------------------------------------------
// 3D workflows (optional feature, enabled in Settings → 3D Generation)
// ---------------------------------------------------------------------------

function randomHex(len) {
  let s = ''
  for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 16).toString(16)
  return s
}

// Local pipeline, step 1: image → 3D mesh (Pixal3D, TencentARC).
// Mirrors the proven homeclaw workflow: LoadImage → Pixal3DModelLoader →
// Pixal3DImageTo3D → Pixal3DExportGLB. The hf_endpoint cache-buster forces
// a clean model fetch per run.
export function buildPixal3DWorkflow({
  imageName,
  modelRepo = 'TencentARC/Pixal3D',
  vramMode = 'dynamic_vram',
  seed = Math.floor(Math.random() * 2 ** 32),
  pipeline = '1536_cascade',
  cameraRes = 1024,
  textureSize = 4096,
  decimation = 300000,
  steps = 20,
  guidance = 7.5,
  textureGuidance = 2.0,
  maxTokens = 49152,
  remesh = true,
  enhance = 'none', // 'none' | 'sharpen' | 'esrgan' | 'magnific4x'
  enhanceModel = '', // upscale_models/*.pth name when enhance === 'esrgan'
  nafMode = 'fallback_if_missing', // 'fallback_if_missing' | 'strict' (natten/NAF)
}) {
  const wf = {
    '1': {
      class_type: 'LoadImage',
      inputs: { image: imageName },
    },
    '2': {
      class_type: 'Pixal3DModelLoader',
      inputs: {
        model_repo: modelRepo,
        hf_endpoint: `https://huggingface.co/hc-${randomHex(12)}`,
        attention_backend: 'auto',
        vram_mode: vramMode,
        download_if_missing: true,
        load_moge: true,
        load_rembg: false,
        naf_mode: nafMode,
        naf_target_size: 'upstream',
        preload_naf: nafMode === 'strict',
        force_reload: true,
      },
    },
    '3': {
      class_type: 'Pixal3DImageTo3D',
      inputs: {
        model: ['2', 0],
        image: ['1', 0],
        seed: seed,
        pipeline_type: pipeline,
        background_mode: 'none',
        camera_mode: 'moge',
        manual_camera_angle_x: 0.857556,
        manual_distance: 2.0,
        mesh_scale: 1.0,
        extend_pixel: 0,
        camera_resolution: cameraRes,
        steps,
        guidance,
        texture_guidance: textureGuidance,
        max_num_tokens: maxTokens,
        force_offload: false,
      },
    },
    '4': {
      class_type: 'Pixal3DExportGLB',
      inputs: {
        pixal3d_result: ['3', 0],
        decimation_target: decimation,
        texture_size: textureSize,
        remesh,
        filename_prefix: String(imageName || 'pixal3d').replace(/\.[^.]+$/, ''),
      },
    },
  }

  // Optional source pre-enhance. The conditioning AND texture bake sample
  // the input image, so a sharper/bigger face here directly sharpens the
  // face on the mesh — this is the biggest remaining local lever.
  if (enhance === 'sharpen') {
    wf['5'] = {
      class_type: 'ImageSharpen',
      inputs: { image: ['1', 0], sharpen_radius: 1, sigma: 1.0, alpha: 1.0 },
    }
    wf['3'].inputs.image = ['5', 0]
  } else if (enhance === 'esrgan' && enhanceModel) {
    // free, local 4x upscaler (models live in models/upscale_models/)
    wf['5'] = {
      class_type: 'UpscaleModelLoader',
      inputs: { model_name: enhanceModel },
    }
    wf['6'] = {
      class_type: 'ImageUpscaleWithModel',
      inputs: { upscale_model: ['5', 0], image: ['1', 0] },
    }
    wf['3'].inputs.image = ['6', 0]
  } else if (enhance === 'magnific4x') {
    wf['5'] = {
      class_type: 'MagnificImageUpscalerPreciseV2Node',
      inputs: {
        image: ['1', 0],
        scale_factor: '4x',
        flavor: 'photo',
        sharpen: 20,
        smart_grain: 7,
        ultra_detail: 50,
        auto_downscale: true,
      },
    }
    wf['3'].inputs.image = ['5', 0]
  }
  return wf
}

// Local pipeline, step 2: mesh in input/3d/ → MIA auto-rig (+ optional
// Mixamo animation). UniRigLoadMesh's file_path dropdown is cached at
// ComfyUI startup, so a freshly uploaded mesh is only listed after a
// restart (the caller checks this before queueing).
export function buildMiaRigWorkflow({
  meshName,
  precision = 'fp32',
  animationFile = '',
  animationType = 'mixamo',
}) {
  const meshBase = String(meshName || '').replace(/\.[^.]+$/, '')
  const workflow = {
    '41': {
      class_type: 'MIALoadModel',
      inputs: { precision, attn_backend: 'auto' },
    },
    '27': {
      class_type: 'UniRigLoadMesh',
      inputs: { source_folder: 'input', file_path: `3d/${meshName}` },
    },
    '42': {
      class_type: 'MIAAutoRig',
      inputs: {
        trimesh: ['27', 0],
        model: ['41', 0],
        fbx_name: `mia_${meshBase}`,
        no_fingers: false,
        use_normal: false,
        reset_to_rest: true,
      },
    },
    '10': {
      class_type: 'UniRigPreviewRiggedMesh',
      inputs: { fbx_output_path: ['42', 0] },
    },
  }

  if (animationFile) {
    const animBase = String(animationFile).replace(/\.[^.]+$/, '')
    workflow['50'] = {
      class_type: 'UniRigApplyAnimation',
      inputs: {
        model_fbx_path: ['42', 0],
        animation_type: animationType,
        animation_file: animationFile,
        output_name: `${meshBase}_${animBase}`,
      },
    }
  }

  return workflow
}

// Tripo pipeline (cloud, needs ComfyUI signed in to comfy.org / Tripo API):
// one chain — image → model → rig → retarget a preset animation
// (walk/run/jump/…, 116 presets on this box).
// Output sockets (v0.37.0): model_file 0, task_id 1, GLB 2, FBX 3.
export function buildTripoWorkflow({
  imageName,
  modelVersion = 'v3.1-20260211',
  rigVersion = 'v1.0-20240301',
  rigType = 'auto',
  spec = 'tripo',
  outFormat = 'glb',
  preset = 'preset:walk',
  textureQuality = 'standard',
  geometryQuality = 'standard',
  textureAlignment = 'original_image',
  pbr = true,
}) {
  return {
    '1': {
      class_type: 'LoadImage',
      inputs: { image: imageName },
    },
    '2': {
      class_type: 'TripoImageToModelNode',
      inputs: {
        image: ['1', 0],
        model_version: modelVersion,
        texture: true,
        pbr,
        texture_quality: textureQuality,
        texture_alignment: textureAlignment,
        geometry_quality: geometryQuality,
        face_limit: -1,
      },
    },
    '3': {
      class_type: 'TripoRigNode',
      inputs: {
        original_model_task_id: ['2', 1],
        model_version: rigVersion,
        rig_type: rigType,
        // Retarget presets require the tripo spec (mixamo rigs can't take them)
        spec,
        out_format: outFormat,
      },
    },
    '4': {
      class_type: 'TripoRetargetNode',
      inputs: {
        original_model_task_id: ['3', 1],
        animation: preset,
        out_format: outFormat,
        export_with_geometry: true,
        animate_in_place: false,
      },
    },
  }
}

// UltraShape 1.0 mesh refine: coarse mesh + reference image → detailed mesh.
// The pack's own SaveGLB writes to disk but records nothing in history
// (ComfyUI v0.37 drops plain string outputs), so we finish with ComfyUI's
// core SaveGLB + Preview3D — both ui-serialize the FILE_3D so the app can
// download the result.
export function buildUltraShapeWorkflow({
  meshPath,
  imageName,
  checkpoint = 'ultrashape_v1.pt',
  config = 'infer_dit_refine.yaml',
  dtype = 'bfloat16',
  lowVram = true,
  steps = 20,
  guidance = 5.0,
  octree = 384,
  numChunks = 8000,
  numLatents = 16384,
  seed = 42,
  removeBg = false,
  filenamePrefix = '3d/ultrashape',
  bakeOriginalPath = null,
  bakeResolution = 1024,
  decimateTris = 0, // >0: slim the source in-workflow before UltraShape seeds from it
}) {
  const wf = {
    '1': {
      class_type: 'UltraShapeLoadModel',
      inputs: { checkpoint, config, dtype, low_vram: lowVram },
    },
    '3': {
      class_type: 'LoadImage',
      inputs: { image: imageName },
    },
  }
  if (decimateTris > 0) {
    // Dense source (e.g. a 956k-tri Pixal3D export): TRIMESH-chain slim it
    // inside this prompt — MeshToolsLoad reads any relative path (output/
    // included), Postprocess's pymeshlab QEM hits the face budget (the
    // meshlib decimate nodes need a pip package the box doesn't have), and
    // FromTrimesh hands UltraShape a clean coarse seed.
    wf['16'] = { class_type: 'MeshToolsLoad', inputs: { mesh_path: meshPath } }
    wf['17'] = {
      class_type: 'MeshToolsPostprocess',
      inputs: {
        trimesh: ['16', 0],
        remove_floaters: true,
        remove_degenerate_faces: true,
        reduce_faces: true,
        max_facenum: decimateTris,
        smooth_normals: false,
      },
    }
    wf['18'] = {
      class_type: 'UltraShapeLoadCoarseMeshFromTrimesh',
      inputs: { model: ['1', 0], trimesh: ['17', 0] },
    }
  } else {
    wf['2'] = {
      class_type: 'UltraShapeLoadCoarseMesh',
      inputs: { model: ['1', 0], mesh_path: meshPath, num_latents: numLatents },
    }
  }
  wf['4'] = {
    class_type: 'UltraShapeRefine',
    inputs: {
      model: ['1', 0],
      coarse_mesh: decimateTris > 0 ? ['18', 0] : ['2', 0],
      image: ['3', 0],
      steps,
      guidance_scale: guidance,
      octree_resolution: octree,
      num_chunks: numChunks,
      seed,
      remove_bg: removeBg,
    },
  }
  wf['5'] = {
    class_type: 'UltraShapeConvertToGLB',
    inputs: { refined_mesh: ['4', 0], file_format: 'glb' },
  }
  if (!bakeOriginalPath) {
    wf['6'] = {
      class_type: 'SaveGLB',
      inputs: { mesh: ['5', 0], filename_prefix: filenamePrefix },
    }
    wf['7'] = {
      class_type: 'Preview3D',
      inputs: { model_file: ['5', 0] },
    }
    return wf
  }
  // Textured source: UltraShape only outputs geometry, so we keep the
  // ORIGINAL mesh (UV atlas + PBR intact) and bake the refine's detail as
  // normal + AO maps onto its existing UVs. Get3DComponents loads both
  // meshes as editable MESH; ApplyTextureToMesh re-attaches the extracted
  // base/metal/rough maps plus the bakes for SaveGLB/Preview3D.
  Object.assign(wf, {
    '6': {
      class_type: 'Load3DAdvanced',
      inputs: { model_file: bakeOriginalPath, viewport_state: {}, width: 1024, height: 1024 },
    },
    '7': { class_type: 'Get3DComponents', inputs: { model_3d: ['6', 0] } },
    '8': { class_type: 'Get3DComponents', inputs: { model_3d: ['5', 0] } },
    '9': { class_type: 'MeshTextureToImage', inputs: { mesh: ['7', 0] } },
    '10': {
      class_type: 'BakeNormalMapFromMesh',
      inputs: {
        low_poly: ['7', 0],
        high_poly: ['8', 0],
        resolution: bakeResolution,
        cage_distance: 0.05,
        ignore_backfaces: true,
      },
    },
    '11': {
      class_type: 'BakeAmbientOcclusion',
      inputs: {
        low_poly: ['7', 0],
        high_poly: ['8', 0],
        resolution: bakeResolution,
        samples: 64,
        max_distance: 0.5,
        strength: 1.0,
        bias: 0.01,
      },
    },
    '12': {
      class_type: 'ApplyTextureToMesh',
      inputs: {
        mesh: ['7', 0],
        base_color: ['9', 0],
        metallic: ['9', 1],
        roughness: ['9', 2],
        occlusion: ['11', 0],
        normal_map: ['10', 0],
      },
    },
    '13': { class_type: 'MeshToFile3D', inputs: { mesh: ['12', 0] } },
    '14': {
      class_type: 'SaveGLB',
      inputs: { mesh: ['13', 0], filename_prefix: filenamePrefix },
    },
    '15': { class_type: 'Preview3D', inputs: { model_file: ['13', 0] } },
  })
  return wf
}

// Hunyuan3D-Paint: skin a mesh (bare UltraShape output, imported GLB, …)
// from the source picture. MeshToolsLoad →6-view camera rig → multiview PBR
// diffusion → bake → inpaint → GLB. Wiring matches the validated smoke run.
export function buildPaintWorkflow({
  meshPath,
  imageName,
  paintModel = 'hunyuan3d-paintpbr-v2-1',
  viewSize = 512,
  steps = 10,
  guidance = 3.0,
  textureSize = 1024,
  seed = 42,
  outputName = 'painted',
}) {
  return {
    '1': { class_type: 'MeshToolsLoad', inputs: { mesh_path: meshPath } },
    '2': {
      class_type: 'Hy3D21CameraConfig',
      inputs: {
        camera_azimuths: '0, 90, 180, 270, 0, 180',
        camera_elevations: '0, 0, 0, 0, 90, -90',
        view_weights: '1, 0.1, 0.5, 0.1, 0.05, 0.05',
        ortho_scale: 1.0,
      },
    },
    '3': { class_type: 'LoadImage', inputs: { image: imageName } },
    '4': {
      class_type: 'Hy3DMultiViewsGenerator',
      inputs: {
        trimesh: ['1', 0],
        camera_config: ['2', 0],
        paint_model: paintModel,
        view_size: viewSize,
        image: ['3', 0],
        steps,
        guidance_scale: guidance,
        texture_size: textureSize,
        unwrap_mesh: true,
        seed,
        diffusion_backend: 'pytorch',
      },
    },
    '5': {
      class_type: 'Hy3DBakeMultiViews',
      inputs: {
        pipeline: ['4', 0],
        camera_config: ['2', 0],
        albedo: ['4', 1],
        mr: ['4', 2],
      },
    },
    '6': {
      class_type: 'Hy3DInPaint',
      inputs: {
        pipeline: ['5', 0],
        albedo: ['5', 1],
        albedo_mask: ['5', 2],
        mr: ['5', 3],
        mr_mask: ['5', 4],
        output_mesh_name: outputName,
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Music workflow — MiniMax Music 3 (DiT + Music3 text encoder + audio VAE).
// Verified live against ComfyUI 0.37: UNETLoader + CLIPLoader(type 'minimax')
// → MiniMaxMusic3TextEncode (guidance lives HERE, so the sampler runs cfg 1.0
// with a zeroed negative) → KSampler → VAEDecodeAudio → SaveAudio/MP3.
// 8s of music generates in ~20s on an RTX 5060 Ti 16GB.
// ---------------------------------------------------------------------------
// AI-part caption builder: wraps a raw part description ("baseline dum
// dum…", "isolated guitar loop") in a solo-stem production description
// with a hard vocal ban — MiniMax Music 3 otherwise hallucinates singing
// from a bare prompt even with empty lyrics.
const PART_INSTRUMENTAL_BAN =
  'Strictly instrumental — no vocals, no singing, no lyrics, no vocal samples, no choir, no ad-libs.'

export function buildPartCaption(text) {
  const raw = (text || '').trim().replace(/[.\s]+$/, '')
  if (!raw) return ''
  const hasBan = /no vocals|no singing|strictly instrumental|instrumental only/i.test(raw)
  return (
    `${raw} — a soloed stem-like part for a modern track, only the instrument(s) ` +
    `described above, clean dry studio recording, tight and in-tune, continuous ` +
    `loopable phrase, modern mix, high quality production.` +
    (hasBan ? '' : ` ${PART_INSTRUMENTAL_BAN}`)
  )
}

export function buildMusicWorkflow({
  caption, // style / instrumentation description (the main prompt)
  lyrics = '', // sung lyrics; '' = instrumental
  duration = 30, // seconds
  seed = -1,
  steps = 20,
  cfgScale = 1.5, // MiniMaxMusic3TextEncode.cfg_scale
  quality = '320k', // 'wav' | '320k' | 'V0' | '128k'
  models,
}) {
  const actualSeed = seed === -1 ? Math.floor(Math.random() * 2 ** 48) : seed

  // Empty lyrics = instrumental. The model still hallucinates vocals from
  // bare prompts, so pin the intent down in the caption itself (skipped
  // when the caller already bans vocals, e.g. buildPartCaption).
  const trimmedCaption = (caption || '').trim()
  const hasBan = /no vocals|no singing|strictly instrumental/i.test(trimmedCaption)
  const fullCaption = lyrics?.trim()
    ? trimmedCaption
    : hasBan || !trimmedCaption
      ? trimmedCaption || `${PART_INSTRUMENTAL_BAN}`
      : `${trimmedCaption.replace(/[.\s]+$/, '')}. ${PART_INSTRUMENTAL_BAN}`

  const wf = {
    '37': {
      class_type: 'UNETLoader',
      inputs: {
        unet_name: models.unet,
        weight_dtype: 'default',
      },
    },
    '38': {
      class_type: 'CLIPLoader',
      inputs: {
        clip_name: models.clip,
        type: 'minimax',
        device: 'default',
      },
    },
    '39': {
      class_type: 'VAELoader',
      inputs: {
        vae_name: models.vae,
      },
    },
    '40': {
      class_type: 'MiniMaxMusic3TextEncode',
      inputs: {
        clip: ['38', 0],
        caption: fullCaption,
        lyrics,
        seed: actualSeed,
        max_duration: duration,
        cfg_scale: cfgScale,
        top_k: 50,
      },
    },
    '41': {
      class_type: 'EmptyMiniMaxMusic3LatentAudio',
      inputs: {
        seconds: duration,
        batch_size: 1,
      },
    },
    '42': {
      class_type: 'ConditioningZeroOut',
      inputs: {
        conditioning: ['40', 0],
      },
    },
    '3': {
      class_type: 'KSampler',
      inputs: {
        model: ['37', 0],
        positive: ['40', 0],
        negative: ['42', 0],
        latent_image: ['41', 0],
        seed: actualSeed,
        control_after_generate: 'randomize',
        steps,
        cfg: 1.0,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1,
      },
    },
    '8': {
      // Tiled audio decode: the plain VAEDecodeAudio OOMs at the final
      // decode on a 16 GB card (TE + DIT still resident), which burns
      // minutes in failed cudaMalloc retries before ComfyUI falls back
      // to tiling anyway. Tiling from the start is the same result,
      // without the VRAM death spiral.
      class_type: 'VAEDecodeAudioTiled',
      inputs: {
        samples: ['3', 0],
        vae: ['39', 0],
        tile_size: 512,
        overlap: 64,
      },
    },
  }

  if (quality === 'wav') {
    wf['60'] = {
      class_type: 'SaveAudio',
      inputs: {
        audio: ['8', 0],
        filename_prefix: 'music/track',
      },
    }
  } else {
    wf['60'] = {
      class_type: 'SaveAudioMP3',
      inputs: {
        audio: ['8', 0],
        filename_prefix: 'music/track',
        quality: quality === 'V0' || quality === '128k' || quality === '320k' ? quality : '320k',
      },
    }
  }

  return wf
}

export function buildVideoWorkflow({
  prompt,
  negativePrompt = '',
  resolution = '480p',
  frames = 33,
  fps = 16,
  seed = -1,
  steps = 30,
  cfg = 6,
  models,
}) {
  const { width, height } = VIDEO_RESOLUTIONS[resolution] || VIDEO_RESOLUTIONS['480p']
  const actualSeed = seed === -1 ? Math.floor(Math.random() * 2 ** 48) : seed

  return {
    '37': {
      class_type: 'UNETLoader',
      inputs: {
        unet_name: models.unet,
        weight_dtype: 'default',
      },
    },
    '38': {
      class_type: 'CLIPLoader',
      inputs: {
        clip_name: models.clip,
        type: 'wan',
        device: 'default',
      },
    },
    '39': {
      class_type: 'VAELoader',
      inputs: {
        vae_name: models.vae,
      },
    },
    '6': {
      class_type: 'CLIPTextEncode',
      inputs: {
        clip: ['38', 0],
        text: prompt,
      },
    },
    '7': {
      class_type: 'CLIPTextEncode',
      inputs: {
        clip: ['38', 0],
        text: negativePrompt || 'Overexposure, static, blurred details, subtitles, paintings, pictures, still, overall gray, worst quality, low quality',
      },
    },
    '40': {
      class_type: 'EmptyHunyuanLatentVideo',
      inputs: {
        width: width,
        height: height,
        length: frames,
        batch_size: 1,
      },
    },
    '3': {
      class_type: 'KSampler',
      inputs: {
        model: ['37', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['40', 0],
        seed: actualSeed,
        control_after_generate: 'randomize',
        steps: steps,
        cfg: cfg,
        sampler_name: 'uni_pc',
        scheduler: 'simple',
        denoise: 1,
      },
    },
    '8': {
      class_type: 'VAEDecode',
      inputs: {
        samples: ['3', 0],
        vae: ['39', 0],
      },
    },
    '28': {
      class_type: 'SaveAnimatedWEBP',
      inputs: {
        images: ['8', 0],
        filename_prefix: 'ComfyUI',
        fps: fps,
        lossless: false,
        quality: 90,
        method: 'default',
      },
    },
  }
}
