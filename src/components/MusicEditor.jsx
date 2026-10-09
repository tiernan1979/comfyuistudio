import { useState, useEffect, useRef, useCallback, memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Play, Pause, Square, Repeat, Scissors, Copy, Trash2, Plus,
  FileAudio, ListMusic, Download, Music, Layers, Loader2, Volume2,
  Undo2, Redo2, Sparkles, VolumeX, MoveHorizontal,
} from 'lucide-react'
import useStore from '../store/useStore'
import {
  saveBlobAs, queuePrompt, pollHistory, collectOutputFiles, getViewUrl,
  assertModelsAvailable, freeLoadedModels, resolveApiBase, stopGeneration,
} from '../lib/comfyui'
import { buildMusicWorkflow, buildPartCaption } from '../lib/workflows'
import { clipEndT, splitClipAt, cutRange, muteRange } from '../lib/trackops'
import { stemBuffers as splitStemArrays, formatStemInfo } from '../lib/stems'
import { AI_STEM_DEFS, aiStemsAvailable, separateBufferAI } from '../lib/stemsAI'

// ---------------------------------------------------------------------------
// Session-scoped project. Lives at module level so closing/reopening the
// editor keeps the arrangement (AudioBuffers are memory-only).
//   track: { id, name, color, gain, pan, mute, solo, clips: [...] }
//   clip:  { id, buffer, offset, clipStart, clipEnd, fadeIn, fadeOut, muted }
// ---------------------------------------------------------------------------
const project = { tracks: [], nextTrack: 1, nextClip: 1 }

const bufferCache = new Map() // url -> Promise<AudioBuffer>

let audioCtx = null
function getCtx() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext
    audioCtx = new AC()
  }
  return audioCtx
}

function loadBuffer(url) {
  if (bufferCache.has(url)) return bufferCache.get(url)
  const p = fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`could not fetch audio (HTTP ${r.status})`)
      return r.arrayBuffer()
    })
    .then((ab) => getCtx().decodeAudioData(ab))
    .then((buf) => {
      const origin = viewOrigin(url)
      if (origin) bufferOrigin.set(buf, origin)
      return buf
    })
    .catch((err) => {
      bufferCache.delete(url) // allow a retry after transient failures
      throw err
    })
  bufferCache.set(url, p)
  return p
}

const stemCache = new WeakMap() // AudioBuffer -> { drums, bass, vocals, synth, stats }
const aiStemCache = new WeakMap() // source AudioBuffer -> { <AI stem key>: AudioBuffer }
// AudioBuffer -> { url, filename, subfolder, type } for buffers fetched from
// a ComfyUI /view URL. Lets the AI split reuse the file already on the server
// (input/ → LoadAudio directly, output/ → re-upload its original bytes)
// instead of WAV-uploading a re-encode that can blow the 100 MB limit (413).
const bufferOrigin = new WeakMap()

function viewOrigin(url) {
  try {
    const u = new URL(url, window.location.origin)
    const filename = u.searchParams.get('filename')
    if (!filename) return null
    return {
      url,
      filename,
      subfolder: u.searchParams.get('subfolder') || '',
      type: u.searchParams.get('type') || 'output',
    }
  } catch {
    return null
  }
}

// Split a clip into 4 stems via the pure DSP module (lib/stems): HPSS with
// center-aware band routing. Returns AudioBuffers ready for clips plus
// per-stem composition stats for the track tooltip. Source track is muted
// by the caller after splitting.
async function stemBuffers(buffer) {
  let cached = stemCache.get(buffer)
  if (cached) return cached
  const channels = []
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c))
  const res = await splitStemArrays(channels, { sampleRate: buffer.sampleRate })
  const ab = (arrs) => {
    const out = getCtx().createBuffer(arrs.length, buffer.length, buffer.sampleRate)
    arrs.forEach((a, i) => out.copyToChannel(a, i))
    return out
  }
  cached = {
    drums: ab(res.drums),
    bass: ab(res.bass),
    vocals: ab(res.vocals),
    synth: ab(res.synth),
    stats: res.stats,
  }
  stemCache.set(buffer, cached)
  return cached
}

function encodeWav(buf) {
  const numCh = buf.numberOfChannels
  const sr = buf.sampleRate
  const len = buf.length
  const dataBytes = len * numCh * 2
  const ab = new ArrayBuffer(44 + dataBytes)
  const dv = new DataView(ab)
  const str = (off, s) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i))
  }
  str(0, 'RIFF')
  dv.setUint32(4, 36 + dataBytes, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  dv.setUint32(16, 16, true)
  dv.setUint16(20, 1, true)
  dv.setUint16(22, numCh, true)
  dv.setUint32(24, sr, true)
  dv.setUint32(28, sr * numCh * 2, true)
  dv.setUint16(32, numCh * 2, true)
  dv.setUint16(34, 16, true)
  str(36, 'data')
  dv.setUint32(40, dataBytes, true)

  const chans = []
  for (let c = 0; c < numCh; c++) chans.push(buf.getChannelData(c))
  let off = 44
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      let v = chans[c][i]
      v = Math.max(-1, Math.min(1, v))
      dv.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true)
      off += 2
    }
  }
  return new Blob([ab], { type: 'audio/wav' })
}

// The separation nodes' demixer crashes on mono audio ('DemixerDemucs'
// object has no attribute 'ch' — verified against the live server), so
// mono clips are upmixed to stereo before upload.
function toStereoWav(buf) {
  if (buf.numberOfChannels >= 2) return encodeWav(buf)
  const st = getCtx().createBuffer(2, buf.length, buf.sampleRate)
  st.copyToChannel(buf.getChannelData(0), 0)
  st.copyToChannel(buf.getChannelData(0), 1)
  return encodeWav(st)
}

const COLORS = ['#818cf8', '#34d399', '#f472b6', '#fbbf24', '#60a5fa', '#a78bfa', '#2dd4bf', '#fb923c']
const STEM_DEFS = [
  { key: 'drums', name: 'Drums', color: '#fb923c' },
  { key: 'bass', name: 'Bass', color: '#f472b6' },
  { key: 'vocals', name: 'Vocals', color: '#34d399' },
  { key: 'synth', name: 'Synth', color: '#60a5fa' },
]

// AI part presets — production-grade captions (the model sings from bare
// prompts like "dum dum dum" unless the caption is this explicit).
const PART_PRESETS = [
  {
    label: 'Bassline',
    caption:
      'A groovy electric bass guitar bassline in A minor at 110 BPM, syncopated funk riff with ghost notes, round warm low end, tight palm-muted attacks, four-bar phrase that loops seamlessly',
  },
  {
    label: 'Drums',
    caption:
      'An acoustic drum kit groove at 96 BPM, punchy kick, crisp snare on beats 2 and 4, steady closed hi-hat eighths, dry studio room sound, tight human feel, four-bar loop',
  },
  {
    label: 'Guitar',
    caption:
      'A clean electric guitar riff at 120 BPM, bright chimey tone with light reverb, rhythmic 16th-note picking pattern, mellow indie-pop feel, four-bar loop',
  },
  {
    label: 'Keys',
    caption:
      'Warm Rhodes electric piano chords at 84 BPM, jazzy seventh voicings, soft tremolo, mellow lo-fi character, four-bar progression that loops seamlessly',
  },
  {
    label: 'Pad',
    caption:
      'A wide evolving ambient synth pad at 70 BPM, lush detuned saw layers, slow filter swell, spacious reverb tail, atmospheric texture bed',
  },
  {
    label: 'Lead',
    caption:
      'A gliding analog lead synthesizer melody at 124 BPM, portamento between notes, saw and square wave layers, catchy hooky phrase in A minor, four-bar loop',
  },
  {
    label: 'Strings',
    caption:
      'Orchestral string section stabs at 110 BPM, short accented hits with natural hall reverb, dramatic cinematic motif, four-bar pattern',
  },
  {
    label: 'Percussion',
    caption:
      'A crisp 16th-note hi-hat and shaker percussion layer at 128 BPM, closed hats with subtle velocity variation and swing, tight electronic groove, seamless loop',
  },
]

