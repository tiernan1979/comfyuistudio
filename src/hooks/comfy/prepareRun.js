// Turn the current store state into a ComfyUI graph — or, for the sprites
// video engine, into a multi-prompt chain plan the caller drives.

import {
  assertCharacterModels,
  assertModelsAvailable,
  checkNodes,
  freeLoadedModels,
  getModelLists,
  hasAudioCrossfade,
  hasAudioLoudnessNodes,
  hasAudioTailTrim,
  hasReferenceAudioPrep,
  hasVideoCrossfade,
  resolveAceStepModels,
  resolveH3VideoModels,
  resolveStableAudioModels,
  uploadAudioFile,
  uploadImage,
} from '../../lib/comfyui'
import {
  buildEditWorkflow,
  buildImageWorkflow,
  buildMusicWorkflow,
  buildSpriteWorkflow,
  buildVideoWorkflow,
  isAceStepModel,
  isMiniMaxH3,
  isStableAudioModel,
} from '../../lib/workflows'
import {
  buildCharacterStage1Workflow,
  buildCharacterStage2Workflow,
  characterMotionPrompt,
  characterStartPose,
  CHARACTER_MODEL_DEFAULTS,
  CHARACTER_NODES,
  CHARACTER_NODE_HINTS,
  layoutRows,
  VIDEO_SHEET_MAX_CELLS,
} from '../../lib/character'
import useStore, { resolveActiveModels, resolvePresetModels } from '../../store/useStore'
import { applyCustomWorkflow } from '../../lib/customWorkflow'
import { DEFAULT_STYLE, enhancePrompt, STYLES } from '../../lib/enhance'

// Edit mode: the configured unet may predate this server (e.g. the old
// qwen_image_edit_fp8 default) — resolve against what's actually installed
// instead of failing the run before it starts.
async function resolveEditModels(base, state) {  let models = state.models
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
  return models
}

function buildMusicModels(state, active) {
  return {
    unet: 'minimax_music3_dit_int8_convrot.safetensors',
    clip: 'minimax_music3_text_encoder_pruned_int8_convrot.safetensors',
    vae: 'minimax_music3_dav.safetensors',
    ...active,
  }
}

// The mask editor stores a PNG data URL (white = repaint). ComfyUI's upload
// endpoint wants a file, so decode it back into one before sending.
function dataUrlToFile(dataUrl, name) {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(String(dataUrl || ''))
  if (!match) throw new Error('The mask data is invalid — repaint it and try again.')
  const mime = match[1]
  const binary = atob(match[2])
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new File([bytes], name, { type: mime })
}

