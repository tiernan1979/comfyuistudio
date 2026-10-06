let ws = null
let progressCallback = null
let completionCallback = null
let phaseCallback = null // (label | null) — friendly name of the running node

// promptId -> { nodeId: class_type } for the prompts this client queued, so
// WS "executing" messages can be labeled ("Decoding audio", "Sampling"…).
const promptNodes = new Map()
let latestPromptId = null

const NODE_PHASE_LABELS = [
  [/^VAEDecodeAudio/, 'Decoding audio'],
  [/^VAEDecode/, 'Decoding output'],
  [/^VAEEncode/, 'Encoding input'],
  [/^SaveAudioMP3/, 'Encoding MP3'],
  [/^SaveAudio/, 'Encoding WAV'],
  [/^SaveImage/, 'Saving image'],
  [/^SaveAnimated|SaveVideo|CreateVideo|^VHS_VideoCombine|VideoCombine/, 'Encoding video'],
  [/KSampler|SamplerCustom|SDEuler|CFGGuider/, 'Sampling'],
  [/TextEncode|CLIPTextEncode/, 'Encoding text'],
  [/Loader|Checkpoint|UNET|Lora/, 'Loading models'],
  [/Upscal|ImageScale/, 'Upscaling'],
]

// Friendly status label for a node class, or null when we'd rather show
// the plain step counter than a noisy node name.
export function friendlyNodeLabel(classType) {
  if (!classType) return null
  for (const [re, label] of NODE_PHASE_LABELS) {
    if (re.test(classType)) return label
  }
  return null
}

// crypto.randomUUID() only exists in secure contexts (localhost/HTTPS).
// Fall back to a Math.random-based UUID when opened via plain HTTP on a LAN IP.
function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

let clientId = generateUUID()

export function getClientId() {
  return clientId
}

// Resolve the effective API base. When useProxy is on, traffic goes through
// this app's own origin via the nginx dynamic proxy, with the ComfyUI
// backend taken from the Server URL saved in settings:
//   <origin>/proxy/<host>/<port>
// Same-origin = the browser's CORS policy can't block anything.
export function resolveApiBase(serverUrl, useProxy) {
  const direct = (serverUrl || '').replace(/\/+$/, '') || 'http://127.0.0.1:8188'
  if (!useProxy || typeof window === 'undefined') return direct
  try {
    const withScheme = direct.includes('://') ? direct : `http://${direct}`
    const u = new URL(withScheme)
    const port = u.port || '8188'
    return `${window.location.origin}/proxy/${u.hostname}/${port}`
  } catch {
    return direct
  }
}

export function setProgressCallback(cb) {
  progressCallback = cb
}

export function setPhaseCallback(cb) {
  phaseCallback = cb
}

export function setCompletionCallback(cb) {
  completionCallback = cb
}

export async function checkConnection(serverUrl) {
  try {
    const res = await fetch(`${serverUrl}/system_stats`)
    return res.ok
  } catch {
    return false
  }
}

export async function getQueueStatus(serverUrl) {
  try {
    const res = await fetch(`${serverUrl}/queue`)
    const data = await res.json()
    return data.queue_remaining || 0
  } catch {
    return 0
  }
}

