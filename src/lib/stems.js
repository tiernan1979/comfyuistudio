// 4-stem split (drums / bass / vocals / synth) — pure typed-array DSP so it
// runs in the browser AND in Node unit tests. Used by the music editor's
// "split into stems" (the server has no demucs-style separation node).
//
// v2 routing (center-aware, exact reconstruction):
//   bass   = LP110(mid) ± LP150(side)            (fundamentals; sharp
//            sections=2 boundary so male F0 ≥110 stays out of bass, while
//            80 Hz keeps 62% amplitude — sections=1 leaked 20%+ of F0)
//   vocals = MID harmonic ≥110 Hz (ALL the way up — no 7 kHz ceiling) + a
//            gated slice of narrowband CENTER transients (plosives/consonants)
//   synth  = SIDE harmonic ≥150 Hz only           (panned content; sections=2
//            so voice-harmonic side tops don't leak into bass — real bass
//            lows are center-panned, side lows are near-empty)
//   drums  = percussive − that gated center slice
//
// Every crossover is an exact complement (vocals/synth get `x − LP(x)`, the
// gated slice is subtracted from drums and added to vocals), so the four
// stems sum back to the original sample-exactly — no LP+HP cancellation
// notches at the crossover (the v1 independent highpass/lowpass pair nullled
// at 150 Hz / 7 kHz whenever all four stems played together).
//
// "Proper check" stats: energy composition per stem (band split + center
// ratio) measured on the outputs, returned alongside the audio.

import { hpssSplit } from './hpss.js'

// RBJ biquad, direct-form II transposed.
function biquad(type, f0, sr, Q = 0.7071) {
  const w0 = (2 * Math.PI * f0) / sr
  const c = Math.cos(w0)
  const alpha = Math.sin(w0) / (2 * Q)
  let b0, b1, b2
  if (type === 'lowpass') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0 } else { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0 }
  const a0 = 1 + alpha, a1 = -2 * c, a2 = 1 - alpha
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
}

function runFilter(x, f) {
  const y = new Float32Array(x.length)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]
    const yi = f.b0 * xi + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2
    x2 = x1; x1 = xi; y2 = y1; y1 = yi
    y[i] = yi
  }
  return y
}

// Zero-phase (forward–backward) Butterworth lowpass. The stems use exact
// complements (high = x − low) so the four stems reconstruct the input
// sample-exactly; a causal filter's passband PHASE rotation would leave a
// huge out-of-phase residue in the complement (measured: 150% of a 70 Hz
// tone surviving in the vocal stem). filtfilt removes phase entirely.
// sections=1 (|H|² response): sections=2 is −6 dB already at 0.8·fc, which
// split an 80 Hz bass fundamental 50/50 between bass and vocals — measured
// E(bass)=25% on a pure 80 Hz tone. sections=1 keeps −6 dB exactly at fc.
const lpFF = (x, fc, sr, sections = 1) => {
  const f = biquad('lowpass', fc, sr)
  let y = x
  for (let i = 0; i < sections; i++) y = runFilter(y, f)
  y = Float32Array.from(y).reverse()
  for (let i = 0; i < sections; i++) y = runFilter(y, f)
  return Float32Array.from(y).reverse()
}
const hpFF = (x, fc, sr, sections = 1) => {
  const f = biquad('highpass', fc, sr)
  let y = x
  for (let i = 0; i < sections; i++) y = runFilter(y, f)
  y = Float32Array.from(y).reverse()
  for (let i = 0; i < sections; i++) y = runFilter(y, f)
  return Float32Array.from(y).reverse()
}
const hpOnly = (x, fc, sr, order = 2) => {
  const f = biquad('highpass', fc, sr)
  let out = x
  for (let i = 0; i < order / 2; i++) out = runFilter(out, f)
  return out
}

const rms = (arr, a, b) => {
  let s = 0
  for (let i = a; i < b; i++) s += arr[i] * arr[i]
  return Math.sqrt(s / Math.max(1, b - a))
}

