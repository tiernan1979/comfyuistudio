// Local image → mesh pipeline plus GLB inspection/upscale.
import {
  assertWorkflowNodes,
  collectOutputFiles,
  freeLoadedModels,
  pollHistory,
  queuePrompt,
  uploadImage,
  uploadMeshFile,
} from '../comfyui.js'
import { buildFaceEnhanceWorkflow, buildMeshWorkflow, buildUltraShapeWorkflow } from '../workflows.js'
import { detectFaceModel, fetchOutputBlob, resolveEditModels } from './assets.js'
import { TIMEOUTS, createMeshProgress, describeNode, nodeLabels, statusLine } from './shared.js'

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

// Rig a mesh the app just generated (server output file): download it,
// re-upload under a unique name, run MIA (+ optional animations).

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
