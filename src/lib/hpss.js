// Client-side harmonic/percussive source separation (HPSS) — used by the
// music editor's "split into stems" when the ComfyUI server has no real
// stem-separation nodes (no demucs/spleeter). This is DSP approximation,
// not AI separation: percussive content → "Drums", the rest is band-split.
//
// Everything here is pure typed-array math (no Web Audio), so it runs in
// Node for unit tests too.

// In-place iterative radix-2 FFT (re/im are Float32/64Arrays of length 2^k).
export function fft(re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t
      t = im[i]; im[i] = im[j]; im[j] = t
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    const half = len >> 1
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let j = 0; j < half; j++) {
        const a = i + j
        const b = a + half
        const vr = re[b] * cr - im[b] * ci
        const vi = re[b] * ci + im[b] * cr
        re[b] = re[a] - vr
        im[b] = im[a] - vi
        re[a] += vr
        im[a] += vi
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = ncr
      }
    }
  }
}

// In-place inverse FFT: conj → fft → conj → 1/n
export function ifft(re, im) {
  for (let i = 0; i < im.length; i++) im[i] = -im[i]
  fft(re, im)
  const n = re.length
  for (let i = 0; i < n; i++) {
    re[i] /= n
    im[i] = -im[i] / n
  }
}

const medianInto = (getMag, k, scratch) => {
  for (let f = 0; f < k; f++) scratch[f] = getMag(f)
  const s = scratch.subarray(0, k)
  s.sort()
  return k % 2 ? s[(k - 1) >> 1] : 0.5 * (s[k / 2 - 1] + s[k / 2])
}

// HPSS split of one channel.
//   harmonic   — sustained content (melody, bass, pads, vocals…)
//   percussive — transient content (drums, hits)
// Sliding median over `kernel` frames per frequency bin, Wiener-style mask
// applied to the harmonic part, windowed overlap-add (perpercussive = original
// − harmonic, since the masks sum to 1).
// Returns Float32Arrays of samples.length; harmonic + percussive ≈ samples.
export function hpssSplit(samples, { frameSize = 2048, hop = 1024, kernel = 15 } = {}) {
  const len = samples.length
  const bins = frameSize / 2 + 1

  const win = new Float32Array(frameSize)
  for (let i = 0; i < frameSize; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / frameSize)

  const harmonic = new Float32Array(len)
  const percussive = new Float32Array(len)
  const wsum = new Float32Array(len)

  const nFrames = Math.max(1, Math.ceil((len - frameSize) / hop) + 1)
  const re = new Float32Array(frameSize)
  const im = new Float32Array(frameSize)
  const fullRe = new Float32Array(frameSize)
  const fullIm = new Float32Array(frameSize)
  const percTime = new Float32Array(frameSize)
  const scratch = new Float32Array(kernel)

  // Causal sliding window of pending frames { start, re, im, mag, time }.
  const pending = []

  const ola = (dest, time, start, countWin) => {
    for (let i = 0; i < frameSize; i++) {
      const p = start + i
      if (p < 0 || p >= len) continue
      const w = win[i]
      dest[p] += time[i] * w
      if (countWin) wsum[p] += w * w
    }
  }

  const emit = (window) => {
    const frame = window[0]
    const k = window.length
    for (let b = 0; b < bins; b++) {
      const med = medianInto((f) => window[f].mag[b], k, scratch)
      const m = frame.mag[b]
      const perc = Math.max(0, m - med)
      const mh = med / (med + perc + 1e-8)
      fullRe[b] = frame.re[b] * mh
      fullIm[b] = frame.im[b] * mh
      if (b > 0 && b < frameSize - b) {
        fullRe[frameSize - b] = frame.re[b] * mh
        fullIm[frameSize - b] = -frame.im[b] * mh
      }
    }
    ifft(fullRe, fullIm)
    ola(harmonic, fullRe, frame.start, true)
    for (let i = 0; i < frameSize; i++) percTime[i] = frame.time[i] - fullRe[i]
    ola(percussive, percTime, frame.start, false)
  }

  for (let fIdx = 0; fIdx < nFrames; fIdx++) {
    const start = fIdx * hop
    const time = new Float32Array(frameSize)
    for (let i = 0; i < frameSize; i++) {
      const p = start + i
      time[i] = p < len ? samples[p] * win[i] : 0
      re[i] = time[i]
      im[i] = 0
    }
    fft(re, im)
    const mag = new Float32Array(bins)
    for (let b = 0; b < bins; b++) mag[b] = Math.hypot(re[b], im[b])
    pending.push({ start, re: re.slice(), im: im.slice(), mag, time })
    if (pending.length >= kernel) {
      emit(pending)
      pending.shift()
    }
  }
  while (pending.length > 0) {
    emit(pending)
    pending.shift()
  }

  for (let i = 0; i < len; i++) {
    const w = wsum[i]
    if (w > 1e-6) {
      harmonic[i] /= w
      percussive[i] /= w
    } else {
      // Near the Hann window's zero endpoints there is no energy to
      // normalize against (~0.45ms at each edge) — pass the sample through.
      harmonic[i] = samples[i]
      percussive[i] = 0
    }
  }
  return { harmonic, percussive }
}
