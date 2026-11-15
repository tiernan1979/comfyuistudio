import { getClientId, state } from './state.js'
import { setLoadedFamily } from '../modelFamily.js'
import { describeQueuePrompt } from './queueLabel.js'

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
  state.progressCallback = cb
}

export function setPhaseCallback(cb) {
  state.phaseCallback = cb
}

export function setCompletionCallback(cb) {
  state.completionCallback = cb
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

// Full queue snapshot for the queue manager. ComfyUI returns entries as
// [number, prompt_id, prompt, extra_data, outputs_to_execute]; only the
// fields the UI needs are kept, and malformed entries are skipped so a
// single bad row can't blank the panel.
export async function getQueue(serverUrl) {
  let res
  try {
    res = await fetch(`${serverUrl}/queue`)
  } catch (err) {
    throw new Error(`Could not reach ComfyUI (${err.message})`)
  }
  if (!res.ok) throw new Error(`Queue request failed (HTTP ${res.status})`)
  const data = await res.json()
  const map = (rows) =>
    (Array.isArray(rows) ? rows : [])
      .map((row) => {
        if (!Array.isArray(row)) return null
        const [number, promptId, graph] = row
        if (!promptId) return null
        const { label, snippet, text } = describeQueuePrompt(graph)
        return { number, promptId, label, snippet, text }
      })
      .filter(Boolean)
  const running = map(data.queue_running)
  const pending = map(data.queue_pending)
  return { running, pending, total: running.length + pending.length }
}

// Remove pending jobs by prompt id. ComfyUI's DELETE /queue takes
// { delete: [id] } (ids, not queue numbers). Running jobs are not
// cancellable this way — callers use stopGeneration for those.
export async function deleteQueuedPrompts(serverUrl, promptIds) {
  const ids = (promptIds || []).filter(Boolean).map(String)
  if (!ids.length) return true
  let res
  try {
    res = await fetch(`${serverUrl}/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delete: ids }),
    })
  } catch (err) {
    throw new Error(`Could not reach ComfyUI (${err.message})`)
  }
  if (!res.ok) throw new Error(`Could not remove queued job (HTTP ${res.status})`)
  return true
}

export async function queuePrompt(serverUrl, workflow) {
  const payload = {
    prompt: workflow,
    client_id: getClientId(),
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
    state.promptNodes.set(
      data.prompt_id,
      Object.fromEntries(
        Object.entries(workflow || {}).map(([id, n]) => [id, n?.class_type || null])
      )
    )
    state.latestPromptId = data.prompt_id
    while (state.promptNodes.size > 8) state.promptNodes.delete(state.promptNodes.keys().next().value)
  } catch {
    /* labeling is best-effort */
  }
  return data.prompt_id
}

// Stop our job only. ComfyUI's /interrupt kills whatever is executing, so
// check the queue first: a pending prompt is removed by id (never with
// {clear:true}, which would wipe jobs queued by the API or another browser),
// and /interrupt is only sent when OUR prompt is the running one.
export async function stopGeneration(serverUrl, promptId = null) {
  if (!promptId) {
    try {
      const r = await fetch(`${serverUrl}/interrupt`, { method: 'POST' })
      return r.ok
    } catch {
      return false
    }
  }
  let queue
  try {
    const res = await fetch(`${serverUrl}/queue`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return false
    queue = await res.json()
  } catch {
    return false
  }
  const running = (queue.queue_running || []).some((row) => row?.[1] === promptId)
  const pending = (queue.queue_pending || []).some((row) => row?.[1] === promptId)
  if (pending) {
    try {
      const r = await fetch(`${serverUrl}/queue`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ delete: [promptId] }),
      })
      return r.ok
    } catch {
      return false
    }
  }
  if (!running) return false
  try {
    const r = await fetch(`${serverUrl}/interrupt`, { method: 'POST' })
    return r.ok
  } catch {
    return false
  }
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
    if (res.ok) setLoadedFamily('')
    return res.ok
  } catch {
    /* best effort */
    return false
  }
}

// Drop cached allocations (intermediates, prompt caches) without evicting
// loaded weights. Used when the same model family needs a little headroom.
export async function freeCachedMemory(serverUrl) {
  try {
    const res = await fetch(`${serverUrl}/free`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unload_models: false, free_memory: true }),
      signal: AbortSignal.timeout(8000),
    })
    return res.ok
  } catch {
    /* best effort */
    return false
  }
}

// GPU memory snapshot (bytes). Returns null when /system_stats is missing or
// the server is unreachable — callers must treat that as "unknown", not "full".
export async function getSystemStats(serverUrl) {
  try {
    const res = await fetch(`${serverUrl}/system_stats`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    const data = await res.json()
    const device = data?.devices?.[0] || {}
    return {
      vramTotal: Number(device.vram_total) || 0,
      vramFree: Number(device.vram_free) || 0,
      ramTotal: Number(data?.system?.ram_total) || 0,
      ramFree: Number(data?.system?.ram_free) || 0,
    }
  } catch {
    return null
  }
}
