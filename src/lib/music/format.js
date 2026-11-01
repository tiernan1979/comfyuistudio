export function fmt(t) {
  if (!Number.isFinite(t) || t < 0) t = 0
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function fmt1(t) {
  if (!Number.isFinite(t) || t < 0) t = 0
  return `${fmt(t)}.${Math.floor((t % 1) * 10)}`
}

export function durationOf(tracks) {
  let d = 0
  for (const t of tracks) {
    for (const c of t.clips) {
      d = Math.max(d, c.offset + (c.clipEnd - c.clipStart))
    }
  }
  return d
}

export function filenameFromViewUrl(url) {
  try {
    const fn = new URL(url, window.location.origin).searchParams.get('filename')
    if (fn) return fn.replace(/\.[^.]+$/, '')
  } catch {
    /* ignore */
  }
  return 'track'
}

// Min/max peaks per pixel column, cached per (buffer, range, width).
export function computePeaks(buffer, start, end, width) {
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
