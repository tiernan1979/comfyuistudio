import { useCallback, useRef, useState } from 'react'
import { clipEndT, splitClipAt, cutRange, muteRange } from '../../lib/trackops'
import { project } from '../../lib/music/session'

// Editing core: undo/redo snapshots, immutable clip/track updates, range
// cut/mute, and pointer interaction for move/trim/range on the timeline.
export default function useTimeline({
  setTracks,
  selected,
  setSelected,
  setRangeSel,
  tracksRef,
  selRef,
  rangeRef,
  setErr,
  restartAtCurrent,
  lastPosRef,
  zoom,
  rangeTool,
}) {
  const [histVer, setHistVer] = useState(0) // undo/redo stack version (button enable)
  const undoRef = useRef([])
  const redoRef = useRef([])
  const snapRef = useRef(null) // in-flight gesture snapshot for undo
  const dragRef = useRef(null)

  // ------------------------- undo / redo -------------------------
  // Snapshots share track/clip objects (all edits are immutable), so a
  // stack entry is cheap. pushUndoNow() = discrete op (call BEFORE mutate);
  // beginGesture/endGesture bracket continuous ops (drag, sliders).
  const pushUndoNow = useCallback(() => {
    undoRef.current.push({ tracks: tracksRef.current, sel: selRef.current, range: rangeRef.current })
    if (undoRef.current.length > 80) undoRef.current.shift()
    redoRef.current = []
    setHistVer((v) => v + 1)
  }, [tracksRef, selRef, rangeRef])

  const beginGesture = useCallback(() => {
    if (!snapRef.current) {
      snapRef.current = { tracks: tracksRef.current, sel: selRef.current, range: rangeRef.current }
    }
  }, [tracksRef, selRef, rangeRef])

  const endGesture = useCallback(() => {
    const s = snapRef.current
    snapRef.current = null
    if (s && s.tracks !== tracksRef.current) {
      undoRef.current.push(s)
      if (undoRef.current.length > 80) undoRef.current.shift()
      redoRef.current = []
      setHistVer((v) => v + 1)
    }
  }, [tracksRef])

  const resetHistory = useCallback(() => {
    undoRef.current = []
    redoRef.current = []
    snapRef.current = null
    setHistVer((v) => v + 1)
  }, [])

  // Structural edits: rebuild the schedule only while playing.
  const commit = useCallback(
    (next, { restart = true } = {}) => {
      project.tracks = next
      tracksRef.current = next
      setTracks(next)
      if (restart) restartAtCurrent()
    },
    [restartAtCurrent, setTracks, tracksRef]
  )

  const applySnap = useCallback(
    (s) => {
      commit(s.tracks)
      setSelected(s.sel)
      setRangeSel(s.range)
    },
    [commit, setSelected, setRangeSel]
  )

  const undo = useCallback(() => {
    const s = undoRef.current.pop()
    if (!s) return
    redoRef.current.push({ tracks: tracksRef.current, sel: selRef.current, range: rangeRef.current })
    applySnap(s)
    setHistVer((v) => v + 1)
  }, [applySnap, tracksRef, selRef, rangeRef])

  const redo = useCallback(() => {
    const s = redoRef.current.pop()
    if (!s) return
    undoRef.current.push({ tracks: tracksRef.current, sel: selRef.current, range: rangeRef.current })
    applySnap(s)
    setHistVer((v) => v + 1)
  }, [applySnap, tracksRef, selRef, rangeRef])

  // ------------------------- clip ops -------------------------
  const updateClip = useCallback(
    (trackId, clipId, changes, { restart = true } = {}) => {
      commit(
        tracksRef.current.map((t) =>
          t.id === trackId
            ? { ...t, clips: t.clips.map((c) => (c.id === clipId ? { ...c, ...changes } : c)) }
            : t
        ),
        { restart }
      )
    },
    [commit, tracksRef]
  )

  const updateTrack = useCallback(
    (trackId, changes, { restart = true } = {}) => {
      commit(
        tracksRef.current.map((t) => (t.id === trackId ? { ...t, ...changes } : t)),
        { restart }
      )
    },
    [commit, tracksRef]
  )

  const removeTrack = useCallback(
    (trackId) => {
      pushUndoNow()
      commit(tracksRef.current.filter((t) => t.id !== trackId))
      if (selected?.trackId === trackId) setSelected(null)
      if (rangeRef.current?.trackId === trackId) setRangeSel(null)
    },
    [pushUndoNow, commit, tracksRef, selected, setSelected, rangeRef, setRangeSel]
  )

  const removeClip = useCallback(() => {
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
  }, [selected, pushUndoNow, commit, tracksRef, setSelected, setRangeSel])

  const duplicateClip = useCallback(() => {
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
  }, [selected, pushUndoNow, commit, tracksRef, setRangeSel])

  const splitSelected = useCallback(() => {
    if (!selected) return
    let done = false
    const clip = tracksRef.current
      .find((t) => t.id === selected.trackId)
      ?.clips.find((c) => c.id === selected.clipId)
    const pieces = clip ? splitClipAt(clip, lastPosRef.current, () => project.nextClip++) : null
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
  }, [selected, tracksRef, lastPosRef, pushUndoNow, commit, setSelected, setRangeSel, setErr])

  // ------------------------- range selection: cut / mute -------------------------
  const findRangeTarget = useCallback(() => {
    const r = rangeRef.current
    if (!r) return null
    const track = tracksRef.current.find((t) => t.id === r.trackId)
    const clip = track?.clips.find((c) => c.id === r.clipId)
    if (!track || !clip) return null
    return { r, track, clip }
  }, [tracksRef, rangeRef])

  // "Cut" — remove the selected range from the clip entirely.
  const cutSelection = useCallback(() => {
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
  }, [findRangeTarget, pushUndoNow, tracksRef, commit, setRangeSel, selRef, setSelected])

  // "Mute" — silence the selected range in place (clip split into 3, middle muted).
  const muteSelection = useCallback(() => {
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
  }, [findRangeTarget, pushUndoNow, tracksRef, commit, setRangeSel, setSelected])

  const renameTrack = useCallback(
    (track, name) => {
      const next = String(name || '').trim()
      if (!next || next === track.name) return
      pushUndoNow()
      updateTrack(track.id, { name: next })
    },
    [pushUndoNow, updateTrack]
  )

  // ------------------------- dragging -------------------------
  const startDrag = useCallback(
    (e, track, clip, mode) => {
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
    },
    [zoom, rangeTool, setSelected, setRangeSel, beginGesture]
  )

  const onDragMove = useCallback(
    (e) => {
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
    },
    [zoom, setRangeSel, updateClip, tracksRef]
  )

  const endDrag = useCallback(() => {
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
  }, [setRangeSel, restartAtCurrent, endGesture])

  // Seek by clicking the ruler / empty lane space
  const posFromEvent = (e, el) => {
    const rect = el.getBoundingClientRect()
    return Math.max(0, (e.clientX - rect.left) / zoom)
  }

  return {
    pushUndoNow,
    beginGesture,
    endGesture,
    resetHistory,
    commit,
    undo,
    redo,
    canUndo: undoRef.current.length > 0,
    canRedo: redoRef.current.length > 0,
    histVer,
    updateClip,
    updateTrack,
    removeTrack,
    removeClip,
    duplicateClip,
    splitSelected,
    cutSelection,
    muteSelection,
    renameTrack,
    startDrag,
    onDragMove,
    endDrag,
    posFromEvent,
    dragRef,
  }
}
