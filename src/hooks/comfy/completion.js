// Single-prompt completion: read history, publish the output, reset the run.

import { extractHistoryError, getHistory, getViewUrl, resolveApiBase } from '../../lib/comfyui'
import { layoutRows } from '../../lib/character'
import { MATERIAL_MAP_KEYS } from '../../lib/workflows'
import { makeSeamlessTexture } from '../../lib/seamless'
import useStore from '../../store/useStore'
import { publishSpriteSheet } from './publishSprite.js'
import { publishFlipbook } from './publishFlipbook.js'

export function createCompletionHandler({ timerRef }) {
  return async (promptId) => {
    const state = useStore.getState()
    const base = resolveApiBase(state.serverUrl, state.useProxy)
    // Imported workflows declare what they produce; use that to route the
    // result to the image, video or audio player instead of guessing.
    const activeCustom =
      state.mode === 'custom'
        ? state.customWorkflows?.find((w) => w.id === state.customWorkflowId) ||
          state.customWorkflows?.[0]
        : null
    const customType = activeCustom?.mapping?.outputType || 'image'
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
        state.setError(
          `No history found for prompt ${promptId} — did ComfyUI restart or clear its queue?`
        )
        return
      }
      if (
        entry.status?.completed === false ||
        entry.status?.status_str === 'error' ||
        entry.status?.status_str === 'interrupted'
      ) {
        const errMsg = extractHistoryError(entry) || 'execution did not complete'
        // A user-initiated stop isn't a server failure — no scary prefix.
        state.setError(
          errMsg === 'Generation stopped.' ? errMsg : `ComfyUI reported failure: ${errMsg}`
        )
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

      // Flipbook mode: SaveImage emits one transparent PNG per WAN frame.
      // Pack them into a horizontal sheet so the player can animate/export it.
      if (state.mode === 'flipbook') {
        try {
          const frames = []
          for (const nodeId of Object.keys(entry.outputs)) {
            const out = entry.outputs[nodeId]
            for (const img of out.images || []) {
              frames.push(await getViewUrl(base, img.filename, img.subfolder, img.type))
            }
          }
          if (frames.length) {
            const fb = state.flipbookSettings || {}
            await publishFlipbook(base, promptId, frames, fb, state.prompt)
          } else {
            state.setError('The flipbook graph finished without producing any frames.')
          }
        } catch (err) {
          console.error('flipbook packing failed', err)
          state.setError(`Flipbook packing failed: ${err.message}`)
        }
        found = true
      }

      // Texture / tileset mode: one SaveImage can return a batch of variants.
      if (state.mode === 'texture') {
        const rawUrls = []
        for (const nodeId of Object.keys(entry.outputs)) {
          const out = entry.outputs[nodeId]
          for (const img of out.images || []) {
            rawUrls.push(await getViewUrl(base, img.filename, img.subfolder, img.type))
          }
        }
        const ts = state.textureSettings || {}
        // Prompt wording alone cannot guarantee a seamless wrap. For plain
        // textures, crop the model's border and clone a clean band over the
        // browser so a 2×2 repeat lines up exactly. Best effort: if the canvas
        // upload fails, keep the original image rather than failing the run.
        const shouldFix =
          ts.kind === 'texture' && ts.seamless !== false && ts.fixSeams !== false
        let urls = rawUrls
        if (shouldFix && rawUrls.length) {
          urls = []
          for (const url of rawUrls) {
            try {
              urls.push(await makeSeamlessTexture(base, url))
            } catch (err) {
              console.warn('[texture] seamless fix failed, keeping original:', err?.message || err)
              urls.push(url)
            }
          }
        }
        if (urls.length) {
          state.setOutputImage(urls[0])
          state.setBatchImages(urls)
          for (let i = 0; i < urls.length; i += 1) {
            state.addToHistory({
              id: i === 0 ? promptId : `${promptId}-${i + 1}`,
              type: 'texture',
              prompt: state.prompt,
              data: urls[i],
              timestamp: Date.now(),
              settings: { ...ts, seamlessFixed: shouldFix },
            })
          }
        } else {
          state.setError('The texture graph finished without producing an image.')
        }
        found = true
      }

      // PBR material pack: each enabled map has its own SaveImage node.
      if (state.mode === 'material') {
        const ms = state.materialSettings || {}
        const maps = {}
        for (const key of MATERIAL_MAP_KEYS) {
          const img = entry.outputs?.[`save_${key}`]?.images?.[0]
          if (img) maps[key] = await getViewUrl(base, img.filename, img.subfolder, img.type)
        }
        const primary = maps.basecolor || Object.values(maps)[0]
        if (primary) {
          state.setOutputImage(primary)
          state.setBatchImages([])
          state.addToHistory({
            id: promptId,
            type: 'material',
            prompt: state.prompt,
            data: primary,
            timestamp: Date.now(),
            settings: { ...ms, maps },
          })
        } else {
          state.setError('The local PBR graph finished without returning any maps.')
        }
        found = true
      }

      // Find the output node (non-sprite modes)
      if (!found)
        for (const nodeId of Object.keys(entry.outputs)) {
          const output = entry.outputs[nodeId]

          // Image output. A batched image job returns several files from one
          // SaveImage node — collect them all so the viewer can show a
          // contact sheet, and give each its own history row.
          if (
            (state.mode === 'custom' ? customType === 'image' : state.mode !== 'video') &&
            output.images?.length > 0
          ) {
            const urls = []
            for (const img of output.images) {
              urls.push(await getViewUrl(base, img.filename, img.subfolder, img.type))
            }
            if (urls.length) {
              state.setOutputImage(urls[0])
              state.setBatchImages(urls)
              const type = state.mode === 'edit' ? 'edit' : 'image'
              for (let i = 0; i < urls.length; i += 1) {
                state.addToHistory({
                  // First image keeps the prompt id (matches ComfyUI);
                  // extras get a stable suffix so they don't collide.
                  id: i === 0 ? promptId : `${promptId}-${i + 1}`,
                  type,
                  prompt: state.prompt,
                  data: urls[i],
                  timestamp: Date.now(),
                  settings: { ...(type === 'edit' ? state.editSettings : state.imageSettings) },
                })
              }
              found = true
              break
            }
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
          if (
            (state.mode === 'video' || (state.mode === 'custom' && customType === 'video')) &&
            output.images?.length > 0 &&
            output.animated?.[0]
          ) {
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
        state.setError(
          'ComfyUI finished but produced no image/video/music output. Check the model filenames in Settings.'
        )
      }
    } catch (err) {
      console.error('Failed to fetch output:', err)
      state.setError(`Failed to process results: ${err.message}`)
    } finally {
      // Mark activity at completion rather than freeing immediately: the
      // idle-unload timer keeps the weights for 5 minutes so follow-up
      // renders reuse them, then drops them if no job arrives.
      state.setLastGenAt(Date.now())
      state.setGenerating(false)
      state.setProgress(null)
      state.setProgressLabel(null)
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }
}
