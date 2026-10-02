import { useEffect, useRef, useCallback } from 'react'
import useStore from '../store/useStore'
import {
  checkConnection,
  connectWebSocket,
  disconnectWebSocket,
  queuePrompt,
  getHistory,
  getViewUrl,
  uploadImage,
  setProgressCallback,
  setCompletionCallback,
  resolveApiBase,
} from '../lib/comfyui'
import { buildImageWorkflow, buildVideoWorkflow, buildEditWorkflow } from '../lib/workflows'

export function useComfyUI() {
  const serverUrl = useStore((s) => s.serverUrl)
  const useProxy = useStore((s) => s.useProxy)
  const apiBase = resolveApiBase(serverUrl, useProxy)
  const timerRef = useRef(null)

  // Check connection on mount and periodically
  useEffect(() => {
    let cancelled = false
    const check = async () => {
      const ok = await checkConnection(apiBase)
      if (cancelled) return
      useStore.getState().setConnected(ok)
      if (ok) {
        connectWebSocket(apiBase)
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

  // Set up progress callback
  useEffect(() => {
    setProgressCallback((progress) => {
      useStore.getState().setProgress(progress)
    })
    setCompletionCallback((promptId, error) => {
      const st = useStore.getState()
      if (error) {
        const msg =
          error.exception_message ||
          error.message ||
          `Execution failed on node ${error.node_id || '?'} (${error.node_type || 'unknown'})`
        st.setError(`ComfyUI execution error: ${msg}`)
        st.setGenerating(false)
        st.setProgress(null)
        return
      }
      if (!promptId) {
        st.setError('ComfyUI finished without reporting a prompt_id.')
        st.setGenerating(false)
        st.setProgress(null)
        return
      }
      handleCompletion(promptId)
    })
  }, [])

  const handleCompletion = useCallback(async (promptId) => {
    const state = useStore.getState()
    const base = resolveApiBase(state.serverUrl, state.useProxy)
    try {
      let history
      try {
        history = await getHistory(base, promptId)
      } catch (err) {
        state.setError(`Queued OK, but could not fetch results: ${err.message}`)
        return
      }
      const entry = history[promptId]
      if (!entry) {
        state.setError(`No history found for prompt ${promptId} — did ComfyUI restart or clear its queue?`)
        return
      }
      if (entry.status?.completed === false) {
        const errMsg =
          entry.status?.messages?.map((m) => m?.[1]?.exception_message || m?.[1] || '').filter(Boolean).join(' | ') ||
          'execution did not complete'
        state.setError(`ComfyUI reported failure: ${errMsg}`)
        return
      }
      if (!entry?.outputs) {
        state.setError('ComfyUI finished but returned no outputs.')
        return
      }
      let found = false

      // Find the output node
      for (const nodeId of Object.keys(entry.outputs)) {
        const output = entry.outputs[nodeId]

        // Image output
        if (output.images?.length > 0) {
          const img = output.images[0]
          const url = await getViewUrl(base, img.filename, img.subfolder, img.type)
          state.setOutputImage(url)
          state.addToHistory({
            id: promptId,
            type: state.mode === 'edit' ? 'edit' : 'image',
            prompt: state.prompt,
            data: url,
            timestamp: Date.now(),
            settings: { ...(state.mode === 'edit' ? state.editSettings : state.imageSettings) },
          })
          found = true
          break
        }

        // Video output (animated WEBP)
        if (output.gifs?.length > 0) {
          const vid = output.gifs[0]
          const url = await getViewUrl(base, vid.filename, vid.subfolder, vid.type)
          state.setOutputVideo(url)
          state.addToHistory({
            id: promptId,
            type: 'video',
            prompt: state.prompt,
            data: url,
            timestamp: Date.now(),
            settings: { ...state.videoSettings },
          })
          found = true
          break
        }
      }
      if (!found) {
        state.setError('ComfyUI finished but produced no image/video output. Check the model filenames in Settings.')
      }
    } catch (err) {
      console.error('Failed to fetch output:', err)
      state.setError(`Failed to process results: ${err.message}`)
    } finally {
      state.setGenerating(false)
      state.setProgress(null)
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [])

  const generate = useCallback(async () => {
    const state = useStore.getState()
    if (!state.prompt.trim() || state.generating) return

    state.setGenerating(true)
    state.setProgress({ value: 0, max: 1, step: 0, total: 1 })
    state.setOutputImage(null)
    state.setOutputVideo(null)
    state.clearError()
    // Activity for the idle-unload timer: models are (about to be) loaded
    state.setLastGenAt(Date.now())
    state.setModelsUnloaded(false)

    // Start timer
    const startTime = Date.now()
    timerRef.current = setInterval(() => {
      state.setElapsedTime(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)

    try {
      const base = resolveApiBase(state.serverUrl, state.useProxy)
      let workflow
      if (state.mode === 'edit') {
        if (!state.sourceImage?.file) {
          throw new Error('Upload a source image first.')
        }
        const uploaded = await uploadImage(base, state.sourceImage.file)
        workflow = buildEditWorkflow({
          prompt: state.prompt,
          negativePrompt: state.negativePrompt,
          imageName: uploaded.name,
          seed: state.editSettings.seed,
          steps: state.editSettings.steps,
          cfg: state.editSettings.cfg,
          models: {
            unet: state.models.edit?.unet || 'qwen_image_edit_fp8_e4m3fn.safetensors',
            clip: state.models.image.clip,
            vae: state.models.image.vae,
          },
        })
      } else if (state.mode === 'image') {
        workflow = buildImageWorkflow({
          prompt: state.prompt,
          negativePrompt: state.negativePrompt,
          aspectRatio: state.imageSettings.aspectRatio,
          seed: state.imageSettings.seed,
          steps: state.imageSettings.steps,
          cfg: state.imageSettings.cfg,
          turboMode: state.imageSettings.turboMode,
          models: state.models.image,
        })
      } else {
        workflow = buildVideoWorkflow({
          prompt: state.prompt,
          negativePrompt: state.negativePrompt,
          resolution: state.videoSettings.resolution,
          frames: state.videoSettings.frames,
          fps: state.videoSettings.fps,
          seed: state.videoSettings.seed,
          steps: state.videoSettings.steps,
          cfg: state.videoSettings.cfg,
          models: state.models.video,
        })
      }

      const promptId = await queuePrompt(base, workflow)
      state.setCurrentPromptId(promptId)
    } catch (err) {
      console.error('Generation failed:', err)
      state.setError(err.message || 'Generation failed for an unknown reason.')
      state.setGenerating(false)
      state.setProgress(null)
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [])

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

  return { generate }
}