export async function queuePrompt(serverUrl, workflow) {
  const payload = {
    prompt: workflow,
    client_id: clientId,
  }
  let res
  try {
    res = await fetch(`${serverUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    throw new Error(`Could not reach ComfyUI at ${serverUrl} (${err.message})`)
  }
  let data
  try {
    data = await res.json()
  } catch {
    throw new Error(`ComfyUI returned HTTP ${res.status} (not JSON) — is this the ComfyUI API?`)
  }
  if (data.error) {
    // Include per-node validation details, e.g. missing models / bad inputs
    let details = ''
    if (data.node_errors) {
      details =
        ' ' +
        Object.entries(data.node_errors)
          .map(([nid, info]) => {
            const msgs = (info.errors || []).map((e) => e.message || e.type || JSON.stringify(e))
            return `node ${nid} (${info.class_type || '?'}): ${msgs.join('; ') || 'invalid'}`
          })
          .join(' | ')
    }
    throw new Error(`${data.error.message || 'Prompt rejected by ComfyUI.'}${details}`)
  }
  if (!data.prompt_id) {
    throw new Error(`ComfyUI did not return a prompt_id (HTTP ${res.status})`)
  }
  // Remember node classes for this prompt so WS "executing" messages can
  // report a friendly phase ("Decoding audio") instead of freezing on the
  // last sampling step.
  try {
    promptNodes.set(
      data.prompt_id,
      Object.fromEntries(
        Object.entries(workflow || {}).map(([id, n]) => [id, n?.class_type || null])
      )
    )
    latestPromptId = data.prompt_id
    while (promptNodes.size > 8) promptNodes.delete(promptNodes.keys().next().value)
  } catch {
    /* labeling is best-effort */
  }
  return data.prompt_id
}

export async function getHistory(serverUrl, promptId) {
  const res = await fetch(`${serverUrl}/history/${promptId}`)
  return await res.json()
}

// Positive prompt text out of a submitted workflow graph: prefer the
// text wired into a KSampler's positive input, else the first
// CLIPTextEncode node. Returns '' when nothing readable is found.
function positiveTextFromGraph(graph) {
  if (!graph || typeof graph !== 'object') return ''
  const textOf = (id) => {
    const n = graph[id]
    const t = n?.inputs?.text
    return typeof t === 'string' ? t : ''
  }
  for (const node of Object.values(graph)) {
    if (node?.class_type === 'KSampler' || node?.class_type === 'KSamplerAdvanced') {
      const link = node.inputs?.positive
      if (Array.isArray(link) && link[0]) {
        const t = textOf(link[0])
        if (t) return t
      }
    }
  }
  for (const node of Object.values(graph)) {
    if (node?.class_type === 'CLIPTextEncode' && typeof node.inputs?.text === 'string' && node.inputs.text) {
      return node.inputs.text
    }
  }
  return ''
}

// Caption + lyrics out of a music workflow graph (MiniMax Music 3 / YuE /
// Sonilo / Comfy Cloud). Used for server-synced history entries whose
// outputs are audio files instead of images.
function musicTextFromGraph(graph) {
  let caption = ''
  let lyrics = ''
  const consider = (c, l) => {
    if (typeof c === 'string' && c && !caption) caption = c
    if (typeof l === 'string' && !lyrics) lyrics = l
  }
  for (const node of Object.values(graph || {})) {
    const t = node?.class_type
    if (t === 'MiniMaxMusic3TextEncode') {
      consider(node.inputs?.caption, node.inputs?.lyrics)
    } else if (t === 'YuE2GenerateMusic' || t === 'YuE2GenerateABC') {
      consider(node.inputs?.style, node.inputs?.lyrics)
    } else if (t === 'SoniloTextToMusic') {
      consider(node.inputs?.prompt, '')
    } else if (t === 'ComfyCloudMiniMaxMusic3TextToAudioNode') {
      consider(node.inputs?.prompt, node.inputs?.lyrics)
    }
  }
  return { caption, lyrics }
}

// Read the whole server-side history into the app's history shape, so
// every machine browsing the same ComfyUI sees the same generations
// (images live on the server — /view serves them to any browser).
// Returns newest-first entries: { id, type, prompt, data, timestamp }.
export async function getServerHistory(serverUrl, maxcount = 60) {
  const res = await fetch(`${serverUrl}/history?maxcount=${maxcount}`)
  if (!res.ok) throw new Error(`ComfyUI /history returned HTTP ${res.status}`)
  const data = await res.json()

  const entries = []
  for (const [promptId, item] of Object.entries(data)) {
    const graph = item?.prompt?.[2] || {}
    const outputs = item?.outputs || {}

    let file = null
    let kind = 'image' // 'image' | 'video' | 'music'
    for (const out of Object.values(outputs)) {
      if (out?.images?.length) {
        file = out.images[0]
        // SaveVideo (MiniMax H3) files mp4s under `images` with
        // animated:[true] — that's a video, not a still.
        kind =
          out.animated?.[0] || /\.(mp4|webm|mov)\b/i.test(file.filename || '')
            ? 'video'
            : 'image'
        break
      }
      if (out?.gifs?.length) {
        file = out.gifs[0]
        kind = 'video'
        break
      }
      if (out?.audio?.length) {
        file = out.audio[0]
        kind = 'music'
        break
      }
    }
    if (!file) continue

    const isEdit =
      kind === 'image' &&
      Object.values(graph).some((n) => n?.class_type === 'LoadImage' && !!n.inputs?.image)

    const tsMsg = (item.status?.messages || []).find(
      (m) => m[0] === 'execution_success' || m[0] === 'execution_start'
    )

    const entry = {
      id: promptId,
      type: kind === 'video' ? 'video' : kind === 'music' ? 'music' : isEdit ? 'edit' : 'image',
      prompt: positiveTextFromGraph(graph),
      data: await getViewUrl(serverUrl, file.filename, file.subfolder || '', file.type || 'output'),
      timestamp: tsMsg?.[1]?.timestamp || 0,
      settings: {},
      fromServer: true,
    }
    if (kind === 'music') {
      const { caption, lyrics } = musicTextFromGraph(graph)
      entry.prompt = caption || entry.prompt
      entry.lyrics = lyrics
    }
    entries.push(entry)
  }
  entries.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
  return entries
}

export async function getViewUrl(serverUrl, filename, subfolder = '', type = 'output') {
  const params = new URLSearchParams({ filename, subfolder, type })
  return `${serverUrl}/view?${params.toString()}`
}

export async function downloadFile(url) {
  const res = await fetch(url)
  return await res.blob()
}

// Upload an image to ComfyUI's input folder so LoadImage can use it.
// Returns { name, subfolder, type }. Timestamped to avoid collisions.
export async function uploadImage(serverUrl, file) {
  const form = new FormData()
  const uniqueName = `edit-${Date.now()}-${file.name}`
  form.append('image', file, uniqueName)
  form.append('overwrite', 'true')
  let res
  try {
    res = await fetch(`${serverUrl}/upload/image`, {
      method: 'POST',
      body: form,
    })
  } catch (err) {
    throw new Error(`Could not upload image (${err.message})`)
  }
  if (!res.ok) {
    throw new Error(`Image upload failed (HTTP ${res.status})`)
  }
  const data = await res.json()
  if (!data.name) {
    throw new Error('ComfyUI did not accept the image upload.')
  }
  return data
}

// Fetch the actual model files present on the ComfyUI server.
// /object_info/<LoaderClass> includes the valid combo values, e.g.
// UNETLoader.input.required.unet_name[0] === ["model_a.safetensors", ...]
//
// Cached for a few minutes: every Generate runs assertModelsAvailable() and
// the Settings modal refresh button passes { force: true }.
let modelListCache = { at: 0, data: null }
const MODEL_LIST_TTL_MS = 5 * 60 * 1000

export async function getModelLists(base, { force = false } = {}) {
  if (!force && modelListCache.data && Date.now() - modelListCache.at < MODEL_LIST_TTL_MS) {
    return modelListCache.data
  }
  const targets = {
    unet: ['UNETLoader', 'unet_name'],
    clip: ['CLIPLoader', 'clip_name'],
    vae: ['VAELoader', 'vae_name'],
    lora: ['LoraLoaderModelOnly', 'lora_name'],
  }
  const entries = await Promise.all(
    Object.entries(targets).map(async ([key, [cls, field]]) => {
      try {
        const res = await fetch(`${base}/object_info/${cls}`)
        if (!res.ok) return [key, []]
        const data = await res.json()
        const list = data?.[cls]?.input?.required?.[field]?.[0]
        return [key, Array.isArray(list) ? list : []]
      } catch {
        return [key, []]
      }
    })
  )
  const data = Object.fromEntries(entries)
  modelListCache = { at: Date.now(), data }
  return data
}

// ---------------------------------------------------------------------------
// Preflight checks — fail with a readable message BEFORE a prompt is queued,
// instead of surfacing a cryptic server-side crash later.
// ---------------------------------------------------------------------------

// Does this diffusion-model filename look like a VIDEO model? Video runs
// fed an image model die inside the net with "too many values to unpack
// (expected 4)" (image models unpack B,C,H,W; video latents are B,C,T,H,W).
export function looksLikeVideoModel(name) {
  // minimax_h3 / hailuo: the MiniMax H3 video dit (e.g.
  // minimax_h3_fl2va_pruned_int8_convrot.safetensors) — kept in sync with
  // H3_VIDEO_RE in workflows.js (unit test asserts they agree).
  return /(^|[^a-z])(wan|hunyuan[-_ ]?video|cogvideo|ltx[-_ ]?v|mochi|svd|animatediff|t2v|i2v|v2v|vid2vid|video|minimax[-_ ]?h\d|hailuo)([^a-z]|$)/i.test(
    String(name || '')
  )
}

// Music models (a music unet fed image/video conditioning fails the same
// cryptic way). Matches MiniMax Music 3, YuE, ACE-Step, Stable Audio,
// DiffRhythm, MusicGen, InspireMusic, Suno/Udio-style dumps, …
export function looksLikeMusicModel(name) {
  return /(^|[^a-z])(minimax[-_ ]?music|music3|music[-_ ]?dit|yue[-_ ]?2?|ace[-_ ]?step|stable[-_ ]?audio|diff[-_ ]?rhythm|musicgen|stemma|inspire[-_ ]?music|music)([^a-z]|$)/i.test(
    String(name || '')
  )
}

function listModels(label, names) {
  return names.length > 0 ? `${label}: ${names.join(', ')}` : `${label}: none`
}

// Throws when the configured models for this mode aren't on the server.
// Returns silently when the server can't be interrogated (unreachable /
// empty lists) — ComfyUI's own rejection then remains the fallback.
export async function assertModelsAvailable(base, mode, models) {
  let lists
  try {
    lists = await getModelLists(base)
  } catch {
    return
  }
  if (!lists || lists.unet.length === 0) return

  const wants = (() => {
    if (mode === 'edit') {
      return [
        ['unet', models.edit?.unet, 'Edit model'],
        ['clip', models.image?.clip, 'Text encoder'],
        ['vae', models.image?.vae, 'VAE'],
      ]
    }
    if (mode === 'video') {
      return [
        ['unet', models.video?.unet, 'Video model'],
        ['clip', models.video?.clip, 'Video text encoder'],
        ['vae', models.video?.vae, 'Video VAE'],
      ]
    }
    if (mode === 'music') {
      // Fall back to the MiniMax Music 3 defaults when the store predates
      // the group (migrate fills them, this covers direct calls too).
      return [
        ['unet', models.music?.unet || 'minimax_music3_dit_int8_convrot.safetensors', 'Music model'],
        ['clip', models.music?.clip || 'minimax_music3_text_encoder_pruned_int8_convrot.safetensors', 'Music text encoder'],
        ['vae', models.music?.vae || 'minimax_music3_dav.safetensors', 'Music VAE'],
      ]
    }
    return [
      ['unet', models.image?.unet, 'Diffusion model'],
      ['clip', models.image?.clip, 'Text encoder'],
      ['vae', models.image?.vae, 'VAE'],
    ]
  })()

  const missing = wants
    .filter(([key, value]) => value && !lists[key].includes(value))
    .map(([key, value, label]) => `${label} "${value}" is not on the server (${listModels(key, lists[key])})`)

  if (mode === 'video') {
    const unet = String(models.video?.unet || '')
    const sameAsImage = unet && (unet === models.image?.unet || unet === models.edit?.unet)
    // MiniMax H3 decodes an audio-video latent — it needs BOTH H3 VAEs.
    if (/minimax[-_ ]?h\d|hailuo/i.test(unet) && !lists.vae.some((n) => /audio[-_ ]?vae/i.test(n))) {
      missing.push(
        `MiniMax H3 video needs an audio VAE on the server (minimax_h3_audio_vae_*.safetensors) — ` +
          `have: ${lists.vae.join(', ') || 'none'}.`
      )
    }
    if (unet && (sameAsImage || !looksLikeVideoModel(unet))) {
      missing.push(
        `"${unet}" is an image model — video needs a VIDEO diffusion model ` +
          `(Wan 2.1/2.2 t2v, Hunyuan-Video, CogVideoX, LTX-Video, …). ` +
          (lists.unet.some(looksLikeVideoModel)
            ? `Your server has: ${lists.unet.filter(looksLikeVideoModel).join(', ')} — pick it in Settings → Video Models.`
            : `Your ComfyUI has no video model installed — drop one into ComfyUI/models/unet/ and set it in Settings → Video Models.`)
      )
    }
  }

  if (mode === 'music') {
    const unet = String(models.music?.unet || 'minimax_music3_dit_int8_convrot.safetensors')
    if (!looksLikeMusicModel(unet)) {
      missing.push(
        `"${unet}" is not a music model — music needs a MUSIC diffusion model ` +
          `(MiniMax Music 3, YuE, ACE-Step, Stable Audio, …). ` +
          (lists.unet.some(looksLikeMusicModel)
            ? `Your server has: ${lists.unet.filter(looksLikeMusicModel).join(', ')} — pick it in Settings → Music Models.`
            : `Your ComfyUI has no music model installed — drop one into ComfyUI/models/unet/ and set it in Settings → Music Models.`)
      )
    }
  }

  if (missing.length > 0) {
    const what =
      mode === 'video'
        ? 'Video generation'
        : mode === 'edit'
          ? 'Image editing'
          : mode === 'music'
            ? 'Music generation'
            : 'Image generation'
    const fileIssues = missing.some((m) => m.includes('is not on the server'))
    let tail = fileIssues ? ' Fix them in Settings → Models.' : ''
    if (mode === 'video' && fileIssues && !missing.some((m) => m.includes('is an image model'))) {
      const vids = lists.unet.filter(looksLikeVideoModel)
      tail += vids.length
        ? ` ComfyUI supports video natively — install one of these video models or select an existing one in Settings → Models: ${vids.join(', ')}.`
        : ' ComfyUI supports video natively (Wan, Hunyuan-Video, CogVideoX, LTX-Video, …) — this server just has no video model installed yet; drop one into ComfyUI/models/unet/ and select it in Settings → Video Models.'
    }
    if (mode === 'music' && fileIssues && !missing.some((m) => m.includes('is not a music model'))) {
      const music = lists.unet.filter(looksLikeMusicModel)
      tail += music.length
        ? ` Your server has: ${music.join(', ')} — select it in Settings → Music Models.`
        : ' No music model found in ComfyUI/models/unet/ — install MiniMax Music 3 (dit + text encoder + dav VAE) or another music model, then set it in Settings → Music Models.'
    }
    throw new Error(`${what} can't run — ${missing.join(' ')}${tail}`)
  }
}

// Which node packs must be present for a feature, given class types.
// Returns { missing: [classType], unreachable: bool }.
export async function checkNodes(base, classTypes) {
  const missing = []
  let unreachable = false
  await Promise.all(
    classTypes.map(async (cls) => {
      try {
        const res = await fetch(`${base}/object_info/${cls}`)
        if (!res.ok) {
          missing.push(cls)
          return
        }
        const data = await res.json()
        if (!data?.[cls]) missing.push(cls)
      } catch {
        unreachable = true
      }
    })
  )
  return { missing: [...new Set(missing)], unreachable }
}

// Throwing variant: used by the 3D pipelines before queueing, so a missing
// node pack errors out with install instructions instead of a dead prompt.
export async function assertNodes(base, classTypes, { label = 'This feature', describe = (c) => c } = {}) {
  const { missing, unreachable } = await checkNodes(base, classTypes)
  if (unreachable) {
    throw new Error(`Could not reach ComfyUI to verify ${label} — check the server URL in Settings.`)
  }
  if (missing.length > 0) {
    throw new Error(
      `${label} needs node pack(s) that aren't installed on your ComfyUI server: ` +
        missing.map(describe).join('; ') +
        '. Install them in custom_nodes/ (then restart ComfyUI), or pick a different pipeline in Settings → 3D.'
    )
  }
}

// Verify every node class used by a built workflow exists on the server
// BEFORE queueing — a missing pack then reads as an install hint rather
// than ComfyUI's "value not in list" / node-does-not-exist rejection.
export async function assertWorkflowNodes(base, workflow, opts = {}) {
  const classes = [...new Set(Object.values(workflow || {}).map((n) => n?.class_type).filter(Boolean))]
  if (classes.length === 0) return
  await assertNodes(base, classes, opts)
}

export function connectWebSocket(serverUrl) {
  if (ws) {
    ws.close()
  }

  const scheme = serverUrl.startsWith('https') ? 'wss' : 'ws'
  const host = serverUrl.replace(/^https?:\/\//, '')
  ws = new WebSocket(`${scheme}://${host}/ws?clientId=${clientId}`)

  ws.onopen = () => {
    console.log('WebSocket connected')
  }

  ws.onmessage = (event) => {
    if (typeof event.data === 'string') {
      const message = JSON.parse(event.data)
      handleWsMessage(message)
    } else {
      // Binary preview frame - skip for now
    }
  }

  ws.onerror = (err) => {
    console.error('WebSocket error:', err)
  }

  ws.onclose = () => {
    console.log('WebSocket closed')
  }

  return ws
}

// Raw WS listeners — long-running flows (3D panel) watch their own prompt
// by filtering execution/progress messages on prompt_id, without taking the
// image/video callbacks over.
const executionListeners = new Set()
export function addExecutionListener(fn) {
  executionListeners.add(fn)
  return () => executionListeners.delete(fn)
}

// exported for tests — the live socket feeds this in handleWsMessage
export function handleWsMessage(message) {
  const { type, data } = message

  for (const fn of executionListeners) {
    try {
      fn(message)
    } catch {
      // a broken listener must not break the socket
    }
  }

  switch (type) {
    case 'progress':
      if (progressCallback) {
        progressCallback({
          value: data.value,
          max: data.max,
          step: data.value,
          total: data.max,
          promptId: data.prompt_id,
        })
      }
      break

    case 'executing':
      if (data.node === null && data.prompt_id) {
        if (phaseCallback) phaseCallback(null, data.prompt_id)
        promptNodes.delete(data.prompt_id)
        if (completionCallback) {
          completionCallback(data.prompt_id)
        }
      } else if (data.node && data.prompt_id) {
        // Friendly phase for the node that just started (only for the most
        // recently queued prompt — older queue entries aren't ours to show).
        if (phaseCallback && data.prompt_id === latestPromptId) {
          const cls = promptNodes.get(data.prompt_id)?.[data.node]
          phaseCallback(friendlyNodeLabel(cls), data.prompt_id)
        }
      }
      break

    case 'execution_error':
      console.error('Execution error:', data)
      if (phaseCallback) phaseCallback(null, data.prompt_id)
      if (completionCallback) {
        completionCallback(null, data)
      }
      break

    case 'execution_interrupted':
      // User pressed Stop (or the server aborted us) — settle like a normal
      // completion so the UI doesn't sit on "Generating…" forever.
      console.log('Execution interrupted:', data)
      if (!data?.prompt_id) break
      if (phaseCallback) phaseCallback(null, data.prompt_id)
      promptNodes.delete(data.prompt_id)
      if (completionCallback) completionCallback(data.prompt_id)
      break

    case 'status':
      if (data.status?.exec_info) {
        // Queue update
      }
      break
  }
}

export function disconnectWebSocket() {
  if (ws) {
    ws.close()
    ws = null
  }
}

// ---------------------------------------------------------------------------
// 3D pipeline helpers
// ---------------------------------------------------------------------------

// Combo options for one field of one node, straight from /object_info.
// Handles both spec shapes: [optionsArray, config] and [type, {options}].
export async function getNodeComboOptions(base, classType, field, kind = 'required') {
  try {
    const res = await fetch(`${base}/object_info/${classType}`)
    if (!res.ok) return []
    const data = await res.json()
    const spec = data?.[classType]?.input?.[kind]?.[field]
    if (!spec) return []
    if (Array.isArray(spec[0])) return spec[0]
    if (Array.isArray(spec[1]?.options)) return spec[1].options
    return []
  } catch {
    return []
  }
}

// Pull every downloadable file out of a finished history entry.
// ComfyUI output shapes vary by node: {filename,subfolder,type} objects,
// full Windows/Unix paths in `text` (Pixal3DExportGLB), or bare filenames.
export function collectOutputFiles(entry) {
  const out = []
  const seen = new Set()

  const push = (filename, subfolder, type, key) => {
    filename = String(filename).replace(/\\/g, '/').split('/').pop()
    subfolder = String(subfolder || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    type = type === 'input' || type === 'temp' ? type : 'output'
    const id = `${type}/${subfolder}/${filename}`
    if (!filename || seen.has(id)) return
    seen.add(id)
    out.push({ filename, subfolder, type, key: key || '' })
  }

  const visit = (value, key) => {
    if (value == null) return
    if (typeof value === 'string') {
      if (!/\.(glb|fbx|obj|gltf|bin|usdz|abc|png|jpg|jpeg|webp|mp4|webm|gif|zip)$/i.test(value)) return
      const parts = value.replace(/\\/g, '/').split('/').filter(Boolean)
      const dirIdx = parts.findIndex((p) => p === 'output' || p === 'input' || p === 'temp')
      if (dirIdx >= 0) {
        push(parts[parts.length - 1], parts.slice(dirIdx + 1, -1).join('/'), parts[dirIdx], key)
      } else {
        push(parts[parts.length - 1], parts.slice(0, -1).join('/'), 'output', key)
      }
      return
    }
    if (Array.isArray(value)) {
      value.forEach((v) => visit(v, key))
      return
    }
    if (typeof value === 'object') {
      if (typeof value.filename === 'string') {
        push(value.filename, value.subfolder, value.type, key)
        return
      }
      if (typeof value.name === 'string' && (value.path || value.url)) {
        push(value.name, value.subfolder || '', value.type, key)
        return
      }
      Object.entries(value).forEach(([k, v]) => visit(v, k))
    }
  }

  Object.values(entry?.outputs || {}).forEach((nodeOut) => {
    Object.entries(nodeOut || {}).forEach(([k, v]) => visit(v, k))
  })
  return out
}

// Human-readable failure text from a failed history entry, if any.
// Only reads structured error messages (execution_error entries) — other
// status messages are objects without an exception and used to stringify to
// "[object Object]" in the banner.
export function extractHistoryError(entry) {
  const status = entry?.status
  if (!status) return null
  const failed = status.status_str === 'error' || status.completed === false || status.status_str === 'interrupted'
  if (!failed) return null
  // A stop request isn't a failure — say so in plain words.
  const wasInterrupted =
    status.status_str === 'interrupted' ||
    (status.messages || []).some((m) => Array.isArray(m) && m[0] === 'execution_interrupted') ||
    (status.messages || []).some((m) => Array.isArray(m) && /interrupt/i.test(String(m[1]?.exception_message || '')))
  if (wasInterrupted) return 'Generation stopped.'
  const details = []
  for (const msg of status.messages || []) {
    if (!Array.isArray(msg) || !msg[1] || typeof msg[1] !== 'object') continue
    const data = msg[1]
    if (data.exception_message) {
      const where = data.node_type ? ` (node ${data.node_id ?? '?'}: ${data.node_type})` : ''
      details.push(`${String(data.exception_message).trim()}${where}`)
    } else if (data.error || data.message) {
      details.push(String(data.error || data.message).trim().slice(0, 500))
    }
  }
  return details.length > 0 ? details.join(' | ') : 'workflow failed (no detail in ComfyUI history)'
}

// Stop the running job; if our prompt is still waiting in the queue it can
// never be interrupted (nothing is running for it), so clear the pending
// queue too — this UI only ever has one job of its own in flight.
export async function stopGeneration(serverUrl, promptId = null) {
  try {
    const r = await fetch(`${serverUrl}/interrupt`, { method: 'POST' })
    if (!r.ok) return false
  } catch {
    return false
  }
  if (promptId) {
    try {
      const q = await (await fetch(`${serverUrl}/queue`)).json()
      const pending = (q.queue_pending || []).some((r) => r[1] === promptId)
      if (pending) {
        await fetch(`${serverUrl}/queue`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ clear: true }),
        })
      }
    } catch {
      // queue state unavailable — interrupt alone is the best we can do
    }
  }
  return true
}

