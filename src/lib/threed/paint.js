// Hunyuan3D paint pipeline; also GLB texture stripping for upload limits.
import {
  assertWorkflowNodes,
  collectOutputFiles,
  freeLoadedModels,
  pollHistory,
  queuePrompt,
  uploadImage,
  uploadMeshFile,
} from '../comfyui.js'
import { buildPaintWorkflow } from '../workflows.js'
import { hybridSkinBlend } from '../hybridSkin.js'
import { resolveEditModels, fetchOutputBlob } from './assets.js'
import { TIMEOUTS, describeNode, nodeLabels, statusLine } from './shared.js'

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

  // Cleanup + face pass, paint side: ONE Qwen refine of the front view
  // before the bake — full view, no face mask, so paint-model artifacts
  // (dark speckles, discolored fingertips) are cleaned along with the face.
  // A separate per-view cleanup pass was tried and removed: 6 extra sampler
  // passes crashed ComfyUI on this 16GB box. views 1024px / texture 4096
  // put ~6x more texels on the face than the old 512/1024 defaults — the
  // bake is where small faces used to mush out.
  const wantFaceFix = cfg.faceFix !== false && !!editModels
  let faceFix = null
  if (wantFaceFix) {
    const models = await resolveEditModels(base, editModels)
    if (models) {
      // 0.55 was re-generating the painted eyes away (blank sockets after
      // the fix). The paint model already renders the face from the source
      // image — the fix should clean up, not redraw. Light touch preserves
      // iris/pupil detail the paint model put down. faceModelName '' forces
      // the full-view composite: a face-only mask would leave fingertips
      // and speckles outside the face untouched.
      faceFix = { faceModelName: '', editModels: models, denoise: 0.3 }
    } else {
      onStatus?.('Face pass skipped (no Qwen edit model on the server)…')
    }
  }

  const buildWf = (fix, upscale) =>
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
      viewUpscale: upscale,
    })

  const runOnce = async (fix, up) => {
    const wf = buildWf(fix, up)
    await assertWorkflowNodes(base, wf, { label: 'Hunyuan3D-Paint skinning', describe: describeNode })
    onStatus?.('Unloading previous models…')
    await freeLoadedModels(base)
    const extras = [fix ? 'cleanup + face pass' : null, up ? 'detail views' : null].filter(Boolean)
    onStatus?.(
      extras.length
        ? `Queued — ${extras.join(' + ')}, then multiview texture diffusion…`
        : 'Queued — multiview texture diffusion takes a couple of minutes…'
    )
    const id = await queuePrompt(base, wf)
    // Base covers the fixed passes (6-view cleanup + face fix + bake) at
    // default steps; each diffusion step above 10 adds ~3 min (measured:
    // steps 25 ran ~88 min end-to-end).
    const steps = cfg.hunyuanPaintSteps ?? 10
    const stepBudget = Math.max(0, steps - 10) * 3 * 60 * 1000
    return pollHistory(base, id, {
      timeoutMs: TIMEOUTS.paint + stepBudget,
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
        onStatus?.('Cleanup + face pass · refining the front view…')
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
