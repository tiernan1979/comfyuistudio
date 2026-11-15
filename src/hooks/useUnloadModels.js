import { useCallback, useState } from 'react'
import useStore from '../store/useStore'
import { freeLoadedModels, resolveApiBase } from '../lib/comfyui'
import { setLoadedFamily } from '../lib/modelFamily'

// Manual "unload models now" action, shared by the connection badge and the
// server settings. Useful when something else needs the GPU immediately and
// waiting for the 5-minute idle timer is not an option. Refused while a
// render is running or queued so we never evict weights from under a job.
export function useUnloadModels() {
  const [busy, setBusy] = useState(false)

  const unload = useCallback(async () => {
    const s = useStore.getState()
    if (s.generating || s.queueRemaining > 0) {
      s.setError('Cannot unload models while a render is running or queued.')
      return false
    }
    setBusy(true)
    try {
      const ok = await freeLoadedModels(resolveApiBase(s.serverUrl, s.useProxy))
      if (ok) {
        setLoadedFamily('')
        s.setModelsUnloaded(true)
        // Activity stamp stays put; modelsUnloaded guards the idle timer.
      } else {
        s.setError('Could not unload models — check the ComfyUI server.')
      }
      return ok
    } finally {
      setBusy(false)
    }
  }, [])

  return { unload, busy }
}
