// 3D generation orchestration: image → mesh → rig → animation.
//
// Two pipelines:
//   local — native Pixal3D/TRELLIS.2 image→GLB (ComfyUI ≥ 0.39) then MIA
//           auto-rig (+ optional Mixamo FBX), all on the user's own box
//   tripo — Tripo cloud API through ComfyUI built-ins: image → model → rig →
//           retarget a preset animation (walk/run/jump/…) in one chain
//
// All functions take the resolved API base (proxy or direct) and report
// human-readable progress through onStatus.

import {
  queuePrompt,
  uploadImage,
  uploadMeshFile,
  getNodeComboOptions,
  pollHistory,
  collectOutputFiles,
  getViewUrl,
  assertMeshBytes,
  freeLoadedModels,
  assertWorkflowNodes,
} from './comfyui.js'
import {
  buildMeshWorkflow,
  buildMiaRigWorkflow,
  buildTripoWorkflow,
  buildUltraShapeWorkflow,
  buildPaintWorkflow,
  buildFaceEnhanceWorkflow,
} from './workflows.js'
import { hybridSkinBlend } from './hybridSkin.js'

// High-quality runs take a while: shape→upsample→texture plus remesh,
// unwrap and PBR baking can legitimately run 15–30 min on a mid GPU.
const TIMEOUTS = {
  mesh: 30 * 60 * 1000,
  mia: 20 * 60 * 1000,
  tripo: 15 * 60 * 1000,
  ultrashape: 45 * 60 * 1000,
  paint: 25 * 60 * 1000,
  enhance: 12 * 60 * 1000,
}

// Friendly names for the nodes we queue, so the status line can say
// "auto-rigging skeleton · 4m12s" instead of just "working…".
const CLASS_LABELS = {
  LoadImage: 'reading image',
  LoadBackgroundRemovalModel: 'loading background-removal model',
  RemoveBackground: 'removing background',
  ImageCropToMask: 'cropping to subject',
  CLIPVisionLoader: 'loading DINO vision encoder',
  UNETLoader: 'loading 3D model',
  VAELoader: 'loading 3D VAE',
  Pixal3DConditioning: 'encoding image (Pixal3D)',
  Trellis2Conditioning: 'encoding image (TRELLIS.2)',
  EmptyTrellis2LatentStructure: 'initializing structure',
  ComfySwitchNode: 'routing',
  PrimitiveBoolean: 'setting engine',
  PrimitiveInt: 'setting resolution',
  CFGOverride: 'tuning guidance',
  RescaleCFG: 'tuning guidance',
  ModelSamplingSD3: 'tuning sampling',
  KSampler: 'diffusing',
  VaeDecodeStructureTrellis2: 'extracting voxel grid',
  Trellis2ShapeStage: 'preparing shape stage',
  VaeDecodeShapeTrellis: 'building mesh',
  Trellis2UpsampleStage: 'preparing upsample stage',
  Trellis2TextureStage: 'preparing texture stage',
  VaeDecodeTextureTrellis: 'extracting voxel colors',
  GetMeshInfo: 'inspecting mesh',
  RemeshMesh: 'remeshing topology',
  DecimateMesh: 'slimming mesh',
  UnwrapMesh: 'unwrapping UVs',
  BakeTextureFromVoxel: 'baking textures',
  BakeNormalMapFromMesh: 'baking normal map',
  BakeAmbientOcclusion: 'baking ambient occlusion',
  ApplyTextureToMesh: 'applying PBR textures',
  MeshSmoothNormals: 'smoothing normals',
  MeshToFile3D: 'converting mesh',
  Save3DAdvanced: 'writing GLB',
  MIALoadModel: 'loading MIA model',
  UniRigLoadMesh: 'loading mesh',
  MIAAutoRig: 'auto-rigging skeleton',
  UniRigPreviewRiggedMesh: 'writing rigged FBX',
  UniRigApplyAnimation: 'applying animation',
  TripoImageToModelNode: 'Tripo: generating model (cloud)',
  TripoRigNode: 'Tripo: rigging (cloud)',
  TripoRetargetNode: 'Tripo: retargeting animation (cloud)',
  UpscaleModelLoader: 'loading ESRGAN model',
  ImageUpscaleWithModel: 'upscaling 4x',
  SaveImage: 'saving image',
  UltraShapeLoadModel: 'loading UltraShape model',
  UltraShapeLoadCoarseMesh: 'loading coarse mesh',
  UltraShapeRefine: 'refining mesh (UltraShape 1.0)',
  UltraShapeConvertToGLB: 'converting to GLB',
  SaveGLB: 'writing GLB',
  Preview3D: 'previewing mesh',
  MeshToolsLoad: 'loading mesh',
  MeshToolsPostprocess: 'slimming mesh',
  MeshToolsDecimate: 'slimming mesh',
  UltraShapeLoadCoarseMeshFromTrimesh: 'seeding mesh',
  MeshToFile3D: 'converting mesh',
  Hy3D21CameraConfig: 'setting up paint cameras',
  Hy3DMultiViewsGenerator: 'diffusing multiview textures',
  Hy3DBakeMultiViews: 'baking views onto UVs',
  Hy3DInPaint: 'inpainting & exporting GLB',
  // Face-fix chain (threeD.faceFix)
  LoadMediaPipeFaceLandmarker: 'loading face detector',
  MediaPipeFaceLandmarker: 'finding the face',
  MediaPipeFaceMask: 'masking the face',
  MaskToImage: 'softening face mask',
  ImageBlur: 'softening face mask',
  ImageToMask: 'softening face mask',
  TextEncodeQwenImageEdit: 'face detail pass',
  ModelSamplingAuraFlow: 'face detail pass',
  CFGNorm: 'face detail pass',
  VAEEncode: 'face detail pass',
  VAEDecode: 'face detail pass',
  ImageFromBatch: 'isolating the front view',
  ImageBatch: 'merging the refined view',
  ImageCompositeMasked: 'blending the face back in',
}

export function nodeLabels(workflow) {
  return Object.fromEntries(
    Object.entries(workflow).map(([id, n]) => [id, CLASS_LABELS[n.class_type] || n.class_type])
  )
}

// ---------------------------------------------------------------------------
// Node-pack verification: "if they don't have the nodes (or whatever), it must
// error out" — both when the 3D tab is enabled in Settings and before each
// pipeline step queues anything.
// ---------------------------------------------------------------------------

