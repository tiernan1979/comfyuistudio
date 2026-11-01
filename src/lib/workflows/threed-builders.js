import { addFaceMask, FACE_PAINT_PROMPT, FACE_PAINT_NEG } from './face.js'

// Local pipeline, step 2: mesh → MIA auto-rig (+ optional Mixamo
// animations). Loads via MeshToolsLoad's mesh_path STRING — a free path, so
// any uploaded name or existing server file works with NO ComfyUI restart
// (the old UniRigLoadMesh file_path dropdown was cached at startup).
export function buildMiaRigWorkflow({
  meshPath, // '3d/foo.glb' — preferred: free string path
  meshName, // legacy: bare name → '3d/<name>'
  precision = 'fp32',
  animationFile = '', // legacy single animation
  animationFiles = [], // multi: one UniRigApplyAnimation node each
  animationType = 'mixamo',
}) {
  const path = String(meshPath || (meshName ? `3d/${meshName}` : ''))
  const meshBase = path.split('/').pop().replace(/\.[^.]+$/, '')
  const anims = [
    ...[].concat(animationFiles || []),
    ...(animationFile ? [animationFile] : []),
  ].filter(Boolean)
  const workflow = {
    '41': {
      class_type: 'MIALoadModel',
      inputs: { precision, attn_backend: 'auto' },
    },
    '27': {
      class_type: 'MeshToolsLoad',
      inputs: { mesh_path: path },
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

  anims.forEach((file, i) => {
    const animBase = String(file).replace(/\.[^.]+$/, '')
    workflow[String(50 + i)] = {
      class_type: 'UniRigApplyAnimation',
      inputs: {
        model_fbx_path: ['42', 0],
        animation_type: animationType,
        animation_file: file,
        output_name: `${meshBase}_${animBase}`,
      },
    }
  })

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
        // UltraShape's old defaults (max_distance 0.5, bias 0.01, strength 1)
        // baked a half-black AO map — rays of half the bbox start inside the
        // surface and self-hit, then glTF occlusion darkened the albedo to
        // blotches. Verified on the character mesh: these values keep mean
        // ~178/255 with 0% near-black texels while still adding contact shade.
        max_distance: 0.15,
        strength: 0.85,
        bias: 0.03,
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
  faceFix = null, // { faceModelName, editModels, denoise } | null
  viewUpscale = true, // detail-upscale views before the bake (face sharpness)
}) {
  const wf = {
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
  if (faceFix) applyPaintFaceFix(wf, faceFix)
  if (viewUpscale) applyViewUpscale(wf, viewSize)
  return wf
}

// Detail-upscale of the baked views. The atlas only gives the face ~2.5% of
// 4096² (≈650² texels, fragmented islands), while the front view's face is
// ~300² px at view_size 768 — so the bake upsampled a soft view into a
// higher-density atlas and the face came out mushy. Feeding the bake views
// at 2× size with the face view sharpened by 4x-UltraSharp (local model)
// fills the atlas's real face density. The UltraSharp pass only runs for
// views ≤768px (its 4× output stays ≤3072² — larger inputs would OOM the
// conv); bigger views just get a lanczos 2× (they already carry the pixels).
function applyViewUpscale(wf, viewSize) {
  const target = Math.min(Math.max(viewSize * 2, 1024), 2048)
  const albedoSrc = wf['5'].inputs.albedo // ['4',1] or the faceFix-refined batch
  // Node ids: 7-9 + 17-21 — 10-16 belong to faceFix (13-16 = mediapipe mask).
  if (viewSize <= 768) {
    wf['7'] = { class_type: 'UpscaleModelLoader', inputs: { model_name: '4x-UltraSharp.pth' } }
    wf['8'] = { class_type: 'ImageFromBatch', inputs: { image: albedoSrc, batch_index: 0, length: 1 } }
    wf['9'] = { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['7', 0], image: ['8', 0] } }
    wf['17'] = {
      class_type: 'ImageScale',
      inputs: { image: ['9', 0], upscale_method: 'lanczos', width: target, height: target, crop: 'disabled' },
    }
    wf['18'] = { class_type: 'ImageFromBatch', inputs: { image: albedoSrc, batch_index: 1, length: 5 } }
    wf['19'] = {
      class_type: 'ImageScale',
      inputs: { image: ['18', 0], upscale_method: 'lanczos', width: target, height: target, crop: 'disabled' },
    }
    wf['20'] = { class_type: 'ImageBatch', inputs: { image1: ['17', 0], image2: ['19', 0] } }
    wf['5'].inputs.albedo = ['20', 0]
  } else {
    wf['20'] = {
      class_type: 'ImageScale',
      inputs: { image: albedoSrc, upscale_method: 'lanczos', width: target, height: target, crop: 'disabled' },
    }
    wf['5'].inputs.albedo = ['20', 0]
  }
  wf['21'] = {
    class_type: 'ImageScale',
    inputs: { image: ['4', 2], upscale_method: 'lanczos', width: target, height: target, crop: 'disabled' },
  }
  wf['5'].inputs.mr = ['21', 0]
}

// Face pass inside the paint run: after the 6 views are generated (node 4)
// and before they are baked (node 5), run a Qwen-Image face refine on the
// FRONT view only (camera azimuth list starts at 0), then rebuild the albedo
// batch so the bake sees the fixed view in slot 0. mr and pipeline are
// untouched. With a MediaPipe model the edit is confined to a blurred face
// mask; without one it's a low-denoise global refine of the front view
// (the front view dominates the bake at view weight 1.0).
function applyPaintFaceFix(wf, { faceModelName = '', editModels, denoise = 0.45 }) {
  wf['10'] = { class_type: 'ImageFromBatch', inputs: { image: ['4', 1], batch_index: 0, length: 1 } }

  let refined = ['78', 0]
  if (faceModelName) {
    wf['11'] = { class_type: 'LoadMediaPipeFaceLandmarker', inputs: { model_name: faceModelName } }
    wf['12'] = {
      class_type: 'MediaPipeFaceLandmarker',
      inputs: {
        face_detection_model: ['11', 0],
        image: ['10', 0],
        detector_variant: 'both',
        num_faces: 1,
        min_confidence: 0.3,
        missing_frame_fallback: 'empty',
      },
    }
    const mask = addFaceMask(wf, { landmarksNode: '12' })
    wf['61'] = {
      class_type: 'ImageCompositeMasked',
      inputs: { destination: ['10', 0], source: ['78', 0], x: 0, y: 0, resize_source: false, mask },
    }
    refined = ['61', 0]
  } else {
    // VAEDecode straight into ImageBatch deterministically poisons the bake's
    // raw texture output (diagnosed against the live server: direct path G/G2
    // byte-identical garbage, composite path Q/Q2 byte-identical clean with
    // identical pixel values). Materialize the refined pixels through a
    // full-opacity composite so the bake sees a fresh tensor; sized from the
    // view generator so non-512 view sizes still match.
    const vs = wf['4']?.inputs?.view_size ?? 512
    wf['64'] = { class_type: 'SolidMask', inputs: { value: 1, width: vs, height: vs } }
    wf['61'] = {
      class_type: 'ImageCompositeMasked',
      inputs: { destination: ['10', 0], source: ['78', 0], x: 0, y: 0, resize_source: false, mask: ['64', 0] },
    }
    refined = ['61', 0]
  }

  // Qwen-Image img2img on the front view (same verified stack as the edit tab).
  wf['37'] = { class_type: 'UNETLoader', inputs: { unet_name: editModels.unet, weight_dtype: 'default' } }
  wf['38'] = {
    class_type: 'CLIPLoader',
    inputs: { clip_name: editModels.clip, type: 'qwen_image', device: 'default' },
  }
  wf['39'] = { class_type: 'VAELoader', inputs: { vae_name: editModels.vae } }
  wf['76'] = {
    class_type: 'TextEncodeQwenImageEdit',
    inputs: { clip: ['38', 0], vae: ['39', 0], image: ['10', 0], prompt: FACE_PAINT_PROMPT },
  }
  wf['77'] = {
    class_type: 'TextEncodeQwenImageEdit',
    inputs: { clip: ['38', 0], vae: ['39', 0], image: ['10', 0], prompt: FACE_PAINT_NEG },
  }
  wf['88'] = { class_type: 'VAEEncode', inputs: { pixels: ['10', 0], vae: ['39', 0] } }
  wf['66'] = { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['37', 0], shift: 3 } }
  wf['75'] = { class_type: 'CFGNorm', inputs: { model: ['66', 0], strength: 1 } }
  wf['73'] = {
    class_type: 'KSampler',
    inputs: {
      model: ['75', 0],
      positive: ['76', 0],
      negative: ['77', 0],
      latent_image: ['88', 0],
      seed: 1234,
      control_after_generate: 'fixed',
      steps: 18,
      cfg: 2.5,
      sampler_name: 'euler',
      scheduler: 'simple',
      denoise,
    },
  }
  wf['78'] = { class_type: 'VAEDecode', inputs: { samples: ['73', 0], vae: ['39', 0] } }

  // Rebuild the 6-view albedo batch: refined front + views 1..5 untouched.
  wf['62'] = { class_type: 'ImageFromBatch', inputs: { image: ['4', 1], batch_index: 1, length: 5 } }
  wf['63'] = { class_type: 'ImageBatch', inputs: { image1: refined, image2: ['62', 0] } }
  wf['5'].inputs.albedo = ['63', 0]
}
