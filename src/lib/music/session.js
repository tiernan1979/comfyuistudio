import { stemBuffers as splitStemArrays } from '../stems'

// ---------------------------------------------------------------------------
// Session-scoped project. Lives at module level so closing/reopening the
// editor keeps the arrangement (AudioBuffers are memory-only).
//   track: { id, name, color, gain, pan, mute, solo, clips: [...] }
//   clip:  { id, buffer, offset, clipStart, clipEnd, fadeIn, fadeOut, muted }
// ---------------------------------------------------------------------------
export const project = { tracks: [], nextTrack: 1, nextClip: 1 }

const bufferCache = new Map() // url -> Promise<AudioBuffer> (LRU, see below)

// Decoded audio is the biggest thing this app holds in memory (a 5-minute
// stereo track is ~100 MB as float32). The cache only exists to avoid
// re-fetching/re-decoding the same file when a clip is re-added or the
// editor reopens, so a small LRU is plenty; clips themselves keep their
// AudioBuffer alive via references.
const BUFFER_CACHE_MAX = 12

let audioCtx = null
export function getCtx() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext
    audioCtx = new AC()
  }
  return audioCtx
}

export function loadBuffer(url) {
  if (bufferCache.has(url)) {
    // Refresh LRU position: delete + reinsert moves it to the end.
    const cached = bufferCache.get(url)
    bufferCache.delete(url)
    bufferCache.set(url, cached)
    return cached
  }
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
  while (bufferCache.size > BUFFER_CACHE_MAX) {
    bufferCache.delete(bufferCache.keys().next().value)
  }
  return p
}

const stemCache = new WeakMap() // AudioBuffer -> { drums, bass, vocals, synth, stats }
export const aiStemCache = new WeakMap() // source AudioBuffer -> { <AI stem key>: AudioBuffer }
// AudioBuffer -> { url, filename, subfolder, type } for buffers fetched from
// a ComfyUI /view URL. Lets the AI split reuse the file already on the server
// (input/ → LoadAudio directly, output/ → re-upload its original bytes)
// instead of WAV-uploading a re-encode that can blow the 100 MB limit (413).
export const bufferOrigin = new WeakMap()

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
export async function stemBuffers(buffer) {
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

export function encodeWav(buf) {
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
export function toStereoWav(buf) {
  if (buf.numberOfChannels >= 2) return encodeWav(buf)
  const st = getCtx().createBuffer(2, buf.length, buf.sampleRate)
  st.copyToChannel(buf.getChannelData(0), 0)
  st.copyToChannel(buf.getChannelData(0), 1)
  return encodeWav(st)
}

export function resetProject() {
  project.tracks = []
  project.nextTrack = 1
  project.nextClip = 1
}
