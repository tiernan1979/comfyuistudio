// Loudness post-processing: the raw decode comes out quiet and thin. When
// the server has the core audio nodes, chain a 3-band EQ (bass boost) and a
// volume lift between decode and save. Values are conservative — bass shelf
// +4dB at 100Hz for depth, +2dB overall gain — enough to feel loud without
// clipping. IDs start at 70 to clear the 55–60 save/trim nodes. Returns the
// updated audioRef plus the next free id.
//
// Shared by the MiniMax (numeric ids) and ACE-Step ('a70' style ids) graphs.
export function applyLoudness(wf, startId, audioRef, models) {
  let id = startId
  let ref = audioRef
  if (models.loudEq) {
    wf[String(id)] = {
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
    ref = [String(id), 0]
    id++
  }
  if (models.loudVolume) {
    wf[String(id)] = {
      class_type: 'AudioAdjustVolume',
      inputs: { audio: ref, volume: 2 },
    }
    ref = [String(id), 0]
    id++
  }
  return { audioRef: ref, nextId: id }
}
