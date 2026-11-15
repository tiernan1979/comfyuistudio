// Loudness post-processing: the raw decode comes out quiet and thin. When
// the server has the core audio nodes, chain a 3-band EQ (bass boost) and a
// volume lift between decode and save. Values are conservative — bass shelf
// +4dB at 100Hz for depth, +2dB overall gain — enough to feel loud without
// clipping. IDs start at 70 to clear the 55–60 save/trim nodes. Returns the
// updated audioRef plus the next free id.
//
// Shared by the MiniMax (numeric ids) and ACE-Step ('a70' style ids) graphs.
// ACE passes a string id, so increment the numeric suffix instead of doing
// `id++` (which produces the node key "NaN" and breaks the audio chain).
function splitNodeId(startId) {
  if (typeof startId === 'number') return { prefix: '', n: startId }
  const match = String(startId).match(/^(.*?)(\d+)$/)
  if (!match) return { prefix: String(startId), n: 0 }
  return { prefix: match[1], n: Number(match[2]) }
}

export function applyLoudness(wf, startId, audioRef, models) {
  const { prefix, n } = splitNodeId(startId)
  let next = n
  const nodeId = () => `${prefix}${next}`
  let ref = audioRef
  if (models.loudEq) {
    const id = nodeId()
    wf[id] = {
      class_type: 'AudioEqualizer3Band',
      inputs: {
        audio: ref,
        low_gain_dB: 4.0,
        low_freq: 100,
        mid_gain_dB: 0.0,
        mid_freq: 1000,
        mid_q: 0.7,
        high_gain_dB: 1.0,
        high_freq: 5000,
      },
    }
    ref = [id, 0]
    next++
  }
  if (models.loudVolume) {
    const id = nodeId()
    wf[id] = {
      class_type: 'AudioAdjustVolume',
      inputs: { audio: ref, volume: 2 },
    }
    ref = [id, 0]
    next++
  }
  return { audioRef: ref, nextId: prefix ? `${prefix}${next}` : next }
}
