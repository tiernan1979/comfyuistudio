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
  // Fast 1080p: sample at 960×544 (the official H3 "fast" size — 4× fewer
  // tokens than 1920×1088) and upscale with 4x-UltraSharp at the end.
  '1080p-fast': { width: 1920, height: 1080, genWidth: 960, genHeight: 544, upscale: '4x-UltraSharp.pth' },
  '1080p': { width: 1920, height: 1080 },
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
  denoise = 1,
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
        denoise: denoise,
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
// Face-fix (settings toggle threeD.faceFix): face-focused Qwen-Image edit
// passes that run around the 3D pipeline. Faces get ~1-2% of the texels in a
// full-body texture bake, so sharpening the face at source (before mesh gen)
// and on the front paint view (before bake) is where the quality lands.
//
// When ComfyUI/models/detection/ has a MediaPipe face model, a precise
// landmark mask confines the edit to the face oval; otherwise a conservative
// whole-image pass is used and the prompt has to carry the "keep everything
// else identical" constraint.
// ---------------------------------------------------------------------------
export const FACE_ENHANCE_PROMPT =
  'Enhance the face in this image: sharpen the eyes, define the iris, eyelids and eyelashes, ' +
  'add natural fine skin texture, crisp lips and clean facial features. Keep the pose, expression, ' +
  'outfit, colors, lighting, background and composition exactly the same — photorealistic detail only, ' +
  'no style change.'
export const FACE_ENHANCE_NEG =
  'deformed face, warped features, asymmetric eyes, plastic or waxy skin, changed clothes, ' +
  'changed background, blurry, low quality'

const FACE_PAINT_PROMPT =
  'Fix and sharpen the face in this rendered character view: crisp eyes with clear irises and ' +
  'eyelids, defined eyelashes, natural skin detail, clean lips. Keep the pose, outfit, colors, ' +
  'lighting and background exactly the same — no style change.'
const FACE_PAINT_NEG =
  'deformed face, melted features, warped eyes, plastic skin, changed outfit, changed pose, blur'

// Shared face-mask softening: MediaPipeFaceMask is a hard-edged polygon fill,
// which would leave a visible seam where the edit meets the untouched image.
// FeatherMask only softens the image border, so blur the mask instead.
function addFaceMask(wf, { landmarksNode }) {
  wf['13'] = { class_type: 'MediaPipeFaceMask', inputs: { face_landmarks: [landmarksNode, 0], regions: 'all' } }
  wf['14'] = { class_type: 'MaskToImage', inputs: { mask: ['13', 0] } }
  wf['15'] = { class_type: 'ImageBlur', inputs: { image: ['14', 0], blur_radius: 15, sigma: 2.5 } }
  wf['16'] = { class_type: 'ImageToMask', inputs: { image: ['15', 0], channel: 'red' } }
  return ['16', 0]
}

// First step of the local pipeline: sharpen the face of the source picture
// before the 3D generator ever sees it. Saves under outputName; the caller
// downloads the PNG and re-uploads it for the mesh workflow.
export function buildFaceEnhanceWorkflow({
  imageName,
  outputName = 'facefix',
  models,
  faceModelName = '',
  denoise,
  steps = 20,
  cfg = 2.5,
  seed = -1,
}) {
  const wf = buildEditWorkflow({
    prompt: FACE_ENHANCE_PROMPT,
    negativePrompt: FACE_ENHANCE_NEG,
    imageName,
    seed,
    steps,
    cfg,
    denoise: denoise ?? (faceModelName ? 0.55 : 0.4),
    models,
  })
  wf['60'].inputs.filename_prefix = outputName
  if (faceModelName) {
    wf['41'] = { class_type: 'LoadMediaPipeFaceLandmarker', inputs: { model_name: faceModelName } }
    wf['42'] = {
      class_type: 'MediaPipeFaceLandmarker',
      inputs: {
        face_detection_model: ['41', 0],
        image: ['78', 0],
        detector_variant: 'both',
        num_faces: 1,
        min_confidence: 0.3,
        missing_frame_fallback: 'empty',
      },
    }
    const mask = addFaceMask(wf, { landmarksNode: '42' })
    wf['61'] = {
      class_type: 'ImageCompositeMasked',
      inputs: {
        destination: ['78', 0],
        source: ['8', 0],
        x: 0,
        y: 0,
        resize_source: false,
        mask,
      },
    }
    wf['60'].inputs.images = ['61', 0]
  }
  return wf
}

