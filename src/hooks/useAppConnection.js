import { useEffect, useRef } from 'react'
import useStore from '../store/useStore'
import {
  checkConnection,
  connectWebSocket,
  disconnectWebSocket,
  resolveApiBase,
} from '../lib/comfyui'
import { syncServerHistory } from './useComfyUI'

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

  // Check connection on mount and periodically
  useEffect(() => {
    let cancelled = false
    const check = async () => {
      const ok = await checkConnection(apiBase)
      if (cancelled) return
      useStore.getState().setConnected(ok)
      if (ok) {
        connectWebSocket(apiBase)
        // Load/refresh the shared server-side history: on first contact
        // and then every ~45s while connected, so generations made from
        // other machines show up without a reload.
        const now = Date.now()
        if (!wasConnectedRef.current || now - lastSyncRef.current > 45000) {
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
