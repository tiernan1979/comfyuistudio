import { useEffect, useRef, useCallback } from 'react'
import useStore from '../store/useStore'
import {
  queuePrompt,
  getHistory,
  getServerHistory,
  getViewUrl,
  uploadImage,
  setProgressCallback,
  setPhaseCallback,
  setCompletionCallback,
  resolveApiBase,
  extractHistoryError,
  assertModelsAvailable,
  freeLoadedModels,
  getModelLists,
} from '../lib/comfyui'
import {
  buildImageWorkflow,
  buildVideoWorkflow,
  buildEditWorkflow,
  buildMusicWorkflow,
  isMiniMaxH3,
} from '../lib/workflows'

// Pull ComfyUI's own /history into the store. Outputs live on the
// server, so every machine pointed at the same ComfyUI sees the same
// generations — localStorage only holds this browser's own entries.
// Local entries win on id conflict; deleted ones stay hidden.
export async function syncServerHistory() {
  const st = useStore.getState()
  try {
    // Fold in deletions made on other browsers/machines first, so they
    // drop locally before the fresh server list is merged. Best-effort —
    // a missing API keeps deletes local-only.
    try {
      const h = await fetch('/api/hidden-ids')
      if (h.ok) {
        const data = await h.json()
        useStore.getState().mergeHiddenIds(data?.ids || [])
      }
    } catch {
      /* API offline — nothing to sync */
    }
    const entries = await getServerHistory(resolveApiBase(st.serverUrl, st.useProxy), 60)
    st.mergeServerHistory(entries)
    return { ok: true, count: entries.length }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

export function useComfyUI() {
  const timerRef = useRef(null)

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

  // Connection polling, the shared WebSocket and the idle-unload timer
  // live in useAppConnection (mounted from App) — they must keep running
  // when GenerateButton unmounts (the 3D tab).

  // Set up progress callback
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
    // minutes of VAE decoding left.
    setPhaseCallback((label, promptId) => {
      if (!isOurs(promptId)) return
      useStore.getState().setProgressLabel(label)
    })
    setCompletionCallback(async (promptId, error) => {
      const st = useStore.getState()
      if (error) {
        if (!isOurs(error.prompt_id)) return
        const base_msg = String(error.exception_message || error.message || '').trim()
        const fallback = `Execution failed on node ${error.node_id ?? '?'} (${error.node_type || 'unknown'})`
        const where = error.node_type ? ` (node ${error.node_id ?? '?'}: ${error.node_type})` : ''
        const msg = base_msg || fallback
        st.setError(`ComfyUI execution error: ${msg}${base_msg ? where : ''}`)
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
      if (
        entry.status?.completed === false ||
        entry.status?.status_str === 'error' ||
        entry.status?.status_str === 'interrupted'
      ) {
        const errMsg = extractHistoryError(entry) || 'execution did not complete'
        // A user-initiated stop isn't a server failure — no scary prefix.
        state.setError(errMsg === 'Generation stopped.' ? errMsg : `ComfyUI reported failure: ${errMsg}`)
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

        // Image output. H3 video also lands in `images` (animated mp4) —
        // video mode reads that bucket as video below instead.
        if (state.mode !== 'video' && output.images?.length > 0) {
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

        // Video output from SaveVideo (MiniMax H3) — ComfyUI files the
        // mp4 under `images` with animated:[true].
        if (state.mode === 'video' && output.images?.length > 0 && output.animated?.[0]) {
          const vid = output.images[0]
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

        // Music output (WAV / MP3 from SaveAudio / SaveAudioMP3)
        if (output.audio?.length > 0) {
          const au = output.audio[0]
          const url = await getViewUrl(base, au.filename, au.subfolder || '', au.type || 'output')
          state.setOutputAudio(url)
          state.addToHistory({
            id: promptId,
            type: 'music',
            prompt: state.prompt,
            lyrics: state.lyrics,
            data: url,
            timestamp: Date.now(),
            settings: { ...state.musicSettings },
          })
          found = true
          break
        }
      }
      if (!found) {
        state.setError('ComfyUI finished but produced no image/video/music output. Check the model filenames in Settings.')
      }
    } catch (err) {
      console.error('Failed to fetch output:', err)
      state.setError(`Failed to process results: ${err.message}`)
    } finally {
      // Run finished (any path) → drop models from VRAM immediately so
      // the next run — often a different pipeline — starts clean.
      await freeModelsAfterRun()
      state.setGenerating(false)
      state.setProgress(null)
      state.setProgressLabel(null)
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
    state.setProgressLabel(null)
    state.setOutputImage(null)
    state.setOutputVideo(null)
    state.setOutputAudio(null)
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
      // Preflight: configured models must actually exist on the server, and
      // video mode must be pointed at a VIDEO model — otherwise the prompt
      // dies server-side (e.g. an image model fed a 5D video latent crashes
      // with "too many values to unpack (expected 4)").
      // Edit mode: the configured unet may predate this server (e.g. the
      // old qwen_image_edit_fp8 default) — resolve against what's actually
      // installed instead of failing the run before it starts.
      let models = state.models
      if (state.mode === 'edit') {
        try {
          const lists = await getModelLists(base)
          const cur = state.models.edit?.unet
          if (lists?.unet?.length && cur && !lists.unet.includes(cur)) {
            const pick =
              lists.unet.find((m) => /qwen.*edit/i.test(m)) ||
              lists.unet.find((m) => /qwen.*2/i.test(m)) ||
              lists.unet.find((m) => /qwen/i.test(m)) ||
              lists.unet[0]
            if (pick && pick !== cur) {
              models = { ...models, edit: { ...models.edit, unet: pick } }
              state.setModels('edit', models.edit)
            }
          }
        } catch {
          /* unreachable server — assertModelsAvailable reports it below */
        }
      }
      await assertModelsAvailable(base, state.mode, models)
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
            unet: models.edit?.unet || 'qwen_image_edit_fp8_e4m3fn.safetensors',
            clip: models.image.clip,
            vae: models.image.vae,
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
      } else if (state.mode === 'music') {
        // Music loads an 8.7 GB text encoder + DIT + audio VAE back-to-back;
        // leftover image/video models push the final VAE decode into OOM
        // (tiled-decode fallback + minutes of retries), so always start
        // clean regardless of the auto-unload setting.
        await freeLoadedModels(base)
        workflow = buildMusicWorkflow({
          caption: state.prompt,
          negativePrompt: state.negativePrompt,
          lyrics: state.lyrics,
          duration: state.musicSettings.duration,
          seed: state.musicSettings.seed,
          steps: state.musicSettings.steps,
          cfgScale: state.musicSettings.cfgScale,
          quality: state.musicSettings.quality,
          models: {
            unet: state.models.music?.unet || 'minimax_music3_dit_int8_convrot.safetensors',
            clip: state.models.music?.clip || 'minimax_music3_text_encoder_pruned_int8_convrot.safetensors',
            vae: state.models.music?.vae || 'minimax_music3_dav.safetensors',
          },
        })
      } else {
        let videoModels = state.models.video
        // MiniMax H3 decodes an AV latent — the audio VAE isn't a setting,
        // pick whatever H3 audio VAE the server has.
        if (isMiniMaxH3(videoModels?.unet)) {
          const lists = await getModelLists(base)
          const audioVae = (lists?.vae || []).find((n) => /audio[-_ ]?vae/i.test(n))
          if (!audioVae) {
            throw new Error(
              'MiniMax H3 video needs an audio VAE on the server (minimax_h3_audio_vae_*.safetensors) — install it or pick another video model in Settings → Models.'
            )
          }
          videoModels = { ...videoModels, vaeAudio: audioVae }
        }
        workflow = buildVideoWorkflow({
          prompt: state.prompt,
          negativePrompt: state.negativePrompt,
          resolution: state.videoSettings.resolution,
          frames: state.videoSettings.frames,
          fps: state.videoSettings.fps,
          seed: state.videoSettings.seed,
          steps: state.videoSettings.steps,
          cfg: state.videoSettings.cfg,
          models: videoModels,
        })
      }

      const promptId = await queuePrompt(base, workflow)
      state.setCurrentPromptId(promptId)
    } catch (err) {
      console.error('Generation failed:', err)
      state.setError(err.message || 'Generation failed for an unknown reason.')
      state.setGenerating(false)
      state.setProgress(null)
      state.setProgressLabel(null)
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [])

  return { generate }
}