// Wait until a queued prompt finishes. Resolves with the history entry,
// rejects on execution error or timeout.
//
//   onTick(secondsElapsed, info) — info = { phase, queuePos, nodeLabel, progress }
//   nodes  — { nodeId: humanLabel } so WS "executing" messages can show
//            which step the server is on (built from the workflow object)
//   label  — job name used in timeout/error messages ("Pixal3D", "MIA rig")
//
// Progress sources: HTTP /queue every tick (queue position vs running) and
// the shared ComfyUI websocket (current executing node + step counts).
export function pollHistory(base, promptId, { timeoutMs = 600000, intervalMs = 3000, onTick, nodes = null, label = 'ComfyUI job' } = {}) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    let settled = false
    let timer = null
    let phase = null // 'queued' | 'running' | null (unknown/history lag)
    let queuePos = null
    let nodeLabel = ''
    let progress = null
    let everQueued = false // seen in /queue at least once
    let goneTicks = 0 // consecutive ticks not in queue and no history

    const info = () => ({ phase, queuePos, nodeLabel, progress })

    const offListener = addExecutionListener((msg) => {
      const { type, data } = msg
      if (!data || data.prompt_id !== promptId) return
      if (type === 'executing' && data.node) {
        phase = 'running'
        nodeLabel = (nodes && nodes[data.node]) || data.node
        progress = null
      } else if (type === 'progress') {
        if (data.max > 1) progress = { value: data.value, max: data.max }
      } else if (type === 'execution_error') {
        const m = data.exception_message || data.message || `${label} failed on node ${data.node_id || '?'}`
        finish(reject, new Error(String(m).slice(0, 600)))
      } else if (type === 'execution_interrupted') {
        finish(reject, new Error('Generation stopped.'))
      }
    })

    const finish = (fn, arg) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      offListener()
      fn(arg)
    }

    const tick = async () => {
      if (settled) return
      if (Date.now() - start > timeoutMs) {
        const mins = Math.round(timeoutMs / 60000)
        finish(
          reject,
          new Error(
            `timed out after ${mins} min waiting for ${label}` +
              (nodeLabel ? ` (last step: ${nodeLabel})` : '') +
              ' — the job may still be running on the server; check the ComfyUI queue and try again'
          )
        )
        return
      }
      let entry = null
      try {
        const res = await fetch(`${base}/history/${promptId}`)
        const data = await res.json()
        entry = data?.[promptId]
        if (entry) {
          const st = entry.status || {}
          if (st.status_str === 'success' || (st.completed === true && st.status_str !== 'error')) {
            finish(resolve, entry)
            return
          }
          if (st.status_str === 'error') {
            finish(reject, new Error(extractHistoryError(entry) || 'workflow failed'))
            return
          }
        }
      } catch {
        // transient network hiccup — keep polling until the timeout
      }
      // Queue position vs running — cheap, and gives useful status even
      // when the websocket is disconnected (headless / remote browsers).
      try {
        const q = await (await fetch(`${base}/queue`)).json()
        const running = (q.queue_running || []).some((r) => r[1] === promptId)
        const pendingIdx = (q.queue_pending || []).findIndex((r) => r[1] === promptId)
        if (running) {
          phase = 'running'
          queuePos = null
          everQueued = true
          goneTicks = 0
        } else if (pendingIdx >= 0) {
          phase = 'queued'
          queuePos = pendingIdx + 1
          everQueued = true
          goneTicks = 0
        } else if (everQueued && !entry) {
          // Was queued, now gone from the queue with no history entry —
          // it was cleared before it ever ran (stop on a pending prompt).
          goneTicks += 1
          if (goneTicks >= 3) {
            finish(reject, new Error('Generation stopped.'))
            return
          }
        }
      } catch {
        // /queue unavailable — keep the last known phase
      }
      onTick?.(Math.round((Date.now() - start) / 1000), info())
      timer = setTimeout(tick, intervalMs)
    }

    tick()
  })
}