// Which pack installs each node, for readable error messages.
const NODE_PACKS = {
  // Native 3D stack — ships with ComfyUI ≥ 0.39 (comfy_extras.nodes_trellis2
  // and friends), no custom pack needed. Missing = ComfyUI too old.
  UNETLoader: 'built-in (ComfyUI ≥ 0.39)',
  CLIPVisionLoader: 'built-in (ComfyUI ≥ 0.39)',
  VAELoader: 'built-in (ComfyUI ≥ 0.39)',
  RemoveBackground: 'built-in (ComfyUI ≥ 0.39)',
  LoadBackgroundRemovalModel: 'built-in (ComfyUI ≥ 0.39)',
  ImageCropToMask: 'built-in (ComfyUI ≥ 0.39)',
  Pixal3DConditioning: 'built-in (ComfyUI ≥ 0.39)',
  Trellis2Conditioning: 'built-in (ComfyUI ≥ 0.39)',
  EmptyTrellis2LatentStructure: 'built-in (ComfyUI ≥ 0.39)',
  Trellis2ShapeStage: 'built-in (ComfyUI ≥ 0.39)',
  Trellis2TextureStage: 'built-in (ComfyUI ≥ 0.39)',
  Trellis2UpsampleStage: 'built-in (ComfyUI ≥ 0.39)',
  VaeDecodeStructureTrellis2: 'built-in (ComfyUI ≥ 0.39)',
  VaeDecodeShapeTrellis: 'built-in (ComfyUI ≥ 0.39)',
  VaeDecodeTextureTrellis: 'built-in (ComfyUI ≥ 0.39)',
  GetMeshInfo: 'built-in mesh nodes (ComfyUI ≥ 0.39)',
  RemeshMesh: 'built-in mesh nodes (ComfyUI ≥ 0.39)',
  DecimateMesh: 'built-in mesh nodes (ComfyUI ≥ 0.39)',
  UnwrapMesh: 'built-in mesh nodes (ComfyUI ≥ 0.39)',
  BakeTextureFromVoxel: 'built-in mesh nodes (ComfyUI ≥ 0.39)',
  BakeNormalMapFromMesh: 'built-in mesh nodes (ComfyUI ≥ 0.39)',
  BakeAmbientOcclusion: 'built-in mesh nodes (ComfyUI ≥ 0.39)',
  ApplyTextureToMesh: 'built-in mesh nodes (ComfyUI ≥ 0.39)',
  MeshSmoothNormals: 'built-in mesh nodes (ComfyUI ≥ 0.39)',
  MeshToFile3D: 'built-in 3D I/O (ComfyUI ≥ 0.39)',
  Save3DAdvanced: 'built-in 3D I/O (ComfyUI ≥ 0.39)',
  SaveGLB: 'built-in 3D I/O (ComfyUI ≥ 0.39)',
  MIALoadModel: 'MIA rigging pack',
  MIAAutoRig: 'MIA rigging pack',
  UniRigLoadMesh: 'ComfyUI-UniRig',
  UniRigPreviewRiggedMesh: 'ComfyUI-UniRig',
  UniRigApplyAnimation: 'ComfyUI-UniRig',
  TripoImageToModelNode: 'Tripo nodes (needs ComfyUI signed in to comfy.org)',
  TripoRigNode: 'Tripo nodes (needs ComfyUI signed in to comfy.org)',
  TripoRetargetNode: 'Tripo nodes (needs ComfyUI signed in to comfy.org)',
  UltraShapeLoadModel: 'ComfyUI-UltraShape1',
  UltraShapeLoadCoarseMesh: 'ComfyUI-UltraShape1',
  UltraShapeLoadCoarseMeshFromTrimesh: 'ComfyUI-UltraShape1',
  UltraShapeRefine: 'ComfyUI-UltraShape1',
  UltraShapeConvertToGLB: 'ComfyUI-UltraShape1',
  MeshToolsLoad: 'ComfyUI-MeshTools',
  MeshToolsPostprocess: 'ComfyUI-MeshTools',
  Get3DComponents: 'mesh tooling nodes',
  MeshTextureToImage: 'mesh tooling nodes',
  BakeNormalMapFromMesh: 'mesh tooling nodes',
  BakeAmbientOcclusion: 'mesh tooling nodes',
  ApplyTextureToMesh: 'mesh tooling nodes',
  MeshToFile3D: 'mesh tooling nodes',
  Hy3D21CameraConfig: 'ComfyUI-Hunyuan3D-Paint',
  Hy3DMultiViewsGenerator: 'ComfyUI-Hunyuan3D-Paint',
  Hy3DBakeMultiViews: 'ComfyUI-Hunyuan3D-Paint',
  Hy3DInPaint: 'ComfyUI-Hunyuan3D-Paint',
  MagnificImageUpscalerPreciseV2Node: 'Magnific upscaler nodes (paid, comfy.org)',
  // Face-fix chain (threeD.faceFix) — all built into ComfyUI ≥ 0.39
  LoadMediaPipeFaceLandmarker: 'built-in (ComfyUI ≥ 0.39)',
  MediaPipeFaceLandmarker: 'built-in (ComfyUI ≥ 0.39)',
  MediaPipeFaceMask: 'built-in (ComfyUI ≥ 0.39)',
  MaskToImage: 'built-in (ComfyUI ≥ 0.39)',
  ImageBlur: 'built-in (ComfyUI ≥ 0.39)',
  ImageToMask: 'built-in (ComfyUI ≥ 0.39)',
  ImageFromBatch: 'built-in (ComfyUI ≥ 0.39)',
  ImageBatch: 'built-in (ComfyUI ≥ 0.39)',
  ImageCompositeMasked: 'built-in (ComfyUI ≥ 0.39)',
  TextEncodeQwenImageEdit: 'built-in (ComfyUI ≥ 0.39)',
  ModelSamplingAuraFlow: 'built-in (ComfyUI ≥ 0.39)',
  CFGNorm: 'built-in (ComfyUI ≥ 0.39)',
}

export function describeNode(cls) {
  const pack = NODE_PACKS[cls]
  return pack ? `${cls} (${pack})` : cls
}

// Baseline node sets per pipeline — Settings checks these when the 3D tab
// is switched on; individual runs additionally verify the exact workflow.
export const PIPELINE_NODES = {
  local: [
    // native image → GLB chain (both engines share the node set; the mode
    // only flips which conditioning + UNET the lazy switches pull in)
    'RemoveBackground',
    'ImageCropToMask',
    'Pixal3DConditioning',
    'Trellis2Conditioning',
    'Trellis2ShapeStage',
    'Trellis2UpsampleStage',
    'Trellis2TextureStage',
    'VaeDecodeStructureTrellis2',
    'VaeDecodeShapeTrellis',
    'VaeDecodeTextureTrellis',
    'RemeshMesh',
    'DecimateMesh',
    'UnwrapMesh',
    'BakeTextureFromVoxel',
    'BakeNormalMapFromMesh',
    'BakeAmbientOcclusion',
    'ApplyTextureToMesh',
    'MeshToFile3D',
    'Save3DAdvanced',
    'LoadMoGeModel',
    'MoGeInference',
    'MoGeGeometryToFOV',
    // rig tail
    'MIALoadModel',
    'MIAAutoRig',
    'UniRigLoadMesh',
    'UniRigPreviewRiggedMesh',
  ],
  tripo: ['TripoImageToModelNode', 'TripoRigNode', 'TripoRetargetNode'],
}

