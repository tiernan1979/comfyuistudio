import { useCallback } from 'react'
import useStore from '../../store/useStore'
import { resolveApiBase } from '../../lib/comfyui'
import { formatStemInfo } from '../../lib/stems'
import { AI_STEM_DEFS, aiStemsAvailable, separateBufferAI } from '../../lib/stemsAI'
import { STEM_DEFS } from '../../components/music/constants'
import {
  project,
  getCtx,
  stemBuffers,
  aiStemCache,
  bufferOrigin,
  toStereoWav,
} from '../../lib/music/session'

// Stem separation: the fast local DSP split and the optional server-side AI
// (htdemucs) split. Both mute the source track and insert the new stems
// directly after it.
export default function useStems({
  selected,
  tracksRef,
  setErr,
  setBusy,
  setRangeSel,
  pushUndoNow,
  commit,
  setAiSplit,
}) {
  // Drum/bass/vocals/synth split (fast DSP: HPSS + center-aware bands).
  // Source track is muted after.
  const splitIntoStems = useCallback(async () => {
    if (!selected) {
      setErr('Select a clip first, then split it into stems.')
      return
    }
    const track = tracksRef.current.find((t) => t.id === selected.trackId)
    if (!track) return
    setBusy('Separating into drums / bass / vocals / synth (approx)…')
    setErr('')
    await new Promise((r) => setTimeout(r, 40)) // paint the spinner before heavy DSP
    try {
      const baseIdx = tracksRef.current.indexOf(track)
      const perStem = STEM_DEFS.map(() => [])
      let stemStats = null
      for (const c of track.clips) {
        const st = await stemBuffers(c.buffer)
        if (!stemStats) stemStats = st.stats
        STEM_DEFS.forEach((def, i) => {
          perStem[i].push({ ...c, id: project.nextClip++, buffer: st[def.key] })
        })
      }
      const newTracks = STEM_DEFS.map((def, i) => ({
        id: project.nextTrack++,
        name: `${track.name} · ${def.name}`,
        color: def.color,
        gain: 1,
        pan: 0,
        mute: false,
        solo: false,
        clips: perStem[i],
        stemInfo: stemStats ? formatStemInfo(stemStats[def.key]) : '',
      }))
      const next = [
        ...tracksRef.current.slice(0, baseIdx + 1),
        ...newTracks,
        ...tracksRef.current.slice(baseIdx + 1),
      ].map((t) => (t.id === track.id ? { ...t, mute: true } : t))
      pushUndoNow()
      commit(next)
      setRangeSel(null)
    } catch (e) {
      setErr(`Stem split failed: ${e.message}`)
    } finally {
      setBusy('')
    }
  }, [selected, tracksRef, setErr, setBusy, setRangeSel, pushUndoNow, commit])

  // Server-side AI split: htdemucs 6-source → UVR Karaoke lead/backing +
  // FoxJoy Reverb dry/reverb of demucs "other". Slow (~1–2 min per clip) so
  // per-clip results are cached; falls back with an install hint when the
  // node packs are missing.
  const splitIntoStemsAI = useCallback(async () => {
    if (!selected) {
      setErr('Select a clip first, then split it into stems.')
      return
    }
    const track = tracksRef.current.find((t) => t.id === selected.trackId)
    if (!track) return
    setErr('')
    const st = useStore.getState()
    const base = resolveApiBase(st.serverUrl, st.useProxy)
    setBusy('AI split: checking server nodes…')
    await new Promise((r) => setTimeout(r, 40)) // paint the spinner first
    try {
      const avail = await aiStemsAvailable(base)
      setAiSplit(avail)
      if (!avail.ok) {
        throw new Error(
          avail.unreachable
            ? 'could not reach ComfyUI to verify separation nodes — check the server URL in Settings.'
            : `node pack(s) not installed on the server: ${avail.missing.join(', ')} — install set-soft/AudioSeparation (cd ComfyUI/custom_nodes && git clone https://github.com/set-soft/AudioSeparation && pip install seconohe), then restart ComfyUI. The fast DSP split still works.`
        )
      }
      const baseIdx = tracksRef.current.indexOf(track)
      const perStem = AI_STEM_DEFS.map(() => [])
      for (const c of track.clips) {
        let stems = aiStemCache.get(c.buffer)
        if (!stems) {
          // Prefer the file already on the server over a WAV re-upload:
          // input/ files go straight to LoadAudio, output/ files get their
          // original bytes (mp3) copied into input/. WAV upload is only the
          // fallback for clips added from the local disk.
          const origin = bufferOrigin.get(c.buffer)
          let src
          if (origin && origin.type === 'input') {
            src = {
              inputName: origin.subfolder ? `${origin.subfolder}/${origin.filename}` : origin.filename,
            }
          } else if (origin) {
            src = { originUrl: origin.url }
          } else {
            src = { wavBlob: toStereoWav(c.buffer) }
          }
          const tag = `${Date.now().toString(36)}-${c.id}`
          const blobs = await separateBufferAI({ base, ...src, tag, onPhase: setBusy })
          // MP3 padding makes files slightly longer than the clip — trim to
          // the source duration so timeline offsets stay exact. All stems
          // share one encoder delay, so they stay mutually aligned.
          const wantDur = c.buffer.length / c.buffer.sampleRate
          stems = {}
          for (const def of AI_STEM_DEFS) {
            const ab = await blobs.get(def.key).arrayBuffer()
            let decoded = await getCtx().decodeAudioData(ab)
            const want = Math.round(decoded.sampleRate * wantDur)
            if (decoded.length > want) {
              const trimmed = getCtx().createBuffer(decoded.numberOfChannels, want, decoded.sampleRate)
              for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
                trimmed.copyToChannel(decoded.getChannelData(ch).subarray(0, want), ch)
              }
              decoded = trimmed
            }
            stems[def.key] = decoded
          }
          aiStemCache.set(c.buffer, stems)
        }
        AI_STEM_DEFS.forEach((def, i) => {
          perStem[i].push({ ...c, id: project.nextClip++, buffer: stems[def.key] })
        })
      }
      const newTracks = AI_STEM_DEFS.map((def, i) => ({
        id: project.nextTrack++,
        name: `${track.name} · ${def.name}`,
        color: def.color,
        gain: 1,
        pan: 0,
        mute: false,
        solo: false,
        clips: perStem[i],
        stemInfo: '',
      }))
      const next = [
        ...tracksRef.current.slice(0, baseIdx + 1),
        ...newTracks,
        ...tracksRef.current.slice(baseIdx + 1),
      ].map((t) => (t.id === track.id ? { ...t, mute: true } : t))
      pushUndoNow()
      commit(next)
      setRangeSel(null)
    } catch (e) {
      setErr(`AI stem split failed: ${e.message}`)
    } finally {
      setBusy('')
    }
  }, [selected, tracksRef, setErr, setBusy, setRangeSel, pushUndoNow, commit, setAiSplit])

  return { splitIntoStems, splitIntoStemsAI }
}
