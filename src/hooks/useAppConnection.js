import { useEffect, useRef } from 'react'
import useStore from '../store/useStore'
import {
  checkConnection,
  getQueueStatus,
  getSystemStats,
  connectWebSocket,
  disconnectWebSocket,
  resolveApiBase,
  addExecutionListener,
} from '../lib/comfyui'
import { syncServerHistory } from './useComfyUI'
import { setLoadedFamily } from '../lib/modelFamily'

const STORAGE_KEY = 'comfyui-studio-storage'

// Above ComfyUI's ~1.3 GB release baseline; real models are far larger.
const RESIDENT_VRAM_BYTES = 2 * 1024 ** 3

// App-lifetime services: connection health, the shared WebSocket, the
// server-history refresh, and the idle model-unload timer.
//
// These used to live in useComfyUI, which is only mounted by GenerateButton
// — and Layout unmounts GenerateButton entirely on the 3D tab. A browser
// opened or reloaded on the 3D page therefore never polled /system_stats:
// its badge sat on the initial `connected: false` forever while every other
// request (uploads, object_info, queue) worked fine through the proxy.
// Mounted once from App so every page keeps the connection loop alive.
export function useAppConnection() {
  const serverUrl = useStore((s) => s.serverUrl)
  const useProxy = useStore((s) => s.useProxy)
  const apiBase = resolveApiBase(serverUrl, useProxy)
  const wasConnectedRef = useRef(false)
  const lastSyncRef = useRef(0)
  const liveSyncTimerRef = useRef(null)

  // Live shared history — every browser/window holds its own websocket to
  // ComfyUI, so a job finishing anywhere fires `executing{node:null}` in
  // every session: refresh the shared server history right away instead of
  // waiting for the polling throttle. Debounced so a queue draining in a
  // burst costs one GET /history, not one per prompt.
  useEffect(() => {
    const off = addExecutionListener((msg) => {
      // Any execution traffic means ComfyUI has a model resident/loading.
      // Refresh the activity stamp so the 5-minute idle timer starts from
      // the real last use, including jobs queued by the API or another tab.
      const active =
        msg?.type === 'execution_start' ||
        msg?.type === 'execution_cached' ||
        msg?.type === 'executing' ||
        msg?.type === 'progress'
      if (active) {
        const s = useStore.getState()
        s.setLastGenAt(Date.now())
        if (s.modelsUnloaded) s.setModelsUnloaded(false)
      }
      const finished =
        (msg?.type === 'executing' && msg.data?.node === null && !!msg.data?.prompt_id) ||
        msg?.type === 'execution_error'
      if (!finished || liveSyncTimerRef.current) return
      liveSyncTimerRef.current = setTimeout(() => {
        liveSyncTimerRef.current = null
        lastSyncRef.current = Date.now()
        syncServerHistory()
      }, 1200)
    })
    return () => {
      off()
      if (liveSyncTimerRef.current) {
        clearTimeout(liveSyncTimerRef.current)
        liveSyncTimerRef.current = null
      }
    }
  }, [])

  // Same-browser, other tabs: localStorage is shared but each tab loads its
  // snapshot once — a `storage` event in another tab rehydrates the store so
  // deletes / new entries / setting changes land instantly without reload.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key && e.key !== STORAGE_KEY) return
      try {
        useStore.persist.rehydrate()
      } catch {
        /* stale or foreign payload — keep current state */
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Check connection on mount and periodically
  useEffect(() => {
    let cancelled = false
    const check = async () => {
      const ok = await checkConnection(apiBase)
      if (cancelled) return
      useStore.getState().setConnected(ok)
      if (ok) {
        connectWebSocket(apiBase)
        // Keep the top-bar queue badge current even when the queue panel is
        // closed (jobs can be queued from the API or another browser).
        const queued = await getQueueStatus(apiBase)
        useStore.getState().setQueueRemaining(queued)
        if (queued > 0) {
          // A remote job keeps the models alive; don't let the idle timer
          // unload them while ComfyUI is still working through the queue.
          useStore.getState().setLastGenAt(Date.now())
          useStore.getState().setModelsUnloaded(false)
        } else if (!useStore.getState().generating) {
          // Reconcile the badge with VRAM on every connection tick, even
          // when auto-unload is off. The API watchdog (or another browser)
          // can free weights without this tab knowing; without this the
          // "models loaded" chip lingered until a reload.
          const stats = await getSystemStats(apiBase)
          if (stats && stats.vramTotal > 0) {
            const used = Math.max(0, stats.vramTotal - stats.vramFree)
            const resident = used > RESIDENT_VRAM_BYTES
            const st = useStore.getState()
            st.setModelsUnloaded(!resident)
            if (resident && !st.lastGenAt) st.setLastGenAt(Date.now())
          }
        }
        // Shared deletes: pull the hidden-ids list every tick (tiny GET) so
        // history removed on another browser/device disappears here too,
        // even when no new generations are happening. The Studio API
        // service is optional — offline just keeps deletes local.
        try {
          const h = await fetch('/api/hidden-ids')
          if (h.ok) {
            const data = await h.json()
            useStore.getState().mergeHiddenIds(data?.ids || [])
          }
        } catch {
          /* API service not running — nothing to merge */
        }
        // Load/refresh the shared server-side history: on first contact
        // and then every ~20s while connected, so generations made from
        // other machines show up without a reload (the websocket listener
        // above covers the instant case).
        const now = Date.now()
        if (!wasConnectedRef.current || now - lastSyncRef.current > 20000) {
          lastSyncRef.current = now
          syncServerHistory()
        }
        wasConnectedRef.current = true
      } else {
        wasConnectedRef.current = false
      }
    }
    check()
    const interval = setInterval(check, 10000)
    return () => {
      cancelled = true
      clearInterval(interval)
      disconnectWebSocket()
    }
  }, [apiBase])

  // Auto-unload ComfyUI models after 5 minutes of no activity:
  // POST /free with { unload_models: true } drops model weights from
  // VRAM/RAM (the next generation reloads them). Activity includes local
  // renders, jobs from the API/another browser, and websocket execution
  // traffic tracked above.
  //
  // The stored flag can go stale: another browser or the REST API may load
  // models after this tab unloaded, or unload them while this tab still
  // thinks it owns the weights. VRAM is the source of truth, so reconcile
  // the flag before deciding — a stale `modelsUnloaded` used to make this
  // timer skip forever (and hide the manual unload button).
  useEffect(() => {
    const IDLE_MS = 5 * 60 * 1000
    const interval = setInterval(async () => {
      const s = useStore.getState()
      if (!s.autoUnload || !s.connected) return
      const base = resolveApiBase(s.serverUrl, s.useProxy)
      const stats = await getSystemStats(base)
      if (!stats || !stats.vramTotal) return
      const vramUsed = Math.max(0, stats.vramTotal - stats.vramFree)
      const resident = vramUsed > RESIDENT_VRAM_BYTES

      if (!resident) {
        // Models are already gone (server-side unloader, ComfyUI restart,
        // or a failed run) — trust VRAM over the in-memory flag.
        if (!s.modelsUnloaded) s.setModelsUnloaded(true)
        return
      }
      if (s.modelsUnloaded) {
        // Flag says unloaded but weights are resident: re-arm the countdown
        // instead of skipping unloading forever.
        s.setModelsUnloaded(false)
        s.setLastGenAt(Date.now())
        return
      }
      if (s.generating || s.queueRemaining > 0) {
        s.setLastGenAt(Date.now())
        return
      }
      // First connection with pre-loaded models: start the countdown now
      // rather than never unloading (lastGenAt is 0 on a fresh page).
      if (!s.lastGenAt) {
        s.setLastGenAt(Date.now())
        return
      }
      if (Date.now() - s.lastGenAt < IDLE_MS) return
      try {
        const res = await fetch(`${base}/free`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ unload_models: true, free_memory: false }),
        })
        if (res.ok) {
          setLoadedFamily('')
          s.setModelsUnloaded(true)
        }
        // Non-OK: leave modelsUnloaded false and retry next tick
      } catch {
        // Server unreachable — retry next tick
      }
    }, 30000)
    return () => clearInterval(interval)
  }, [])
}
