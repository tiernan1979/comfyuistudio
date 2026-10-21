import { useEffect, useRef, useCallback } from 'react'
import {
  queuePrompt,
  getHistory,
  getServerHistory,
  getViewUrl,
  rebuildViewUrl,
  uploadImage,
  setProgressCallback,
  setPhaseCallback,
  setCompletionCallback,
  resolveApiBase,
  extractHistoryError,
  assertModelsAvailable,
  assertCharacterModels,
  freeLoadedModels,
  getModelLists,
  resolveAceStepModels,
  resolveStableAudioModels,
  resolveH3VideoModels,
  hasAudioCrossfade,
  hasVideoCrossfade,
  hasAudioTailTrim,
  hasAudioLoudnessNodes,
  hasReferenceAudioPrep,
  uploadAudioFile,
  checkNodes,
} from '../lib/comfyui'
import useStore, { pushHistoryEntries, resolveActiveModels } from '../store/useStore'
import { checkVramGuard } from './useVramGuard'
import {
  buildImageWorkflow,
  buildVideoWorkflow,
  buildEditWorkflow,
  buildMusicWorkflow,
  buildSpriteWorkflow,
  isMiniMaxH3,
  isAceStepModel,
  isStableAudioModel,
} from '../lib/workflows'
import {
  buildCharacterKeyframeWorkflow,
  buildCharacterStage1Workflow,
  buildCharacterStage2Workflow,
  characterMotionPrompt,
  characterStartPose,
  layoutRows,
  CHARACTER_MODEL_DEFAULTS,
  CHARACTER_NODES,
  CHARACTER_NODE_HINTS,
  VIDEO_SHEET_MAX_CELLS,
} from '../lib/character'
import { packSpriteSheet } from '../lib/sprite'

