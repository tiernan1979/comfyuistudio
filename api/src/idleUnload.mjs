// Server-side idle unloader.
//
// The browser timer only runs while a Studio tab is open and its machine is
// awake — close the tab and the last pipeline's weights sit in VRAM until
// ComfyUI restarts. The API runs whenever the stack does, so it owns the
// authoritative 5-minute idle check: no queue and no new history for five
// minutes means nothing needs the resident models, so POST /free.
//
// Activity is tracked from the queue plus ComfyUI's newest history entry, so
// jobs started by a browser, another API client or a script all count. The
// check is off when the shared config sets `autoUnload: false`.

import { loadRuntimeConfig } from './lib.mjs'
import { freeLoadedModels } from '../../src/lib/comfyui.js'

export const IDLE_UNLOAD_MS = 5 * 60 * 1000
// ComfyUI's own CUDA context/allocator sits around 1.3 GB even with every
// model released, so use a threshold above that baseline. Anything near a
// usable diffusion/video model is far larger.
const MIN_RESIDENT_BYTES = 2 * 1024 ** 3

// Pure decision helper (unit-tested without timers or a server).
export function idleUnloadDue({
  autoUnload,
  busy,
  vramUsed,
  idleForMs,
  idleMs = IDLE_UNLOAD_MS,
}) {
  if (!autoUnload || busy) return false
  if (!Number.isFinite(vramUsed) || vramUsed < MIN_RESIDENT_BYTES) return false
  return idleForMs >= idleMs
}

// ComfyUI reports the device fields nested under devices[0], not at the top
// level; parsing the wrong shape made the first watchdog version a no-op.
export function vramUsedFromStats(stats) {
  const device = stats?.devices?.[0] || {}
  const total = Number(device.vram_total) || 0
  const free = Number(device.vram_free) || 0
  return Math.max(0, total - free)
}

async function getJson(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

// Start the watchdog. Returns a stop function (used by tests); in the API
// process it runs for the life of the server.
export function startIdleUnload({
  comfyuiUrl,
  configPath = process.env.CONFIG_PATH || '/configdir/config.json',
  idleMs = IDLE_UNLOAD_MS,
  pollMs = 15000,
  log = console,
} = {}) {
  const base = (comfyuiUrl || '').replace(/\/+$/, '')
  let lastActivity = Date.now()
  let lastHistoryId = null
  let running = false
  let stopped = false

  const tick = async () => {
    if (stopped || running) return
    running = true
    try {
      const [queue, history, stats, config] = await Promise.all([
        getJson(`${base}/queue`),
        getJson(`${base}/history?max_items=1`),
        getJson(`${base}/system_stats`),
        loadRuntimeConfig(configPath),
      ])
      if (stopped) return

      const now = Date.now()
      const runningCount = Array.isArray(queue?.queue_running) ? queue.queue_running.length : 0
      const pendingCount = Array.isArray(queue?.queue_pending) ? queue.queue_pending.length : 0
      const busy = runningCount + pendingCount > 0
      if (busy) lastActivity = now

      // A new history key means a job finished since the last poll. Ignore
      // the key present at startup: it may predate this process.
      const historyId =
        history && typeof history === 'object' ? Object.keys(history)[0] || '' : ''
      if (lastHistoryId === null) lastHistoryId = historyId
      else if (historyId && historyId !== lastHistoryId) {
        lastHistoryId = historyId
        lastActivity = now
      }

      const vramUsed = vramUsedFromStats(stats)
      if (
        idleUnloadDue({
          autoUnload: config?.autoUnload !== false,
          busy,
          vramUsed,
          idleForMs: now - lastActivity,
          idleMs,
        })
      ) {
        const freed = await freeLoadedModels(base)
        if (freed) {
          lastActivity = Date.now()
          log.log?.(`[idle-unload] freed models after ${Math.round(idleMs / 60000)} min idle`)
        }
      }
    } finally {
      running = false
    }
  }

  const timer = setInterval(tick, pollMs)
  tick()
  return () => {
    stopped = true
    clearInterval(timer)
  }
}