export async function prepareRun(base, state) {
  let models = state.models
  // The Style dropdown is a generation setting. Non-default styles are also
  // applied at queue time so picking one before typing still takes effect.
  // The default photoreal style stays opt-in via Enhance — it is the default
  // and would otherwise silently rewrite every prompt.
  const useStyle = !!state.style && state.style !== DEFAULT_STYLE
  const styledPrompt = useStyle ? enhancePrompt(state.prompt, state.style) : state.prompt
  const styledNegative = useStyle
    ? state.negativePrompt?.trim() || STYLES[state.style]?.negative || ''
    : state.negativePrompt
  if (state.mode === 'edit') models = await resolveEditModels(base, state)

  // Imported workflows are opaque graphs: ComfyUI validates them when the
  // prompt is queued, and we can't pre-check their model filenames here.
  if (state.mode === 'custom') {
    const wf =
      state.customWorkflows?.find((w) => w.id === state.customWorkflowId) ||
      state.customWorkflows?.[0]
    if (!wf) throw new Error('Import a workflow in Settings → Workflows first.')
    return {
      workflow: applyCustomWorkflow(wf.graph, wf.mapping, {
        prompt: styledPrompt,
        negative: styledNegative,
        seed: state.customSettings?.seed ?? -1,
      }),
    }
  }

  // Check the files generation will actually use: model presets (video,
  // music, SFX) override the flat group, but the flat group can still hold a
  // stale default (e.g. the old Wan 2.1 file). Preflighting it alone rejected
  // runs whose selected preset was installed — "keeps looking for wan2.1…".
  await assertModelsAvailable(base, state.mode, resolvePresetModels({ ...state, models }))

  if (state.mode === 'edit') {
    if (!state.sourceImage?.file) throw new Error('Upload a source image first.')
    const uploaded = await uploadImage(base, state.sourceImage.file)
    // Optional mask: upload the painted PNG alongside the source. The mask
    // canvas is exported at the source image's aspect ratio, and ComfyUI
    // scales it to the latent size inside SetLatentNoiseMask.
    let maskName = ''
    if (state.sourceImage.mask) {
      state.setProgressLabel('Uploading mask…')
      const file = dataUrlToFile(state.sourceImage.mask, `mask-${Date.now()}.png`)
      maskName = (await uploadImage(base, file)).name
    }
    return {
      workflow: buildEditWorkflow({
        prompt: state.prompt,
        negativePrompt: state.negativePrompt,
        imageName: uploaded.name,
        maskName,
        seed: state.editSettings.seed,
        steps: state.editSettings.steps,
        cfg: state.editSettings.cfg,
        denoise: state.editSettings.denoise ?? 1,
        models: {
          unet: models.edit?.unet || 'qwen_image_edit_fp8_e4m3fn.safetensors',
          clip: models.image.clip,
          vae: models.image.vae,
        },
      }),
    }
  }

  if (state.mode === 'image') {
    const imgCustom = state.imageSettings.sizeMode === 'custom'
    return {
      workflow: buildImageWorkflow({
        prompt: styledPrompt,
        negativePrompt: styledNegative,
        aspectRatio: state.imageSettings.aspectRatio,
        width: imgCustom ? state.imageSettings.width : undefined,
        height: imgCustom ? state.imageSettings.height : undefined,
        seed: state.imageSettings.seed,
        steps: state.imageSettings.steps,
        cfg: state.imageSettings.cfg,
        turboMode: state.imageSettings.turboMode,
        batchSize: state.imageSettings.batchCount || 1,
        models: state.models.image,
      }),
    }
  }

  if (state.mode === 'music') {
    // Music loads an 8.7 GB text encoder + DIT + audio VAE back-to-back;
    // leftover image/video models push the final VAE decode into OOM
    // (tiled-decode fallback + minutes of retries), so always start clean
    // regardless of the auto-unload setting — freed just before the queue
    // below (nothing in between touches VRAM).
    // Trim dead-air tails when the AudioTailTrim custom node is installed
    // (comfy_nodes/AudioTailTrim.py); graphs stay stock without it.
    const trimAudio = await hasAudioTailTrim(base)
    const loud = await hasAudioLoudnessNodes(base)
    const musicModels = buildMusicModels(state, resolveActiveModels(state, 'music'))
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
    const stableSelected =
      isStableAudioModel(musicModels.unet) || musicModels.engine === 'stable_audio'
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

    return {
      workflow: buildMusicWorkflow({
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
      }),
    }
  }

  if (state.mode === 'sfx') {
    // Stable Audio 3 sound effects. The checkpoint lives in
    // models/checkpoints and the T5Gemma encoder in models/text_encoders,
    // so resolve both against the server before building. Free leftover
    // image/video/music models first so the audio decode stays clean.
    const sfxModels = { ...resolveActiveModels(state, 'sfx') }
    sfxModels.stable = resolveStableAudioModels(await getModelLists(base), sfxModels)
    // SFX is always the Stable Audio graph. Without this an ACE/MiniMax
    // unet in the SFX preset would fall through to the music builder and
    // silently render a song instead of a sound effect.
    sfxModels.engine = 'stable_audio'
    await freeLoadedModels(base)
    return {
      workflow: buildMusicWorkflow({
        caption: state.prompt,
        negativePrompt: state.negativePrompt,
        lyrics: '',
        duration: state.sfxSettings.duration,
        seed: state.sfxSettings.seed,
        quality: state.sfxSettings.quality,
        sfx: true,
        models: sfxModels,
      }),
    }
  }

  if (state.mode === 'sprite') {
    // Game-ready sprite sheet. Pose engine (default): one base pose + N
    // identity-consistent pose edits (all from that base), BiRefNet
    // background removal, scaled to fixed cells and saved as N transparent
    // frames (packed in-browser).
    //
    // Video engine: a multi-prompt WAN 2.2 chain (keyframe → one animation
    // video per row → frames) that ends in the exact same sheet contract.
    // It owns its completions from here on, so it returns a chain plan and
    // every later prompt is queued by the caller.
    const sp = state.spriteSettings || {}
    if (sp.engine === 'video') {
      const rows = layoutRows(sp)
      const totalCells = rows.reduce((n, r) => n + r.frames, 0)
      if (totalCells > VIDEO_SHEET_MAX_CELLS) {
        throw new Error(
          `Video sheet too large: ${rows.length} rows = ${totalCells} frames ` +
            `(max ${VIDEO_SHEET_MAX_CELLS}). Reduce animations, directions, or frames per animation.`
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
        throw new Error(
          'Could not reach ComfyUI to verify the video engine — check the server URL in Settings.'
        )
      }
      if (missing.length) {
        throw new Error(
          "The Sprites video engine needs node pack(s) that aren't installed on your ComfyUI server: " +
            missing.map((c) => CHARACTER_NODE_HINTS[c] || c).join('; ') +
            '. Install them in custom_nodes/ (then restart ComfyUI), or switch Engine back to “Pose edits”.'
        )
      }

      // Resolve the seed ONCE: the keyframe seed and every stage's noise
      // seed must stay identical across the whole chain.
      const seed =
        sp.seed === -1 || sp.seed == null ? Math.floor(Math.random() * 2 ** 48) : sp.seed
      const run = Date.now().toString(36)
      return {
        chainPlan: {
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
          keyframePose:
            rows.length === 1
              ? characterStartPose(rows[0].animation)
              : 'neutral standing pose',
          // The keyframe is shared by every row, so a single-row sheet uses
          // that row's expression (it may be a per-animation override) while a
          // multi-row sheet falls back to the global expression.
          keyframeExpression:
            rows.length === 1 ? rows[0].expression : sp.expression || 'neutral',
          width: sp.videoRes || 512,
          height: sp.videoRes || 512,
          keyframePrefix: `wan_key/${run}`,
          prefixes: rows.map((_, i) => `wan22_${run}/r${i}`),
          motion: rows.map((r) =>
            characterMotionPrompt(state.prompt, r.animation, r.direction, r.expression)
          ),
          keyframe: '',
          latents: [],
          framesByRow: [],
        },
      }
    }

    await freeLoadedModels(base)
    return {
      workflow: buildSpriteWorkflow({
        subject: state.prompt,
        frames: sp.frames,
        cellSize: sp.cellSize,
        genSize: sp.genSize,
        animation: sp.animation,
        sheetMode: sp.sheetMode,
        animations: sp.animations,
        directions: sp.directions,
        animFrames: sp.animFrames,
        expression: sp.expression,
        animExpressions: sp.animExpressions,
        frameExpressions: sp.frameExpressions,
        expressionRows: sp.expressionRows,
        seed: sp.seed,
        steps: sp.steps,
        cfg: sp.cfg,
        models: models.image,
      }),
    }
  }

  // Video (default fallthrough)
  let videoModels = resolveActiveModels(state, 'video')
  // MiniMax H3 is a three-headed beast: the DiT needs its own Qwen3-VL
  // text encoder (not the music/Wan one) and decodes an AV latent with both
  // an H3 video VAE and an H3 audio VAE. The resolver honours the configured
  // clip/vae/vaeAudio when they are valid H3 assets, otherwise it uses the
  // server's match (a preset saved with the old Wan umt5 encoder would
  // otherwise crash the sampler).
  let crossfade = 0
  let firstFrameName = ''
  if (isMiniMaxH3(videoModels?.unet)) {
    const resolved = resolveH3VideoModels(await getModelLists(base), videoModels)
    // Write a correction back to the flat group and the active preset so
    // Settings/config.json show the files the graph actually used instead of
    // drifting from it (the previous resolver overwrote both silently).
    const changed = ['clip', 'vae', 'vaeAudio'].filter(
      (key) => resolved[key] && resolved[key] !== videoModels[key]
    )
    videoModels = resolved
    if (changed.length) {
      const store = useStore.getState()
      const patch = { clip: resolved.clip, vae: resolved.vae, vaeAudio: resolved.vaeAudio }
      store.setModels('video', patch)
      const index = store.active?.video
      if (index != null && store.presets?.video?.[index]) {
        store.updatePreset('video', index, patch)
      }
    }
    // Image-to-video: upload the still selected in Settings (a File from the
    // picker, or a ComfyUI view URL handed over from the image viewer) and
    // feed it to window 0 as H3's first_frame.
    if (state.videoSourceImage) {
      state.setProgressLabel('Uploading first frame…')
      const src = state.videoSourceImage
      let file = src.file
      if (!file && src.url) {
        const res = await fetch(src.url)
        if (!res.ok) throw new Error(`Could not download the first frame (HTTP ${res.status}).`)
        const blob = await res.blob()
        file = new File([blob], src.name || 'first-frame.png', { type: blob.type || 'image/png' })
      }
      if (file) firstFrameName = (await uploadImage(base, file)).name
    }
    // Crossfade the seams only when BOTH bundled nodes are installed:
    // the audio node shortens its timeline and the video node shortens
    // the frame count by the same duration, so they must be used
    // together to stay in sync. If either is missing we hard-cut.
    if (
      (state.videoSettings.crossfadeSeconds || 0) > 0 &&
      (await hasAudioCrossfade(base)) &&
      (await hasVideoCrossfade(base))
    ) {
      crossfade = state.videoSettings.crossfadeSeconds
    }
  }
  return {
    workflow: buildVideoWorkflow({
      prompt: styledPrompt,
      negativePrompt: styledNegative,
      resolution: state.videoSettings.resolution,
      frames: state.videoSettings.frames,
      fps: state.videoSettings.fps,
      windowSeconds: state.videoSettings.windowSeconds,
      segments: state.videoSettings.segments,
      duration: state.videoSettings.duration,
      crossfade,
      firstFrameName,
      seed: state.videoSettings.seed,
      steps: state.videoSettings.steps,
      cfg: state.videoSettings.cfg,
      models: videoModels,
    }),
  }
}
