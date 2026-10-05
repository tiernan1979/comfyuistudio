// 3D generation orchestration: image → mesh → rig → animation.
//
// Two pipelines:
//   local — Pixal3D (image→GLB) then MIA auto-rig (+ optional Mixamo FBX),
//           everything on the user's own ComfyUI box
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
  buildPixal3DWorkflow,
  buildMiaRigWorkflow,
  buildTripoWorkflow,
  buildUltraShapeWorkflow,
  buildPaintWorkflow,
} from './workflows.js'

// High-quality runs take a while: 1536_cascade at 1024 camera res with a
// 4k texture bake can legitimately run 20–30 min on a mid GPU.
const TIMEOUTS = {
  pixal3d: 30 * 60 * 1000,
  mia: 20 * 60 * 1000,
  tripo: 15 * 60 * 1000,
  ultrashape: 45 * 60 * 1000,
  paint: 25 * 60 * 1000,
}

// Friendly names for the nodes we queue, so the status line can say
// "auto-rigging skeleton · 4m12s" instead of just "working…".
const CLASS_LABELS = {
  LoadImage: 'reading image',
  Pixal3DModelLoader: 'loading Pixal3D model (first run downloads weights)',
  Pixal3DImageTo3D: 'generating mesh',
  Pixal3DExportGLB: 'baking texture & exporting GLB',
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
}

export function nodeLabels(workflow) {
  return Object.fromEntries(
    Object.entries(workflow).map(([id, n]) => [id, CLASS_LABELS[n.class_type] || n.class_type])
  )
}

// ---------------------------------------------------------------------------
// Node-pack verification: "if they don't have Pixal3D (or whatever), it must
// error out" — both when the 3D tab is enabled in Settings and before each
// pipeline step queues anything.
// ---------------------------------------------------------------------------

// Which pack installs each node, for readable error messages.
const NODE_PACKS = {
  Pixal3DModelLoader: 'ComfyUI-Pixal3D (TencentARC)',
  Pixal3DImageTo3D: 'ComfyUI-Pixal3D (TencentARC)',
  Pixal3DExportGLB: 'ComfyUI-Pixal3D (TencentARC)',
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
}

export function describeNode(cls) {
  const pack = NODE_PACKS[cls]
  return pack ? `${cls} (${pack})` : cls
}

