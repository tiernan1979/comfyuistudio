// Audio download helpers shared by the Music and SFX players.
//
// ComfyUI's `SaveAudio` node ALWAYS writes .flac — there is no WAV option in
// it, even when the app's "Output Quality" says wav. So the lossless path
// transcodes the fetched FLAC to a real PCM WAV in the browser (Web Audio
// decodeAudioData handles FLAC in every current engine). If decoding fails we
// fall back to the original file so a download always succeeds.

export function audioExtFromUrl(url) {
  try {
    const u = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://x')
    const fn = u.searchParams.get('filename') || ''
    const m = fn.match(/\.(wav|flac|mp3|ogg|m4a|opus)$/i)
    if (m) return `.${m[1].toLowerCase()}`
  } catch {
    /* fall through */
  }
  return ''
}

// AudioBuffer → 16-bit PCM WAV blob (same encoder the music editor uses).
export function encodeWavBlob(audioBuffer) {
  const numCh = audioBuffer.numberOfChannels
  const sr = audioBuffer.sampleRate
  const len = audioBuffer.length
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
  for (let c = 0; c < numCh; c++) chans.push(audioBuffer.getChannelData(c))
  let off = 44
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const v = Math.max(-1, Math.min(1, chans[c][i]))
      dv.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true)
      off += 2
    }
  }
  return new Blob([ab], { type: 'audio/wav' })
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// Fetch a ComfyUI /view URL and hand the bytes to `makeName(ext)`.
//   format 'wav'      → transcode lossless (flac) sources to PCM WAV
//   format 'original' → save exactly what the server returned
export async function downloadAudioAs(url, { format = 'original', makeName } = {}) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`)
  // slice(0): decodeAudioData detaches the buffer in some engines.
  const ab = await res.arrayBuffer()
  let blob = new Blob([ab], { type: 'application/octet-stream' })
  let ext = audioExtFromUrl(url) || '.bin'

  if (format === 'wav' && ext !== '.wav') {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext
      const ctx = new Ctx()
      try {
        const decoded = await ctx.decodeAudioData(ab.slice(0))
        blob = encodeWavBlob(decoded)
        ext = '.wav'
      } finally {
        ctx.close?.()
      }
    } catch (err) {
      // No FLAC support in this engine — keep the original file.
      console.warn('[audio] WAV conversion failed, keeping the original file:', err)
    }
  }
  saveBlob(blob, makeName ? makeName(ext) : `audio${ext}`)
  return ext
}