export function requiredThreeDNodes(pipeline) {
  return PIPELINE_NODES[pipeline === 'tripo' ? 'tripo' : 'local']
}

export function formatElapsed(seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m > 0 ? `${m}m${String(s).padStart(2, '0')}s` : `${s}s`
}

// Compose the status line from pollHistory's tick info.
function statusLine(phase, seconds, info, prog) {
  const t = formatElapsed(seconds)
  if (info?.phase === 'queued') return `queued (#${info.queuePos}) · ${t}`
  if (prog && prog.pct != null && prog.stage) return `${prog.stage} — ${prog.pct}% · ${t}`
  if (info?.nodeLabel) {
    const step = info.progress ? ` — step ${info.progress.value}/${info.progress.max}` : ''
    return `${info.nodeLabel}${step} · ${t}`
  }
  if (phase) return `${phase}… ${t}`
  return `working on ComfyUI… ${t}`
}

// Ordered stages of the native image→GLB pipeline (buildMeshWorkflow node
// ids), with rough live-run weights so the UI can show an overall percent
// like image/video jobs do: "adding texture — 42% · 1m12s".
//   nodes   — workflow node ids belonging to the stage
//   sampler — KSampler id whose step progress interpolates inside the stage
const MESH_STAGES = [
  {
    key: 'prep',
    label: 'preparing image',
    weight: 0.03,
    sampler: null,
    nodes: ['122', '193', '192', '248', '15', '117', '118', '40', '319', '108',
      '125', '298', '299', '314', '315', '316', '318', '199', '279', '126',
      '312', '5', '6', '7'],
  },
  { key: 'structure', label: 'generating model', weight: 0.10, sampler: '3', nodes: ['3', '119', '91'] },
  { key: 'shape', label: 'shaping mesh', weight: 0.18, sampler: '18', nodes: ['18'] },
  { key: 'upsample', label: 'refining detail', weight: 0.14, sampler: '23', nodes: ['94', '23'] },
  // ComfyUI walks the graph depth-first from Save3D, so the geometry branch
  // (decode→remesh→decimate→unwrap) executes between the upsample and
  // texture samplers, not after them.
  { key: 'geometry', label: 'building mesh', weight: 0.14, sampler: null, nodes: ['92', '202', '241', '186', '238', '196', '233', '224', '235', '226'] },
  { key: 'texture', label: 'adding texture', weight: 0.18, sampler: '12', nodes: ['98', '12', '93'] },
  { key: 'bake', label: 'baking textures', weight: 0.15, sampler: null, nodes: ['147', '164', '207', '208'] },
  { key: 'save', label: 'writing GLB', weight: 0.08, sampler: null, nodes: ['210', '260', '285', '322'] },
]

// Progress tracker for one runGenerateMesh call. Maps the executing node to
// its stage (monotonic — unknown nodes keep the current stage) and uses the
// active KSampler's step events for within-stage interpolation.
function createMeshProgress() {
  const byNode = {}
  MESH_STAGES.forEach((s, i) => s.nodes.forEach((id) => { byNode[id] = i }))
  const starts = []
  let acc = 0
  for (const s of MESH_STAGES) { starts.push(acc); acc += s.weight }
  let stageIdx = -1
  let pct = 0
  return (info) => {
    if (info?.phase === 'queued') return { pct: 0, stage: null }
    if (info?.node != null && byNode[info.node] !== undefined && byNode[info.node] > stageIdx) {
      stageIdx = byNode[info.node]
    }
    if (stageIdx < 0) return { pct: 0, stage: null }
    const st = MESH_STAGES[stageIdx]
    let p = starts[stageIdx]
    if (st.sampler && info?.node === st.sampler && info.progress && info.progress.max > 1) {
      p += st.weight * (info.progress.value / info.progress.max)
    }
    if (p * 100 > pct) pct = p * 100
    return { pct: Math.min(100, Math.round(pct)), stage: st.label }
  }
}

// Fixed name for the mesh handed to UniRigLoadMesh. Its file dropdown is
// cached at ComfyUI startup, so a fixed name only needs ONE ComfyUI restart
// ever — after that every rig run overwrites the same indexed entry.
export const RIG_INPUT_NAME = 'studio_rig_input.glb'

// Animation options for the local pipeline (UniRigApplyAnimation's
// animation_file dropdown — Mixamo FBX files shipped with the node).
export function listLocalAnimations(base) {
  return getNodeComboOptions(base, 'UniRigApplyAnimation', 'animation_file')
}

// Animation presets for the Tripo pipeline (TripoRetargetNode's animation
// combo — preset:walk, preset:run, preset:jump, …).
export function listTripoPresets(base) {
  return getNodeComboOptions(base, 'TripoRetargetNode', 'animation')
}

export async function fetchOutputBlob(base, file) {
  const url = await getViewUrl(base, file.filename, file.subfolder, file.type)
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) {
    throw new Error(`could not download ${file.filename} from ComfyUI (HTTP ${res.status})`)
  }
  const ct = (res.headers.get('content-type') || '').toLowerCase()
  if (ct.includes('text/html')) {
    throw new Error(
      `downloading ${file.filename} returned an HTML page instead of the file (tried ${url}) — ` +
        `the app proxy may have missed the request; check the ComfyUI Server URL in Settings`
    )
  }
  const blob = await res.blob()
  await assertMeshBytes(blob, file.filename)
  return blob
}

// The MediaPipe face model list comes from ComfyUI/models/detection/, which
// ships empty — returns '' (→ face fix falls back to the whole-image pass)
// until the user drops mediapipe_face_fp32.safetensors in and restarts.
export async function detectFaceModel(base) {
  try {
    const opts = await getNodeComboOptions(base, 'LoadMediaPipeFaceLandmarker', 'model_name')
    return opts && opts.length ? String(opts[0]) : ''
  } catch {
    return ''
  }
}

// Resolve edit-model filenames against what the server actually has: the
// stored defaults name files from other installs (fresh profiles list
// qwen_image_edit_fp8 which this box doesn't carry), so pick a qwen edit
// stack from the live combo lists. Returns null when nothing fits — the
// caller then skips the face pass instead of queueing a doomed prompt.
async function pickModel(base, classType, field, current, prefs) {
  const list = await getNodeComboOptions(base, classType, field)
  if (!list.length) return current || null
  if (current && list.includes(current)) return current
  for (const re of prefs) {
    const hit = list.find((m) => re.test(m))
    if (hit) return hit
  }
  return null
}