// Split one clip's channels into 4 stems.
//   channels: Float32Array[] (1 = mono, 2 = stereo; ch ≥2 route per-channel
//             into synth so every channel reconstructs exactly)
//   returns  { drums, bass, vocals, synth, stats } — same channel count each
//            (vocals is dual-mono from the center; extra channels silent)
export async function stemBuffers(channels, { sampleRate: sr = 44100 } = {}) {
  const n = channels.length
  const len = channels[0].length

  // HPSS per channel (yield so long clips don't freeze the spinner).
  const hp = []
  for (const ch of channels) {
    hp.push(hpssSplit(ch))
    await new Promise((r) => setTimeout(r, 0))
  }
  const H = hp.map((h) => h.harmonic)
  const P = hp.map((h) => h.percussive)

  // Mid/side of the harmonic part (ch ≥2 folded into side for exact sums).
  const mid = new Float32Array(len)
  const side = new Float32Array(len)
  if (n === 1) {
    mid.set(H[0])
  } else {
    for (let i = 0; i < len; i++) mid[i] = (H[0][i] + H[1][i]) * 0.5
    for (let i = 0; i < len; i++) side[i] = (H[0][i] - H[1][i]) * 0.5
  }

  // --- gated CENTER transient slice (plosives/consonants) → vocals ---
  // Only content that is: inside 150–7000 Hz, without drum body (<100 Hz)
  // and without cymbal crack (>9 kHz), and centered (lives in midP).
  const midP = new Float32Array(len)
  if (n === 1) midP.set(P[0])
  else for (let i = 0; i < len; i++) midP[i] = (P[0][i] + P[1][i]) * 0.5
  // Zero-phase band for the routed slice: a causal BP would leave an
  // in-band phase-ghost in drums when vocals are muted (residue |1−H| > 1).
  // Upper edge 9 kHz so sibilance tails ('sh' up to ~8k) route too; the
  // >9 kHz crack guard still keeps hats/cymbals in drums.
  const bandP = hpFF(lpFF(midP, 9000, sr, 1), 150, sr, 1)
  const f80 = biquad('lowpass', 80, sr)
  const lowP80 = runFilter(midP, f80)
  const highP = hpOnly(midP, 9000, sr, 2)

  const W = Math.max(64, Math.round(0.046 * sr))
  const HOP = W >> 1
  const nWin = Math.max(1, Math.ceil(len / HOP))
  const ebArr = new Float32Array(nWin)
  const gArr = new Float32Array(nWin)
  let ebPeak = 0
  for (let w = 0; w < nWin; w++) {
    const a = Math.min(len - 1, w * HOP)
    const b = Math.min(len, a + W)
    if (b - a < 8) break
    const eb = rms(bandP, a, b)
    ebArr[w] = eb
    if (eb > ebPeak) ebPeak = eb
  }
  const floor = ebPeak * 0.05
  for (let w = 0; w < nWin; w++) {
    const a = Math.min(len - 1, w * HOP)
    const b = Math.min(len, a + W)
    if (b - a < 8) break
    const eb = ebArr[w]
    const el = rms(lowP80, a, b)
    const eh = rms(highP, a, b)
    // body test @80 Hz (kick/snare/toms keep their low shelf in drums);
    // crack guard @9 kHz loose enough for sibilance tails (measured eh/eb
    // ≈0.67 on a 4–8k 'sh') while pure cymbal content fails the eb floor.
    gArr[w] = eb > floor && el < 0.2 * eb && eh < 0.9 * eb ? 1 : 0
  }
  // Interpolate between window CENTERS (window w covers [w*HOP, w*HOP+W],
  // so its decision is anchored at w*HOP + W/2) → short bursts get the full
  // gate instead of riding a down-ramp, with click-free ramps between.
  const g = new Float32Array(len)
  for (let i = 0; i < len; i++) {
    const pos = (i - W / 2) / HOP
    if (pos <= 0) g[i] = gArr[0]
    else if (pos >= nWin - 1) g[i] = gArr[nWin - 1]
    else {
      const w0 = Math.floor(pos)
      const t = pos - w0
      g[i] = gArr[w0] + (gArr[w0 + 1] - gArr[w0]) * t
    }
  }
  const vocP = new Float32Array(len)
  for (let i = 0; i < len; i++) vocP[i] = bandP[i] * g[i]

  // --- exact-complement band routing (zero-phase) ---
  //   mid  <110 Hz → bass ;  mid ≥110 Hz → vocals
  //   side <150 Hz → bass ;  side ≥150 Hz → synth
  const lp100M = lpFF(mid, 110, sr, 2)
  const lp150S = lpFF(side, 150, sr, 2)
  const vocalsMid = new Float32Array(len)   // mid − LP100(mid)
  const synthSide = new Float32Array(len)   // side − LP150(side)
  const bassL = new Float32Array(len)       // LP100(mid) + LP150(side)
  const bassR = new Float32Array(len)       // LP100(mid) − LP150(side)
  for (let i = 0; i < len; i++) {
    vocalsMid[i] = mid[i] - lp100M[i]
    synthSide[i] = side[i] - lp150S[i]
    bassL[i] = lp100M[i] + lp150S[i]
    bassR[i] = lp100M[i] - lp150S[i]
  }

  const drums = P.map((p) => p.slice())
  const vocals = []
  const synth = []
  const bass = []
  const voc = new Float32Array(len)
  for (let i = 0; i < len; i++) voc[i] = vocalsMid[i] + vocP[i]
  if (n === 1) {
    drums[0] = new Float32Array(len)
    for (let i = 0; i < len; i++) drums[0][i] = P[0][i] - vocP[i]
    vocals.push(voc.slice())
    synth.push(new Float32Array(len)) // mono = all center → nothing side
    bass.push(lpFF(H[0], 110, sr, 2))
  } else {
    drums[0] = new Float32Array(len)
    drums[1] = new Float32Array(len)
    for (let i = 0; i < len; i++) {
      drums[0][i] = P[0][i] - vocP[i]
      drums[1][i] = P[1][i] - vocP[i]
    }
    vocals.push(voc.slice(), voc.slice())
    synth.push(synthSide.slice())
    synth.push(Float32Array.from(synthSide, (v) => -v))
    bass.push(bassL, bassR)
    for (let c = 2; c < n; c++) {
      // extra channels: side-like routing so each channel reconstructs alone
      const lpC = lpFF(H[c], 150, sr, 2)
      const hS = new Float32Array(len)
      for (let i = 0; i < len; i++) hS[i] = H[c][i] - lpC[i]
      synth.push(hS)
      vocals.push(new Float32Array(len))
      bass.push(lpC)
    }
  }

  return { drums, bass, vocals, synth, stats: measureStats({ drums, bass, vocals, synth }, sr) }
}