const HEADER_W = 176
const LANE_H = 64

function fmt(t) {
  if (!Number.isFinite(t) || t < 0) t = 0
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
function fmt1(t) {
  if (!Number.isFinite(t) || t < 0) t = 0
  return `${fmt(t)}.${Math.floor((t % 1) * 10)}`
}

function durationOf(tracks) {
  let d = 0
  for (const t of tracks) {
    for (const c of t.clips) {
      d = Math.max(d, c.offset + (c.clipEnd - c.clipStart))
    }
  }
  return d
}

function filenameFromViewUrl(url) {
  try {
    const fn = new URL(url, window.location.origin).searchParams.get('filename')
    if (fn) return fn.replace(/\.[^.]+$/, '')
  } catch {
    /* ignore */
  }
  return 'track'
}

// ---------------------------------------------------------------------------
// Waveform — min/max peaks per pixel column, cached per (buffer, range, width)
// ---------------------------------------------------------------------------
function computePeaks(buffer, start, end, width) {
  const w = Math.max(1, Math.round(width))
  const key = `${start.toFixed(3)}_${end.toFixed(3)}_${w}`
  if (buffer._peaks && buffer._peaks.key === key) return buffer._peaks.val

  const sr = buffer.sampleRate
  const from = Math.max(0, Math.floor(start * sr))
  const to = Math.min(buffer.length, Math.ceil(end * sr))
  const total = Math.max(1, to - from)
  const mins = new Float32Array(w)
  const maxs = new Float32Array(w)
  const ch0 = buffer.getChannelData(0)
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null
  const step = total / w
  for (let x = 0; x < w; x++) {
    const a = from + Math.floor(x * step)
    const b = Math.min(to, from + Math.floor((x + 1) * step) + 1)
    let mn = 1
    let mx = -1
    for (let i = a; i < b; i++) {
      let v = ch0[i]
      if (ch1) v = (v + ch1[i]) * 0.5
      if (v < mn) mn = v
      if (v > mx) mx = v
    }
    if (mn > mx) {
      mn = 0
      mx = 0
    }
    mins[x] = mn
    maxs[x] = mx
  }
  const val = { mins, maxs, w }
  try {
    buffer._peaks = { key, val }
  } catch {
    /* non-extensible — recompute next time */
  }
  return val
}

const Waveform = memo(function Waveform({ buffer, start, end, width, height, color }) {
  const ref = useRef(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !buffer) return
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(1, Math.round(width))
    canvas.width = w * dpr
    canvas.height = height * dpr
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, height)
    const peaks = computePeaks(buffer, start, end, w)
    const mid = height / 2
    ctx.strokeStyle = color
    ctx.globalAlpha = 0.9
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = 0; x < peaks.w; x++) {
      const mn = mid - peaks.mins[x] * (mid - 2)
      const mx = mid - peaks.maxs[x] * (mid - 2)
      ctx.moveTo(x + 0.5, Math.min(mn, mx))
      ctx.lineTo(x + 0.5, Math.max(mn, mx) + 0.6)
    }
    ctx.stroke()
    ctx.globalAlpha = 0.35
    ctx.beginPath()
    ctx.moveTo(0, mid)
    ctx.lineTo(w, mid)
    ctx.stroke()
  }, [buffer, start, end, width, height, color])
  return <canvas ref={ref} style={{ width: `${width}px`, height: `${height}px` }} className="block" />
})