async function resolveEditModels(base, editModels = {}) {
  try {
    const unet = await pickModel(base, 'UNETLoader', 'unet_name', editModels.unet, [
      /qwen[-_ ]?image.*edit/i,
      /qwen.*edit/i,
      /qwen_image/i,
      /qwen/i,
    ])
    if (!unet) return null
    const clip = await pickModel(base, 'CLIPLoader', 'clip_name', editModels.clip, [
      /qwen3vl_8b/i,
      /qwen3vl/i,
      /qwen/i,
    ])
    if (!clip) return null
    const vae = await pickModel(base, 'VAELoader', 'vae_name', editModels.vae, [/qwen_image/i, /qwen/i])
    if (!vae) return null
    return { unet, clip, vae }
  } catch {
    return null
  }
}

// Local pipeline, step 1: upload image, run the native Pixal3D/TRELLIS.2
// chain, return the GLB ref.
export async function runGenerateMesh(base, file, cfg, onStatus, editModels = null) {
  if ((cfg.pixalEnhance || 'none') === 'esrgan' && !cfg.pixalUpscaleModel) {
    throw new Error(
      'ESRGAN upscale is selected but no model file is set — pick one in Settings → 3D. ' +
        'If the list is empty, drop a free .pth (e.g. 4x-UltraSharp) into ' +
        'ComfyUI/models/upscale_models/ and restart ComfyUI.'
    )
  }
  onStatus?.('Uploading image…')
  const up = await uploadImage(base, file)

  // Face fix, source side: a face-focused Qwen-Image edit pass on the picture
  // BEFORE the generator sees it — faces are ~1-2% of the texture and start
  // melted if the source is soft. Any failure (no edit models, queue error,
  // no PNG out) falls back to the original picture instead of blocking 3D.
  let meshImageName = up.name
  if (cfg.faceFix !== false && editModels) {
    try {
      const models = await resolveEditModels(base, editModels)
      if (!models) throw new Error('no Qwen edit model on the server')
      const faceModel = await detectFaceModel(base)
      onStatus?.(
        faceModel
          ? 'Face pass · enhancing facial detail in your picture…'
          : 'Face pass · face-focused enhance of your picture…'
      )
      const enhanceWf = buildFaceEnhanceWorkflow({
        imageName: up.name,
        outputName: `facefix_${Date.now().toString(36)}`,
        models,
        faceModelName: faceModel,
      })
      await assertWorkflowNodes(base, enhanceWf, { label: 'Face enhance', describe: describeNode })
      await freeLoadedModels(base)
      const enhanceId = await queuePrompt(base, enhanceWf)
      const enhanceEntry = await pollHistory(base, enhanceId, {
        timeoutMs: TIMEOUTS.enhance,
        label: 'Face enhance',
        nodes: nodeLabels(enhanceWf),
        onTick: (s, info) => onStatus?.(statusLine('face pass', s, info)),
      })
      const png = collectOutputFiles(enhanceEntry).find((f) => /\.png$/i.test(f.filename))
      if (!png) throw new Error('no PNG in the face-pass output')
      const blob = await fetchOutputBlob(base, png)
      const reup = await uploadImage(base, new File([blob], png.filename, { type: 'image/png' }))
      meshImageName = reup.name
      onStatus?.('Face-enhanced picture ready — generating the mesh…')
    } catch (err) {
      meshImageName = up.name
      onStatus?.(`Face pass skipped (${(err && err.message) || err}) — using your original picture…`)
    }
  }

  const wf = buildMeshWorkflow({
    imageName: meshImageName,
    filenameBase: String(meshImageName || 'mesh').replace(/\.[^.]+$/, ''),
    mode: cfg.meshMode === 'trellis2' ? 'trellis2' : 'pixal3d',
    steps: cfg.pixalSteps,
    guidance: cfg.pixalGuidance,
    cameraRes: cfg.pixalCameraRes,
    textureSize: cfg.pixalTextureSize,
    decimation: cfg.pixalDecimation,
    remesh: cfg.pixalRemesh !== false,
    enhance: cfg.pixalEnhance || 'none',
    enhanceModel: cfg.pixalUpscaleModel || '',
  })
  await assertWorkflowNodes(base, wf, { label: '3D mesh generation', describe: describeNode })
  onStatus?.('Unloading previous models…')
  await freeLoadedModels(base)
  onStatus?.('Queued — loading the 3D model on the first run can take a while…')
  const track = createMeshProgress()
  const id = await queuePrompt(base, wf)
  const entry = await pollHistory(base, id, {
    timeoutMs: TIMEOUTS.mesh,
    label: 'Mesh generation',
    nodes: nodeLabels(wf),
    onTick: (s, info) => {
      const prog = track(info)
      onStatus?.(statusLine('generating', s, info, prog), prog.stage ? prog : null)
    },
  })
  const glb = collectOutputFiles(entry).find((f) => /\.glb$/i.test(f.filename))
  if (!glb) {
    throw new Error('Mesh generation finished but no GLB appeared in ComfyUI output — check the ComfyUI console')
  }
  return glb
}

// Local pipeline, step 2: download the generated mesh, then rig it.
// Returns downloadable result files: [{ filename, subfolder, type, key, blob? }]
export async function runRigMesh(base, glbFile, cfg, animationFile, onStatus) {
  onStatus?.('Downloading generated mesh…')
  const blob = await fetchOutputBlob(base, glbFile)
  return runRigFromBlob(base, blob, cfg, animationFile, onStatus)
}

// Rig a .glb the user already has — skips Generate entirely.
export async function runRigImported(base, file, cfg, animationFile, onStatus) {
  onStatus?.(`Validating ${file.name || 'mesh'}…`)
  // Force the GLB magic check even if the picked name lacks the extension.
  await assertMeshBytes(file, /\.glb$/i.test(file.name || '') ? file.name : RIG_INPUT_NAME)
  if (file.size > 64 * 1024 * 1024) {
    throw new Error(`"${file.name}" is ${(file.size / 1048576).toFixed(0)} MB — keep imported meshes under 64 MB`)
  }
  return runRigFromBlob(base, file, cfg, animationFile, onStatus)
}

