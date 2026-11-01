// Animation/model discovery and small file probes for the 3D panels.
import { getNodeComboOptions, getViewUrl, assertMeshBytes } from '../comfyui.js'
import { KNOWN_MIXAMO_ANIMATIONS, RIG_INPUT_NAME } from './shared.js'

export async function listLocalAnimations(base) {
  let combo = []
  try {
    combo = await getNodeComboOptions(base, 'UniRigApplyAnimation', 'animation_file')
  } catch { /* node pack absent — fall through to probe-only */ }
  // Probe the known list so files added after ComfyUI started still show up.
  const probed = []
  for (const name of KNOWN_MIXAMO_ANIMATIONS) {
    if (combo.includes(name)) continue
    if (await probeInputFile(base, name, 'animation_templates/mixamo')) probed.push(name)
  }
  // Dedupe, keep combo order first, then probed additions.
  return [...combo, ...probed.filter((n) => !combo.includes(n))]
}

// Upload Mixamo animation FBXs into input/animation_templates/mixamo/ so
// UniRigApplyAnimation can retarget them. Returns the stored filenames.
// Note: the animation_file dropdown is cached at ComfyUI startup — files
// uploaded here work immediately in the workflow (MeshToolsLoad-style free
// paths don't apply; this node reads a startup-cached combo), so the caller
// should tell the user to restart ComfyUI once after uploading.
export async function uploadAnimationFiles(base, files, onStatus) {
  const stored = []
  for (const file of files) {
    const name = String(file.name || '').trim()
    if (!/\.fbx$/i.test(name)) continue
    const blob = file instanceof Blob ? file : new Blob([file])
    onStatus?.(`Uploading ${name}…`)
    const form = new FormData()
    form.append('image', blob, name)
    form.append('subfolder', 'animation_templates/mixamo')
    form.append('type', 'input')
    form.append('overwrite', 'true')
    let res
    try {
      res = await fetch(`${base}/upload/image`, { method: 'POST', body: form })
    } catch (err) {
      throw new Error(`could not upload ${name} (${err.message})`)
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 160)
      const hint =
        res.status === 413
          ? " — file exceeds ComfyUI's request-body limit; restart ComfyUI with --max-upload-size 400"
          : ''
      throw new Error(`upload failed for ${name} (HTTP ${res.status}${hint})${detail ? `: ${detail}` : ''}`)
    }
    const data = await res.json()
    if (!data.name) throw new Error(`ComfyUI did not accept ${name}`)
    stored.push(data.name)
  }
  if (stored.length === 0) throw new Error('No .fbx files in that selection — Mixamo downloads are .fbx')
  return stored
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

// Does this input/ file exist on the server? Tries the path as typed, then
// input/3d/<name> for bare filenames. HEAD first (no bytes moved), ranged
// GET fallback. Returns { filename, subfolder, meshPath } or null.
export async function probeServerFile(base, serverPath) {
  const clean = String(serverPath || '').trim().replace(/^\/+/, '')
  if (!clean) return null
  const split = (p) => {
    const i = p.lastIndexOf('/')
    return i < 0 ? { filename: p, subfolder: '' } : { filename: p.slice(i + 1), subfolder: p.slice(0, i) }
  }
  const tries = [split(clean)]
  if (!clean.includes('/')) tries.push({ filename: clean, subfolder: '3d' })
  for (const { filename, subfolder } of tries) {
    if (!filename) continue
    if (await probeInputFile(base, filename, subfolder)) {
      return { filename, subfolder, meshPath: subfolder ? `${subfolder}/${filename}` : filename }
    }
  }
  return null
}

// Which of these animation files are REALLY on disk? The animation_file
// dropdown is startup-cached, so it lists ghosts after input cleanups —
// probe input/animation_templates/<type>/ per file. { missing, available }.
export async function probeAnimationFiles(base, files, animationType = 'mixamo') {
  const names = [].concat(files || []).map((a) => String(a || '').trim()).filter(Boolean)
  const missing = []
  const available = []
  for (const name of names) {
    if (await probeInputFile(base, name, `animation_templates/${animationType}`)) available.push(name)
    else missing.push(name)
  }
  return { missing, available }
}

// UniRigApplyAnimation.animation_file is a COMBO validated server-side against
// the list cached at ComfyUI startup. A file can be sitting on disk and still
// be rejected at queue time because the node never saw it. Returns the subset
// of `files` that are on disk but not in that cached dropdown.
export async function animationsNeedingRestart(base, files, animationType = 'mixamo') {
  const names = [].concat(files || []).map((a) => String(a || '').trim()).filter(Boolean)
  if (names.length === 0) return []
  let combo
  try {
    combo = await getNodeComboOptions(base, 'UniRigApplyAnimation', 'animation_file')
  } catch {
    return [] // node pack absent — can't judge, let the queue-time check speak
  }
  if (!Array.isArray(combo) || combo.length === 0) return []
  const { available } = await probeAnimationFiles(base, names, animationType)
  return available.filter((name) => !combo.includes(name))
}

// HEAD/ranged-GET probe of one input/ file. Returns true when the server
// serves real bytes (not an HTML error page).
async function probeInputFile(base, filename, subfolder) {
  let url = null
  try {
    url = await getViewUrl(base, filename, subfolder, 'input')
  } catch {
    return false
  }
  try {
    const head = await fetch(url, { method: 'HEAD', cache: 'no-store' }).catch(() => null)
    if (head?.ok && !(head.headers.get('content-type') || '').toLowerCase().includes('text/html')) return true
  } catch {
    /* fall through to ranged GET */
  }
  try {
    const res = await fetch(url, { cache: 'no-store', headers: { Range: 'bytes=0-0' } }).catch(() => null)
    if (!res) return false
    const ok = res.ok || res.status === 206
    try { await res.blob() } catch { /* body discarded */ }
    return ok && !(res.headers.get('content-type') || '').toLowerCase().includes('text/html')
  } catch {
    return false
  }
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

export async function resolveEditModels(base, editModels = {}) {
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
