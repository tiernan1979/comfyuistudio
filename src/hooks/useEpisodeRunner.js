// Sequential shot runner for the episode planner. It deliberately reuses the
// single useComfyUI() instance owned by GenerateButton: mounting another one
// would register a second completion listener and double-add history.
import { useEffect, useRef, useState } from 'react'
import useStore from '../store/useStore'
import { resolveApiBase, stopGeneration } from '../lib/comfyui'

const MIN_SECONDS = 5.2
const MAX_SECONDS = 15.1
const POLL_MS = 1000

export default function useEpisodeRunner(generate) {
  const [running, setRunning] = useState(false)
  const [currentId, setCurrentId] = useState(null)
  const stopRef = useRef(false)
  const runningRef = useRef(false)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      // A mode switch can unmount the planner mid-shot; stop the loop so it
      // does not keep queueing renders in the background.
      stopRef.current = true
    }
  }, [])

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  const run = async () => {
    if (runningRef.current) return
    if (useStore.getState().generating) {
      useStore.getState().setError('Wait for the current render to finish before starting the episode.')
      return
    }
    const shots = useStore.getState().episodeShots || []
    const pending = shots.filter((shot) => shot.status !== 'done')
    if (!pending.length) return

    runningRef.current = true
    stopRef.current = false
    setRunning(true)

    try {
      for (const shot of pending) {
        if (stopRef.current || !aliveRef.current) break

        // A previous iteration may have marked this one done (or removed it).
        const latest = useStore.getState().episodeShots.find((s) => s.id === shot.id)
        if (!latest || latest.status === 'done') continue

        const seconds = Math.min(
          MAX_SECONDS,
          Math.max(MIN_SECONDS, Number(shot.seconds) || MIN_SECONDS),
        )
        const store = useStore.getState()
        setCurrentId(shot.id)
        store.updateEpisodeShot(shot.id, { status: 'running', error: '', startedAt: Date.now() })
        // PromptInput and the video settings panel read the live store, so
        // select the shot's inputs before asking the shared hook to generate.
        store.setMode('video')
        useStore.getState().setPrompt(shot.prompt || '')
        useStore.getState().setVideoSettings({ duration: seconds })
        useStore.getState().setVideoSourceImage(
          shot.still
            ? { url: shot.still, preview: shot.still, name: shot.name || `shot-${shot.id}` }
            : null,
        )

        const before = new Set(useStore.getState().history.map((h) => h.id))
        const startedAt = Date.now()
        let failure = ''

        try {
          await generate()

          // generate() resolves once the job is queued; the completion
          // handler clears `generating` when ComfyUI finishes (or fails).
          const deadline = Date.now() + 20 * 60 * 1000 + seconds * 60 * 1000
          while (useStore.getState().generating) {
            if (stopRef.current || !aliveRef.current) break
            if (Date.now() > deadline) {
              failure = 'Timed out waiting for the render.'
              break
            }
            await sleep(POLL_MS)
          }

          if (!failure && stopRef.current) failure = 'stopped'
          if (!failure && !aliveRef.current) {
            useStore.getState().updateEpisodeShot(shot.id, {
              status: 'draft',
              error: 'Interrupted — the episode planner closed.',
              finishedAt: Date.now(),
            })
            break
          }

          if (!failure) {
            const state = useStore.getState()
            const entry = (state.history || []).find(
              (h) =>
                h.type === 'video' &&
                !before.has(h.id) &&
                (h.timestamp || 0) >= startedAt - 1000,
            )
            const url = entry?.data || state.outputVideo || ''
            if (url) {
              useStore.getState().updateEpisodeShot(shot.id, {
                status: 'done',
                outputUrl: url,
                error: '',
                finishedAt: Date.now(),
              })
            } else {
              failure = state.error || 'Render finished without a video output.'
            }
          }
        } catch (err) {
          failure = err?.message || 'Render failed.'
        }

        if (failure) {
          const state = useStore.getState()
          useStore.getState().updateEpisodeShot(shot.id, {
            // A deliberate stop leaves the shot runnable on the next pass.
            status: failure === 'stopped' ? 'draft' : 'error',
            error: failure === 'stopped' ? 'Stopped' : failure,
            finishedAt: Date.now(),
          })
          // A timeout can leave ComfyUI busy, so interrupt before continuing.
          if (failure.startsWith('Timed out') && state.generating) {
            try {
              const base = resolveApiBase(state.serverUrl, state.useProxy)
              await stopGeneration(base, state.currentPromptId)
            } catch {
              // best effort
            }
          }
          if (failure === 'stopped') break
          if (!useStore.getState().connected) break
        }
      }
    } finally {
      runningRef.current = false
      if (aliveRef.current) {
        setRunning(false)
        setCurrentId(null)
      }
    }
  }

  const stop = async () => {
    stopRef.current = true
    const state = useStore.getState()
    if (!state.generating) return
    try {
      await stopGeneration(resolveApiBase(state.serverUrl, state.useProxy), state.currentPromptId)
    } catch {
      // The runner will stop at the next poll even if the interrupt fails.
    }
  }

  return { running, currentId, run, stop }
}
