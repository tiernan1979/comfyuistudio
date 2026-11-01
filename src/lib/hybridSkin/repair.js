// Paint-artifact cleanup for the blended face.
//
// The paint pass reproduces eyes and fine detail well but adds scratch lines,
// a bright chin blob and hue outliers. These helpers detect and remove those
// before they reach the generated texture, while leaving real features
// (beards, stubble, lips) intact.

const lumOf = (pcolor, i) =>
  (pcolor[i * 4] + pcolor[i * 4 + 1] + pcolor[i * 4 + 2]) / 3

const chromaOf = (pcolor, i) =>
  Math.max(pcolor[i * 4], pcolor[i * 4 + 1], pcolor[i * 4 + 2]) -
  Math.min(pcolor[i * 4], pcolor[i * 4 + 1], pcolor[i * 4 + 2])

function median3(pcolor, W, H, i) {
  const y = (i / W) | 0
  const x = i - y * W
  const vals = [[], [], []]
  for (let dy = -1; dy <= 1; dy++) {
    const ny = Math.min(Math.max(y + dy, 0), H - 1)
    for (let dx = -1; dx <= 1; dx++) {
      const nx = Math.min(Math.max(x + dx, 0), W - 1)
      const j = (ny * W + nx) * 4
      for (let c = 0; c < 3; c++) vals[c].push(pcolor[j + c])
    }
  }
  return vals.map((v) => v.sort((a, b) => a - b)[4])
}

export function cleanPaintArtifacts({ pcolor, pcov, W, H, nPix }) {
  for (let i = 0; i < nPix; i++) {
    if (!pcov[i]) continue
    if (lumOf(pcolor, i) <= 150 || chromaOf(pcolor, i) >= 80) continue
    const med = median3(pcolor, W, H, i)
    const d = Math.hypot(
      pcolor[i * 4] - med[0],
      pcolor[i * 4 + 1] - med[1],
      pcolor[i * 4 + 2] - med[2]
    )
    if (d > 6) {
      pcolor[i * 4] = med[0]
      pcolor[i * 4 + 1] = med[1]
      pcolor[i * 4 + 2] = med[2]
    }
  }
}

function computeChinZone(ymap, lipY, nPix) {
  const inZone = new Uint8Array(nPix)
  const zoneIdx = []
  for (let i = 0; i < nPix; i++) {
    if (ymap[i] > -1e8 && ymap[i] < lipY) {
      inZone[i] = 1
      zoneIdx.push(i)
    }
  }
  return { inZone, zoneIdx }
}

function dilateSet(set, radius, W, H) {
  const out = new Set(set)
  let frontier = [...set]
  for (let r = 0; r < radius; r++) {
    const nf = []
    for (const i of frontier) {
      const y = (i / W) | 0
      const x = i - y * W
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const j = ny * W + nx
        if (!out.has(j)) {
          out.add(j)
          nf.push(j)
        }
      }
    }
    frontier = nf
    if (!frontier.length) break
  }
  return out
}

// Dark-speck kill: only ISOLATED dark islands. A real dark beard/stubble is
// one large contiguous region — killing it and gaussian-filling from skin
// tone is what smeared the jawline. 4-connected components: keep the kill for
// components under SPECK_MAX texels, spare anything bigger.
const SPECK_MAX = 80

function findSpecks(cand, W, H, nPix) {
  const speck = new Uint8Array(nPix)
  const seen = new Uint8Array(nPix)
  const stack = []
  const comp = []
  for (let seed = 0; seed < nPix; seed++) {
    if (!cand[seed] || seen[seed]) continue
    comp.length = 0
    stack.length = 0
    stack.push(seed)
    seen[seed] = 1
    while (stack.length) {
      const i = stack.pop()
      comp.push(i)
      const y = (i / W) | 0
      const x = i - y * W
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const j = ny * W + nx
        if (cand[j] && !seen[j]) {
          seen[j] = 1
          stack.push(j)
        }
      }
    }
    if (comp.length <= SPECK_MAX) for (const i of comp) speck[i] = 1
  }
  return speck
}