// Per-stem "proper check": band composition + center ratio of the outputs.
function measureStats(stems, sr) {
  const stats = {}
  for (const [key, chans] of Object.entries(stems)) {
    let eTot = 0, eLow = 0, eMid = 0, eHigh = 0
    // Per-channel band energies (mono-summing channels would exactly cancel
    // side-mirrored stems — synth is +side/−side — and read 0%). Partition is
    // the zero-phase chain: <150 | 150–7k | >7k.
    for (const c of chans) {
      const low = lpFF(c, 150, sr, 1)
      const upTo7k = lpFF(c, 7000, sr, 1)
      for (let i = 0; i < c.length; i++) {
        const midband = upTo7k[i] - low[i]
        const high = c[i] - upTo7k[i]
        eTot += c[i] * c[i]
        eLow += low[i] * low[i]
        eHigh += high * high
        eMid += midband * midband
      }
    }
    // center ratio from the first two channels (mid vs side energy)
    let eMidSig = 0, eSideSig = 0
    if (chans.length >= 2) {
      const L = chans[0], R = chans[1]
      for (let i = 0; i < L.length; i += 4) {
        const m = (L[i] + R[i]) * 0.5
        const s = (L[i] - R[i]) * 0.5
        eMidSig += m * m
        eSideSig += s * s
      }
    } else {
      eMidSig = 1
      eSideSig = 0
    }
    const pct = (v) => (eTot > 0 ? Math.round((v / eTot) * 100) : 0)
    stats[key] = {
      lowPct: pct(eLow),
      midPct: pct(eMid),
      highPct: pct(eHigh),
      centerPct: Math.round((100 * eMidSig) / Math.max(1e-9, eMidSig + eSideSig)),
    }
  }
  return stats
}

export function formatStemInfo(stats) {
  if (!stats) return ''
  const s = stats
  return `stem check: ${s.centerPct}% center · ${s.lowPct}% <150Hz · ${s.midPct}% 150–7k · ${s.highPct}% >7k`
}