// Pull the shared generation history into the store. Primary source is
// the app's own API (/api/history) — a durable, origin-neutral store that
// merges live ComfyUI entries with ones pushed by other browsers, so
// every origin (http://host:5555, https://host, …) converges on the same
// list even after ComfyUI restarts or clears its in-memory history.
// Falls back to a direct ComfyUI /history read when the API is offline.
// Local entries win on id conflict; deleted ones stay hidden.
export async function syncServerHistory() {
  const st = useStore.getState()
  const apiBase = resolveApiBase(st.serverUrl, st.useProxy)
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
    let entries = null
    let viaApi = false
    try {
      const r = await fetch('/api/history?limit=200')
      if (r.ok) {
        const data = await r.json()
        if (Array.isArray(data?.entries)) {
          entries = data.entries
          viaApi = true
        }
      }
    } catch {
      /* API offline — direct ComfyUI read below */
    }
    if (!entries) entries = await getServerHistory(apiBase, 60)
    // Rebuild output URLs against THIS origin: entries recorded elsewhere
    // point at that origin's proxy (or at direct http:// ComfyUI URLs,
    // which https pages refuse to load) — both are dead links here.
    entries = entries.map((e) => {
      if (!e?.data) return e
      const url = rebuildViewUrl(e, apiBase)
      return url && url !== e.data ? { ...e, data: url } : e
    })
    // Catch-up: push entries only this browser has (e.g. localStorage
    // accumulated before history became shared) so other origins see
    // them too. Ids already in the shared store are skipped, so this
    // fires once per entry, not on every sync.
    if (viaApi) {
      const fetched = new Set(entries.map((e) => String(e.id)))
      const hidden = new Set(useStore.getState().hiddenHistoryIds.map(String))
      const localOnly = useStore.getState().history.filter(
        (h) => h?.id && h?.data && !fetched.has(String(h.id)) && !hidden.has(String(h.id)),
      )
      if (localOnly.length) pushHistoryEntries(localOnly)
    }
    useStore.getState().mergeServerHistory(entries)
    return { ok: true, count: entries.length, source: viaApi ? 'shared' : 'server' }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

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
          await advanceChain(promptId, error)
        } catch (err) {
          console.error('video character chain failed:', err)
          await failChain(err.message || 'Video character run failed.')
        }
        return
      }
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

      // Sprite mode: the graph emits N transparent per-frame PNGs (one
      // SaveImage batch). Gather them all, pack a single alpha-preserving
      // sheet in the browser, upload it for a stable URL, and publish that.
      if (state.mode === 'sprite') {
        try {
          const frames = []
          for (const nodeId of Object.keys(entry.outputs)) {
            const out = entry.outputs[nodeId]
            for (const img of out.images || []) {
              frames.push(await getViewUrl(base, img.filename, img.subfolder, img.type))
            }
          }
          if (frames.length) {
            const sp = state.spriteSettings || {}
            await publishSpriteSheet(base, promptId, frames, sp, layoutRows(sp), state.prompt)
          } else {
            state.setError('The sprite graph finished without producing any frames.')
          }
        } catch (err) {
          console.error('sprite packing failed', err)
          state.setError(`Sprite packing failed: ${err.message}`)
        }
        // Sprite mode owns its output: never fall through to the generic
        // single-image branch below, which would show one raw frame as if it
        // were the packed sheet (and mislabel it as an image).
        found = true
      }

      // Find the output node (non-sprite modes)
      if (!found) for (const nodeId of Object.keys(entry.outputs)) {
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
            title: state.titles?.video || '',
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
            title: state.titles?.video || '',
            data: url,
            timestamp: Date.now(),
            settings: { ...state.videoSettings },
          })
          found = true
          break
        }

        // Audio output (WAV / MP3 / FLAC from SaveAudio / SaveAudioMP3) —
        // music (MiniMax / ACE-Step) or SFX (Stable Audio 3).
        if (output.audio?.length > 0) {
          const au = output.audio[0]
          const url = await getViewUrl(base, au.filename, au.subfolder || '', au.type || 'output')
          const audioType = state.mode === 'sfx' ? 'sfx' : 'music'
          state.setOutputAudio(url)
          state.addToHistory({
            id: promptId,
            type: audioType,
            prompt: state.prompt,
            lyrics: audioType === 'music' ? state.lyrics : undefined,
            // Snapshot the AI title onto the job so the download name and
            // the history tile keep matching THIS render.
            title: state.titles?.[audioType] || '',
            data: url,
            timestamp: Date.now(),
            settings: { ...(audioType === 'sfx' ? state.sfxSettings : state.musicSettings) },
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

  // Pack frames row-major into an alpha-preserving sheet, upload it for a
  // stable URL, and publish it (output image + history entry). Shared by the
  // pose engine's single-prompt path and the video engine's chain finale —
  // both hand over the flat row-major frame list from layoutRows().
  const publishSpriteSheet = async (base, promptId, frames, sp, layout, prompt) => {
    const state = useStore.getState()
    const rows = layout.map((r) => ({ name: r.name, frames: r.frames }))
    const columns = rows.reduce((m, r) => Math.max(m, r.frames), 1)
    const packed = await packSpriteSheet(frames, {
      columns,
      cellSize: sp.cellSize || 256,
      rows,
      background: sp.background || 'transparent',
    })
    console.log(
      `[sprite] packed ${frames.length} frames into ${packed.width}×${packed.height} ` +
        `(${columns} cols × ${rows.length} rows @ ${sp.cellSize || 256}px)`,
    )
    let sheetUrl = ''
    try {
      const up = await uploadImage(
        base,
        new File([packed.blob], `sprite_${Date.now()}.png`, { type: 'image/png' }),
      )
      sheetUrl = await getViewUrl(base, up.name, up.subfolder || '', up.type || 'input')
    } catch {
      // ComfyUI upload unavailable — fall back to a session blob URL.
      sheetUrl = URL.createObjectURL(packed.blob)
    }
    state.setOutputImage(sheetUrl)
    state.addToHistory({
      id: promptId,
      type: 'sprite',
      prompt,
      data: sheetUrl,
      frames,
      timestamp: Date.now(),
      settings: { ...sp, layout: rows, columns },
    })
    return sheetUrl
  }

  // ---------------------------------------------------------------------------
  // Video engine chain: keyframe (Qwen) → stage 1 (WAN high-noise expert,
  // SaveLatent) per row → stage 2 (low-noise expert + frame extraction) per
  // row → pack. The two GGUF experts are ~9.7 GB each and must never be
  // resident together (16 GB VRAM, 17 GB RAM), so every model-family
  // transition POSTs /free first; consecutive prompts of the same family
  // reuse the resident model. Latents and the keyframe cross prompts via
  // "[output]" annotated paths — SaveLatent writes into output/ and both
  // LoadLatent and LoadImageOutput resolve annotated output/ paths (verified
  // against this ComfyUI), so no file ever round-trips through the browser.
  // ---------------------------------------------------------------------------

  const finishChain = () => {
    chainRef.current = null
    chainStageRef.current = null
    const st = useStore.getState()
    st.setGenerating(false)
    st.setProgress(null)
    st.setProgressLabel(null)
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const failChain = async (msg) => {
    const st = useStore.getState()
    st.setError(msg)
    // A failed stage's models are still resident — free them now (same
    // contract as the single-prompt failure path).
    await freeModelsAfterRun()
    finishChain()
  }

  const submitChainStage = async (base) => {
    const plan = chainRef.current
    if (!plan) return
    const st = useStore.getState()
    const row = plan.rows[plan.row]
    const step = plan.done + 1
    let wf
    let label
    if (plan.phase === 'keyframe') {
      label = `Keyframe (${step}/${plan.total})`
      wf = buildCharacterKeyframeWorkflow({
        subject: plan.subject,
        pose: plan.keyframePose,
        genSize: plan.sp.genSize,
        seed: plan.seed,
        steps: plan.sp.steps,
        cfg: plan.sp.cfg,
        prefix: plan.keyframePrefix,
        models: plan.imageModels,
      })
    } else if (plan.phase === 'stage1') {
      label = `${row.name} · pass 1/2 (${step}/${plan.total})`
      wf = buildCharacterStage1Workflow({
        keyframe: plan.keyframe,
        motion: plan.motion[plan.row],
        width: plan.width,
        height: plan.height,
        frames: row.frames,
        seed: plan.seed,
        prefix: plan.prefixes[plan.row],
        character: plan.character,
      })
    } else {
      label = `${row.name} · pass 2/2 + frames (${step}/${plan.total})`
      wf = buildCharacterStage2Workflow({
        keyframe: plan.keyframe,
        motion: plan.motion[plan.row],
        width: plan.width,
        height: plan.height,
        frames: row.frames,
        seed: plan.seed,
        cellSize: plan.sp.cellSize,
        character: plan.character,
        latent: plan.latents[plan.row],
      })
    }
    chainStageRef.current = label
    st.setProgressLabel(label)
    st.setProgress({ value: plan.done / plan.total, max: 1, step: plan.done, total: plan.total })
    const promptId = await queuePrompt(base, wf)
    plan.queuedPromptId = promptId
    st.setCurrentPromptId(promptId)
  }

  const completeChain = async (promptId) => {
    const plan = chainRef.current
    if (!plan) return
    const st = useStore.getState()
    const base = resolveApiBase(st.serverUrl, st.useProxy)
    try {
      const frames = plan.framesByRow.flat()
      console.log(
        `[sprite] chain complete: ${frames.length} frames from ${plan.framesByRow.length} rows ` +
          `(per row: ${plan.framesByRow.map((r) => r.length).join(',')})`,
      )
      await publishSpriteSheet(base, promptId, frames, plan.sp, plan.rows, plan.subject)
    } catch (err) {
      console.error('sprite packing failed', err)
      st.setError(`Sprite packing failed: ${err.message}`)
    } finally {
      await freeModelsAfterRun()
      finishChain()
    }
  }

  const advanceChain = async (promptId, error) => {
    const plan = chainRef.current
    if (!plan) return
    const st = useStore.getState()
    const base = resolveApiBase(st.serverUrl, st.useProxy)
    if (error) {
      const baseMsg = String(error.exception_message || error.message || '').trim()
      const fallback = `Execution failed on node ${error.node_id ?? '?'} (${error.node_type || 'unknown'})`
      const where = error.node_type ? ` (node ${error.node_id ?? '?'}: ${error.node_type})` : ''
      return failChain(`ComfyUI execution error: ${baseMsg || fallback}${baseMsg ? where : ''}`)
    }
    if (!promptId) return failChain('ComfyUI finished without reporting a prompt_id.')
    let history
    try {
      history = await getHistory(base, promptId)
    } catch (err) {
      return failChain(`Queued OK, but could not fetch results: ${err.message}`)
    }
    const entry = history[promptId]
    if (!entry) {
      return failChain(`No history found for prompt ${promptId} — did ComfyUI restart or clear its queue?`)
    }
    if (
      entry.status?.completed === false ||
      entry.status?.status_str === 'error' ||
      entry.status?.status_str === 'interrupted'
    ) {
      const errMsg = extractHistoryError(entry) || 'execution did not complete'
      // A user-initiated stop isn't a server failure — no scary prefix.
      return failChain(errMsg === 'Generation stopped.' ? errMsg : `ComfyUI reported failure: ${errMsg}`)
    }
    const outputs = entry.outputs || {}
    // Every stage builder names its terminal node `out`.
    const out = outputs.out || Object.values(outputs)[0]
    if (!out) return failChain('ComfyUI finished but returned no outputs.')
    plan.done += 1
    // The chain may have been torn down (stop button, mode switch) while we
    // were fetching history — never advance a plan that is no longer live.
    if (chainRef.current !== plan) return

    if (plan.phase === 'keyframe') {
      const img = out.images?.[0]
      if (!img) return failChain('The keyframe step produced no image.')
      plan.keyframe = `${img.subfolder ? `${img.subfolder}/` : ''}${img.filename} [output]`
      plan.phase = 'stage1'
      plan.row = 0
      // Qwen image stack out of VRAM before the first WAN expert loads.
      await freeLoadedModels(base)
      if (chainRef.current !== plan) return
      return submitChainStage(base)
    }

    if (plan.phase === 'stage1') {
      const lat = out.latents?.[0]
      if (!lat) return failChain('WAN pass 1 finished without a latent — SaveLatent output missing.')
      plan.latents.push(`${lat.subfolder ? `${lat.subfolder}/` : ''}${lat.filename} [output]`)
      if (plan.row + 1 < plan.rows.length) {
        plan.row += 1
        return submitChainStage(base)
      }
      // All latents saved — high-noise expert out before the low-noise one
      // loads (two separate 9.7 GB files).
      await freeLoadedModels(base)
      plan.phase = 'stage2'
      plan.row = 0
      if (chainRef.current !== plan) return
      return submitChainStage(base)
    }

    // stage2 — transparent frames for this row, already in batch order.
    const imgs = out.images || []
    if (!imgs.length) return failChain('WAN pass 2 finished without frames.')
    const frameUrls = []
    for (const im of imgs) {
      frameUrls.push(await getViewUrl(base, im.filename, im.subfolder || '', im.type || 'output'))
    }
    if (chainRef.current !== plan) return
    plan.framesByRow.push(frameUrls)
    if (plan.row + 1 < plan.rows.length) {
      plan.row += 1
      return submitChainStage(base)
    }
    return completeChain(promptId)
  }

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
        // clean regardless of the auto-unload setting — freed just before
        // the queue below (nothing in between touches VRAM).
        // Trim dead-air tails when the AudioTailTrim custom node is installed
        // (comfy_nodes/AudioTailTrim.py); graphs stay stock without it.
        const trimAudio = await hasAudioTailTrim(base)
        const loud = await hasAudioLoudnessNodes(base)
        const musicModels = {
          unet: 'minimax_music3_dit_int8_convrot.safetensors',
          clip: 'minimax_music3_text_encoder_pruned_int8_convrot.safetensors',
          vae: 'minimax_music3_dav.safetensors',
          ...resolveActiveModels(state, 'music'),
        }
        const aceSelected = isAceStepModel(musicModels.unet)
        if (aceSelected) {
          // ACE-Step: clip/vae live in the server's ACE files (AIO checkpoint
          // or split qwen encoders), not in the MiniMax trio — resolve them
          // here so the builder gets { ace } (throws with install guidance).
          // Force direct (no planner) when duration > 360s — the planner
          // node hard-caps max_duration at 360, so ACE's own TE (up to 2000s)
          // is the only path for longer tracks.
          const dur = state.musicSettings.duration || 300
          musicModels.ace = resolveAceStepModels(await getModelLists(base), {
            ...musicModels,
            forceDirect: dur > 360,
          })
        }
        // Stable Audio 3 (SFX engine): the checkpoint lives in models/checkpoints
        // and the T5Gemma encoder in models/text_encoders — resolve both here so
        // the builder gets { stable } (throws with install guidance if absent).
        const stableSelected = isStableAudioModel(musicModels.unet) || musicModels.engine === 'stable_audio'
        if (stableSelected) {
          musicModels.stable = resolveStableAudioModels(await getModelLists(base), musicModels)
        }
        // ACE-Step reference audio (timbre/style source): upload into input/
        // so LoadAudio can pick it up, then thread the filename into the
        // graph (ReferenceTimbreAudio branch). MiniMax has no such node.
        // ReferenceAudioPrep (custom node) samples long clips server-side;
        // probed here and threaded via models.prepReference.
        let referenceAudioName = ''
        if (aceSelected && state.referenceAudio?.file) {
          state.setProgressLabel('Uploading reference audio…')
          referenceAudioName = await uploadAudioFile(base, state.referenceAudio.file)
          musicModels.prepReference = await hasReferenceAudioPrep(base)
        }
        await freeLoadedModels(base)
        musicModels.trimAudio = trimAudio
        musicModels.loudEq = loud.eq
        musicModels.loudVolume = loud.volume
        workflow = buildMusicWorkflow({
          caption: state.prompt,
          negativePrompt: state.negativePrompt,
          lyrics: state.lyrics,
          seed: state.musicSettings.seed,
          steps: state.musicSettings.steps,
          cfgScale: state.musicSettings.cfgScale,
          quality: state.musicSettings.quality,
          // Duration = the AR planner's max_duration cap (both engines) —
          // the model sizes the song itself and the tail trim cuts any
          // silent pad; exact render length when no planner is available.
          duration: state.musicSettings.duration || 300,
          referenceAudio: referenceAudioName,
          models: musicModels,
        })
      } else if (state.mode === 'sfx') {
        // Stable Audio 3 sound effects. The checkpoint lives in
        // models/checkpoints and the T5Gemma encoder in models/text_encoders,
        // so resolve both against the server before building. Free leftover
        // image/video/music models first so the audio decode stays clean.
        const sfxModels = { ...resolveActiveModels(state, 'sfx') }
        sfxModels.stable = resolveStableAudioModels(await getModelLists(base), sfxModels)
        await freeLoadedModels(base)
        workflow = buildMusicWorkflow({
          caption: state.prompt,
          negativePrompt: state.negativePrompt,
          lyrics: '',
          duration: state.sfxSettings.duration,
          seed: state.sfxSettings.seed,
          quality: state.sfxSettings.quality,
          sfx: true,
          models: sfxModels,
        })
      } else if (state.mode === 'sprite') {
        // Game-ready sprite sheet. Pose engine (default): one base pose + N
        // identity-consistent pose edits (all from that base), BiRefNet
        // background removal, scaled to fixed cells and saved as N transparent
        // frames (packed in-browser).
        //
        // Video engine: a multi-prompt WAN 2.2 chain (keyframe → one animation
        // video per row → frames) that ends in the exact same sheet contract.
        // It owns its completions from here on, so it starts the chain and
        // returns — every later prompt is queued from advanceChain().
        const sp = state.spriteSettings || {}
        if (sp.engine === 'video') {
          const rows = layoutRows(sp)
          const totalCells = rows.reduce((n, r) => n + r.frames, 0)
          if (totalCells > VIDEO_SHEET_MAX_CELLS) {
            throw new Error(
              `Video sheet too large: ${rows.length} rows = ${totalCells} frames ` +
                `(max ${VIDEO_SHEET_MAX_CELLS}). Reduce animations, directions, or frames per animation.`,
            )
          }
          // Two model families run back-to-back — always start clean, then
          // preflight both stacks and every node class the three graphs use
          // (a half-installed server would otherwise die mid-chain, after
          // the keyframe has already been paid for).
          await freeLoadedModels(base)
          await assertModelsAvailable(base, 'sprite', models)
          const character = { ...CHARACTER_MODEL_DEFAULTS, ...(state.models.character || {}) }
          await assertCharacterModels(base, character)
          const { missing, unreachable } = await checkNodes(base, CHARACTER_NODES)
          if (unreachable) {
            throw new Error('Could not reach ComfyUI to verify the video engine — check the server URL in Settings.')
          }
          if (missing.length) {
            throw new Error(
              'The Sprites video engine needs node pack(s) that aren\'t installed on your ComfyUI server: ' +
                missing.map((c) => CHARACTER_NODE_HINTS[c] || c).join('; ') +
                '. Install them in custom_nodes/ (then restart ComfyUI), or switch Engine back to “Pose edits”.',
            )
          }
          // Resolve the seed ONCE: the keyframe seed and every stage's noise
          // seed must stay identical across the whole chain.
          const seed = sp.seed === -1 || sp.seed == null ? Math.floor(Math.random() * 2 ** 48) : sp.seed
          const run = Date.now().toString(36)
          chainRef.current = {
            phase: 'keyframe',
            row: 0,
            rows,
            total: 1 + rows.length * 2,
            done: 0,
            sp,
            subject: state.prompt,
            imageModels: models.image,
            character,
            seed,
            // A single-animation sheet starts the video from that action's
            // pose (crawl/swim/fall would otherwise morph in from standing);
            // a multi-animation sheet has no single start pose, so standing.
            keyframePose: rows.length === 1 ? characterStartPose(rows[0].animation) : 'neutral standing pose',
            width: sp.videoRes || 512,
            height: sp.videoRes || 512,
            keyframePrefix: `wan_key/${run}`,
            prefixes: rows.map((_, i) => `wan22_${run}/r${i}`),
            motion: rows.map((r) => characterMotionPrompt(state.prompt, r.animation, r.direction)),
            keyframe: '',
            latents: [],
            framesByRow: [],
          }
          await submitChainStage(base)
          return
        }
        await freeLoadedModels(base)
        workflow = buildSpriteWorkflow({
          subject: state.prompt,
          frames: sp.frames,
          cellSize: sp.cellSize,
          genSize: sp.genSize,
          animation: sp.animation,
          sheetMode: sp.sheetMode,
          animations: sp.animations,
          directions: sp.directions,
          animFrames: sp.animFrames,
          seed: sp.seed,
          steps: sp.steps,
          cfg: sp.cfg,
          models: models.image,
        })
      } else {
        let videoModels = resolveActiveModels(state, 'video')
        // MiniMax H3 is a three-headed beast: the DiT needs its own Qwen3-VL
        // text encoder (not the music one) and decodes an AV latent with both
        // an H3 video VAE and an H3 audio VAE. None of that is a setting —
        // resolve whatever the server has and overwrite the preset's clip/vae
        // (which may be stale, e.g. a music encoder in the clip slot).
        let crossfade = 0
        if (isMiniMaxH3(videoModels?.unet)) {
          videoModels = resolveH3VideoModels(await getModelLists(base), videoModels)
          // Crossfade the seams only when BOTH bundled nodes are installed:
          // the audio node shortens its timeline and the video node shortens
          // the frame count by the same duration, so they must be used
          // together to stay in sync. If either is missing we hard-cut.
          if ((state.videoSettings.crossfadeSeconds || 0) > 0 && (await hasAudioCrossfade(base)) && (await hasVideoCrossfade(base))) {
            crossfade = state.videoSettings.crossfadeSeconds
          }
        }
        workflow = buildVideoWorkflow({
          prompt: state.prompt,
          negativePrompt: state.negativePrompt,
          resolution: state.videoSettings.resolution,
          frames: state.videoSettings.frames,
          fps: state.videoSettings.fps,
          segments: state.videoSettings.segments,
          duration: state.videoSettings.duration,
          crossfade,
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
  }, [])

  return { generate }
}