function applyArtifactKills({ pcolor, palpha, pcov, W, H, nPix, inZone }) {
  const chinOk = new Uint8Array(nPix)
  for (let i = 0; i < nPix; i++) {
    if (inZone[i] && pcov[i] && palpha[i] >= 5) chinOk[i] = 1
  }

  const killRaw = []
  for (let i = 0; i < nPix; i++) {
    if (chinOk[i] && lumOf(pcolor, i) > 140 && chromaOf(pcolor, i) < 110) killRaw.push(i)
  }
  const killzone = dilateSet(killRaw, 2, W, H)
  for (const i of dilateSet(killRaw, 5, W, H)) {
    if (chinOk[i] && lumOf(pcolor, i) < 135 && chromaOf(pcolor, i) < 100) killzone.add(i)
  }

  const speckCand = new Uint8Array(nPix)
  for (let i = 0; i < nPix; i++) {
    if (chinOk[i] && lumOf(pcolor, i) < 95 && chromaOf(pcolor, i) < 110) speckCand[i] = 1
  }
  const speck = findSpecks(speckCand, W, H, nPix)

  const killMask = new Uint8Array(nPix)
  for (const i of killzone) {
    killMask[i] = 1
    palpha[i] = 0
  }
  for (let i = 0; i < nPix; i++) if (speck[i]) palpha[i] = 0

  return { killMask, speck }
}

// Zone tone alignment: paint chin -> gen chin (constant shift).
//
// Paint's chin is tonally FLAT but orange (zone mean blue ~60 vs gen ~80);
// gen's chin carries huge low-freq patches. Shift paint by ONE constant
// (zone medians) — never follow gen's spatially varying field, which would
// transplant its patches. Zone-restricted so lips/eyes keep their color.
function alignChinTone({ pcolor, zoneIdx }, gd) {
  const toneDelta = [0, 1, 2].map((c) => {
    const gArr = new Float64Array(zoneIdx.length)
    const pArr = new Float64Array(zoneIdx.length)
    for (let k = 0; k < zoneIdx.length; k++) {
      gArr[k] = gd[zoneIdx[k] * 4 + c]
      pArr[k] = pcolor[zoneIdx[k] * 4 + c]
    }
    gArr.sort()
    pArr.sort()
    return gArr[gArr.length >> 1] - pArr[pArr.length >> 1]
  })
  for (const i of zoneIdx) {
    const o = i * 4
    for (let c = 0; c < 3; c++) {
      const v = pcolor[o + c] + toneDelta[c]
      pcolor[o + c] = v < 0 ? 0 : v > 255 ? 255 : v
    }
  }
}

// Force the chin-zone interior to a single source (tone-matched paint): the
// mixed gen-show/paint-show patchwork was itself the visible mottle. The
// jaw/box-edge feather (palphaRamp -> 0) is preserved by the guard.
function forceChinInterior({ palpha, zoneIdx }, palphaRamp) {
  for (const i of zoneIdx) {
    const f = Math.min(Math.max((palphaRamp[i] - 12.75) / 63.75, 0), 1) * 255
    if (f > palpha[i]) palpha[i] = f
  }
}

// Mutates the projected atlas in place; returns the masks the repair pass
// needs afterwards (it runs on the composited texture, not the paint layer).
export function refinePaintAtlas(atlas, gd, onStatus) {
  const { pcolor, palpha, pcov, ymap, lipY, W, H, nPix } = atlas

  onStatus?.('Face blend · cleaning paint artifacts…')
  cleanPaintArtifacts(atlas)

  // Pre-kill smoothstep ramp: force-to-paint below must derive from the
  // geometric feather, not from post-kill palpha (kills zero it exactly
  // where gen's own cool patches would otherwise show through).
  const palphaRamp = palpha.slice()

  const { inZone, zoneIdx } = computeChinZone(ymap, lipY, nPix)
  const { killMask, speck } = applyArtifactKills(atlas)

  onStatus?.('Face blend · aligning chin tone…')
  alignChinTone({ pcolor, zoneIdx }, gd)
  forceChinInterior({ palpha, zoneIdx }, palphaRamp)

  return { inZone, zoneIdx, killMask, speck }
}

const midOf = (arr) => {
  arr.sort((a, b) => a - b)
  return arr[40]
}