// Refuse to treat an HTML error page (e.g. an SPA fallback) as a mesh —
// that would silently upload garbage that only fails much later.
export async function assertMeshBytes(blob, filename) {
  if (/\.glb$/i.test(filename)) {
    const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer())
    const magic = String.fromCharCode(head[0], head[1], head[2], head[3])
    if (magic !== 'glTF') {
      throw new Error(
        `"${filename}" isn't a GLB file (got ${blob.size} bytes starting with ${JSON.stringify(magic)}) — ` +
          `the download probably returned an error page instead of the mesh`
      )
    }
  } else if (/\.fbx$/i.test(filename)) {
    const head = new Uint8Array(await blob.slice(0, 20).arrayBuffer())
    let magic = ''
    for (const b of head) magic += String.fromCharCode(b)
    if (!magic.startsWith('Kaydara')) {
      throw new Error(`"${filename}" isn't an FBX file (got ${blob.size} bytes) — refusing to upload it`)
    }
  }
}

// Upload a mesh file into ComfyUI's input/3d/ so UniRigLoadMesh can load it.
// Returns the stored filename (name returned by the server).
export async function uploadMeshFile(base, filename, blob) {
  await assertMeshBytes(blob, filename)
  const form = new FormData()
  form.append('image', blob, filename)
  form.append('subfolder', '3d')
  form.append('type', 'input')
  form.append('overwrite', 'true')
  let res
  try {
    res = await fetch(`${base}/upload/image`, { method: 'POST', body: form })
  } catch (err) {
    throw new Error(`could not upload mesh (${err.message})`)
  }
  if (!res.ok) throw new Error(`mesh upload failed (HTTP ${res.status})`)
  const data = await res.json()
  if (!data.name) throw new Error('ComfyUI did not accept the mesh upload')
  return data.name
}

// Drop every model ComfyUI holds on the GPU (weights → CPU, cache evicted).
// Callers use this so the NEXT queued run starts with an empty VRAM budget:
// leftover models from another pipeline (e.g. WanVAE after an image run
// still resident when a 300s music job starts) are a common OOM cause.
// Best effort — VRAM state must never fail a run. Resolves true when the
// server accepted the free request.
export async function freeLoadedModels(serverUrl) {
  try {
    const res = await fetch(`${serverUrl}/free`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
      signal: AbortSignal.timeout(8000),
    })
    return res.ok
  } catch {
    /* best effort */
    return false
  }
}

// Save a Blob as a browser download.
export function saveBlobAs(blob, saveName) {
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = saveName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 30000)
}

// Trigger a browser download of a ComfyUI output/input file.
export async function downloadFileAs(url, saveName) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`)
  saveBlobAs(await res.blob(), saveName)
}