// Shared tail of both rig paths: upload under the fixed indexed name,
// verify UniRigLoadMesh's dropdown knows it, run MIA (+ optional animation).
async function runRigFromBlob(base, blob, cfg, animationFile, onStatus) {
  onStatus?.('Uploading mesh to ComfyUI input/3d…')
  // Fixed name: the dropdown is cached at startup, so one ComfyUI restart
  // indexes this name forever and every future rig works without restarts.
  const stored = await uploadMeshFile(base, RIG_INPUT_NAME, blob)

  // UniRigLoadMesh's file list is cached at ComfyUI startup. If our fixed
  // name isn't in it yet, fail with instructions instead of queueing a
  // prompt that would die on "Value not in list".
  onStatus?.('Checking ComfyUI mesh index…')
  const opts = await getNodeComboOptions(base, 'UniRigLoadMesh', 'file_path')
  if (opts.length > 0 && !opts.includes(`3d/${stored}`)) {
    throw new Error(
      `One-time setup: ComfyUI only builds its mesh dropdown at startup, so it doesn't know ` +
        `"3d/${stored}" yet (the file is uploaded and ready). Restart ComfyUI once, then Rig again — ` +
        `the fixed name stays indexed forever, no more restarts needed after that.`
    )
  }

  const wf = buildMiaRigWorkflow({
    meshName: stored,
    precision: cfg.miaPrecision,
    animationFile,
  })
  await assertWorkflowNodes(base, wf, { label: 'MIA auto-rig', describe: describeNode })
  onStatus?.('Unloading previous models…')
  await freeLoadedModels(base)
  onStatus?.('Queued — MIA auto-rig takes a few minutes…')
  const id = await queuePrompt(base, wf)
  const entry = await pollHistory(base, id, {
    timeoutMs: TIMEOUTS.mia,
    label: 'MIA rig',
    nodes: nodeLabels(wf),
    onTick: (s, info) => onStatus?.(statusLine(animationFile ? 'rigging + animating' : 'rigging', s, info)),
  })

  const files = collectOutputFiles(entry).filter((f) => /\.(fbx|glb)$/i.test(f.filename))

  // ComfyUI v0.37 doesn't record string outputs in history, and MIA's
  // Preview node writes the FBX to output/ without a file entry — fall
  // back to the names the nodes construct (same as homeclaw does).
  const meshBase = stored.replace(/\.[^.]+$/, '')
  const candidates = animationFile
    ? [`${meshBase}_${animationFile.replace(/\.[^.]+$/, '')}.fbx`]
    : [`mia_${meshBase}_mia.fbx`, `mia_${meshBase}.fbx`, `${meshBase}.fbx`]
  for (const name of candidates) {
    if (!files.some((f) => f.filename === name)) {
      files.push({ filename: name, subfolder: '', type: 'output', key: 'constructed' })
    }
  }

  // Probe candidates (history files are trusted as-is) so the UI only ever
  // lists files that actually download; keep the first blob to avoid
  // re-fetching it when the user clicks Download.
  const verified = []
  for (const f of files) {
    if (f.key !== 'constructed') {
      verified.push(f)
      continue
    }
    try {
      const b = await fetchOutputBlob(base, f)
      verified.push({ ...f, blob: b })
    } catch {
      // constructed name didn't exist — skip it
    }
  }
  const real = verified.filter((f) => f.key !== 'constructed' || f.blob)
  if (real.length === 0) {
    throw new Error(
      'Rig finished but no FBX/GLB was found in ComfyUI output — check the ComfyUI console'
    )
  }
  return real
}

// Does this GLB actually carry a skin? (embedded images + UVs). Used to
// decide whether to run the texture-bake leg of the Upscale workflow —
// UltraShape itself outputs POSITION-only geometry with no materials.
export async function glbHasTextures(blob) {
  try {
    const buf = new Uint8Array(await blob.arrayBuffer())
    if (buf.length < 24) return false
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    if (dv.getUint32(0, true) !== 0x46546c67) return false
    const jsonLen = dv.getUint32(12, true)
    const json = JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + jsonLen)))
    if (!Array.isArray(json.images) || json.images.length === 0) return false
    for (const m of json.meshes || []) {
      for (const p of m.primitives || []) {
        if (p.attributes && p.attributes.TEXCOORD_0 !== undefined) return true
      }
    }
    return false
  } catch {
    return false
  }
}

// Triangle count from a GLB's JSON chunk only (header + JSON, no texture
// decode) so huge files are cheap to triage. Returns 0 when unreadable —
// callers treat that as "unknown, don't intervene".
export async function glbTriCount(blob) {
  try {
    const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer())
    if (head.length < 16) return 0
    const dv = new DataView(head.buffer)
    if (dv.getUint32(0, true) !== 0x46546c67) return 0
    const jsonLen = dv.getUint32(12, true)
    if (jsonLen <= 0 || jsonLen > 64 * 1024 * 1024) return 0
    const js = new TextDecoder().decode(await blob.slice(20, 20 + jsonLen).arrayBuffer())
    const json = JSON.parse(js)
    let tris = 0
    for (const m of json.meshes || []) {
      for (const p of m.primitives || []) {
        if (p.indices !== undefined) tris += json.accessors[p.indices].count / 3
        else tris += json.accessors[p.attributes.POSITION].count / 3
      }
    }
    return Math.round(tris)
  } catch {
    return 0
  }
}

// Above this, the source is too dense for a smooth "coarse seed": slim it
// with MeshTools before UltraShape loads it (1M-tri Pixal exports made
// 159 MB GLBs that felt unusable for the Upscale step).
const PREDECIMATE_TRIS = 400000
const PREDECIMATE_TARGET = 200000