function markBadTexels(gd, zoneIdx, killMask, speck, W, H) {
  const bad = new Uint8Array(zoneIdx.length ? gd.length / 4 : 0)
  for (const i of zoneIdx) {
    const y = (i / W) | 0
    const x = i - y * W
    const lums = [], chrs = [], bs = [], rs = []
    let darkNear = 0
    // Dark-rule guard: only flag darkness as BAD when the texel is NOT part
    // of a large dark neighborhood (7×7 window ≥ 8 dark texels = beard/
    // stubble, which must survive). Isolated dark outliers still get fixed.
    for (let dy = -3; dy <= 3; dy++) {
      const ny = Math.min(Math.max(y + dy, 0), H - 1)
      for (let dx = -3; dx <= 3; dx++) {
        const nx = Math.min(Math.max(x + dx, 0), W - 1)
        const o2 = (ny * W + nx) * 4
        if ((gd[o2] + gd[o2 + 1] + gd[o2 + 2]) / 3 < 110) darkNear++
      }
    }
    for (let dy = -1; dy <= 1; dy++) {
      const ny = Math.min(Math.max(y + dy, 0), H - 1)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = Math.min(Math.max(x + dx, 0), W - 1)
        const o = (ny * W + nx) * 4
        const r = gd[o], g = gd[o + 1], b = gd[o + 2]
        lums.push((r + g + b) / 3)
        chrs.push(Math.max(r, g, b) - Math.min(r, g, b))
        bs.push(b)
        rs.push(r)
      }
    }
    const ml = midOf(lums), mc = midOf(chrs), mB = midOf(bs), mR = midOf(rs)
    const o = i * 4
    const r = gd[o], g = gd[o + 1], b = gd[o + 2]
    const fl = (r + g + b) / 3
    const fch = Math.max(r, g, b) - Math.min(r, g, b)
    if (fl > ml + 14 && fl > 140) bad[i] = 1
    else if (fl < ml - 16 && fl < 115 && darkNear < 8) bad[i] = 1
    else if (fch > mc + 22 && fch > 95) bad[i] = 1
    else if (fl > 130 && fch < mc - 22 && fl > ml + 6) bad[i] = 1
    else if (b > mB + 16) bad[i] = 1
    else if (r > mR + 18 && b < mB + 5 && fl > 125) bad[i] = 1
  }
  for (let i = 0; i < bad.length; i++) if (killMask[i] || speck[i]) bad[i] = 1
  return bad
}

// Chin zone repair: iterative masked-gaussian fill.
//
// Bad content here is PATCH-SCALE (paint dark specks spanning 100+ texels,
// bright blobs, hue outliers) plus the alpha-kill masks themselves. A local
// median stays trapped inside a patch; instead fill from the zone-restricted
// gaussian of GOOD neighbors (sigma ~60, 2 passes).
export function repairChinZone(gd, { inZone, zoneIdx, killMask, speck }, W, H, onStatus) {
  onStatus?.('Face blend · repairing chin patches…')
  const nPix = W * H
  const bad = markBadTexels(gd, zoneIdx, killMask, speck, W, H)

  let repairCount = 0
  for (let i = 0; i < nPix; i++) if (bad[i]) repairCount++
  if (!repairCount) return repairCount

  const goodF = new Float32Array(nPix)
  const den = new Float32Array(nPix)
  const buf = new Float32Array(nPix)
  const s1 = new Float32Array(nPix)
  const s2 = new Float32Array(nPix)
  const num = new Float32Array(nPix)
  for (let i = 0; i < nPix; i++) goodF[i] = inZone[i] && !bad[i] ? 1 : 0

  const R = 73 // two box passes of r=73 ≈ gaussian sigma 60
  const boxH = (src, dst) => {
    const inv = 1 / (2 * R + 1)
    for (let y = 0; y < H; y++) {
      const row = y * W
      let sum = 0
      for (let k = -R; k <= R; k++) sum += src[row + (k < 0 ? 0 : k >= W ? W - 1 : k)]
      for (let x = 0; x < W; x++) {
        dst[row + x] = sum * inv
        const ax = x + R + 1, sx = x - R
        sum += src[row + (ax >= W ? W - 1 : ax)] - src[row + (sx < 0 ? 0 : sx)]
      }
    }
  }
  const boxV = (src, dst) => {
    const inv = 1 / (2 * R + 1)
    for (let x = 0; x < W; x++) {
      let sum = 0
      for (let k = -R; k <= R; k++) sum += src[(k < 0 ? 0 : k >= H ? H - 1 : k) * W + x]
      for (let y = 0; y < H; y++) {
        dst[y * W + x] = sum * inv
        const ay = y + R + 1, sy = y - R
        sum += src[(ay >= H ? H - 1 : ay) * W + x] - src[(sy < 0 ? 0 : sy) * W + x]
      }
    }
  }
  const gauss2 = (src, dst) => {
    boxH(src, s1)
    boxV(s1, s2)
    boxH(s2, s1)
    boxV(s1, dst)
  }

  gauss2(goodF, den)
  for (let pass = 0; pass < 2; pass++) {
    for (let c = 0; c < 3; c++) {
      for (let i = 0; i < nPix; i++) buf[i] = gd[i * 4 + c] * goodF[i]
      gauss2(buf, num)
      for (let i = 0; i < nPix; i++) {
        if (!bad[i]) continue
        const w = den[i] > 1e-3 ? den[i] : 1e-3
        const v = num[i] / w
        gd[i * 4 + c] = v < 0 ? 0 : v > 255 ? 255 : v
      }
    }
  }
  return repairCount
}
