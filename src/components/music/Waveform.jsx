import { memo, useEffect, useRef } from 'react'
import { computePeaks } from '../../lib/music/format'

// Waveform — min/max peaks per pixel column, cached per (buffer, range, width).
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

export default Waveform