// UltraShape 1.0 mesh upscale ("Upscale" button): push the coarse mesh
// (generated or imported) + the source image through UltraShapeRefine on
// the local box, download the refined GLB. Returns { entry, blob, name } —
// callers swap `entry` in as the current mesh so Rig/download use the
// refined version. Purely local/free; needs the ComfyUI-UltraShape1 pack.
// When the source mesh has a skin (UVs + embedded textures), the workflow
// also bakes the refine detail as normal + AO maps onto the original's UV
// atlas and saves THAT — so the result keeps its textures.
export async function runMeshUpscale(base, { cfg = {}, imageFile, meshEntry, meshFile, meshName = 'mesh.glb' }, onStatus) {
  if (!imageFile) {
    throw new Error('Pick the source image first — UltraShape refines the mesh guided by your image')
  }
  // Grab the source bytes either way: we need them to detect a skin, and
  // un-uploaded meshes get uploaded below.
  let srcBlob = meshFile || null
  if (!srcBlob && meshEntry) srcBlob = await fetchOutputBlob(base, meshEntry)
  if (!srcBlob) throw new Error('No mesh to upscale — generate or import a mesh first')

  // Point UltraShape at the mesh already on the server when we know where
  // it lives; otherwise upload it (its path resolution accepts input/… and
  // output/… prefixes relative to the ComfyUI root).
  let meshPath
  let bakeOriginalPath = null
  const textured = await glbHasTextures(srcBlob)
  if (meshEntry && (meshEntry.type === 'output' || meshEntry.type === 'input')) {
    const sub = meshEntry.subfolder ? `${meshEntry.subfolder}/` : ''
    meshPath = `${meshEntry.type}/${sub}${meshEntry.filename}`
    if (textured) {
      // Load3DAdvanced only lists input/3d — ship a copy for the bake leg.
      onStatus?.('Uploading mesh for texture bake…')
      const stored = await uploadMeshFile(base, 'ultrashape_source.glb', srcBlob)
      bakeOriginalPath = `3d/${stored}`
    }
  } else {
    onStatus?.('Uploading mesh…')
    const stored = await uploadMeshFile(base, 'ultrashape_coarse.glb', srcBlob)
    meshPath = `input/3d/${stored}`
    if (textured) bakeOriginalPath = `3d/${stored}`
  }

  // Dense source (e.g. a 1M-tri Pixal3D export): tell the builder to slim it
  // inside the UltraShape prompt — a 159 MB monster would otherwise be the
  // coarse seed. Keeps the bake leg pointed at the untouched original.
  const tris = await glbTriCount(srcBlob)
  const decimateTris = tris > PREDECIMATE_TRIS ? PREDECIMATE_TARGET : 0
  if (decimateTris) {
    onStatus?.(`Mesh has ${Math.round(tris / 1000)}k triangles — pre-decimating to ${decimateTris}…`)
  }

  onStatus?.('Uploading source image…')
  const up = await uploadImage(base, imageFile)

  const wf = buildUltraShapeWorkflow({
    meshPath,
    imageName: up.name,
    decimateTris,
    checkpoint: cfg.ultrashapeCheckpoint || 'ultrashape_v1.pt',
    dtype: cfg.ultrashapeDtype || 'bfloat16',
    lowVram: cfg.ultrashapeLowVram !== false,
    steps: cfg.ultrashapeSteps ?? 20,
    guidance: cfg.ultrashapeGuidance ?? 5,
    octree: cfg.ultrashapeOctree ?? 384,
    numChunks: cfg.ultrashapeNumChunks ?? 8000,
    numLatents: cfg.ultrashapeNumLatents ?? 16384,
    bakeOriginalPath,
  })
  onStatus?.('Queued — UltraShape refine takes a few minutes…')
  await assertWorkflowNodes(base, wf, { label: 'UltraShape upscale', describe: describeNode })
  const runOnce = async () => {
    const id = await queuePrompt(base, wf)
    return pollHistory(base, id, {
      timeoutMs: TIMEOUTS.ultrashape,
      label: 'UltraShape',
      nodes: nodeLabels(wf),
      onTick: (s, info) => onStatus?.(statusLine('refining', s, info)),
    })
  }
  // A run that dies mid-refine (OOM, interrupt) leaves the cached
  // UltraShape wrapper with stale CPU/GPU offload state — the next run
  // then fails with a device mismatch. /free drops the node cache so the
  // model reloads fresh; recover once automatically.
  const RECOVERABLE = /same device|different device|mat1 is on cpu|out of memory/i
  // Start with a clean slate: whatever the previous stage loaded (Pixal,
  // MIA, …) must not squat in VRAM next to UltraShape's weights.
  onStatus?.('Unloading previous models…')
  await freeLoadedModels(base)
  let entry
  try {
    entry = await runOnce()
  } catch (err) {
    if (!RECOVERABLE.test(String(err?.message || err))) throw err
    onStatus?.('Recovering — clearing stale ComfyUI state, retrying once…')
    await freeLoadedModels(base)
    entry = await runOnce()
  }
  const outs = collectOutputFiles(entry).filter((f) => /\.glb$/i.test(f.filename))
  const glb = outs.find((f) => String(f.filename).startsWith('ultrashape')) || outs[0]
  if (!glb) {
    throw new Error(
      'UltraShape finished but no GLB appeared in ComfyUI output — check the ComfyUI console. ' +
        'The pack also needs its python deps: pip install -r requirements.txt in ' +
        'custom_nodes/ComfyUI-UltraShape1, then queue again.'
    )
  }
  onStatus?.('Downloading refined mesh…')
  const blob = await fetchOutputBlob(base, glb)
  const baseName = String(meshName).replace(/\.[^.]+$/, '')
  return { entry: glb, blob, name: `${baseName}_ultrashape.glb` }
}