// Baseline node sets per pipeline — Settings checks these when the 3D tab
// is switched on; individual runs additionally verify the exact workflow.
export const PIPELINE_NODES = {
  local: [
    'Pixal3DModelLoader',
    'Pixal3DImageTo3D',
    'Pixal3DExportGLB',
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
function statusLine(phase, seconds, info) {
  const t = formatElapsed(seconds)
  if (info?.phase === 'queued') return `queued (#${info.queuePos}) · ${t}`
  if (info?.nodeLabel) {
    const step = info.progress ? ` — step ${info.progress.value}/${info.progress.max}` : ''
    return `${info.nodeLabel}${step} · ${t}`
  }
  if (phase) return `${phase}… ${t}`
  return `working on ComfyUI… ${t}`
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

// Local pipeline, step 1: upload image, run Pixal3D, return the GLB ref.
export async function runGenerateMesh(base, file, cfg, onStatus) {
  if ((cfg.pixalEnhance || 'none') === 'esrgan' && !cfg.pixalUpscaleModel) {
    throw new Error(
      'ESRGAN upscale is selected but no model file is set — pick one in Settings → 3D. ' +
        'If the list is empty, drop a free .pth (e.g. 4x-UltraSharp) into ' +
        'ComfyUI/models/upscale_models/ and restart ComfyUI.'
    )
  }
  onStatus?.('Uploading image…')
  const up = await uploadImage(base, file)
  const wf = buildPixal3DWorkflow({
    imageName: up.name,
    modelRepo: cfg.pixalModelRepo,
    vramMode: cfg.pixalVramMode,
    pipeline: cfg.pixalPipeline,
    cameraRes: cfg.pixalCameraRes,
    textureSize: cfg.pixalTextureSize,
    decimation: cfg.pixalDecimation,
    steps: cfg.pixalSteps,
    guidance: cfg.pixalGuidance,
    textureGuidance: cfg.pixalTextureGuidance,
    maxTokens: cfg.pixalMaxTokens,
    remesh: cfg.pixalRemesh,
    enhance: cfg.pixalEnhance || 'none',
    enhanceModel: cfg.pixalUpscaleModel || '',
    nafMode: cfg.pixalNafMode || 'fallback_if_missing',
  })
  await assertWorkflowNodes(base, wf, { label: 'Pixal3D mesh generation', describe: describeNode })
  onStatus?.('Unloading previous models…')
  await freeLoadedModels(base)
  onStatus?.('Queued — loading Pixal3D model on first run can take a while…')
  const id = await queuePrompt(base, wf)
  const entry = await pollHistory(base, id, {
    timeoutMs: TIMEOUTS.pixal3d,
    label: 'Pixal3D',
    nodes: nodeLabels(wf),
    onTick: (s, info) => onStatus?.(statusLine('generating', s, info)),
  })
  const glb = collectOutputFiles(entry).find((f) => /\.glb$/i.test(f.filename))
  if (!glb) {
    throw new Error('Pixal3D finished but no GLB appeared in ComfyUI output — check the ComfyUI console')
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

// Hunyuan3D-Paint ("Skin" button): bare mesh + source picture → PBR-skinned
// GLB on the local box. Unwraps, renders6 views, runs multiview PBR
// diffusion, bakes and inpaints (~80s after the model loads). InPaint's GLB
// never lands in history (tuple return), so we probe /view for the
// counter-based names the node constructs — a unique per-run output name
// guarantees only our own file can match. Returns { entry, blob, name }.
export async function runPaintSkin(
  base,
  { cfg = {}, imageFile, meshEntry, meshFile, meshName = 'mesh.glb' },
  onStatus
) {
  if (!imageFile) {
    throw new Error('Pick the source picture first — Hunyuan3D-Paint skins the mesh from your image')
  }
  let srcBlob = meshFile || null
  if (!srcBlob && meshEntry) srcBlob = await fetchOutputBlob(base, meshEntry)
  if (!srcBlob) throw new Error('No mesh to skin — generate or import a mesh first')

  // MeshToolsLoad's mesh_path is a plain STRING path (no dropdown index),
  // so a fixed upload name never needs a ComfyUI restart.
  onStatus?.('Uploading mesh to ComfyUI input/3d…')
  const stored = await uploadMeshFile(base, 'hunyuan_paint_src.glb', srcBlob)
  onStatus?.('Uploading source picture…')
  const up = await uploadImage(base, imageFile)

  // Unique per run: get_save_image_path can only ever write one file with
  // this base name, so a stale skin from an earlier run can't be picked up.
  const outputName = `painted_${Date.now().toString(36)}`
  const wf = buildPaintWorkflow({
    meshPath: `3d/${stored}`,
    imageName: up.name,
    paintModel: cfg.hunyuanPaintModel || 'hunyuan3d-paintpbr-v2-1',
    viewSize: cfg.hunyuanViewSize ?? 512,
    steps: cfg.hunyuanPaintSteps ?? 10,
    guidance: cfg.hunyuanGuidance ?? 3,
    textureSize: cfg.hunyuanTextureSize ?? 1024,
    outputName,
  })
  await assertWorkflowNodes(base, wf, { label: 'Hunyuan3D-Paint skinning', describe: describeNode })
  onStatus?.('Unloading previous models…')
  await freeLoadedModels(base)
  onStatus?.('Queued — multiview texture diffusion takes a couple of minutes…')
  const id = await queuePrompt(base, wf)
  const entry = await pollHistory(base, id, {
    timeoutMs: TIMEOUTS.paint,
    label: 'Hunyuan paint',
    nodes: nodeLabels(wf),
    onTick: (s, info) => onStatus?.(statusLine('skinning', s, info)),
  })

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
      return { entry: f, blob, name: `${baseName}_painted.glb` }
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
