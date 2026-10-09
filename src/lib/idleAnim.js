// Client-side idle-animation injection: adds breathing (and optionally
// eye-blink) morph targets plus a looping 8s `idle` clip to a GLB directly
// in the browser — no server round-trip. Pure ArrayBuffer math so it runs
// both in the app and in the Node test suite.
//
// Why morphs: the generated single-shell GLBs carry no skin/bones and the
// rigs (MIA/Mixamo) have no eye bones, so a procedural morph layer is the
// only way to give the preview (and the downloaded GLB) a living idle.
// Eye centers are picked by the user on the preview (texture-based auto
// detection proved unreliable on the fragmented paint atlases); breathing
// is fully automatic from body proportions.

const CS = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5124: 4, 5125: 4, 5126: 4 }
const TC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }

function parseGlb(buf) {
  if (buf.length < 20) throw new Error('GLB too short')
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB file')
  const jsonLen = dv.getUint32(12, true)
  if (dv.getUint32(16, true) !== 0x4e4f534a) throw new Error('GLB missing JSON chunk')
  const jsonEnd = 20 + jsonLen
  if (jsonEnd > buf.length) throw new Error('GLB JSON chunk out of range')
  const json = JSON.parse(new TextDecoder().decode(buf.slice(20, jsonEnd)))
  let bin = new Uint8Array(0)
  if (jsonEnd + 8 <= buf.length && dv.getUint32(jsonEnd + 4, true) === 0x004e4942) {
    const binLen = dv.getUint32(jsonEnd, true)
    if (jsonEnd + 8 + binLen > buf.length) throw new Error('GLB BIN chunk out of range')
    bin = buf.subarray(jsonEnd + 8, jsonEnd + 8 + binLen)
  }
  return { json, bin, jsonEnd }
}

function accessorOffset(json, bin, i) {
  const a = json.accessors[i]
  if (a.bufferView === undefined) throw new Error(`accessor ${i} has no bufferView`)
  const bv = json.bufferViews[a.bufferView]
  const off = (bv.byteOffset || 0) + (a.byteOffset || 0)
  const n = TC[a.type]
  const es = CS[a.componentType]
  const need = a.count * n * es
  if (off + need > bin.length) throw new Error(`accessor ${i} out of BIN range`)
  return { a, bv, off, n, es }
}

function readF32Vec3(json, bin, i) {
  const { a, bv, off, n } = accessorOffset(json, bin, i)
  if (a.type !== 'VEC3') throw new Error('expected VEC3 accessor')
  if (a.componentType !== 5126) throw new Error('unsupported mesh format (non-float positions)')
  const out = new Float32Array(a.count * 3)
  const stride = bv.byteStride || 0
  if (!stride || stride === 12) {
    out.set(new Float32Array(bin.buffer, bin.byteOffset + off, a.count * 3))
  } else {
    const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength)
    for (let v = 0; v < a.count; v++) for (let c = 0; c < 3; c++) out[v * 3 + c] = dv.getFloat32(off + v * stride + c * 4, true)
  }
  return out
}

// --- 4x4 matrix helpers (column-major, glTF convention) -------------------

function nodeMatrix(node) {
  if (node.matrix) return Float32Array.from(node.matrix)
  const [tx, ty, tz] = node.translation || [0, 0, 0]
  const [qx, qy, qz, qw] = node.rotation || [0, 0, 0, 1]
  const [sx, sy, sz] = node.scale || [1, 1, 1]
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz
  const xx = qx * x2, xy = qx * y2, xz = qx * z2
  const yy = qy * y2, yz = qy * z2, zz = qz * z2
  const wx = qw * x2, wy = qw * y2, wz = qw * z2
  return new Float32Array([
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ])
}

function invertRigid(m) {
  // inverse of an affine matrix (rotation/scale + translation)
  const a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6]
  const g = m[8], h = m[9], i = m[10]
  const det = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e)
  if (Math.abs(det) < 1e-12) return null
  const id = 1 / det
  const r = new Float32Array(16)
  r[0] = (e * i - f * h) * id
  r[1] = (c * h - b * i) * id
  r[2] = (b * f - c * e) * id
  r[4] = (f * g - d * i) * id
  r[5] = (a * i - c * g) * id
  r[6] = (c * d - a * f) * id
  r[8] = (d * h - e * g) * id
  r[9] = (b * g - a * h) * id
  r[10] = (a * e - b * d) * id
  const tx = m[12], ty = m[13], tz = m[14]
  r[12] = -(r[0] * tx + r[4] * ty + r[8] * tz)
  r[13] = -(r[1] * tx + r[5] * ty + r[9] * tz)
  r[14] = -(r[2] * tx + r[6] * ty + r[10] * tz)
  r[15] = 1
  return r
}