// ComfyUI's aiohttp server rejects request bodies over --max-upload-size
// (default 100MB), so a high-budget mesh (1M tris + 4K PBR) dies with
// HTTP 413 on upload. The Skin pipeline never reads the source textures —
// MeshToolsLoad takes the geometry, re-unwraps (unwrap_mesh: true), and
// repaints everything from the source picture — so this rebuilds the GLB
// without images/textures/samplers: image bufferViews are dropped from the
// BIN chunk, remaining bufferViews are remapped with 4-byte alignment, and
// every texture reference in materials is deleted (factors kept). Vertex
// data is copied byte-for-byte. Returns the input blob untouched when
// there is nothing to strip; throws on malformed input so callers can
// fall back to the original file.
export async function stripGlbTextures(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer())
  if (buf.length < 20) throw new Error('GLB too short')
  const magic = String.fromCharCode(buf[0], buf[1], buf[2], buf[3])
  if (magic !== 'glTF') throw new Error(`not a GLB (magic ${JSON.stringify(magic)})`)
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const jsonLen = dv.getUint32(12, true)
  const jsonType = dv.getUint32(16, true)
  if (jsonType !== 0x4e4f534a) throw new Error('GLB missing JSON chunk')
  const jsonEnd = 20 + jsonLen
  if (jsonEnd > buf.length) throw new Error('GLB JSON chunk out of range')
  const json = JSON.parse(new TextDecoder().decode(buf.slice(20, jsonEnd)))
  if (!json.images?.length && !json.textures?.length) return blob
  if ((json.buffers?.length || 0) !== 1) throw new Error('expected exactly one GLB buffer')
  const imageViews = new Set()
  for (const img of json.images || []) if (typeof img.bufferView === 'number') imageViews.add(img.bufferView)
  // Delete every texture reference in materials (baseColorTexture,
  // normalTexture, extensions like KHR_materials_specular …) while
  // keeping scalar factors so the material stays valid.
  const stripTexKeys = (node) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      node.forEach(stripTexKeys)
      return
    }
    for (const key of Object.keys(node)) {
      if (key.endsWith('Texture')) delete node[key]
      else stripTexKeys(node[key])
    }
  }
  for (const mat of json.materials || []) stripTexKeys(mat)
  delete json.images
  delete json.textures
  delete json.samplers
  for (const field of ['extensionsRequired', 'extensionsUsed']) {
    if (json[field]) {
      json[field] = json[field].filter((e) => !/^KHR_texture_/.test(e))
      if (!json[field].length) delete json[field]
    }
  }
  // Every bufferView still referenced anywhere EXCEPT the deleted images
  // (accessors, sparse accessors, animation samplers, extensions …) must
  // survive the drop pass — shared image/geometry views are legal.
  const needed = new Set()
  const collect = (node) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      node.forEach(collect)
      return
    }
    if (typeof node.bufferView === 'number') needed.add(node.bufferView)
    for (const v of Object.values(node)) collect(v)
  }
  const { images: _i, textures: _t, samplers: _s, ...rest } = json
  collect(rest)
  const oldViews = json.bufferViews || []
  let binStart = -1
  let binLen = 0
  if (jsonEnd + 8 <= buf.length && dv.getUint32(jsonEnd + 4, true) === 0x004e4942) {
    binLen = dv.getUint32(jsonEnd, true)
    if (jsonEnd + 8 + binLen > buf.length) throw new Error('GLB BIN chunk out of range')
    binStart = jsonEnd + 8
  }
  const bin = binStart >= 0 ? buf.subarray(binStart, binStart + binLen) : new Uint8Array(0)
  const newViews = []
  const remap = new Map()
  oldViews.forEach((v, i) => {
    if (imageViews.has(i) && !needed.has(i)) {
      remap.set(i, -1)
      return
    }
    remap.set(i, newViews.length)
    newViews.push({ ...v })
  })
  // Remap every surviving bufferView pointer (accessors, sparse accessors,
  // node extensions …) — images are already gone from `rest`, so nothing
  // legitimately pointing at a dropped view can be hit here.
  const patch = (node) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      node.forEach(patch)
      return
    }
    if (typeof node.bufferView === 'number') {
      const next = remap.get(node.bufferView)
      if (next === undefined || next === -1) throw new Error('needed bufferView was dropped')
      node.bufferView = next
    }
    for (const v of Object.values(node)) patch(v)
  }
  patch(rest)
  // Rebuild BIN from the kept views' byte ranges, 4-byte aligned so
  // vertex attribute stride math stays valid.
  let cursor = 0
  const segments = []
  for (const v of newViews) {
    const off = v.byteOffset || 0
    const len = v.byteLength
    if (off + len > bin.length) throw new Error('bufferView out of BIN range')
    const pad = (4 - (cursor % 4)) % 4
    if (pad) {
      segments.push(new Uint8Array(pad))
      cursor += pad
    }
    v.byteOffset = cursor
    segments.push(bin.subarray(off, off + len))
    cursor += len
  }
  const newBin = new Uint8Array(cursor)
  {
    let p = 0
    for (const seg of segments) {
      newBin.set(seg, p)
      p += seg.length
    }
  }
  if (newViews.length) json.bufferViews = newViews
  else delete json.bufferViews
  json.buffers[0].byteLength = newBin.length
  // Reassemble the container: JSON chunk padded with spaces, BIN with NULs.
  const enc = new TextEncoder().encode(JSON.stringify(json))
  const jsonPad = (4 - (enc.length % 4)) % 4
  const jsonChunkLen = enc.length + jsonPad
  const binPad = (4 - (newBin.length % 4)) % 4
  const binChunkLen = newBin.length + binPad
  const total = 12 + 8 + jsonChunkLen + 8 + binChunkLen
  const out = new Uint8Array(total)
  const odv = new DataView(out.buffer)
  out.set([0x67, 0x6c, 0x54, 0x46], 0) // 'glTF'
  odv.setUint32(4, 2, true)
  odv.setUint32(8, total, true)
  odv.setUint32(12, jsonChunkLen, true)
  odv.setUint32(16, 0x4e4f534a, true)
  out.set(enc, 20)
  out.fill(0x20, 20 + enc.length, 20 + jsonChunkLen)
  odv.setUint32(20 + jsonChunkLen, binChunkLen, true)
  odv.setUint32(20 + jsonChunkLen + 4, 0x004e4942, true)
  out.set(newBin, 20 + jsonChunkLen + 8)
  return new Blob([out], { type: 'model/gltf-binary' })
}

