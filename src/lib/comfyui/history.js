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
// Sonilo / Comfy Cloud / ACE-Step). Used for server-synced history entries
// whose outputs are audio files instead of images.
export function musicTextFromGraph(graph) {
  let caption = ''
  let lyrics = ''
  const consider = (c, l) => {
    if (typeof c === 'string' && c && !caption) caption = c
    if (typeof l === 'string' && l && !lyrics) lyrics = l
  }
  for (const node of Object.values(graph || {})) {
    const t = node?.class_type
    if (t === 'MiniMaxMusic3TextEncode') {
      consider(node.inputs?.caption, node.inputs?.lyrics)
    } else if (t === 'TextEncodeAceStepAudio1.5') {
      // ACE carries the style/genre text in `tags`, not `caption`/`text`.
      consider(node.inputs?.tags, node.inputs?.lyrics)
    } else if (t === 'YuE2GenerateMusic' || t === 'YuE2GenerateABC') {
      consider(node.inputs?.style, node.inputs?.lyrics)
    } else if (t === 'SoniloTextToMusic') {
      consider(node.inputs?.prompt, '')
    } else if (t === 'ComfyCloudMiniMaxMusic3TextToAudioNode') {
      consider(node.inputs?.prompt, node.inputs?.lyrics)
    } else if (t === 'ConditioningStableAudio') {
      // Stable Audio 3: the prompt is a plain CLIPTextEncode feeding the
      // node's `positive` input (the `negative` one is the ban list).
      const ref = node.inputs?.positive
      const pos = Array.isArray(ref) ? graph[ref[0]] : null
      if (pos?.class_type === 'CLIPTextEncode') consider(pos.inputs?.text, '')
    }
  }
  return { caption, lyrics }
}

// Read the whole server-side history into the app's history shape, so
// every machine browsing the same ComfyUI sees the same generations
// (images live on the server — /view serves them to any browser).
// Returns newest-first entries: { id, type, prompt, data, timestamp }.
export async function getServerHistory(serverUrl, maxcount = 60) {
  // `max_items` is the live ComfyUI param (newest N); `maxcount` kept for
  // older servers that used it — both are harmless when ignored.
  const res = await fetch(`${serverUrl}/history?max_items=${maxcount}&maxcount=${maxcount}`)
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

    // Audio from a Stable Audio graph is SFX (its own mode); other audio is
    // music. ComfyUI files both under the same `audio` output bucket.
    const isSfx =
      kind === 'music' &&
      Object.values(graph).some((n) => n?.class_type === 'ConditioningStableAudio')

    // Sprite frames are written under the `sprite/` output subfolder.
    const isSprite = kind === 'image' && String(file.subfolder || '').startsWith('sprite')

    const tsMsg = (item.status?.messages || []).find(
      (m) => m[0] === 'execution_success' || m[0] === 'execution_start'
    )

    const entry = {
      id: promptId,
      type: kind === 'video' ? 'video' : kind === 'music' ? (isSfx ? 'sfx' : 'music') : isSprite ? 'sprite' : isEdit ? 'edit' : 'image',
      prompt: positiveTextFromGraph(graph),
      data: await getViewUrl(serverUrl, file.filename, file.subfolder || '', file.type || 'output'),
      // File params on their own: history is shared across origins
      // (http://host:5555 vs https://host), and each browser rebuilds the
      // output URL against its own origin/proxy from these.
      view: { filename: file.filename, subfolder: file.subfolder || '', type: file.type || 'output' },
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

// Parse a /view URL back into its file params. Works for any origin or
// proxy prefix (`…/proxy/host/port/view?…`, `http://comfy:8188/view?…`);
// returns null for anything that isn't a /view URL (blob:, data:, …).
export function viewFromUrl(url) {
  if (typeof url !== 'string' || !url) return null
  try {
    const u = new URL(url, 'http://local.invalid')
    if (!u.pathname.endsWith('/view')) return null
    const filename = u.searchParams.get('filename')
    if (!filename) return null
    return {
      filename,
      subfolder: u.searchParams.get('subfolder') || '',
      type: u.searchParams.get('type') || 'output',
    }
  } catch {
    return null
  }
}

// Rebuild a history entry's output URL against THIS origin's API base.
// Shared history entries carry URLs minted by the origin that recorded
// them (or the API's direct ComfyUI URLs) — on another origin those are
// dead links, and on https they're blocked as mixed content. Entries
// store their `view` params so every browser can re-mint a working URL.
export function rebuildViewUrl(entry, apiBase) {
  const view = entry?.view || viewFromUrl(entry?.data)
  if (!view || !apiBase) return entry?.data
  const params = new URLSearchParams({
    filename: view.filename,
    subfolder: view.subfolder || '',
    type: view.type || 'output',
  })
  return `${String(apiBase).replace(/\/+$/, '')}/view?${params.toString()}`
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
