import { useCallback } from 'react'
import useStore from '../../store/useStore'
import {
  saveBlobAs,
  queuePrompt,
  pollHistory,
  collectOutputFiles,
  getViewUrl,
  assertModelsAvailable,
  freeLoadedModels,
  resolveApiBase,
} from '../../lib/comfyui'
import { buildMusicWorkflow, buildPartCaption } from '../../lib/workflows'
import { getCtx, loadBuffer, encodeWav, project } from '../../lib/music/session'
import { filenameFromViewUrl } from '../../lib/music/format'
import { COLORS } from '../../components/music/constants'

// Loading tracks, generating an instrumental part via MiniMax, and mixing
// the arrangement down to a WAV.
export default function useMusicActions({
  tracks,
  tracksRef,
  dur,
  masterVol,
  commit,
  pushUndoNow,
  setSelected,
  setBusy,
  setErr,
  partPrompt,
  partDuration,
  setPartPrompt,
  setShowPart,
  setRecentParts,
  busy,
}) {
  // ------------------------- loading -------------------------
  const addTrackFromBuffer = useCallback(
    (buffer, name, url = '') => {
      const t = {
        id: project.nextTrack++,
        name,
        color: COLORS[(project.nextTrack - 2) % COLORS.length],
        gain: 1,
        pan: 0,
        mute: false,
        solo: false,
        clips: [
          {
            id: project.nextClip++,
            buffer,
            offset: 0,
            clipStart: 0,
            clipEnd: buffer.duration,
            fadeIn: 0,
            fadeOut: 0,
            url,
          },
        ],
      }
      pushUndoNow()
      commit([...tracksRef.current, t])
      setSelected({ trackId: t.id, clipId: t.clips[0].id })
      return t
    },
    [commit, pushUndoNow, tracksRef, setSelected]
  )

  const addFromUrl = useCallback(
    async (url, name) => {
      if (tracksRef.current.some((t) => t.clips.some((c) => c.url === url))) return
      setBusy('Loading audio…')
      setErr('')
      try {
        const buffer = await loadBuffer(url)
        addTrackFromBuffer(buffer, name || filenameFromViewUrl(url), url)
      } catch (e) {
        setErr(`Could not load audio: ${e.message}`)
      } finally {
        setBusy('')
      }
    },
    [addTrackFromBuffer, tracksRef, setBusy, setErr]
  )

  const onFilePicked = useCallback(
    async (e) => {
      const files = Array.from(e.target.files || [])
      e.target.value = ''
      if (files.length === 0) return
      setErr('')
      const failures = []
      for (const f of files) {
        setBusy(`Decoding "${f.name}"…`)
        try {
          const ab = await f.arrayBuffer()
          const buffer = await getCtx().decodeAudioData(ab)
          addTrackFromBuffer(buffer, f.name.replace(/\.[^.]+$/, ''), '')
        } catch (e2) {
          failures.push(`"${f.name}": ${e2.message}`)
        }
      }
      if (failures.length) {
        setErr(
          `Could not decode ${failures.join('; ')} — the file may be corrupt or an unsupported audio format.`
        )
      }
      setBusy('')
    },
    [addTrackFromBuffer, setErr, setBusy]
  )

  // ------------------------- AI part generation -------------------------
  // Queue a MiniMax instrumental generation right from the editor and drop
  // the result in as a new track at the playhead.
  const generatePart = useCallback(async () => {
    const raw = partPrompt.trim()
    if (!raw || busy) return
    // Enriched caption: solo-stem description + hard vocal ban (the model
    // sings from bare prompts even with lyrics:'').
    const caption = buildPartCaption(raw)
    setErr('')
    const st = useStore.getState()
    const base = resolveApiBase(st.serverUrl, st.useProxy)
    setBusy('Generating part… (checking models)')
    try {
      // Always start clean: music loads TE+DAV back-to-back and leftover
      // image/video models are the main OOM cause at decode time.
      await freeLoadedModels(base)
      await assertModelsAvailable(base, 'music', st.models)
      const wf = buildMusicWorkflow({
        caption,
        lyrics: '',
        structure: false, // short stem loops don't need the full section map
        duration: partDuration,
        seed: -1,
        steps: st.musicSettings?.steps ?? 20,
        cfgScale: st.musicSettings?.cfgScale ?? 1.5,
        quality: st.musicSettings?.quality || '320k',
        models: st.models.music,
      })
      const pid = await queuePrompt(base, wf)
      const entry = await pollHistory(base, pid, {
        timeoutMs: 300000,
        intervalMs: 2000,
        label: 'AI part',
        onTick: (secs, info) => {
          if (info.phase === 'queued') {
            setBusy(`Generating part… queued${info.queuePos ? ` (#${info.queuePos})` : ''}`)
          } else {
            const label = useStore.getState().progressLabel
            setBusy(`Generating part… ${label ? `${label} · ` : ''}${secs}s`)
          }
        },
      })
      const files = collectOutputFiles(entry)
      const audio = files.find((f) => /\.(mp3|wav|flac|ogg|m4a)$/i.test(f.filename)) || files[0]
      if (!audio) throw new Error('server finished but returned no audio file')
      const url = await getViewUrl(base, audio.filename, audio.subfolder, audio.type)
      const name = raw.length > 30 ? `${raw.slice(0, 30)}…` : raw
      setRecentParts((rp) => [{ id: pid, name, url }, ...rp.filter((x) => x.url !== url)].slice(0, 8))
      await addFromUrl(url, name)
      setPartPrompt('')
      setShowPart(false)
    } catch (e) {
      setErr(`AI part failed: ${e.message}`)
    } finally {
      setBusy('')
    }
  }, [
    partPrompt,
    partDuration,
    busy,
    addFromUrl,
    setBusy,
    setErr,
    setPartPrompt,
    setShowPart,
    setRecentParts,
  ])

  // ------------------------- export -------------------------
  const exportMix = useCallback(async () => {
    if (dur <= 0) return
    setBusy('Rendering mixdown…')
    setErr('')
    try {
      const sr = getCtx().sampleRate
      const len = Math.ceil((dur + 0.05) * sr)
      const off = new OfflineAudioContext(2, len, sr)
      const master = off.createGain()
      master.gain.value = masterVol
      master.connect(off.destination)

      const anySolo = tracks.some((t) => t.solo)
      for (const t of tracks) {
        const audible = anySolo ? t.solo : !t.mute
        const tg = off.createGain()
        tg.gain.value = audible ? t.gain : 0
        const tp = off.createStereoPanner()
        tp.pan.value = t.pan
        tg.connect(tp)
        tp.connect(master)
        for (const c of t.clips) {
          if (c.muted) continue
          const d = c.clipEnd - c.clipStart
          if (d <= 0) continue
          const src = off.createBufferSource()
          src.buffer = c.buffer
          const cg = off.createGain()
          const t0 = c.offset
          const endT = t0 + d
          const fi = Math.min(Math.max(0, c.fadeIn), d)
          let rampEnd = t0
          if (fi > 0) {
            cg.gain.setValueAtTime(0, t0)
            rampEnd = t0 + fi
            cg.gain.linearRampToValueAtTime(1, rampEnd)
          } else {
            cg.gain.setValueAtTime(1, t0)
          }
          const fo = Math.min(Math.max(0, c.fadeOut), d - fi)
          if (fo > 0) {
            const outStart = Math.max(endT - fo, rampEnd)
            if (outStart > rampEnd) cg.gain.setValueAtTime(1, outStart)
            cg.gain.linearRampToValueAtTime(0.0001, endT)
          }
          src.connect(cg)
          cg.connect(tg)
          src.start(t0, c.clipStart, d)
        }
      }
      const rendered = await off.startRendering()
      saveBlobAs(encodeWav(rendered), `mixdown-${Date.now()}.wav`)
    } catch (e) {
      setErr(`Export failed: ${e.message}`)
    } finally {
      setBusy('')
    }
  }, [dur, masterVol, tracks, setBusy, setErr])

  return { addTrackFromBuffer, addFromUrl, onFilePicked, generatePart, exportMix }
}