// ---------------------------------------------------------------------------
// 3D workflows (optional feature, enabled in Settings → 3D Generation)
// ---------------------------------------------------------------------------

function randomHex(len) {
  let s = ''
  for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 16).toString(16)
  return s
}

// Local pipeline, step 1: image → textured GLB using ComfyUI's NATIVE
// Pixal3D / TRELLIS.2 nodes (built into ComfyUI ≥ 0.39 — no custom pack).
// Converted from the official 3d_pixal3d_trellis2_image_to_model template:
// bg-removal → crop → dual conditioning (switched by mode) → structure →
// shape → upsample → texture → remesh/decimate/unwrap → PBR bake → GLB.
export function buildMeshWorkflow({
  imageName,
  mode = 'pixal3d', // 'pixal3d' | 'trellis2'
  seed = Math.floor(Math.random() * 2 ** 32),
  steps = 20,
  guidance = 7.5,
  cameraRes = 1024,
  textureSize = 4096,
  decimation = 300000,
  remesh = true,
  enhance = 'none', // 'none' | 'sharpen' | 'esrgan' | 'magnific4x'
  enhanceModel = '', // upscale_models/*.pth name when enhance === 'esrgan'
  filenameBase = 'mesh',
}) {
  const wf = {

    '3': {
      "class_type": "KSampler",
      "inputs": {
        "model": [
          "108",
          0
        ],
        "seed": 56,
        "steps": 12,
        "cfg": 7.5,
        "sampler_name": "euler",
        "scheduler": "normal",
        "positive": [
          "314",
          0
        ],
        "negative": [
          "315",
          0
        ],
        "latent_image": [
          "87",
          0
        ],
        "denoise": 1
      }
    },
    '12': {
      "class_type": "KSampler",
      "inputs": {
        "model": [
          "318",
          0
        ],
        "seed": 43,
        "steps": 12,
        "cfg": 1,
        "sampler_name": "euler",
        "scheduler": "normal",
        "positive": [
          "98",
          0
        ],
        "negative": [
          "98",
          1
        ],
        "latent_image": [
          "98",
          2
        ],
        "denoise": 1
      }
    },
    '15': {
      "class_type": "CLIPVisionLoader",
      "inputs": {
        "clip_name": "dino_v3_L_naf_fp32.safetensors"
      }
    },
    '18': {
      "class_type": "KSampler",
      "inputs": {
        "model": [
          "126",
          0
        ],
        "seed": 42,
        "steps": 20,
        "cfg": 7.5,
        "sampler_name": "euler",
        "scheduler": "normal",
        "positive": [
          "91",
          0
        ],
        "negative": [
          "91",
          1
        ],
        "latent_image": [
          "91",
          2
        ],
        "denoise": 1
      }
    },
    '23': {
      "class_type": "KSampler",
      "inputs": {
        "model": [
          "126",
          0
        ],
        "seed": 42,
        "steps": 12,
        "cfg": 7.5,
        "sampler_name": "euler",
        "scheduler": "simple",
        "positive": [
          "94",
          0
        ],
        "negative": [
          "94",
          1
        ],
        "latent_image": [
          "94",
          2
        ],
        "denoise": 1
      }
    },
    '40': {
      "class_type": "UNETLoader",
      "inputs": {
        "unet_name": "trellis_2_int8_convrot.safetensors",
        "weight_dtype": "default"
      }
    },
    '87': {
      "class_type": "EmptyTrellis2LatentStructure",
      "inputs": {
        "batch_size": 1
      }
    },
    '91': {
      "class_type": "Trellis2ShapeStage",
      "inputs": {
        "positive": [
          "314",
          0
        ],
        "negative": [
          "315",
          0
        ],
        "voxel": [
          "119",
          0
        ]
      }
    },
    '92': {
      "class_type": "VaeDecodeShapeTrellis",
      "inputs": {
        "samples": [
          "23",
          0
        ],
        "vae": [
          "117",
          0
        ]
      }
    },
    '93': {
      "class_type": "VaeDecodeTextureTrellis",
      "inputs": {
        "samples": [
          "12",
          0
        ],
        "vae": [
          "118",
          0
        ],
        "shape_subdivides": [
          "92",
          1
        ]
      }
    },
    '94': {
      "class_type": "Trellis2UpsampleStage",
      "inputs": {
        "positive": [
          "91",
          0
        ],
        "negative": [
          "91",
          1
        ],
        "shape_latent": [
          "18",
          0
        ],
        "vae": [
          "117",
          0
        ],
        "target_resolution": 1536
      }
    },
    '98': {
      "class_type": "Trellis2TextureStage",
      "inputs": {
        "positive": [
          "94",
          0
        ],
        "negative": [
          "94",
          1
        ],
        "shape_latent": [
          "23",
          0
        ]
      }
    },
    // MoGe FOV branch (official workflow 920c795f693a): depth-estimate the
    // cropped input and derive the true horizontal FOV for Pixal3D
    // conditioning — a fixed 49.13° placeholder distorts geometry on most
    // photos. Runs only in pixal3d mode (TRELLIS.2's conditioning has no
    // camera input, so 298 never executes and these stay lazy).
    '55': {
      "class_type": "LoadMoGeModel",
      "inputs": {
        "model_name": "moge_2_vitl_normal_fp16.safetensors"
      }
    },
    '56': {
      "class_type": "MoGeInference",
      "inputs": {
        "moge_model": [
          "55",
          0
        ],
        "image": [
          "312",
          0
        ],
        "resolution_level": 9,
        "fov_x_degrees": 0,
        "batch_size": 4,
        "force_projection": true,
        "apply_mask": true,
        "refine_steps": 3
      }
    },
    '242': {
      "class_type": "MoGeGeometryToFOV",
      "inputs": {
        "moge_geometry": [
          "56",
          0
        ],
        "axis": "horizontal",
        "unit": "degrees"
      }
    },
    '108': {
      "class_type": "ModelSamplingSD3",
      "inputs": {
        "model": [
          "125",
          0
        ],
        "shift": 5
      }
    },
    '117': {
      "class_type": "VAELoader",
      "inputs": {
        "vae_name": "trellis_2_shape_vae_bf16.safetensors"
      }
    },
    '118': {
      "class_type": "VAELoader",
      "inputs": {
        "vae_name": "trellis_2_texture_vae_bf16.safetensors"
      }
    },
    '119': {
      "class_type": "VaeDecodeStructureTrellis2",
      "inputs": {
        "samples": [
          "3",
          0
        ],
        "vae": [
          "117",
          0
        ],
        "resolution": "32"
      }
    },
    '122': {
      "class_type": "LoadImage",
      "inputs": {
        "image": "cave_wall.png"
      }
    },
    '125': {
      "class_type": "RescaleCFG",
      "inputs": {
        "model": [
          "199",
          0
        ],
        "multiplier": 0.7
      }
    },
    '126': {
      "class_type": "RescaleCFG",
      "inputs": {
        "model": [
          "279",
          0
        ],
        "multiplier": 0.5
      }
    },
    '147': {
      "class_type": "BakeTextureFromVoxel",
      "inputs": {
        "mesh": [
          "196",
          0
        ],
        "voxel_colors": [
          "93",
          0
        ],
        "texture_size": [
          "288",
          0
        ],
        "reference_mesh": [
          "92",
          0
        ]
      }
    },
    '186': {
      "class_type": "DecimateMesh",
      "inputs": {
        "mesh": [
          "241",
          0
        ],
        "target_face_count": 700000,
        "placement_mode": "midpoint"
      }
    },
    '192': {
      "class_type": "RemoveBackground",
      "inputs": {
        "bg_removal_model": [
          "193",
          0
        ],
        "image": [
          "122",
          0
        ]
      }
    },
    '193': {
      "class_type": "LoadBackgroundRemovalModel",
      "inputs": {
        "bg_removal_name": "birefnet.safetensors"
      }
    },
    '196': {
      "class_type": "UnwrapMesh",
      "inputs": {
        "mesh": [
          "238",
          0
        ],
        "segmenter": "pec",
        "resolution": [
          "288",
          0
        ],
        "padding": 1,
        "weld_distance": 0.0002
      }
    },
    '199': {
      "class_type": "CFGOverride",
      "inputs": {
        "model": [
          "318",
          0
        ],
        "cfg": 1,
        "start_percent": 0.667,
        "end_percent": 1
      }
    },
    '202': {
      "class_type": "GetMeshInfo",
      "inputs": {
        "mesh": [
          "92",
          0
        ]
      }
    },
    '210': {
      "class_type": "ApplyTextureToMesh",
      "inputs": {
        "mesh": [
          "196",
          0
        ],
        "base_color": [
          "147",
          0
        ],
        "metallic": [
          "147",
          1
        ],
        "roughness": [
          "147",
          2
        ],
        "occlusion": [
          "233",
          0
        ],
        "normal_map": [
          "224",
          0
        ]
      }
    },
    '224': {
      "class_type": "BakeNormalMapFromMesh",
      "inputs": {
        "low_poly": [
          "196",
          0
        ],
        "high_poly": [
          "241",
          0
        ],
        "resolution": 2048,
        "cage_distance": 0.05,
        "ignore_backfaces": true
      }
    },
    '233': {
      "class_type": "BakeAmbientOcclusion",
      "inputs": {
        "low_poly": [
          "196",
          0
        ],
        "high_poly": [
          "241",
          0
        ],
        "resolution": 1024,
        "samples": 64,
        "max_distance": 0.71,
        "strength": 1,
        "bias": 0.01
      }
    },
    '238': {
      "class_type": "MeshSmoothNormals",
      "inputs": {
        "mesh": [
          "186",
          0
        ],
        "crease_angle": 180
      }
    },
    '241': {
      "class_type": "RemeshMesh",
      "inputs": {
        "mesh": [
          "202",
          0
        ],
        "resolution": 768,
        "sign_mode": "udf",
        "sign_mode.qef": false,
        "sign_mode.drop_inverted_components": false,
        "sign_mode.drop_enclosed_components": false,
        "band": 1,
        "project_back": 0,
        "fix_poles": false,
        "smooth_iters": 20,
        "drop_small_components": 0.01,
        "precluster_max_verts": 20000000
      }
    },
    '248': {
      "class_type": "ComfySwitchNode",
      "inputs": {
        "switch": true,
        "on_false": [
          "122",
          1
        ],
        "on_true": [
          "192",
          0
        ]
      }
    },
    '260': {
      "class_type": "MeshSmoothNormals",
      "inputs": {
        "mesh": [
          "210",
          0
        ],
        "crease_angle": 180
      }
    },
    '279': {
      "class_type": "CFGOverride",
      "inputs": {
        "model": [
          "318",
          0
        ],
        "cfg": 1,
        "start_percent": 0.769,
        "end_percent": 1
      }
    },
    '285': {
      "class_type": "MeshToFile3D",
      "inputs": {
        "mesh": [
          "260",
          0
        ]
      }
    },
    '288': {
      "class_type": "PrimitiveInt",
      "inputs": {
        "value": 4096
      }
    },
    '298': {
      "class_type": "Pixal3DConditioning",
      "inputs": {
        "clip_vision_model": [
          "15",
          0
        ],
        "image": [
          "312",
          0
        ],
        "camera_angle_x": [
          "242",
          0
        ]
      }
    },
    '299': {
      "class_type": "Trellis2Conditioning",
      "inputs": {
        "clip_vision_model": [
          "15",
          0
        ],
        "image": [
          "312",
          0
        ]
      }
    },
    '312': {
      "class_type": "ImageCropToMask",
      "inputs": {
        "images": [
          "122",
          0
        ],
        "masks": [
          "248",
          0
        ],
        "width": 1024,
        "height": 1024,
        "pad_factor": 1.1,
        "grow_mask": 0,
        "background": "#000000"
      }
    },
    '314': {
      "class_type": "ComfySwitchNode",
      "inputs": {
        "switch": [
          "316",
          0
        ],
        "on_false": [
          "298",
          0
        ],
        "on_true": [
          "299",
          0
        ]
      }
    },
    '315': {
      "class_type": "ComfySwitchNode",
      "inputs": {
        "switch": [
          "316",
          0
        ],
        "on_false": [
          "298",
          1
        ],
        "on_true": [
          "299",
          1
        ]
      }
    },
    '316': {
      "class_type": "PrimitiveBoolean",
      "inputs": {
        "value": false
      }
    },
    '318': {
      "class_type": "ComfySwitchNode",
      "inputs": {
        "switch": [
          "316",
          0
        ],
        "on_false": [
          "319",
          0
        ],
        "on_true": [
          "40",
          0
        ]
      }
    },
    '319': {
      "class_type": "UNETLoader",
      "inputs": {
        "unet_name": "pixal3d_int8_convrot.safetensors",
        "weight_dtype": "default"
      }
    },
    '322': {
      "class_type": "Save3DAdvanced",
      "inputs": {
        "model_3d": [
          "285",
          0
        ],
        "filename_prefix": "3d/ComfyUI",
        "viewport_state": "",
        "width": 1024,
        "height": 1024
      }
    },
  }

  // --- parameter injection -------------------------------------------------
  wf['122'].inputs.image = imageName
  // mode: false = pixal3D conditioning+UNET, true = TRELLIS.2 (lazy switches)
  wf['316'].inputs.value = mode === 'trellis2'
  // randomize every sampler (template ships fixed demo seeds)
  wf['3'].inputs.seed = seed
  wf['18'].inputs.seed = seed + 1
  wf['23'].inputs.seed = seed + 2
  wf['12'].inputs.seed = seed + 3
  // shape sampler follows the steps/guidance knobs; structure (12 @ 7.5),
  // upsample (12 @ 7.5) and texture (12 @ cfg 1) keep the official
  // template's tuned values — over-guiding the texture sampler (cfg > 1)
  // wrecks the baked colors.
  wf['18'].inputs.steps = steps
  wf['18'].inputs.cfg = guidance
  wf['23'].inputs.cfg = guidance
  wf['12'].inputs.cfg = 1
  const crop = Math.min(4096, Math.max(64, Math.round(cameraRes / 8) * 8))
  wf['312'].inputs.width = crop
  wf['312'].inputs.height = crop
  wf['288'].inputs.value = textureSize
  wf['186'].inputs.target_face_count = decimation
  wf['322'].inputs.filename_prefix = `3d/${filenameBase}`

  // voxel remesh off: bypass RemeshMesh, everything downstream reads the
  // raw dense mesh (GetMeshInfo is a pass-through)
  if (!remesh) {
    delete wf['241']
    wf['186'].inputs.mesh = ['202', 0]
    wf['224'].inputs.high_poly = ['202', 0]
    wf['233'].inputs.high_poly = ['202', 0]
  }

  // optional source pre-enhance — both the conditioning and the texture bake
  // sample this image, so a sharper input directly sharpens the face.
  if (enhance === 'sharpen') {
    wf['5'] = {
      class_type: 'ImageSharpen',
      inputs: { image: ['122', 0], sharpen_radius: 1, sigma: 1.0, alpha: 1.0 },
    }
    wf['192'].inputs.image = ['5', 0]
    wf['312'].inputs.images = ['5', 0]
  } else if (enhance === 'esrgan' && enhanceModel) {
    wf['5'] = { class_type: 'UpscaleModelLoader', inputs: { model_name: enhanceModel } }
    wf['6'] = {
      class_type: 'ImageUpscaleWithModel',
      inputs: { upscale_model: ['5', 0], image: ['122', 0] },
    }
    wf['192'].inputs.image = ['6', 0]
    wf['312'].inputs.images = ['6', 0]
  } else if (enhance === 'magnific4x') {
    wf['7'] = {
      class_type: 'MagnificImageUpscalerPreciseV2Node',
      inputs: {
        image: ['122', 0],
        scale_factor: '4x',
        flavor: 'photo',
        sharpen: 20,
        smart_grain: 7,
        ultra_detail: 50,
        auto_downscale: true,
      },
    }
    wf['192'].inputs.image = ['7', 0]
    wf['312'].inputs.images = ['7', 0]
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
  return wf
}

// Face pass inside the paint run: after the 6 views are generated (node 4)
// and before they are baked (node 5), run a Qwen-Image face refine on the
// FRONT view only (camera azimuth list starts at 0), then rebuild the albedo
// batch so the bake sees the fixed view in slot 0. mr and pipeline are
// untouched. With a MediaPipe model the edit is confined to a blurred face
// mask; without one it's a low-denoise global refine of the front view
// (the front view dominates the bake at view weight 1.0).
function applyPaintFaceFix(wf, { faceModelName = '', editModels, denoise = 0.35 }) {
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
      steps: 14,
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

// MiniMax Music3 has NO text negative prompt — the text encoder only takes
// caption + lyrics. (The graph's negative is a zeroed conditioning sampled
// at the official cfg 1.7: guidance amplification, not a text negative.) Users coming from other tools paste "Negative Prompt: ..." blocks
// into the caption; the model would read that list as POSITIVE description
// (literally conditioning on "vocals, singing, ..." — the opposite of the
// intent). Split that section out and re-phrase it as an in-caption ban,
// which is the phrasing that works for this model.
export function splitNegativeSection(text) {
  const s = (text || '').trim()
  const m = s.match(/(?:^|\n|[.!?][ \t]+)(?:negative\s*prompt|avoid)\s*:[ \t]*([\s\S]+)$/i)
  if (!m) return { caption: text || '', banned: [] }
  const banned = m[1]
    .split(/[,;\n]+/)
    .map((x) => x.trim().replace(/[.\s]+$/, ''))
    .filter(Boolean)
  return { caption: s.slice(0, m.index).trim(), banned }
}

function bannedClause(items, existing) {
  const hay = (existing || '').toLowerCase()
  const fresh = []
  for (const raw of items || []) {
    const word = raw.replace(/^no\s+/i, '').trim()
    if (!word || hay.includes(word.toLowerCase())) continue
    fresh.push(word)
  }
  if (!fresh.length) return ''
  const words = fresh.map((w) => 'no ' + w)
  const clause = words.join(', ')
  return ' ' + clause.charAt(0).toUpperCase() + clause.slice(1) + '.'
}

// Default section map used when the lyrics box is empty (and shown as the
// box's default text). MiniMax Music3 treats [Tag] lines as executable song
// structure; a section map is what makes the AR planner actually USE the
// requested duration instead of ending after 15-40s.
export const STRUCTURE_TAGS = '[Intro]\n\n[Verse]\n\n[Pre-Chorus]\n\n[Chorus]\n\n[Post-Chorus]\n\n[Bridge]\n\n[Instrumental]\n\n[Solo]\n\n[Outro]'

function stripStructureTags(text) {
  return (text || '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim()
}

// Lyrics semantics: empty → inject the default section map; tag-only input
// counts as INSTRUMENTAL (the vocal ban still applies — tags describe
// structure, not vocals); real words → sung lyrics, caption left alone.
export function normalizeLyrics(lyrics, structure = true) {
  const t = (lyrics || '').trim()
  const text = t || (structure ? STRUCTURE_TAGS : '')
  return { text, instrumental: stripStructureTags(text) === '' }
}

export function buildMusicWorkflow({
  caption, // style / instrumentation description (the main prompt)
  negativePrompt = '', // merged into an in-caption "no X, no Y" ban clause
  lyrics = '', // sung lyrics; '' = default section map (instrumental)
  structure = true, // inject STRUCTURE_TAGS when lyrics are empty
  // Cap in seconds for the AR structure planner (node's own default).
  // No UI control anymore — the planner ends the song when it wants to
  // (`<|audio_end|>`); this only bounds how long it may keep planning.
  duration = 120,
  seed = -1,
  steps = 30, // official template default
  cfgScale = 1.7, // MiniMaxMusic3TextEncode.cfg_scale (official template)
  quality = '320k', // 'wav' | '320k' | 'V0' | '128k'
  models,
}) {
  const actualSeed = seed === -1 ? Math.floor(Math.random() * 2 ** 48) : seed

  // Empty lyrics = instrumental. The model still hallucinates vocals from
  // bare prompts, so pin the intent down in the caption itself (skipped
  // when the caller already bans vocals, e.g. buildPartCaption).
  const { text: lyricText, instrumental } = normalizeLyrics(lyrics, structure)
  const { caption: rawCaption, banned: sectionBanned } = splitNegativeSection(caption)
  const trimmedCaption = (rawCaption || '').trim()
  const hasBan = /no vocals|no singing|strictly instrumental/i.test(trimmedCaption)
  const baseCaption = !instrumental
    ? trimmedCaption
    : hasBan || !trimmedCaption
      ? trimmedCaption || `${PART_INSTRUMENTAL_BAN}`
      : `${trimmedCaption.replace(/[.\s]+$/, '')}. ${PART_INSTRUMENTAL_BAN}`
  const negItems = [
    ...sectionBanned,
    ...(negativePrompt || '').split(/[,;\n]+/).map((x) => x.trim().replace(/[.\s]+$/, '')).filter(Boolean),
  ]
  const fullCaption = baseCaption + bannedClause(negItems, baseCaption)

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
        lyrics: lyricText,
        seed: actualSeed,
        max_duration: duration,
        cfg_scale: cfgScale,
        top_k: 50,
      },
    },
    '41': {
      class_type: 'EmptyMiniMaxMusic3LatentAudio',
      inputs: {
        // Linked to the text encoder's `seconds` output: the AR structure
        // planner inside MiniMaxMusic3TextEncode can end the song BEFORE
        // max_duration (`<|audio_end|>`). If the latent is sized to the
        // REQUESTED duration instead of the PLANNED one, the DiT samples
        // tens of seconds with no structure plan behind them — the weird,
        // drifting tail users hear in the last 30-60s of a 2-minute mp3.
        // The encode runs first (it feeds the KSampler anyway), so comfy
        // resolves this as a plain float at execution time.
        seconds: ['40', 1],
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
        // Official ComfyUI template: euler + simple scheduler, cfg 1.7
        // against the zeroed negative (flow-matching model — the old
        // cfg 1.0/normal pairing suppressed CFG entirely).
        cfg: 1.7,
        sampler_name: 'euler',
        scheduler: 'simple',
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
        // Official template value: fewer, longer tiles than the old 512;
        // still far below a full-track decode, which OOMs on 16 GB with
        // the TE + DIT resident.
        tile_size: 1536,
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

// MiniMax H3 (Hailuo) video dit — matches minimax_h3_* / hailuo files.
// Shared with comfyui.js (validation) and useComfyUI.js (audio-VAE pick).
export const H3_VIDEO_RE = /minimax[-_ ]?h\d|hailuo/i
export function isMiniMaxH3(name) {
  return H3_VIDEO_RE.test(String(name || ''))
}

export function buildVideoWorkflow({
  prompt,
  negativePrompt = '',
  resolution = '480p',
  frames = 33,
  fps = 16,
  seed = -1,
  steps = 20, // sampler is the bottleneck on 16GB RAM — 20 (was 30) default
  cfg = 6,
  models,
}) {
  if (isMiniMaxH3(models?.unet)) return buildH3VideoWorkflow({ prompt, resolution, frames, fps, seed, steps, models })
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

// MiniMax H3 native graph (comfy_extras.nodes_minimax_h3). Ground truth:
// official template video_minimax_h3_t2v.json (Comfy-Org/workflow_templates),
// probed live on 0.37 — SaveVideo accepts {format:'auto', codec:'auto'} and
// reports the mp4 under outputs.images with animated:[true].
//   - MiniMaxH3ImageToVideo preps prompt + empty AV latent (no source image)
//   - BasicGuider: the model is guidance-embedded — no CFG, no negative
//   - res_multistep + simple scheduler (official docs: every local H3 workflow)
//   - AV latent decodes to frames + stereo audio, muxed by CreateVideo/SaveVideo
function buildH3VideoWorkflow({ prompt, resolution, frames, fps, seed, steps, models }) {
  if (!models?.vaeAudio) {
    throw new Error(
      'MiniMax H3 video needs the H3 audio VAE (minimax_h3_audio_vae_*.safetensors) — it was not found on the server.'
    )
  }
  const raw = VIDEO_RESOLUTIONS[resolution] || VIDEO_RESOLUTIONS['480p']
  // Sample size (fast paths declare a smaller genWidth/genHeight), snapped
  // to H3's multiple-of-32 requirement (e.g. 720 → 736). The final size is
  // what the saved video comes out as after the optional upscale chain.
  const genWidth = Math.max(32, Math.round((raw.genWidth || raw.width) / 32) * 32)
  const genHeight = Math.max(32, Math.round((raw.genHeight || raw.height) / 32) * 32)
  const finalWidth = Math.max(32, Math.round(raw.width / 32) * 32)
  const finalHeight = Math.max(32, Math.round(raw.height / 32) * 32)
  const upscale = !!(raw.upscale && (genWidth !== finalWidth || genHeight !== finalHeight))
  const actualSeed = seed === -1 ? Math.floor(Math.random() * 2 ** 48) : seed
  // H3 samples at 24fps on a 17k+5 frame grid. The UI speaks frames/fps, so
  // convert the intended duration to 24fps frames and snap UP to the grid
  // (same maths as the template's expression, python-style modulo).
  const f = Math.max(5, Math.round(((frames || 33) / (fps || 16)) * 24))
  const length = f + ((((5 - (f % 17)) % 17) + 17) % 17)
  // Optional turbo LoRA sits between the loader and the sampler.
  const baseSrc = models.lora ? '52' : '37'

  const wf = {
    '37': { class_type: 'UNETLoader', inputs: { unet_name: models.unet, weight_dtype: 'default' } },
    '38': { class_type: 'CLIPLoader', inputs: { clip_name: models.clip, type: 'minimax', device: 'default' } },
    '39': { class_type: 'VAELoader', inputs: { vae_name: models.vae } },
    '391': { class_type: 'VAELoader', inputs: { vae_name: models.vaeAudio } },
    '40': {
      class_type: 'MiniMaxH3ImageToVideo',
      inputs: { clip: ['38', 0], vae: ['39', 0], prompt, width: genWidth, height: genHeight, length },
    },
    '41': { class_type: 'RandomNoise', inputs: { noise_seed: actualSeed } },
    '42': { class_type: 'KSamplerSelect', inputs: { sampler_name: 'res_multistep' } },
    // Comfy Kitchen INT8 attention: measured 201s vs 316-341s pytorch on the
    // 5060 Ti (1.6-1.7×, same seed/output quality in A/B tests).
    '53': { class_type: 'ModelAttentionBackend', inputs: { model: [baseSrc, 0], attention: 'comfy kitchen attention' } },
    '43': { class_type: 'BasicScheduler', inputs: { model: ['53', 0], scheduler: 'simple', steps, denoise: 1 } },
    '44': { class_type: 'BasicGuider', inputs: { model: ['53', 0], conditioning: ['40', 0] } },
    '45': {
      class_type: 'SamplerCustomAdvanced',
      inputs: { noise: ['41', 0], guider: ['44', 0], sampler: ['42', 0], sigmas: ['43', 0], latent_image: ['40', 1] },
    },
    '46': { class_type: 'VAEDecode', inputs: { samples: ['45', 0], vae: ['39', 0] } },
    '47': { class_type: 'VAEDecodeAudio', inputs: { samples: ['45', 0], vae: ['391', 0] } },
    // H3 is a 24fps model — never the UI's fps (would change playback speed).
    '48': { class_type: 'CreateVideo', inputs: { images: [upscale ? '51' : '46', 0], audio: ['47', 0], fps: 24 } },
    '28': {
      class_type: 'SaveVideo',
      inputs: { video: ['48', 0], filename_prefix: 'video/ComfyUI', format: 'auto', codec: 'auto' },
    },
  }
  if (models.lora) {
    wf['52'] = {
      class_type: 'LoraLoaderModelOnly',
      inputs: { model: ['37', 0], lora_name: models.lora, strength_model: models.loraStrength ?? 1 },
    }
  }
  if (upscale) {
    // ESRGAN 4× on the decoded frames, then lanczos down to the exact final
    // size (960×544 → 3840×2176 → 1920×1088). Tiled internally by the node,
    // so it stays inside 16GB VRAM.
    wf['49'] = { class_type: 'UpscaleModelLoader', inputs: { model_name: raw.upscale } }
    wf['50'] = { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['49', 0], image: ['46', 0] } }
    wf['51'] = {
      class_type: 'ImageScale',
      inputs: { image: ['50', 0], upscale_method: 'lanczos', width: finalWidth, height: finalHeight, crop: 'disabled' },
    }
  }
  return wf
}