export default function MusicEditor() {
  const open = useStore((s) => s.showMusicEditor)
  const setOpen = useStore((s) => s.setShowMusicEditor)
  const outputAudio = useStore((s) => s.outputAudio)
  const history = useStore((s) => s.history)
  const deletedUrls = useStore((s) => s.deletedUrls)
  const serverUrl = useStore((s) => s.serverUrl)
  const useProxy = useStore((s) => s.useProxy)

  const [tracks, setTracks] = useState(project.tracks)
  const [selected, setSelected] = useState(null) // { trackId, clipId }
  const [rangeTool, setRangeTool] = useState(false) // drag = select range
  const [rangeSel, setRangeSel] = useState(null) // { trackId, clipId, from, to }
  const [position, setPosition] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [loop, setLoop] = useState(false)
  const [zoom, setZoom] = useState(60) // px per second
  const [masterVol, setMasterVol] = useState(1)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [aiSplit, setAiSplit] = useState(null) // null = checking, else { ok, missing, unreachable }
  const [showHistory, setShowHistory] = useState(false)
  const [showPart, setShowPart] = useState(false)
  const [partPrompt, setPartPrompt] = useState('')
  const [partDuration, setPartDuration] = useState(10)
  const [recentParts, setRecentParts] = useState([]) // { id, name, url }
  const [, setHistVer] = useState(0) // undo/redo stack version (button enable)

  const tracksRef = useRef(project.tracks)
  const selRef = useRef(null)
  const rangeRef = useRef(null)
  const undoRef = useRef([])
  const redoRef = useRef([])
  const snapRef = useRef(null) // in-flight gesture snapshot for undo
  const playingRef = useRef(false)
  const loopRef = useRef(false)
  const zoomRef = useRef(zoom)
  const lastPosRef = useRef(0)
  const clockRef = useRef(null) // { startAt, startPos }
  const sourcesRef = useRef([])
  const rafRef = useRef(0)
  const graphRef = useRef(null)
  const scrollRef = useRef(null)
  const dragRef = useRef(null)
  const fileInputRef = useRef(null)

  const dur = durationOf(tracks)
  const contentW = Math.max((dur + 3) * zoom, 10 * zoom)

  // Probe for the server-side separation node packs whenever the server
  // changes — only drives the AI button's tooltip; the click handler
  // re-checks anyway, so a stale probe can never hard-block the feature.
  useEffect(() => {
    let alive = true
    aiStemsAvailable(resolveApiBase(serverUrl, useProxy))
      .then((r) => {
        if (alive) setAiSplit(r)
      })
      .catch(() => {
        if (alive) setAiSplit({ ok: false, missing: [], unreachable: true })
      })
    return () => {
      alive = false
    }
  }, [serverUrl, useProxy])

  // Keep imperative mirrors in sync
  useEffect(() => {
    tracksRef.current = tracks
    project.tracks = tracks
  }, [tracks])
  useEffect(() => {
    selRef.current = selected
  }, [selected])
  useEffect(() => {
    rangeRef.current = rangeSel
  }, [rangeSel])
  useEffect(() => {
    playingRef.current = playing
  }, [playing])
  useEffect(() => {
    loopRef.current = loop
  }, [loop])
  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])

  // ------------------------- undo / redo -------------------------
  // Snapshots share track/clip objects (all edits are immutable), so a
  // stack entry is cheap. pushUndoNow() = discrete op (call BEFORE mutate);
  // beginGesture/endGesture bracket continuous ops (drag, sliders).
  const pushUndoNow = useCallback(() => {
    undoRef.current.push({ tracks: tracksRef.current, sel: selRef.current, range: rangeRef.current })
    if (undoRef.current.length > 80) undoRef.current.shift()
    redoRef.current = []
    setHistVer((v) => v + 1)
  }, [])

  const beginGesture = useCallback(() => {
    if (!snapRef.current) {
      snapRef.current = { tracks: tracksRef.current, sel: selRef.current, range: rangeRef.current }
    }
  }, [])

  const endGesture = useCallback(() => {
    const s = snapRef.current
    snapRef.current = null
    if (s && s.tracks !== tracksRef.current) {
      undoRef.current.push(s)
      if (undoRef.current.length > 80) undoRef.current.shift()
      redoRef.current = []
      setHistVer((v) => v + 1)
    }
  }, [])

  // ------------------------- audio engine -------------------------
  const ensureGraph = () => {
    const ctx = getCtx()
    if (!graphRef.current) {
      const master = ctx.createGain()
      master.gain.value = masterVol
      master.connect(ctx.destination)
      graphRef.current = { master, trackNodes: new Map() }
    }
    return graphRef.current
  }

  const trackNodesFor = (track, g) => {
    let n = g.trackNodes.get(track.id)
    if (!n) {
      const ctx = getCtx()
      n = { gain: ctx.createGain(), pan: ctx.createStereoPanner() }
      n.gain.connect(n.pan)
      n.pan.connect(g.master)
      g.trackNodes.set(track.id, n)
    }
    return n
  }

  // Live volume/pan/mute/solo — no reschedule needed
  useEffect(() => {
    if (!graphRef.current) return
    const anySolo = tracks.some((t) => t.solo)
    for (const t of tracks) {
      const n = graphRef.current.trackNodes.get(t.id)
      if (!n) continue
      const audible = anySolo ? t.solo : !t.mute
      n.gain.gain.value = audible ? t.gain : 0
      n.pan.pan.value = t.pan
    }
  }, [tracks, masterVol])

  useEffect(() => {
    if (graphRef.current) graphRef.current.master.gain.value = masterVol
  }, [masterVol])

  const stopSources = useCallback(() => {
    for (const s of sourcesRef.current) {
      try {
        s.stop()
      } catch {
        /* already stopped */
      }
      try {
        s.disconnect()
      } catch {
        /* ignore */
      }
    }
    sourcesRef.current = []
  }, [])

  const currentPosition = useCallback(() => {
    if (clockRef.current) {
      return clockRef.current.startPos + (getCtx().currentTime - clockRef.current.startAt)
    }
    return lastPosRef.current
  }, [])

  const updatePos = useCallback((p) => {
    lastPosRef.current = p
    setPosition(p)
  }, [])

  const play = useCallback(
    async (from) => {
      const ctx = getCtx()
      try {
        await ctx.resume()
      } catch {
        /* ignore */
      }
      const g = ensureGraph()
      g.master.gain.value = masterVol
      stopSources()
      cancelAnimationFrame(rafRef.current)

      const anySolo = tracksRef.current.some((t) => t.solo)
      const now = ctx.currentTime + 0.05
      clockRef.current = { startAt: now, startPos: from }

      for (const t of tracksRef.current) {
        const audible = anySolo ? t.solo : !t.mute
        if (!audible) continue
        const tn = trackNodesFor(t, g)
        tn.gain.gain.value = t.gain
        tn.pan.pan.value = t.pan
        for (const c of t.clips) {
          if (c.muted) continue
          const d = c.clipEnd - c.clipStart
          if (d <= 0) continue
          const local0 = from - c.offset
          if (local0 >= d) continue
          const local = Math.max(0, local0)
          const src = ctx.createBufferSource()
          src.buffer = c.buffer
          const cg = ctx.createGain()
          const t0 = now + Math.max(0, c.offset - from)
          const endT = t0 + (d - local)

          const fi = Math.min(Math.max(0, c.fadeIn), d)
          let rampEnd = t0
          if (fi > 0) {
            cg.gain.setValueAtTime(local < fi ? local / fi : 1, t0)
            if (local < fi) {
              rampEnd = t0 + (fi - local)
              cg.gain.linearRampToValueAtTime(1, rampEnd)
            }
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
          cg.connect(tn.gain)
          src.start(t0, c.clipStart + local, d - local)
          sourcesRef.current.push(src)
        }
      }

      setPlaying(true)
      playingRef.current = true

      const tick = () => {
        const p = currentPosition()
        updatePos(p)
        const total = durationOf(tracksRef.current)
        if (p >= total) {
          if (loopRef.current && total > 0) {
            play(0)
            return
          }
          stopSources()
          clockRef.current = null
          setPlaying(false)
          playingRef.current = false
          updatePos(total)
          return
        }
        const el = scrollRef.current
        if (el) {
          const x = p * zoomRef.current
          const rel = x - el.scrollLeft
          if (rel > el.clientWidth - 140 || rel < 40) {
            el.scrollLeft = Math.max(0, x - 80)
          }
        }
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    },
    [masterVol, stopSources, currentPosition, updatePos]
  )

  const pause = useCallback(() => {
    updatePos(Math.max(0, currentPosition()))
    stopSources()
    cancelAnimationFrame(rafRef.current)
    clockRef.current = null
    setPlaying(false)
    playingRef.current = false
  }, [currentPosition, stopSources, updatePos])

  const seek = useCallback(
    (p) => {
      const total = Math.max(durationOf(tracksRef.current), 0)
      const clamped = Math.max(0, Math.min(p, total))
      updatePos(clamped)
      if (playingRef.current) {
        stopSources()
        cancelAnimationFrame(rafRef.current)
        play(clamped)
      }
    },
    [play, stopSources, updatePos]
  )

  const restartAtCurrent = useCallback(() => {
    if (!playingRef.current) return
    const p = currentPosition()
    stopSources()
    cancelAnimationFrame(rafRef.current)
    play(p)
  }, [currentPosition, play, stopSources])

  // Structural edits: rebuild the schedule only while playing
  const commit = useCallback(
    (next, { restart = true } = {}) => {
      project.tracks = next
      tracksRef.current = next
      setTracks(next)
      if (restart) restartAtCurrent()
    },
    [restartAtCurrent]
  )

  // Deleting an entry in History (or "Clear all") also drops any track
  // loaded from the same file — deletion must remove it from every screen.
  useEffect(() => {
    if (!deletedUrls || deletedUrls.length === 0) return
    const cur = tracks
    const kept = cur.filter((t) => !t.clips.some((c) => c.url && deletedUrls.includes(c.url)))
    if (kept.length === cur.length) return
    pushUndoNow() // deleting a history item is undoable inside the editor
    commit(kept)
    if (selected && !kept.some((t) => t.id === selected.trackId)) setSelected(null)
    setRangeSel((r) => (r && !kept.some((t) => t.id === r.trackId) ? null : r))
  }, [deletedUrls, tracks, commit, selected, pushUndoNow]) // eslint-disable-line react-hooks/exhaustive-deps

  const applySnap = useCallback(
    (s) => {
      commit(s.tracks)
      setSelected(s.sel)
      setRangeSel(s.range)
    },
    [commit]
  )

  const undo = useCallback(() => {
    const s = undoRef.current.pop()
    if (!s) return
    redoRef.current.push({ tracks: tracksRef.current, sel: selRef.current, range: rangeRef.current })
    applySnap(s)
    setHistVer((v) => v + 1)
  }, [applySnap])

  const redo = useCallback(() => {
    const s = redoRef.current.pop()
    if (!s) return
    undoRef.current.push({ tracks: tracksRef.current, sel: selRef.current, range: rangeRef.current })
    applySnap(s)
    setHistVer((v) => v + 1)
  }, [applySnap])

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
    [commit, pushUndoNow]
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
    [addTrackFromBuffer]
  )

  // When opened from the player, pull the current output into the project.
  // The session arrangement is per-song: if the target audio isn't in the
  // current project, reset first — open for track A, close, open for track
  // B and you get B's clean timeline instead of A's (re-opening the SAME
  // song keeps your arrangement, edits and stem tracks).
  useEffect(() => {
    if (!open || !outputAudio) return
    if (project.tracks.some((t) => t.clips.some((c) => c.url === outputAudio))) return
    if (project.tracks.length > 0) {
      if (playingRef.current) pause()
      stopSources()
      project.tracks = []
      project.nextTrack = 1
      project.nextClip = 1
      undoRef.current = []
      redoRef.current = []
      tracksRef.current = []
      setTracks([])
      setSelected(null)
      setRangeSel(null)
      setPosition(0)
      setErr('')
    }
    addFromUrl(outputAudio, filenameFromViewUrl(outputAudio))
  }, [open, outputAudio, addFromUrl, pause, stopSources])

  // Stop playback when the editor closes
  useEffect(() => {
    if (!open && playingRef.current) pause()
  }, [open, pause])

  // ------------------------- clip ops -------------------------
  const updateClip = (trackId, clipId, changes, { restart = true } = {}) => {
    commit(
      tracksRef.current.map((t) =>
        t.id === trackId
          ? { ...t, clips: t.clips.map((c) => (c.id === clipId ? { ...c, ...changes } : c)) }
          : t
      ),
      { restart }
    )
  }

  const updateTrack = (trackId, changes, { restart = true } = {}) => {
    commit(
      tracksRef.current.map((t) => (t.id === trackId ? { ...t, ...changes } : t)),
      { restart }
    )
  }

  const removeTrack = (trackId) => {
    pushUndoNow()
    commit(tracksRef.current.filter((t) => t.id !== trackId))
    if (selected?.trackId === trackId) setSelected(null)
    if (rangeRef.current?.trackId === trackId) setRangeSel(null)
  }

  const removeClip = () => {
    if (!selected) return
    pushUndoNow()
    const next = tracksRef.current
      .map((t) =>
        t.id === selected.trackId ? { ...t, clips: t.clips.filter((c) => c.id !== selected.clipId) } : t
      )
      .filter((t) => t.clips.length > 0)
    commit(next)
    setSelected(null)
    setRangeSel(null)
  }

  const duplicateClip = () => {
    if (!selected) return
    pushUndoNow()
    const next = []
    for (const t of tracksRef.current) {
      if (t.id !== selected.trackId) {
        next.push(t)
        continue
      }
      const clips = []
      for (const c of t.clips) {
        clips.push(c)
        if (c.id === selected.clipId) {
          const copy = { ...c, id: project.nextClip++, offset: c.offset + (c.clipEnd - c.clipStart) }
          clips.push(copy)
        }
      }
      next.push({ ...t, clips })
    }
    commit(next)
    setRangeSel(null)
  }

  const splitSelected = () => {
    if (!selected) return
    const p = lastPosRef.current
    let done = false
    const clip = tracksRef.current.find((t) => t.id === selected.trackId)?.clips.find((c) => c.id === selected.clipId)
    const pieces = clip ? splitClipAt(clip, p, () => project.nextClip++) : null
    if (pieces) {
      pushUndoNow()
      const next = tracksRef.current.map((t) => {
        if (t.id !== selected.trackId) return t
        return { ...t, clips: t.clips.flatMap((c) => (c.id === selected.clipId ? pieces : [c])) }
      })
      commit(next)
      setSelected({ trackId: selected.trackId, clipId: pieces[1].id })
      setRangeSel(null)
      done = true
    }
    if (!done) setErr('Put the playhead inside the selected clip to split it there.')
  }

  // ------------------------- range selection: cut / mute -------------------------
  const findRangeTarget = () => {
    const r = rangeRef.current
    if (!r) return null
    const track = tracksRef.current.find((t) => t.id === r.trackId)
    const clip = track?.clips.find((c) => c.id === r.clipId)
    if (!track || !clip) return null
    return { r, track, clip }
  }

  // "Cut" — remove the selected range from the clip entirely.
  const cutSelection = () => {
    const hit = findRangeTarget()
    if (!hit) {
      setRangeSel(null)
      return
    }
    const { r, track, clip } = hit
    pushUndoNow()
    const pieces = cutRange(clip, r.from, r.to, () => project.nextClip++)
    const next = tracksRef.current
      .map((t) =>
        t.id !== track.id ? t : { ...t, clips: t.clips.flatMap((c) => (c.id === clip.id ? pieces : [c])) }
      )
      .filter((t) => t.clips.length > 0)
    commit(next)
    setRangeSel(null)
    if (selRef.current?.clipId === clip.id) setSelected(null)
  }

  // "Mute" — silence the selected range in place (clip split into 3, middle muted).
  const muteSelection = () => {
    const hit = findRangeTarget()
    if (!hit) {
      setRangeSel(null)
      return
    }
    const { r, track, clip } = hit
    pushUndoNow()
    const pieces = muteRange(clip, r.from, r.to, () => project.nextClip++)
    const next = tracksRef.current.map((t) =>
      t.id !== track.id ? t : { ...t, clips: t.clips.flatMap((c) => (c.id === clip.id ? pieces : [c])) }
    )
    commit(next)
    setRangeSel(null)
    const mid = pieces.find((c) => c.muted)
    if (mid) setSelected({ trackId: track.id, clipId: mid.id })
  }

  // Drum/bass/vocals/synth split (fast DSP: HPSS + center-aware bands).
  // Source track is muted after.
  const splitIntoStems = async () => {
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
  }

  // Server-side AI split: htdemucs 6-source → UVR Karaoke lead/backing +
  // FoxJoy Reverb dry/reverb of demucs "other". Slow (~1–2 min per clip) so
  // per-clip results are cached; falls back with an install hint when the
  // node packs are missing.
  const splitIntoStemsAI = async () => {
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
  }

  const renameTrack = (track) => {
    const name = window.prompt('Track name', track.name)
    if (!name || !name.trim() || name.trim() === track.name) return
    pushUndoNow()
    updateTrack(track.id, { name: name.trim() })
  }

  // ------------------------- AI part generation -------------------------
  // Queue a MiniMax instrumental generation right from the editor and drop
  // the result in as a new track at the playhead.
  const generatePart = async () => {
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
      const audio =
        files.find((f) => /\.(mp3|wav|flac|ogg|m4a)$/i.test(f.filename)) || files[0]
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
  }

  const onFilePicked = async (e) => {
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
        `Could not decode ${failures.join('; ')} — the file may be corrupt or an unsupported audio format.`,
      )
    }
    setBusy('')
  }

  // ------------------------- export -------------------------
  const exportMix = async () => {
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
  }

  // ------------------------- dragging -------------------------
  const startDrag = (e, track, clip, mode) => {
    e.stopPropagation()
    e.preventDefault()
    setSelected({ trackId: track.id, clipId: clip.id })

    // Range tool or Shift+drag on a clip = select a time range for cut/mute
    if (e.shiftKey || rangeTool) {
      const rect = e.currentTarget.getBoundingClientRect()
      const p = Math.max(
        clip.offset,
        Math.min(clipEndT(clip), clip.offset + (e.clientX - rect.left) / zoom)
      )
      setRangeSel({ trackId: track.id, clipId: clip.id, from: p, to: p })
      dragRef.current = {
        mode: 'range',
        startX: e.clientX,
        t0: p,
        min: clip.offset,
        max: clipEndT(clip),
        lastP: null,
      }
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }

    setRangeSel(null)
    beginGesture()
    dragRef.current = {
      mode,
      trackId: track.id,
      clipId: clip.id,
      startX: e.clientX,
      orig: { offset: clip.offset, clipStart: clip.clipStart, clipEnd: clip.clipEnd },
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onDragMove = (e) => {
    const d = dragRef.current
    if (!d) return
    if (d.mode === 'range') {
      const p = Math.max(d.min, Math.min(d.max, d.t0 + (e.clientX - d.startX) / zoom))
      d.lastP = p
      setRangeSel((r) => (r ? { ...r, from: Math.min(d.t0, p), to: Math.max(d.t0, p) } : r))
      return
    }
    const dx = (e.clientX - d.startX) / zoom
    if (Math.abs(dx) < 0.005) return
    const { orig } = d
    if (d.mode === 'move') {
      updateClip(d.trackId, d.clipId, { offset: Math.max(0, orig.offset + dx) }, { restart: false })
    } else if (d.mode === 'trim-l') {
      const maxBack = orig.clipStart
      const maxFwd = orig.clipEnd - 0.1 - orig.clipStart
      const delta = Math.max(-maxBack, Math.min(maxFwd, dx))
      updateClip(
        d.trackId,
        d.clipId,
        { clipStart: orig.clipStart + delta, offset: Math.max(0, orig.offset + delta) },
        { restart: false }
      )
    } else if (d.mode === 'trim-r') {
      const clip = tracksRef.current
        .find((t) => t.id === d.trackId)
        ?.clips.find((c) => c.id === d.clipId)
      const maxEnd = clip ? clip.buffer.duration : orig.clipEnd
      const newEnd = Math.max(orig.clipStart + 0.1, Math.min(maxEnd, orig.clipEnd + dx))
      updateClip(d.trackId, d.clipId, { clipEnd: newEnd }, { restart: false })
    }
  }

  const endDrag = () => {
    const d = dragRef.current
    dragRef.current = null
    if (d?.mode === 'range') {
      // plain click or an impossibly small drag = no selection
      if (d.lastP == null || Math.abs(d.lastP - d.t0) < 0.08) setRangeSel(null)
      return
    }
    if (d) {
      restartAtCurrent()
      endGesture()
    }
  }

  // Seek by clicking the ruler / empty lane space
  const posFromEvent = (e, el) => {
    const rect = el.getBoundingClientRect()
    return Math.max(0, (e.clientX - rect.left) / zoom)
  }

  const onRulerDown = (e) => {
    e.preventDefault()
    const el = e.currentTarget
    seek(posFromEvent(e, el))
    el.setPointerCapture(e.pointerId)
    const move = (ev) => seek(posFromEvent(ev, el))
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const onLaneDown = (e, track) => {
    if (e.target !== e.currentTarget) return
    setSelected(null)
    seek(posFromEvent(e, e.currentTarget))
    // click an empty area of a non-selected track to select the track name area? no-op
    void track
  }

  // ------------------------- keyboard -------------------------
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return

      // Undo / redo
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const k = e.key.toLowerCase()
        if (k === 'z') {
          e.preventDefault()
          if (e.shiftKey) redo()
          else undo()
          return
        }
        if (k === 'y') {
          e.preventDefault()
          redo()
          return
        }
      }

      if (e.key === ' ') {
        e.preventDefault()
        if (playingRef.current) pause()
        else if (durationOf(tracksRef.current) > 0) play(lastPosRef.current >= durationOf(tracksRef.current) ? 0 : lastPosRef.current)
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault()
        splitSelected()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        if (rangeRef.current) cutSelection()
        else removeClip()
      } else if ((e.key === 'm' || e.key === 'M') && rangeRef.current) {
        e.preventDefault()
        muteSelection()
      } else if (e.key === 'Escape') {
        if (rangeRef.current) setRangeSel(null)
        if (showPart) setShowPart(false)
        if (showHistory) setShowHistory(false)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        seek(lastPosRef.current - (e.shiftKey ? 0.1 : 1))
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        seek(lastPosRef.current + (e.shiftKey ? 0.1 : 1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selected, showPart, showHistory])

  // Zoom the timeline so the whole project fits the visible area
  const fitZoom = () => {
    const el = scrollRef.current
    const avail = Math.max(200, (el?.clientWidth || 900) - HEADER_W - 40)
    const d = Math.max(durationOf(tracksRef.current), 1)
    setZoom(Math.max(16, Math.min(400, Math.round(avail / d))))
  }

  // Ruler tick spacing
  const tickStep = (() => {
    const cands = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120]
    return cands.find((c) => c * zoom >= 56) || 300
  })()
  const ticks = []
  for (let t = 0; t <= contentW / zoom + tickStep; t += tickStep) ticks.push(t)

  const selTrack = selected ? tracks.find((t) => t.id === selected.trackId) : null
  const selClip = selTrack?.clips.find((c) => c.id === selected?.clipId) || null

  const historyEntries = history.filter((h) => h.type === 'music')

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-bg-primary/98 backdrop-blur-sm flex flex-col"
        >
          {/* Grey-out while audio loads/decodes/renders — big files can
              take a while, and a bare spinner chip reads as "nothing
              happened". Blocks clicks on the timeline underneath. */}
          <AnimatePresence>
            {busy && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                data-testid="studio-loading"
                className="absolute inset-0 z-40 bg-black/60 backdrop-blur-[2px] flex flex-col items-center justify-center gap-4 px-8 text-center"
              >
                <Loader2 size={40} className="animate-spin text-accent" />
                <p className="text-sm font-medium text-text-secondary">{busy}</p>
                <p className="text-xs text-text-muted">This can take a moment for long tracks</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Toolbar */}
          <div className="shrink-0 border-b border-border bg-bg-secondary/70 px-4 py-2.5 flex items-center gap-2 flex-wrap select-none">
            <button
              onClick={() => (playing ? pause() : dur > 0 && play(lastPosRef.current >= dur ? 0 : lastPosRef.current))}
              disabled={dur <= 0}
              className="p-2 rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-40 transition-colors"
              title="Play / pause (Space)"
            >
              {playing ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button
              onClick={() => {
                pause()
                updatePos(0)
              }}
              disabled={dur <= 0}
              className="p-2 rounded-lg bg-bg-hover hover:bg-white/10 text-text-secondary disabled:opacity-40"
              title="Stop"
            >
              <Square size={14} />
            </button>
            <button
              onClick={() => setLoop(!loop)}
              className={`p-2 rounded-lg transition-colors ${loop ? 'bg-accent text-white' : 'bg-bg-hover hover:bg-white/10 text-text-secondary'}`}
              title="Loop"
            >
              <Repeat size={14} />
            </button>

            <span className="ml-1 font-mono text-xs text-text-secondary tabular-nums">
              {fmt1(Math.min(position, dur))} <span className="text-text-muted">/ {fmt1(dur)}</span>
            </span>

            <span className="w-px h-6 bg-border mx-1" />

            {/* zoom */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setZoom((z) => Math.max(16, Math.round(z / 1.5)))}
                className="p-1.5 rounded bg-bg-hover hover:bg-white/10 text-text-secondary text-xs"
                title="Zoom out"
              >
                −
              </button>
              <input
                type="range"
                min={16}
                max={400}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="w-24 h-1 accent-accent cursor-pointer"
                aria-label="Zoom"
              />
              <button
                onClick={() => setZoom((z) => Math.min(400, Math.round(z * 1.5)))}
                className="p-1.5 rounded bg-bg-hover hover:bg-white/10 text-text-secondary text-xs"
                title="Zoom in"
              >
                +
              </button>
              <button
                onClick={fitZoom}
                className="px-1.5 py-1 rounded bg-bg-hover hover:bg-white/10 text-text-secondary text-xs"
                title="Fit project to the visible width"
              >
                Fit
              </button>
            </div>

            <span className="w-px h-6 bg-border mx-1" />

            <button
              onClick={undo}
              disabled={undoRef.current.length === 0}
              aria-label="Undo"
              className="p-2 rounded-lg bg-bg-hover hover:bg-white/10 text-text-secondary disabled:opacity-40"
              title="Undo (Ctrl+Z)"
            >
              <Undo2 size={14} />
            </button>
            <button
              onClick={redo}
              disabled={redoRef.current.length === 0}
              aria-label="Redo"
              className="p-2 rounded-lg bg-bg-hover hover:bg-white/10 text-text-secondary disabled:opacity-40"
              title="Redo (Ctrl+Shift+Z)"
            >
              <Redo2 size={14} />
            </button>

            <span className="w-px h-6 bg-border mx-1" />

            <button
              onClick={() => setRangeTool(!rangeTool)}
              data-testid="range-tool"
              aria-pressed={rangeTool}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                rangeTool
                  ? 'bg-accent text-white shadow-lg shadow-accent/25'
                  : 'bg-bg-hover hover:bg-white/10 text-text-secondary'
              }`}
              title="Range tool — drag on a clip to select a time range, then Cut or Mute it (Esc clears)"
            >
              <MoveHorizontal size={13} /> Range
            </button>
            <button
              onClick={splitSelected}
              disabled={!selected}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-bg-hover hover:bg-white/10 text-text-secondary disabled:opacity-40"
              title="Split selected clip at playhead (S)"
            >
              <Scissors size={13} /> Split
            </button>
            <button
              onClick={duplicateClip}
              disabled={!selected}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-bg-hover hover:bg-white/10 text-text-secondary disabled:opacity-40"
              title="Duplicate selected clip"
            >
              <Copy size={13} /> Copy
            </button>
            <button
              onClick={removeClip}
              disabled={!selected}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-bg-hover hover:bg-red-500/20 hover:text-red-300 disabled:opacity-40 text-text-secondary"
              title="Delete selected clip (Del)"
            >
              <Trash2 size={13} /> Delete
            </button>
            <button
              onClick={splitIntoStems}
              disabled={!selected || !!busy}
              data-testid="stems-button"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-purple-500/15 text-purple-300 hover:bg-purple-500/25 disabled:opacity-40"
              title="Fast DSP split (HPSS + center-aware bands): drums / bass / vocals / synth — instant, no models needed"
            >
              <Layers size={13} /> Stems
            </button>
            <button
              onClick={splitIntoStemsAI}
              disabled={!selected || !!busy}
              data-testid="ai-stems-button"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40"
              title={
                aiSplit && !aiSplit.ok
                  ? 'AI separation is not available: the set-soft/AudioSeparation node pack is not installed on the ComfyUI server — the fast DSP Stems button still works'
                  : "Server AI split (htdemucs 6-source): drums / bass / guitar / piano / other / reverb + lead / backing — accurate, ~1–2 min per clip"
              }
            >
              <Sparkles size={13} /> AI Stems
            </button>

            <span className="w-px h-6 bg-border mx-1" />

            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-bg-hover hover:bg-white/10 text-text-secondary"
            >
              <FileAudio size={13} /> Add file
            </button>
            <div className="relative">
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-bg-hover hover:bg-white/10 text-text-secondary"
              >
                <ListMusic size={13} /> From history
              </button>
              {showHistory && (
                <div className="absolute left-0 top-full mt-1 w-72 max-h-64 overflow-y-auto rounded-xl border border-border bg-bg-card shadow-2xl z-20 p-1.5">
                  {historyEntries.length === 0 ? (
                    <p className="text-xs text-text-muted p-2">No generated music yet</p>
                  ) : (
                    historyEntries.map((h) => (
                      <button
                        key={h.id}
                        onClick={() => {
                          setShowHistory(false)
                          addFromUrl(h.data, h.prompt || filenameFromViewUrl(h.data))
                        }}
                        className="w-full text-left px-2.5 py-2 rounded-lg text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors truncate"
                      >
                        {h.prompt || filenameFromViewUrl(h.data)}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="relative">
              <button
                onClick={() => setShowPart(!showPart)}
                disabled={!!busy}
                data-testid="ai-part-button"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-40"
              >
                <Sparkles size={13} /> AI part
              </button>
              {showPart && (
                <div
                  data-testid="ai-part-panel"
                  className="absolute left-0 top-full mt-1 w-80 rounded-xl border border-border bg-bg-card shadow-2xl z-30 p-3 space-y-2.5"
                >
                  <p className="text-xs font-medium text-text-primary">Generate a new part</p>
                  <div className="flex flex-wrap gap-1.5">
                    {PART_PRESETS.map((p) => (
                      <button
                        key={p.label}
                        onClick={() => setPartPrompt(p.caption)}
                        data-testid={`preset-${p.label.toLowerCase()}`}
                        className="px-2 py-1 rounded-full text-[10px] bg-bg-hover hover:bg-white/10 text-text-secondary hover:text-accent"
                        title={p.caption}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={partPrompt}
                    onChange={(e) => setPartPrompt(e.target.value)}
                    rows={3}
                    data-testid="ai-part-prompt"
                    placeholder="Describe the part: “isolated acoustic guitar arpeggio, dry, no other instruments”…"
                    className="w-full rounded-lg bg-bg-primary border border-border px-2.5 py-2 text-xs text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:border-accent"
                  />
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-text-muted">Length</span>
                    <select
                      value={partDuration}
                      onChange={(e) => setPartDuration(Number(e.target.value))}
                      className="rounded bg-bg-primary border border-border px-1.5 py-1 text-xs text-text-secondary"
                      aria-label="Part duration"
                    >
                      {[5, 10, 15, 30].map((d) => (
                        <option key={d} value={d}>
                          {d}s
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={generatePart}
                      disabled={!!busy || !partPrompt.trim()}
                      data-testid="ai-part-generate"
                      className="ml-auto px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent hover:bg-accent-hover text-white disabled:opacity-40"
                    >
                      Generate
                    </button>
                  </div>
                  {recentParts.length > 0 && (
                    <div className="pt-1 border-t border-border">
                      <p className="text-[10px] text-text-muted mb-1">Recent parts — click to add again</p>
                      <div className="flex flex-wrap gap-1.5">
                        {recentParts.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => addFromUrl(p.url, p.name)}
                            className="px-2 py-1 rounded-full text-[10px] bg-bg-hover hover:bg-white/10 text-text-secondary truncate max-w-[140px]"
                          >
                            {p.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <p className="text-[10px] text-text-muted leading-relaxed">
                    Instrumental-only — vocals are always excluded. Models are freed first so
                    the text encoder starts on clean VRAM.
                  </p>
                </div>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept="audio/*" multiple onChange={onFilePicked} className="hidden" />

            <span className="w-px h-6 bg-border mx-1" />

            <div className="flex items-center gap-1.5" title="Master volume">
              <Volume2 size={14} className="text-text-muted" />
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.01}
                value={masterVol}
                onChange={(e) => setMasterVol(Number(e.target.value))}
                className="w-20 h-1 accent-accent cursor-pointer"
                aria-label="Master volume"
              />
            </div>

            <button
              onClick={exportMix}
              disabled={dur <= 0 || !!busy}
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent hover:bg-accent-hover text-white disabled:opacity-40"
            >
              <Download size={13} /> Export WAV
            </button>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close studio"
              className="p-2 rounded-lg bg-bg-hover hover:bg-red-500/20 hover:text-red-300 text-text-secondary"
            >
              <X size={16} />
            </button>
          </div>

          {/* Range selection bar (shift-drag on a clip) */}
          {rangeSel && (
            <div
              data-testid="range-bar"
              className="shrink-0 border-b border-border bg-amber-500/10 px-4 py-2 flex items-center gap-4 flex-wrap text-xs select-none"
            >
              <span className="text-amber-300 font-medium">
                <Scissors size={12} className="inline mr-1.5" />
                Range {fmt1(rangeSel.from)} → {fmt1(rangeSel.to)}
                <span className="text-amber-200/70 font-mono"> ({(rangeSel.to - rangeSel.from).toFixed(2)}s)</span>
              </span>
              <button
                onClick={cutSelection}
                data-testid="range-cut"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-red-500/20 text-red-300 hover:bg-red-500/30"
                title="Remove the selected range from the clip (Del)"
              >
                <Scissors size={13} /> Cut
              </button>
              <button
                onClick={muteSelection}
                data-testid="range-mute"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
                title="Silence the selected range in place (M)"
              >
                <VolumeX size={13} /> Mute
              </button>
              <button
                onClick={() => setRangeSel(null)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-bg-hover hover:bg-white/10 text-text-secondary"
                title="Clear selection (Esc)"
              >
                <X size={13} /> Clear
              </button>
              <span className="text-text-muted">
                Cut removes it · Mute turns it off for this time only (turn M back on to edit)
              </span>
            </div>
          )}

          {/* Clip properties bar */}
          {selClip && !rangeSel && (
            <div className="shrink-0 border-b border-border bg-bg-card/60 px-4 py-2 flex items-center gap-5 flex-wrap text-xs select-none">
              <span className="text-text-secondary font-medium">
                <Music size={12} className="inline mr-1.5 text-accent" />
                {selTrack?.name}
              </span>
              <span className="text-text-muted font-mono">
                start {selClip.offset.toFixed(2)}s · len {(selClip.clipEnd - selClip.clipStart).toFixed(2)}s
              </span>
              <label className="flex items-center gap-2 text-text-muted">
                Fade in
                <input
                  type="range"
                  min={0}
                  max={Math.max(0.1, (selClip.clipEnd - selClip.clipStart) / 2)}
                  step={0.05}
                  value={selClip.fadeIn}
                  onPointerDown={beginGesture}
                  onChange={(e) =>
                    updateClip(selTrack.id, selClip.id, { fadeIn: Number(e.target.value) }, { restart: false })
                  }
                  onPointerUp={() => {
                    restartAtCurrent()
                    endGesture()
                  }}
                  className="w-24 accent-accent cursor-pointer"
                />
                <span className="font-mono w-9">{selClip.fadeIn.toFixed(2)}s</span>
              </label>
              <label className="flex items-center gap-2 text-text-muted">
                Fade out
                <input
                  type="range"
                  min={0}
                  max={Math.max(0.1, (selClip.clipEnd - selClip.clipStart) / 2)}
                  step={0.05}
                  value={selClip.fadeOut}
                  onPointerDown={beginGesture}
                  onChange={(e) =>
                    updateClip(selTrack.id, selClip.id, { fadeOut: Number(e.target.value) }, { restart: false })
                  }
                  onPointerUp={() => {
                    restartAtCurrent()
                    endGesture()
                  }}
                  className="w-24 accent-accent cursor-pointer"
                />
                <span className="font-mono w-9">{selClip.fadeOut.toFixed(2)}s</span>
              </label>
            </div>
          )}

          {/* Timeline */}
          <div
            className="relative flex-1 min-h-0"
            onPointerDown={() => {
              showHistory && setShowHistory(false)
              showPart && setShowPart(false)
            }}
          >
            <div ref={scrollRef} className="absolute inset-0 overflow-auto select-none">
              <div className="relative" style={{ width: HEADER_W + contentW }}>
                {/* Ruler */}
                <div className="sticky top-0 z-20 flex h-7">
                  <div
                    className="sticky left-0 z-30 shrink-0 h-7 bg-bg-secondary border-b border-r border-border flex items-center px-2.5 text-[10px] text-text-muted"
                    style={{ width: HEADER_W }}
                  >
                    Tracks · {tracks.length}
                  </div>
                  <div
                    className="relative h-7 bg-bg-secondary border-b border-border cursor-pointer"
                    style={{ width: contentW }}
                    onPointerDown={onRulerDown}
                  >
                    {ticks.map((t) => (
                      <div key={t} className="absolute top-0 h-full flex items-end" style={{ left: t * zoom }}>
                        <span className="absolute top-0.5 left-1 text-[9px] font-mono text-text-muted pointer-events-none">
                          {fmt(t)}
                        </span>
                        <span className="w-px h-2.5 bg-border/80" />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Rows */}
                {tracks.map((track) => (
                  <div key={track.id} className="flex border-b border-border/60" style={{ height: LANE_H }}>
                    {/* Header */}
                    <div
                      className="sticky left-0 z-10 shrink-0 bg-bg-secondary border-r border-border px-2 py-1.5 flex flex-col justify-between"
                      style={{ width: HEADER_W, height: LANE_H }}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: track.color }} />
                        <span
                          className="text-[11px] text-text-secondary truncate flex-1 cursor-text hover:text-text-primary"
                          title={`${track.name}${track.stemInfo ? ` — ${track.stemInfo}` : ''} — double-click to rename`}
                          onDoubleClick={() => renameTrack(track)}
                        >
                          {track.name}
                        </span>
                        <button
                          onClick={() => removeTrack(track.id)}
                          className="p-0.5 rounded hover:bg-red-500/20 hover:text-red-300 text-text-muted"
                          title="Remove track"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            pushUndoNow()
                            updateTrack(track.id, { mute: !track.mute })
                          }}
                          className={`w-5 h-5 rounded text-[9px] font-bold ${track.mute ? 'bg-amber-500 text-black' : 'bg-bg-hover text-text-muted hover:text-text-secondary'}`}
                          title="Mute"
                        >
                          M
                        </button>
                        <button
                          onClick={() => {
                            pushUndoNow()
                            updateTrack(track.id, { solo: !track.solo })
                          }}
                          className={`w-5 h-5 rounded text-[9px] font-bold ${track.solo ? 'bg-sky-400 text-black' : 'bg-bg-hover text-text-muted hover:text-text-secondary'}`}
                          title="Solo"
                        >
                          S
                        </button>
                        <input
                          type="range"
                          min={0}
                          max={2}
                          step={0.01}
                          value={track.gain}
                          onPointerDown={beginGesture}
                          onPointerUp={endGesture}
                          onChange={(e) => updateTrack(track.id, { gain: Number(e.target.value) }, { restart: false })}
                          className="flex-1 min-w-0 h-1 accent-accent cursor-pointer"
                          title={`Volume ${Math.round(track.gain * 100)}%`}
                        />
                        <input
                          type="range"
                          min={-1}
                          max={1}
                          step={0.01}
                          value={track.pan}
                          onPointerDown={beginGesture}
                          onPointerUp={endGesture}
                          onChange={(e) => updateTrack(track.id, { pan: Number(e.target.value) }, { restart: false })}
                          className="w-8 h-1 accent-accent cursor-pointer"
                          title={`Pan ${Math.round(track.pan * 100)}`}
                        />
                      </div>
                    </div>

                    {/* Lane */}
                    <div
                      className="relative bg-bg-primary/40 border-l border-transparent"
                      style={{ width: contentW, height: LANE_H }}
                      onPointerDown={(e) => onLaneDown(e, track)}
                    >
                      {track.clips.map((clip) => {
                        const w = Math.max(2, (clip.clipEnd - clip.clipStart) * zoom)
                        const isSel = selected?.clipId === clip.id
                        const onRange = rangeSel?.clipId === clip.id
                        return (
                          <div
                            key={clip.id}
                            data-testid="clip"
                            onPointerDown={(e) => startDrag(e, track, clip, 'move')}
                            onPointerMove={onDragMove}
                            onPointerUp={endDrag}
                            onPointerCancel={endDrag}
                            className={`absolute top-1 rounded-md overflow-hidden border transition-shadow ${
                              rangeTool
                                ? 'cursor-crosshair'
                                : 'cursor-grab active:cursor-grabbing'
                            } ${
                              isSel ? 'border-accent shadow-lg shadow-accent/30 z-[1]' : 'border-white/10 hover:border-white/30'
                            } ${clip.muted ? 'opacity-45' : ''}`}
                            style={{
                              left: clip.offset * zoom,
                              width: w,
                              height: LANE_H - 8,
                              background: `${track.color}22`,
                            }}
                            title={
                              clip.muted
                                ? `${track.name} — muted range (Range tool / Shift-drag to select, Del cuts)`
                                : `${track.name} — drag to move, edges to trim, Range tool or Shift-drag to select`
                            }
                          >
                            <div className="absolute inset-0 flex items-center pointer-events-none">
                              <Waveform
                                buffer={clip.buffer}
                                start={clip.clipStart}
                                end={clip.clipEnd}
                                width={w}
                                height={LANE_H - 8}
                                color={track.color}
                              />
                            </div>
                            {clip.muted && (
                              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <span className="px-1.5 py-0.5 rounded text-[8px] font-bold tracking-wider bg-amber-500/90 text-black">
                                  MUTED
                                </span>
                              </div>
                            )}
                            {onRange && (
                              <div
                                data-testid="range-selection"
                                className="absolute top-0 bottom-0 bg-amber-400/20 border-x-2 border-amber-300 pointer-events-none z-[3]"
                                style={{
                                  left: Math.max(0, (rangeSel.from - clip.offset) * zoom),
                                  width: Math.max(2, (rangeSel.to - rangeSel.from) * zoom),
                                }}
                              />
                            )}
                            {/* trim handles */}
                            <div
                              onPointerDown={(e) => startDrag(e, track, clip, 'trim-l')}
                              onPointerMove={onDragMove}
                              onPointerUp={endDrag}
                              className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/40 z-[2]"
                            />
                            <div
                              onPointerDown={(e) => startDrag(e, track, clip, 'trim-r')}
                              onPointerMove={onDragMove}
                              onPointerUp={endDrag}
                              className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/40 z-[2]"
                            />
                            {(clip.fadeIn > 0 || clip.fadeOut > 0) && (
                              <div className="absolute top-0.5 right-1 text-[8px] font-mono text-white/70 pointer-events-none">
                                {clip.fadeIn > 0 && `↓${clip.fadeIn.toFixed(1)} `}
                                {clip.fadeOut > 0 && `↑${clip.fadeOut.toFixed(1)}`}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}

                {/* Empty state */}
                {tracks.length === 0 && (
                  <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                    <div className="w-14 h-14 rounded-2xl bg-bg-hover flex items-center justify-center">
                      <Music size={26} className="text-text-muted" />
                    </div>
                    <p className="text-sm text-text-secondary">The studio is empty</p>
                    <p className="text-xs text-text-muted max-w-sm leading-relaxed">
                      Generate a track in the Music tab and open it here, add audio from history,
                      drop in your own files, or use <b>AI part</b> to generate a new instrument
                      part from a prompt. Turn on the <b>Range</b> tool (or Shift-drag) on a clip
                      to select a section, then <b>Cut</b> or <b> Mute</b> it. Select a clip and press <b>Stems</b> to split it into
                      drums / bass / vocals / synth (approximate DSP split).
                    </p>
                  </div>
                )}

                {/* Playhead */}
                {dur > 0 && (
                  <div
                    className="absolute top-0 bottom-0 w-px bg-red-400 pointer-events-none z-[5]"
                    style={{ left: HEADER_W + position * zoom }}
                  >
                    <span className="absolute -top-0 -left-1 w-2 h-2 rotate-45 bg-red-400" />
                  </div>
                )}
              </div>
            </div>

            {/* busy / error chips */}
            <AnimatePresence>
              {busy && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 rounded-xl bg-bg-card border border-border shadow-2xl text-xs text-text-secondary"
                >
                  <Loader2 size={13} className="animate-spin text-accent" />
                  {busy}
                  {busy.startsWith('Generating part') && (
                    <button
                      onClick={async () => {
                        const st = useStore.getState()
                        await stopGeneration(resolveApiBase(st.serverUrl, st.useProxy), null)
                      }}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-500/20 text-red-300 hover:bg-red-500/35 transition-colors"
                      title="Stop this generation"
                    >
                      <Square size={10} fill="currentColor" />
                      Stop
                    </button>
                  )}
                </motion.div>
              )}
              {err && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-2 rounded-xl bg-red-500/15 border border-red-500/40 text-xs text-red-300 max-w-xl"
                >
                  {err}
                  <button onClick={() => setErr('')} className="shrink-0 hover:text-white">
                    <X size={12} />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Status bar */}
          <div className="shrink-0 border-t border-border bg-bg-secondary/70 px-4 py-1.5 flex items-center gap-4 text-[10px] text-text-muted select-none">
            <span>
              Space play/pause · S split · Range tool or Shift-drag select · M mute range · Del
              cut/delete · Ctrl+Z undo · ←/→ seek (Shift = 0.1s)
            </span>
            <span className="ml-auto font-mono">
              {zoom.toFixed(0)} px/s · {tracks.length} track{tracks.length === 1 ? '' : 's'}
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
