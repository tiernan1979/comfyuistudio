import { useEffect, useRef } from 'react'
import useStore from '../store/useStore'
import {
  checkConnection,
  connectWebSocket,
  disconnectWebSocket,
  resolveApiBase,
  addExecutionListener,
} from '../lib/comfyui'
import { syncServerHistory } from './useComfyUI'

const STORAGE_KEY = 'comfyui-studio-storage'

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

  // Auto-unload ComfyUI models after 5 minutes without generating:
  // POST /free with { unload_models: true } drops model weights from
  // VRAM/RAM (the next generation reloads them).
  useEffect(() => {
    const IDLE_MS = 5 * 60 * 1000
    const interval = setInterval(async () => {
      const s = useStore.getState()
      if (!s.autoUnload || !s.connected || s.generating) return
      if (s.modelsUnloaded || !s.lastGenAt) return
      if (Date.now() - s.lastGenAt < IDLE_MS) return
      try {
        const base = resolveApiBase(s.serverUrl, s.useProxy)
        const res = await fetch(`${base}/free`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ unload_models: true, free_memory: false }),
        })
        if (res.ok) {
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
