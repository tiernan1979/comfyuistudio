let ws = null
let progressCallback = null
let completionCallback = null

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
  return data.prompt_id
}

export async function getHistory(serverUrl, promptId) {
  const res = await fetch(`${serverUrl}/history/${promptId}`)
  return await res.json()
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
export async function getModelLists(base) {
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
  return Object.fromEntries(entries)
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

function handleWsMessage(message) {
  const { type, data } = message

  switch (type) {
    case 'progress':
      if (progressCallback) {
        progressCallback({
          value: data.value,
          max: data.max,
          step: data.value,
          total: data.max,
        })
      }
      break

    case 'executing':
      if (data.node === null && data.prompt_id) {
        if (completionCallback) {
          completionCallback(data.prompt_id)
        }
      }
      break

    case 'execution_error':
      console.error('Execution error:', data)
      if (completionCallback) {
        completionCallback(null, data)
      }
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