function xform(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ]
}

function findMeshNode(json) {
  const idx = (json.nodes || []).findIndex((n) => typeof n.mesh === 'number')
  if (idx < 0) throw new Error('no mesh node found in this GLB')
  return idx
}

// Picking support: geometry + world→model conversion for click coordinates
// coming from model-viewer's positionAndNormalFromPoint (world space).
export async function loadGlbGeometry(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer())
  const { json, bin } = parseGlb(buf)
  const nodeIdx = findMeshNode(json)
  const node = json.nodes[nodeIdx]
  const mesh = json.meshes[node.mesh]
  const prims = mesh.primitives.filter((p) => p.attributes?.POSITION !== undefined)
  if (!prims.length) throw new Error('mesh has no positions')
  const all = prims.map((p) => readF32Vec3(json, bin, p.attributes.POSITION))
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const arr of all) {
    for (let i = 0; i < arr.length; i += 3) {
      for (let c = 0; c < 3; c++) {
        const v = arr[i + c]
        if (v < min[c]) min[c] = v
        if (v > max[c]) max[c] = v
      }
    }
  }
  const inv = invertRigid(nodeMatrix(node))
  if (!inv) throw new Error('cannot invert node transform')
  const diag = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2])
  return {
    json,
    bbox: { min, max, diag },
    // world-space point → model space (where morph math happens)
    toModel: (p) => xform(inv, p[0], p[1], p[2]),
    inBbox: (p) => {
      const pad = diag * 0.03
      return p.every((v, i) => v >= min[i] - pad && v <= max[i] + pad)
    },
  }
}

// --- delta math (port of the verified Python prototype) -------------------

function blinkDeltas(out, pos, eyes) {
  const A = 0.013
  for (const [ex, ey, ez] of eyes) {
    for (let i = 0; i < pos.length; i += 3) {
      const vx = pos[i] - ex
      const vy = pos[i + 1] - ey
      const vz = pos[i + 2] - ez
      const r = Math.sqrt(vx * vx + vy * vy + vz * vz)
      const hor = Math.exp(-((vx / 0.011) ** 2))
      if (vy > -0.0015 && vy < 0.016 && r < 0.022 && pos[i + 2] > ez - 0.016) {
        const prof = Math.min(Math.max(1 - vy / 0.016, 0), 1) ** 0.8
        const w = prof * hor
        out[i + 1] -= A * w
        out[i + 2] -= 0.25 * w * Math.max(vz, 0)
      } else if (vy <= -0.0015 && vy > -0.008 && r < 0.02 && pos[i + 2] > ez - 0.016) {
        const w = Math.min(Math.max(1 + vy / 0.008, 0), 1) * hor
        out[i + 1] += 0.25 * A * w
      }
    }
  }
}

function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

function breathDeltas(out, pos) {
  const n = pos.length / 3
  let ymin = Infinity
  let ymax = -Infinity
  let zmed = 0
  const yn = new Float32Array(n)
  const r = new Float32Array(n)
  const zs = new Float32Array(n)
  for (let v = 0; v < n; v++) {
    zs[v] = pos[v * 3 + 2]
    if (pos[v * 3 + 1] < ymin) ymin = pos[v * 3 + 1]
    if (pos[v * 3 + 1] > ymax) ymax = pos[v * 3 + 1]
  }
  const sortedZ = Float32Array.from(zs).sort()
  zmed = sortedZ[n >> 1]
  const H = ymax - ymin
  if (!(H > 1e-9)) throw new Error('degenerate mesh height')
  for (let v = 0; v < n; v++) {
    yn[v] = (pos[v * 3 + 1] - ymin) / H
    const rx = pos[v * 3]
    const rz = pos[v * 3 + 2] - zmed
    r[v] = Math.hypot(rx, rz)
  }
  // per-row (body-height band) radius threshold: 65th percentile excludes
  // T-pose arms hanging outside the torso silhouette.
  const BANDS = 60
  let y0 = Infinity
  let y1 = -Infinity
  for (let v = 0; v < n; v++) {
    if (yn[v] < y0) y0 = yn[v]
    if (yn[v] > y1) y1 = yn[v]
  }
  const thr = new Float32Array(n)
  const buckets = Array.from({ length: BANDS - 1 }, () => [])
  for (let v = 0; v < n; v++) {
    if (yn[v] >= y1) continue
    const b = Math.min(BANDS - 2, Math.max(0, Math.floor(((yn[v] - y0) / (y1 - y0)) * (BANDS - 1))))
    buckets[b].push(v)
  }
  for (const b of buckets) {
    if (b.length <= 8) continue
    const rs = b.map((v) => r[v]).sort((a, c) => a - c)
    const q = quantile(rs, 0.65)
    for (const v of b) thr[v] = q
  }
  for (let v = 0; v < n; v++) {
    const rv = r[v]
    const t = Math.max(thr[v], 1e-6)
    if (rv >= t) continue
    const wY = Math.exp(-(((yn[v] - 0.6) / 0.12) ** 2))
    const soft = Math.min(Math.max(1 - (rv / t) ** 2, 0), 1)
    const w = wY * soft * 0.045 * rv
    if (w === 0 || rv <= 1e-6) continue
    const i = v * 3
    out[i] += (pos[i] / rv) * w
    out[i + 2] += (pos[i + 2] - zmed) / rv * w
  }
}

