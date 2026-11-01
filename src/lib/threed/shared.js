export const TIMEOUTS = {
  mesh: 30 * 60 * 1000,
  mia: 20 * 60 * 1000,
  tripo: 15 * 60 * 1000,
  ultrashape: 45 * 60 * 1000,
  paint: 50 * 60 * 1000,
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
    'MeshToolsLoad',
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
export function statusLine(phase, seconds, info, prog) {
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
export function createMeshProgress() {
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

// Legacy fixed upload name from when UniRigLoadMesh's startup-cached
// dropdown forced one indexed filename. MeshToolsLoad takes any string path,
// so uploads now use unique names — kept exported for compatibility.
export const RIG_INPUT_NAME = 'studio_rig_input.glb'

// Animation options for the local pipeline (UniRigApplyAnimation's
// animation_file dropdown — Mixamo FBX files shipped with the node).
// The combo is startup-cached by ComfyUI, so files added after boot don't
// appear. Probe a known list of filenames against the server via /view
// (which returns 200 for any file on disk) and merge with the combo.
export const KNOWN_MIXAMO_ANIMATIONS = [
  'Breakdance.fbx',
  'Breathing Idle.fbx',
  'Capoeira.fbx',
  'Crouched To Standing.fbx',
  'Crouching Idle.fbx',
  'Crouching.fbx',
  'Dying.fbx',
  'Hip_Hop_Dancing.fbx',
  'Jumping.fbx',
  'Mma_Kick.fbx',
  'Running Jump.fbx',
  'Running.fbx',
  'Standing To Crouched.fbx',
  'Walking.fbx',
]

