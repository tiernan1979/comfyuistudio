import { useCallback, useEffect, useRef } from 'react'
import { getCtx } from '../../lib/music/session'
import { durationOf } from '../../lib/music/format'

// Playback engine: WebAudio graph, scheduling, transport clock and the
// requestAnimationFrame playhead. Track/clip objects are immutable, so the
// schedule is rebuilt from refs whenever the transport restarts.
export default function usePlayback({
  tracks,
  tracksRef,
  playingRef,
  loopRef,
  zoomRef,
  scrollRef,
  masterVol,
  setPlaying,
  setPosition,
}) {
  const lastPosRef = useRef(0)
  const clockRef = useRef(null) // { startAt, startPos }
  const sourcesRef = useRef([])
  const rafRef = useRef(0)
  const graphRef = useRef(null)
  const masterVolRef = useRef(masterVol)

  useEffect(() => {
    masterVolRef.current = masterVol
  }, [masterVol])

  const ensureGraph = useCallback(() => {
    const ctx = getCtx()
    if (!graphRef.current) {
      const master = ctx.createGain()
      master.gain.value = masterVolRef.current
      master.connect(ctx.destination)
      graphRef.current = { master, trackNodes: new Map() }
    }
    return graphRef.current
  }, [])

  const trackNodesFor = useCallback((track, g) => {
    let n = g.trackNodes.get(track.id)
    if (!n) {
      const ctx = getCtx()
      n = { gain: ctx.createGain(), pan: ctx.createStereoPanner() }
      n.gain.connect(n.pan)
      n.pan.connect(g.master)
      g.trackNodes.set(track.id, n)
    }
    return n
  }, [])

  // Live volume/pan/mute/solo — no reschedule needed.
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
  }, [tracks])

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
  }, [setPosition])

  const play = useCallback(
    async (from) => {
      const ctx = getCtx()
      try {
        await ctx.resume()
      } catch {
        /* ignore */
      }
      const g = ensureGraph()
      g.master.gain.value = masterVolRef.current
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
    [
      ensureGraph,
      trackNodesFor,
      stopSources,
      currentPosition,
      updatePos,
      tracksRef,
      playingRef,
      loopRef,
      zoomRef,
      scrollRef,
      setPlaying,
    ]
  )

  const pause = useCallback(() => {
    updatePos(Math.max(0, currentPosition()))
    stopSources()
    cancelAnimationFrame(rafRef.current)
    clockRef.current = null
    setPlaying(false)
    playingRef.current = false
  }, [currentPosition, stopSources, updatePos, setPlaying, playingRef])

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
    [play, stopSources, updatePos, tracksRef, playingRef]
  )

  const restartAtCurrent = useCallback(() => {
    if (!playingRef.current) return
    const p = currentPosition()
    stopSources()
    cancelAnimationFrame(rafRef.current)
    play(p)
  }, [currentPosition, play, stopSources, playingRef])

  // Release the graph when the editor unmounts.
  useEffect(
    () => () => {
      stopSources()
      cancelAnimationFrame(rafRef.current)
      clockRef.current = null
    },
    [stopSources]
  )

  return {
    play,
    pause,
    seek,
    restartAtCurrent,
    stopSources,
    updatePos,
    currentPosition,
    lastPosRef,
  }
}