function buildClip(withBlink) {
  const times = new Set()
  for (let t = 0; t <= 8.0001; t += 0.5) times.add(Math.round(t * 1000) / 1000)
  const bKeys = []
  const bVals = []
  if (withBlink) {
    for (const t0 of [2.0, 6.0]) {
      for (const [dt, val] of [[0, 0], [0.08, 1], [0.13, 1], [0.3, 0]]) {
        const t = Math.round((t0 + dt) * 1000) / 1000
        times.add(t)
        bKeys.push(t)
        bVals.push(val)
      }
    }
    bKeys.sort((a, c) => a - c)
  }
  const ts = [...times].sort((a, c) => a - c)
  const rows = ts.map((t) => {
    const breath = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / 4)
    let blink = 0
    if (withBlink) {
      if (t <= bKeys[0]) blink = 0
      else if (t >= bKeys[bKeys.length - 1]) blink = 0
      else
        for (let k = 0; k < bKeys.length - 1; k++) {
          if (t >= bKeys[k] && t <= bKeys[k + 1]) {
            const span = bKeys[k + 1] - bKeys[k]
            const f = span === 0 ? 0 : (t - bKeys[k]) / span
            blink = bVals[k] + f * (bVals[k + 1] - bVals[k])
            break
          }
        }
    }
    return { blink, breath }
  })
  return { ts, rows }
}

// --- injection ------------------------------------------------------------

