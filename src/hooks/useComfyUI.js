import { useEffect, useRef, useCallback, useMemo } from 'react'
import {
  freeLoadedModels,
  queuePrompt,
  resolveApiBase,
  setCompletionCallback,
  setPhaseCallback,
  setProgressCallback,
} from '../lib/comfyui'
import useStore from '../store/useStore'
import { checkVramGuard } from './useVramGuard'
import { prepareRun } from './comfy/prepareRun.js'
import { createCompletionHandler } from './comfy/completion.js'
import { createCharacterChain } from './comfy/characterChain.js'

export { syncServerHistory } from './comfy/syncHistory.js'

export function useComfyUI() {
  const timerRef = useRef(null)
  // Multi-prompt state for the Sprites video engine (keyframe → stage 1 per
  // row → stage 2 per row → pack). null when no chain is running. Kept in a
  // ref because the WS completion callback is registered once and must read
  // the live state of whichever chain is in flight.
  const chainRef = useRef(null)
  // Stage label prepended to WS node-phase text ("walk · pass 1/2 (2/7) ·
  // Sampling") so the user can see WHERE in the chain we are.
  const chainStageRef = useRef(null)

  // Drop models from VRAM as soon as a run reaches a terminal state
  // (success or error). ComfyUI otherwise keeps the previous pipeline's
  // weights resident (WanVAE + image CLIP still loaded when a music job
  // starts), and long jobs — e.g. a 300s track's VAE decode — then OOM
  // the GPU and crash the server. Respect the autoUnload setting; on
  // failure modelsUnloaded stays false so the idle timer / the next
  // pre-queue check retries.
  const freeModelsAfterRun = useCallback(async () => {
    const st = useStore.getState()
    if (!st.autoUnload) return false
    const freed = await freeLoadedModels(resolveApiBase(st.serverUrl, st.useProxy))
    if (freed) st.setModelsUnloaded(true)
    return freed
  }, [])

  const chain = useMemo(
    () => createCharacterChain({ chainRef, chainStageRef, timerRef, freeModelsAfterRun }),
    [freeModelsAfterRun]
  )
  const handleCompletion = useMemo(
    () => createCompletionHandler({ freeModelsAfterRun, timerRef }),
    [freeModelsAfterRun]
  )

  // Connection polling, the shared WebSocket and the idle-unload timer
  // live in useAppConnection (mounted from App) — they must keep running
  // when GenerateButton unmounts (the 3D tab).

  // Set up progress / phase / completion callbacks.
  useEffect(() => {
    // The websocket is shared across flows — the 3D panel runs its own
    // prompts too. Only act on messages for the prompt WE queued; a
    // message with an id but no matching currentPromptId belongs to
    // another flow (or a pre-reload job) and is ignored.
    const isOurs = (id) => id == null || id === useStore.getState().currentPromptId

    setProgressCallback((progress) => {
      if (!isOurs(progress.promptId)) return
      useStore.getState().setProgress(progress)
    })

    // Friendly phase of the running node ("Decoding audio", "Sampling") —
    // keeps the UI alive when sampling hits 20/20 but the job still has
    // minutes of VAE decoding left. During a video-engine chain the current
    // stage is prefixed so the label never loses the big picture.
    setPhaseCallback((label, promptId) => {
      if (!isOurs(promptId)) return
      const stage = chainStageRef.current
      useStore.getState().setProgressLabel(stage ? `${stage} · ${label}` : label)
    })

    setCompletionCallback(async (promptId, error) => {
      const st = useStore.getState()

      // The video engine runs several prompts back-to-back; it owns its own
      // completion path (advance one stage or tear the whole chain down).
      // Gate on the plan's OWN queued prompt: currentPromptId is a shared
      // slot another flow (e.g. 3D) can overwrite mid-chain, and swallowing
      // a foreign completion here would feed foreign outputs to the chain.
      if (chainRef.current) {
        const id = error ? error.prompt_id : promptId
        if (id != null && id !== chainRef.current.queuedPromptId) return
        try {
          await chain.advanceChain(promptId, error)
        } catch (err) {
          console.error('video character chain failed:', err)
          await chain.failChain(err.message || 'Video character run failed.')
        }
        return
      }

      if (error) {
        if (!isOurs(error.prompt_id)) return
        const baseMsg = String(error.exception_message || error.message || '').trim()
        const fallback = `Execution failed on node ${error.node_id ?? '?'} (${error.node_type || 'unknown'})`
        const where = error.node_type ? ` (node ${error.node_id ?? '?'}: ${error.node_type})` : ''
        const msg = baseMsg || fallback
        st.setError(`ComfyUI execution error: ${msg}${baseMsg ? where : ''}`)
        // A failed run's models are still resident — free them now.
        await freeModelsAfterRun()
        st.setGenerating(false)
        st.setProgress(null)
        st.setProgressLabel(null)
        return
      }

      if (!isOurs(promptId)) return
      if (!promptId) {
        st.setError('ComfyUI finished without reporting a prompt_id.')
        await freeModelsAfterRun()
        st.setGenerating(false)
        st.setProgress(null)
        st.setProgressLabel(null)
        return
      }
      handleCompletion(promptId)
    })
  }, [chain, freeModelsAfterRun, handleCompletion])

  const generate = useCallback(async () => {
    const state = useStore.getState()
    if (!state.prompt.trim() || state.generating) return

    // VRAM guard first, while the UI still looks idle: if another LLM owns
    // the card and ComfyUI is idle, free our weights; if a job is running,
    // throw before we flip into the generating state (so nothing sticks).
    if (state.vramGuard) {
      try {
        await checkVramGuard(state, (label) => useStore.getState().setProgressLabel(label))
      } catch (err) {
        useStore.getState().setError(err.message)
        return
      }
    }

    state.setGenerating(true)
    state.setProgress({ value: 0, max: 1, step: 0, total: 1 })
    state.setProgressLabel(null)
    state.setOutputImage(null)
    state.setOutputVideo(null)
    state.setOutputAudio(null)
    state.setBatchImages([])
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
      // Belt & braces: if the previous run (or an unknown state after a
      // fresh page load) left models in VRAM and the post-run free didn't
      // go through, free them NOW — before queueing. Cross-pipeline
      // leftovers push long jobs into OOM; skipping when the last free
      // succeeded keeps the happy path at one /free per run.
      if (state.autoUnload && (!state.lastGenAt || !state.modelsUnloaded)) {
        await freeLoadedModels(base)
      }

      const prep = await prepareRun(base, state)
      if (prep.chainPlan) {
        // Sprites video engine: it owns completions from here on.
        chainRef.current = prep.chainPlan
        chainStageRef.current = null
        await chain.submitChainStage(base)
        return
      }

      const promptId = await queuePrompt(base, prep.workflow)
      state.setCurrentPromptId(promptId)
    } catch (err) {
      console.error('Generation failed:', err)
      // The video chain's first submission lives inside this try — a failure
      // there must not leave a half-built plan to receive completions.
      chainRef.current = null
      chainStageRef.current = null
      state.setError(err.message || 'Generation failed for an unknown reason.')
      state.setGenerating(false)
      state.setProgress(null)
      state.setProgressLabel(null)
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [chain])

  return { generate }
}
