import { useCallback, useEffect, useRef, useState } from 'react'
import useStore from '../store/useStore'
import {
  resolveApiBase,
  stopGeneration,
} from '../lib/comfyui'
import { aiStemsAvailable } from '../lib/stemsAI'
import { project, resetProject } from '../lib/music/session'
import { durationOf, filenameFromViewUrl } from '../lib/music/format'
import { HEADER_W } from '../components/music/constants'
import usePlayback from './music/usePlayback'
import useTimeline from './music/useTimeline'
import useStems from './music/useStems'
import useMusicActions from './music/useMusicActions'

// Orchestrates the music editor: session state, transport, editing, stem
// tools, loading/export and keyboard shortcuts. Components receive the
// returned object and stay presentational.
export default function useMusicEditor() {
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

  const tracksRef = useRef(project.tracks)
  const selRef = useRef(null)
  const rangeRef = useRef(null)
  const playingRef = useRef(false)
  const loopRef = useRef(false)
  const zoomRef = useRef(zoom)
  const scrollRef = useRef(null)
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

  // Keep imperative mirrors in sync.
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

  const playback = usePlayback({
    tracks,
    tracksRef,
    playingRef,
    loopRef,
    zoomRef,
    scrollRef,
    masterVol,
    setPlaying,
    setPosition,
  })

  const timeline = useTimeline({
    setTracks,
    selected,
    setSelected,
    setRangeSel,
    tracksRef,
    selRef,
    rangeRef,
    setErr,
    restartAtCurrent: playback.restartAtCurrent,
    lastPosRef: playback.lastPosRef,
    zoom,
    rangeTool,
  })

  const stems = useStems({
    selected,
    tracksRef,
    setErr,
    setBusy,
    setRangeSel,
    pushUndoNow: timeline.pushUndoNow,
    commit: timeline.commit,
    setAiSplit,
  })

  const actions = useMusicActions({
    tracks,
    tracksRef,
    dur,
    masterVol,
    commit: timeline.commit,
    pushUndoNow: timeline.pushUndoNow,
    setSelected,
    setBusy,
    setErr,
    partPrompt,
    partDuration,
    setPartPrompt,
    setShowPart,
    setRecentParts,
    busy,
  })

  // Deleting an entry in History (or "Clear all") also drops any track
  // loaded from the same file — deletion must remove it from every screen.
  useEffect(() => {
    if (!deletedUrls || deletedUrls.length === 0) return
    const cur = tracks
    const kept = cur.filter((t) => !t.clips.some((c) => c.url && deletedUrls.includes(c.url)))
    if (kept.length === cur.length) return
    timeline.pushUndoNow() // deleting a history item is undoable inside the editor
    timeline.commit(kept)
    if (selected && !kept.some((t) => t.id === selected.trackId)) setSelected(null)
    setRangeSel((r) => (r && !kept.some((t) => t.id === r.trackId) ? null : r))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deletedUrls, tracks, selected])

  // When opened from the player, pull the current output into the project.
  // The session arrangement is per-song: if the target audio isn't in the
  // current project, reset first — open for track A, close, open for track
  // B and you get B's clean timeline instead of A's (re-opening the SAME
  // song keeps your arrangement, edits and stem tracks).
  useEffect(() => {
    if (!open || !outputAudio) return
    if (project.tracks.some((t) => t.clips.some((c) => c.url === outputAudio))) return
    if (project.tracks.length > 0) {
      if (playingRef.current) playback.pause()
      playback.stopSources()
      resetProject()
      timeline.resetHistory()
      tracksRef.current = project.tracks
      setTracks(project.tracks)
      setSelected(null)
      setRangeSel(null)
      setPosition(0)
      setErr('')
    }
    actions.addFromUrl(outputAudio, filenameFromViewUrl(outputAudio))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, outputAudio])

  // Stop playback when the editor closes.
  useEffect(() => {
    if (!open && playingRef.current) playback.pause()
  }, [open, playback.pause]) // eslint-disable-line react-hooks/exhaustive-deps

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
          if (e.shiftKey) timeline.redo()
          else timeline.undo()
          return
        }
        if (k === 'y') {
          e.preventDefault()
          timeline.redo()
          return
        }
      }

      const total = durationOf(tracksRef.current)
      if (e.key === ' ') {
        e.preventDefault()
        if (playingRef.current) playback.pause()
        else if (total > 0) {
          const at = playback.lastPosRef.current
          playback.play(at >= total ? 0 : at)
        }
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault()
        timeline.splitSelected()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        if (rangeRef.current) timeline.cutSelection()
        else timeline.removeClip()
      } else if ((e.key === 'm' || e.key === 'M') && rangeRef.current) {
        e.preventDefault()
        timeline.muteSelection()
      } else if (e.key === 'Escape') {
        if (rangeRef.current) setRangeSel(null)
        if (showPart) setShowPart(false)
        if (showHistory) setShowHistory(false)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        playback.seek(playback.lastPosRef.current - (e.shiftKey ? 0.1 : 1))
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        playback.seek(playback.lastPosRef.current + (e.shiftKey ? 0.1 : 1))
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

  const onRulerDown = (e) => {
    e.preventDefault()
    const el = e.currentTarget
    playback.seek(timeline.posFromEvent(e, el))
    el.setPointerCapture(e.pointerId)
    const move = (ev) => playback.seek(timeline.posFromEvent(ev, el))
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const onLaneDown = (e) => {
    if (e.target !== e.currentTarget) return
    setSelected(null)
    playback.seek(timeline.posFromEvent(e, e.currentTarget))
  }

  const stopPartGeneration = useCallback(async () => {
    const st = useStore.getState()
    await stopGeneration(resolveApiBase(st.serverUrl, st.useProxy), null)
  }, [])

  return {
    open,
    setOpen,
    tracks,
    selected,
    setSelected,
    rangeTool,
    setRangeTool,
    rangeSel,
    setRangeSel,
    position,
    playing,
    loop,
    setLoop,
    zoom,
    setZoom,
    masterVol,
    setMasterVol,
    busy,
    err,
    setErr,
    aiSplit,
    showHistory,
    setShowHistory,
    showPart,
    setShowPart,
    partPrompt,
    setPartPrompt,
    partDuration,
    setPartDuration,
    recentParts,
    dur,
    contentW,
    scrollRef,
    fileInputRef,
    ...playback,
    ...timeline,
    ...stems,
    ...actions,
    onRulerDown,
    onLaneDown,
    fitZoom,
    tickStep,
    ticks,
    selTrack,
    selClip,
    historyEntries,
    stopPartGeneration,
  }
}