// eyes: [] → breathing only; [{x,y,z}×2] in world coords (from picking) —
// converted to model space here via the root node transform.
export async function injectIdleAnimation(blob, { eyes = [] } = {}) {
  if (eyes.length && eyes.length !== 2) throw new Error('pick both eyes (or none for breathing only)')
  const buf = new Uint8Array(await blob.arrayBuffer())
  const { json, bin } = parseGlb(buf)
  if ((json.buffers?.length || 0) !== 1) throw new Error('expected exactly one GLB buffer')
  if (json.animations?.some((a) => a.name === 'idle' || a.name?.startsWith('idle.')))
    throw new Error('this model already has an idle animation')

  const nodeIdx = findMeshNode(json)
  const node = json.nodes[nodeIdx]
  const mesh = json.meshes[node.mesh]
  const prims = (mesh.primitives || []).filter((p) => p.attributes?.POSITION !== undefined)
  if (!prims.length) throw new Error('mesh has no positions')
  for (const p of prims) {
    if (p.mode !== undefined && p.mode !== 4) throw new Error('only triangle meshes are supported')
  }

  const inv = invertRigid(nodeMatrix(node))
  if (!inv) throw new Error('cannot invert node transform')
  const eyePts = eyes.map((e) => xform(inv, e.x, e.y, e.z))

  const posList = prims.map((p) => readF32Vec3(json, bin, p.attributes.POSITION))
  const total = posList.reduce((s, a) => s + a.length, 0)
  const combined = new Float32Array(total)
  let off = 0
  for (const a of posList) {
    combined.set(a, off)
    off += a.length
  }

  const blink = new Float32Array(total)
  if (eyePts.length) blinkDeltas(blink, combined, eyePts)
  const breath = new Float32Array(total)
  breathDeltas(breath, combined)

  // existing morphs (rare here) must agree across primitives
  const mPrev = prims[0].targets?.length || 0
  if (prims.some((p) => (p.targets?.length || 0) !== mPrev))
    throw new Error('primitives with mismatched morph targets are not supported')
  const nAnim = (eyePts.length ? 1 : 0) + 1
  const W = mPrev + nAnim
  if (W > 4) throw new Error('too many morph targets to animate (max 4)')
  if (node.weights && node.weights.length !== mPrev && node.weights.length !== 0)
    throw new Error('unexpected existing node weights')
  const initW = Array.from({ length: mPrev }, (_, i) => node.weights?.[i] ?? 0)

  // serialize deltas + clip into the BIN chunk (4-byte aligned)
  const parts = []
  let cursor = bin.length
  const pad4 = () => {
    const p = (4 - (cursor % 4)) % 4
    if (p) {
      parts.push(new Uint8Array(p))
      cursor += p
    }
  }
  const addView = (bytes) => {
    pad4()
    const byteOffset = cursor
    parts.push(bytes)
    cursor += bytes.length
    const vi = json.bufferViews.length
    json.bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.length })
    return vi
  }
  const addAcc = (viewIdx, count, type, min, max) => {
    const a = { bufferView: viewIdx, componentType: 5126, count, type }
    if (min) a.min = min
    if (max) a.max = max
    json.accessors.push(a)
    return json.accessors.length - 1
  }
  const vec3MinMax = (arr) => {
    const mn = [Infinity, Infinity, Infinity]
    const mx = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < arr.length; i += 3)
      for (let c = 0; c < 3; c++) {
        const v = arr[i + c]
        if (v < mn[c]) mn[c] = v
        if (v > mx[c]) mx[c] = v
      }
    return [mn, mx]
  }

  if (!json.bufferViews) json.bufferViews = []
  if (!json.accessors) json.accessors = []

  const newTargets = []
  for (const arr of [eyePts.length ? blink : null, breath].filter(Boolean)) {
    const [mn, mx] = vec3MinMax(arr)
    const view = addView(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength))
    json.accessors.push({
      bufferView: view,
      componentType: 5126,
      count: arr.length / 3,
      type: 'VEC3',
      min: mn,
      max: mx,
    })
    newTargets.push(arr)
  }
  const targetIdxs = []
  {
    let ai = json.accessors.length - newTargets.length
    for (let k = 0; k < newTargets.length; k++) targetIdxs.push(ai++)
  }
  for (const p of prims) {
    if (!p.targets) p.targets = []
    for (const ti of targetIdxs) p.targets.push({ POSITION: ti })
  }
  node.weights = [...initW, ...Array.from({ length: nAnim }, () => 0)]

  // clip
  const withBlink = eyePts.length > 0
  const { ts, rows } = buildClip(withBlink)
  const times = Float32Array.from(ts)
  const out = new Float32Array(times.length * W)
  rows.forEach((r, i) => {
    for (let c = 0; c < mPrev; c++) out[i * W + c] = initW[c]
    let c = mPrev
    if (withBlink) out[i * W + c++] = r.blink
    out[i * W + c++] = r.breath
  })
  const tView = addView(new Uint8Array(times.buffer, times.byteOffset, times.byteLength))
  const tAcc = addAcc(tView, times.length, 'SCALAR', [times[0]], [times[times.length - 1]])
  const oType = W === 1 ? 'SCALAR' : W === 2 ? 'VEC2' : W === 3 ? 'VEC3' : 'VEC4'
  const oView = addView(new Uint8Array(out.buffer, out.byteOffset, out.byteLength))
  const oAcc = addAcc(oView, times.length, oType)

  json.animations = json.animations || []
  json.animations.unshift({
    name: 'idle',
    samplers: [{ input: tAcc, output: oAcc, interpolation: 'LINEAR' }],
    channels: [{ sampler: 0, target: { node: nodeIdx, path: 'weights' } }],
  })

  // rebuild BIN: original bytes + our appended segments
  const binPad = (4 - (cursor % 4)) % 4
  const newBin = new Uint8Array(cursor + binPad)
  newBin.set(bin, 0)
  {
    let p = bin.length
    for (const seg of parts) {
      newBin.set(seg, p)
      p += seg.length
    }
  }
  json.buffers[0].byteLength = newBin.length

  // reassemble the container (space-padded JSON, NUL-padded BIN)
  const enc = new TextEncoder().encode(JSON.stringify(json))
  const jsonPad = (4 - (enc.length % 4)) % 4
  const jsonChunkLen = enc.length + jsonPad
  const binChunkLen = newBin.length
  const total2 = 12 + 8 + jsonChunkLen + 8 + binChunkLen
  const outBuf = new Uint8Array(total2)
  const odv = new DataView(outBuf.buffer)
  outBuf.set([0x67, 0x6c, 0x54, 0x46], 0)
  odv.setUint32(4, 2, true)
  odv.setUint32(8, total2, true)
  odv.setUint32(12, jsonChunkLen, true)
  odv.setUint32(16, 0x4e4f534a, true)
  outBuf.set(enc, 20)
  outBuf.fill(0x20, 20 + enc.length, 20 + jsonChunkLen)
  odv.setUint32(20 + jsonChunkLen, binChunkLen, true)
  odv.setUint32(20 + jsonChunkLen + 4, 0x004e4942, true)
  outBuf.set(newBin, 20 + jsonChunkLen + 8)

  return {
    blob: new Blob([outBuf], { type: 'model/gltf-binary' }),
    stats: {
      blink: withBlink,
      duration: ts[ts.length - 1],
      keys: ts.length,
      morphTargets: nAnim,
    },
  }
}
