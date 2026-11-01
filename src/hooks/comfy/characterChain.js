// Sprites video engine chain:
// keyframe (Qwen) → stage 1 (WAN high-noise expert, SaveLatent) per row →
// stage 2 (low-noise expert + frame extraction) per row → pack.
//
// The two GGUF experts are ~9.7 GB each and must never be resident together
// (16 GB VRAM, 17 GB RAM), so every model-family transition POSTs /free
// first; consecutive prompts of the same family reuse the resident model.
// Latents and the keyframe cross prompts via "[output]" annotated paths —
// SaveLatent writes into output/ and both LoadLatent and LoadImageOutput
// resolve annotated output/ paths (verified against this ComfyUI), so no file
// ever round-trips through the browser.

import {
  extractHistoryError,
  freeLoadedModels,
  getHistory,
  getViewUrl,
  queuePrompt,
  resolveApiBase,
} from '../../lib/comfyui'
import {
  buildCharacterKeyframeWorkflow,
  buildCharacterStage1Workflow,
  buildCharacterStage2Workflow,
} from '../../lib/character'
import useStore from '../../store/useStore'
import { publishSpriteSheet } from './publishSprite.js'

export function createCharacterChain({ chainRef, chainStageRef, timerRef, freeModelsAfterRun }) {
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
        expression: plan.keyframeExpression,
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
          `(per row: ${plan.framesByRow.map((r) => r.length).join(',')})`
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
      return failChain(
        `No history found for prompt ${promptId} — did ComfyUI restart or clear its queue?`
      )
    }
    if (
      entry.status?.completed === false ||
      entry.status?.status_str === 'error' ||
      entry.status?.status_str === 'interrupted'
    ) {
      const errMsg = extractHistoryError(entry) || 'execution did not complete'
      // A user-initiated stop isn't a server failure — no scary prefix.
      return failChain(
        errMsg === 'Generation stopped.' ? errMsg : `ComfyUI reported failure: ${errMsg}`
      )
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

  return { finishChain, failChain, submitChainStage, completeChain, advanceChain }
}