// Hunyuan3D-Paint ("Skin" button): bare mesh + source picture → PBR-skinned
// GLB on the local box. Unwraps, renders6 views, runs multiview PBR
// diffusion, bakes and inpaints (~80s after the model loads). InPaint's GLB
// never lands in history (tuple return), so we probe /view for the
// counter-based names the node constructs — a unique per-run output name
// guarantees only our own file can match. Returns { entry, blob, name }.
export async function runPaintSkin(
  base,
  { cfg = {}, imageFile, meshEntry, meshFile, meshName = 'mesh.glb', editModels = null },
  onStatus
) {
  if (!imageFile) {
    throw new Error('Pick the source picture first — Hunyuan3D-Paint skins the mesh from your image')
  }
  let srcBlob = meshFile || null
  if (!srcBlob && meshEntry) srcBlob = await fetchOutputBlob(base, meshEntry)
  if (!srcBlob) throw new Error('No mesh to skin — generate or import a mesh first')

  // ComfyUI rejects bodies over --max-upload-size (default 100MB) with
  // HTTP 413. Paint never reads the source textures (MeshToolsLoad →
  // trimesh → unwrap_mesh), so past ~90MB upload geometry only.
  let uploadBlob = srcBlob
  const SAFE_UPLOAD = 90 * 1024 * 1024
  if (srcBlob.size > SAFE_UPLOAD) {
    onStatus?.(
      `Mesh is ${Math.round(srcBlob.size / 1048576)}MB — preparing geometry-only upload (paint repaints from your picture)…`
    )
    try {
      const stripped = await stripGlbTextures(srcBlob)
      if (stripped.size < srcBlob.size) uploadBlob = stripped
    } catch {
      // Malformed GLB — fall through with the original; uploadMeshFile's
      // 413 message still explains the limit if it trips.
    }
  }

  // MeshToolsLoad's mesh_path is a plain STRING path (no dropdown index),
  // so a fixed upload name never needs a ComfyUI restart.
  onStatus?.('Uploading mesh to ComfyUI input/3d…')
  const stored = await uploadMeshFile(base, 'hunyuan_paint_src.glb', uploadBlob)
  onStatus?.('Uploading source picture…')
  const up = await uploadImage(base, imageFile)

  // Unique per run: get_save_image_path can only ever write one file with
  // this base name, so a stale skin from an earlier run can't be picked up.
  const outputName = `painted_${Date.now().toString(36)}`

  // Face fix, paint side: refine the face on the front view before the bake.
  // views 1024px / texture 4096 put ~6x more texels on the face than the old
  // 512/1024 defaults — the bake is where small faces used to mush out.
  const wantFaceFix = cfg.faceFix !== false && !!editModels
  let faceFix = null
  if (wantFaceFix) {
    const models = await resolveEditModels(base, editModels)
    const faceModelName = await detectFaceModel(base)
    if (models) {
      // 0.55 was re-generating the painted eyes away (blank sockets after
      // the fix). The paint model already renders the face from the source
      // image — the fix should clean up, not redraw. Light touch preserves
      // iris/pupil detail the paint model put down.
      faceFix = { faceModelName, editModels: models, denoise: 0.3 }
    } else {
      onStatus?.('Face pass skipped (no Qwen edit model on the server)…')
    }
  }

  const buildWf = (fix) =>
    buildPaintWorkflow({
      meshPath: `3d/${stored}`,
      imageName: up.name,
      paintModel: cfg.hunyuanPaintModel || 'hunyuan3d-paintpbr-v2-1',
      viewSize: cfg.hunyuanViewSize ?? 1024,
      steps: cfg.hunyuanPaintSteps ?? 10,
      guidance: cfg.hunyuanGuidance ?? 3,
      textureSize: cfg.hunyuanTextureSize ?? 4096,
      outputName,
      faceFix: fix,
      viewUpscale: up,
    })

  const runOnce = async (fix, up) => {
    const wf = buildWf(fix, up)
    await assertWorkflowNodes(base, wf, { label: 'Hunyuan3D-Paint skinning', describe: describeNode })
    onStatus?.('Unloading previous models…')
    await freeLoadedModels(base)
    const extras = [fix ? 'face pass' : null, up ? 'detail views' : null].filter(Boolean)
    onStatus?.(
      extras.length
        ? `Queued — ${extras.join(' + ')}, then multiview texture diffusion…`
        : 'Queued — multiview texture diffusion takes a couple of minutes…'
    )
    const id = await queuePrompt(base, wf)
    return pollHistory(base, id, {
      timeoutMs: TIMEOUTS.paint,
      label: 'Hunyuan paint',
      nodes: nodeLabels(wf),
      onTick: (s, info) => onStatus?.(statusLine('skinning', s, info)),
    })
  }

  // Degrade one feature at a time so a face-pass or upscale-stage failure
  // (missing node, OOM, no face found) never loses the whole paint run.
  const wantUpscale = cfg.hunyuanViewUpscale !== false
  const plan = []
  const pushPlan = (fix, up) => {
    const k = `${fix ? 'f' : 'n'}${up ? 'u' : '-'}`
    if (!plan.some((p) => p.k === k)) plan.push({ k, fix, up })
  }
  pushPlan(faceFix, wantUpscale)
  pushPlan(null, wantUpscale)
  pushPlan(faceFix, false)
  pushPlan(null, false)

  let entry
  for (let i = 0; i < plan.length; i++) {
    const { fix, up } = plan[i]
    try {
      if (fix) {
        onStatus?.(
          fix.faceModelName
            ? 'Face pass · precise face mask on the front view…'
            : 'Face pass · refining the face in the front view…'
        )
      }
      entry = await runOnce(fix, up)
      break
    } catch (err) {
      if (i === plan.length - 1) throw err
      // Same recoverable pattern as UltraShape.
      onStatus?.(
        `Attempt failed (${(err && err.message) || err}) — retrying with a simpler pipeline…`
      )
    }
  }

  // History first in case a ComfyUI version records the file entry, then
  // probe the constructed names (fresh prefixes start at _00001_).
  const fromHistory = collectOutputFiles(entry).find((f) => /\.glb$/i.test(f.filename))
  const candidates = fromHistory
    ? [fromHistory]
    : Array.from({ length: 10 }, (_, i) => ({
        filename: `${outputName}_${String(i + 1).padStart(5, '0')}_.glb`,
        subfolder: '',
        type: 'output',
        key: 'probed',
      }))
  for (const f of candidates) {
    try {
      onStatus?.('Downloading painted mesh…')
      const blob = await fetchOutputBlob(base, f)
      const baseName = String(meshName).replace(/\.[^.]+$/, '')
      let outBlob = blob
      if (cfg.hunyuanSkinBlend !== false && (srcBlob || meshEntry)) {
        try {
          onStatus?.('Face blend · keeping your generated hair and clothes…')
          const blended = await hybridSkinBlend(srcBlob, blob, onStatus)
          outBlob = blended.blob
          onStatus?.('Face blend done — paint details on the face, generated texture elsewhere')
        } catch (err) {
          onStatus?.(
            `Face blend skipped (${(err && err.message) || 'error'}) — using the painted texture as-is`
          )
        }
      }
      return { entry: f, blob: outBlob, name: `${baseName}_painted.glb` }
    } catch {
      // probed name didn't exist — try the next counter
    }
  }
  throw new Error(
    'Paint finished but no GLB could be downloaded from ComfyUI output — check the ComfyUI console. ' +
      'The pack also needs its models: hunyuan3d-paintpbr-v2-1 in models/diffusers and ' +
      'dinov2-giant in models/clip_vision (see custom_nodes/ComfyUI-Hunyuan3D-Paint).'
  )
}

// Tripo pipeline: image → Tripo model → rig → retargeted preset animation.
export async function runTripo(base, file, cfg, preset, onStatus) {
  onStatus?.('Uploading image…')
  const up = await uploadImage(base, file)
  const wf = buildTripoWorkflow({
    imageName: up.name,
    modelVersion: cfg.tripoModelVersion,
    rigVersion: cfg.tripoRigVersion,
    rigType: cfg.tripoRigType,
    spec: cfg.tripoSpec,
    outFormat: cfg.tripoOutFormat,
    preset,
    textureQuality: cfg.tripoTextureQuality || 'standard',
    geometryQuality: cfg.tripoGeometryQuality || 'standard',
    textureAlignment: cfg.tripoTextureAlignment || 'original_image',
    pbr: cfg.tripoPbr !== false,
  })
  await assertWorkflowNodes(base, wf, { label: 'Tripo 3D pipeline', describe: describeNode })
  onStatus?.('Queued — Tripo generates, rigs and animates in the cloud (needs ComfyUI signed in to comfy.org)…')
  const id = await queuePrompt(base, wf)
  const entry = await pollHistory(base, id, {
    timeoutMs: TIMEOUTS.tripo,
    label: 'Tripo pipeline',
    nodes: nodeLabels(wf),
    onTick: (s, info) => onStatus?.(statusLine('Tripo: generate → rig → animate', s, info)),
  })

  const files = collectOutputFiles(entry).filter((f) => /\.(glb|fbx)$/i.test(f.filename))
  if (files.length === 0) {
    throw new Error(
      'Tripo job succeeded but no model file appeared in ComfyUI output. ' +
        'If this repeats, check that ComfyUI is signed in to comfy.org (Settings → API keys) and inspect the ComfyUI console.'
    )
  }
  return files
}
