import { MESH_GRAPH_A } from './mesh-graph-a.js'
import { MESH_GRAPH_B } from './mesh-graph-b.js'

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
  const wf = { ...MESH_GRAPH_A, ...MESH_GRAPH_B }

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
