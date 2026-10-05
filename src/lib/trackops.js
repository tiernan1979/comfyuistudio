// Pure clip-editing math for the music editor.
// A clip is a window { offset, clipStart, clipEnd } into an AudioBuffer:
//   timeline span = [offset, offset + (clipEnd - clipStart)]
//   buffer time at timeline t = clipStart + (t - offset)
// All functions return NEW clip objects (buffers are shared, never sliced).

export const MIN_PIECE = 0.05 // seconds — smaller fragments are dropped

export function clipEndT(c) {
  return c.offset + (c.clipEnd - c.clipStart)
}

// Split a clip at timeline time t. Returns [left, right] or null when t is
// too close to either edge (or outside the clip).
export function splitClipAt(clip, t, nextId) {
  const d = clip.clipEnd - clip.clipStart
  const local = t - clip.offset
  if (local <= MIN_PIECE || local >= d - MIN_PIECE) return null
  const cut = clip.clipStart + local
  return [
    { ...clip, clipEnd: cut },
    { ...clip, id: nextId(), offset: t, clipStart: cut },
  ]
}

// Remove the [from, to] range from the clip. Returns the remaining pieces
// (0, 1 or 2 clips); pieces smaller than MIN_PIECE are dropped.
export function cutRange(clip, from, to, nextId) {
  const start = clip.offset
  const end = clipEndT(clip)
  let a = Math.max(from, start)
  let b = Math.min(to, end)
  if (a > b) [a, b] = [b, a]
  if (b - a < MIN_PIECE) return [clip]
  if (a - start < MIN_PIECE && end - b < MIN_PIECE) return [] // whole clip cut away

  const out = []
  if (a - start >= MIN_PIECE) {
    out.push({ ...clip, clipEnd: clip.clipStart + (a - start) })
  }
  if (end - b >= MIN_PIECE) {
    out.push({ ...clip, id: nextId(), offset: b, clipStart: clip.clipStart + (b - start) })
  }
  return out
}

// Split the clip around [from, to] and mark the middle piece muted
// ("turn off for this time"). Returns 1–3 clips.
export function muteRange(clip, from, to, nextId) {
  const start = clip.offset
  const end = clipEndT(clip)
  let a = Math.max(from, start)
  let b = Math.min(to, end)
  if (a > b) [a, b] = [b, a]
  if (b - a < MIN_PIECE) return [clip]
  if (a - start < MIN_PIECE && end - b < MIN_PIECE) return [{ ...clip, muted: true }]

  const out = []
  if (a - start >= MIN_PIECE) {
    out.push({ ...clip, clipEnd: clip.clipStart + (a - start) })
  }
  out.push({
    ...clip,
    id: nextId(),
    offset: a,
    clipStart: clip.clipStart + (a - start),
    clipEnd: clip.clipStart + (b - start),
    muted: true,
  })
  if (end - b >= MIN_PIECE) {
    out.push({ ...clip, id: nextId(), offset: b, clipStart: clip.clipStart + (b - start) })
  }
  return out
}
