// Hybrid Skin: blend the freshly painted face region into the GENERATED
// texture so a Skin run gives paint's eyes/details without paint's crown
// blotches or orange neck. Faces are index-aligned between the two GLBs
// (paint only re-unwraps), so each generated-atlas texel maps into the
// paint atlas through barycentric UV interpolation of the same triangle.
//
// Port of /tmp/opencode/hybrid_proof.py (validated numerically: eyes match
// paint within 1.1/255 mean, neck/crown match the generated texture exactly).
// Chin pipeline (ffC): tuned scratch/kill thresholds, zone-median tone shift
// (paint chin -> gen chin, zone-restricted so lips keep their color), force
// the chin interior to tone-matched paint off the PRE-kill ramp, then an
// iterative masked-gaussian repair of patch-scale artifacts and kill masks.
//
// Pure ArrayBuffer stages are exported for the Node test suite; texture
// decode/encode needs the browser canvas APIs.

const CS = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5124: 4, 5125: 4, 5126: 4 }
const TC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }

// Face box as fractions of the generated mesh's bounding box (calibrated on
// a ~1-unit-tall humanoid; y0/y1 measure down from the top of the head).
export const SKIN_BLEND_BOX = {
  y0f: 0.15, // chin line
  y1f: 0.045, // forehead top (crown stays generated)
  xTf: 0.0554, // half face width (× bbox height)
  z0f: 0.447, // front-of-face depth: zmin + z0f * (zmax - zmin)
  fxf: 0.0141, // feather widths (× bbox height)
  fyf: 0.0202,
  fzf: 0.0302,
  lipYf: 0.265, // fraction of (y1 - y0) above y0 → artifact kill cutoff
}

const smooth = (t) => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t
  return x * x * (3 - 2 * x)
}

function parseGlb(buf) {
  if (buf.length < 20) throw new Error('GLB too short')
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB file')
  const jsonLen = dv.getUint32(12, true)
  if (dv.getUint32(16, true) !== 0x4e4f534a) throw new Error('GLB missing JSON chunk')
  const jsonEnd = 20 + jsonLen
  const json = JSON.parse(new TextDecoder().decode(buf.slice(20, jsonEnd)))
  let bin = new Uint8Array(0)
  if (jsonEnd + 8 <= buf.length && dv.getUint32(jsonEnd + 4, true) === 0x004e4942) {
    const binLen = dv.getUint32(jsonEnd, true)
    bin = buf.subarray(jsonEnd + 8, jsonEnd + 8 + binLen)
  }
  return { json, bin }
}

function accessorSlice(json, bin, i) {
  const a = json.accessors[i]
  const bv = json.bufferViews[a.bufferView]
  const off = (bv.byteOffset || 0) + (a.byteOffset || 0)
  const n = TC[a.type]
  const es = CS[a.componentType]
  return { a, bv, off, n, es, count: a.count }
}

function readF32(json, bin, i, comps) {
  const { a, bv, off, n, es, count } = accessorSlice(json, bin, i)
  if (n !== comps) throw new Error(`expected ${comps}-component accessor`)
  const out = new Float32Array(count * comps)
  const stride = bv.byteStride || 0
  if (a.componentType === 5126 && (!stride || stride === comps * 4)) {
    out.set(new Float32Array(bin.buffer, bin.byteOffset + off, count * comps))
  } else {
    const dv = new DataView(bin.buffer, bin.byteOffset + bin.byteLength)
    for (let v = 0; v < count; v++) {
      for (let c = 0; c < comps; c++) {
        const base = off + v * (stride || comps * es) + c * es
        let val
        if (a.componentType === 5126) val = dv.getFloat32(base, true)
        else if (a.componentType === 5125) val = dv.getUint32(base, true)
        else if (a.componentType === 5123) val = dv.getUint16(base, true)
        else val = dv.getUint8(base)
        out[v * comps + c] = val
      }
    }
  }
  return out
}

function readIndices(json, bin, i) {
  const { a, bv, off, es, count } = accessorSlice(json, bin, i)
  const out = new Uint32Array(count)
  const stride = bv.byteStride || es
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength)
  for (let v = 0; v < count; v++) {
    const b = off + v * stride
    out[v] = es === 4 ? dv.getUint32(b, true) : es === 2 ? dv.getUint16(b, true) : dv.getUint8(b)
  }
  return out
}

function firstMeshPrimitive(json) {
  for (const node of json.nodes || []) {
    if (node.mesh === undefined) continue
    const mesh = json.meshes[node.mesh]
    const prim = (mesh?.primitives || []).find((p) => p.attributes?.POSITION !== undefined)
    if (prim) return { node, prim }
  }
  const mesh = json.meshes?.[0]
  const prim = (mesh?.primitives || []).find((p) => p.attributes?.POSITION !== undefined)
  if (!prim) throw new Error('mesh has no primitives')
  return { node: null, prim }
}

function imageSourceIndex(json, slot) {
  // resolved through the first PBR material; -1 = mesh has no such texture
  const mat = json.materials?.[0]
  const tex =
    slot === 'base'
      ? mat?.pbrMetallicRoughness?.baseColorTexture
      : mat?.pbrMetallicRoughness?.metallicRoughnessTexture
  if (tex && json.textures?.[tex.index]?.source !== undefined) return json.textures[tex.index].source
  if (slot === 'base') return 0
  return -1
}

function imageBytes(json, bin, idx) {
  const img = json.images[idx]
  if (!img) throw new Error('texture image missing')
  if (img.bufferView !== undefined) {
    const bv = json.bufferViews[img.bufferView]
    const off = bv.byteOffset || 0
    return bin.subarray(off, off + bv.byteLength)
  }
  if (img.uri?.startsWith('data:')) {
    const b64 = img.uri.split(',', 2)[1] || ''
    const binStr = atob(b64)
    const out = new Uint8Array(binStr.length)
    for (let i = 0; i < binStr.length; i++) out[i] = binStr.charCodeAt(i)
    return out
  }
  throw new Error('unsupported texture storage (external uri)')
}

function nodeIsIdentity(node) {
  if (!node) return true
  if (node.matrix) {
    const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    return node.matrix.every((v, i) => Math.abs(v - id[i]) < 1e-6)
  }
  const t = node.translation || [0, 0, 0]
  const r = node.rotation || [0, 0, 0, 1]
  const s = node.scale || [1, 1, 1]
  const rotId = Math.abs(r[0]) < 1e-9 && Math.abs(r[1]) < 1e-9 && Math.abs(r[2]) < 1e-9 && Math.abs(Math.abs(r[3]) - 1) < 1e-9
  return rotId && t.every((v) => Math.abs(v) < 1e-6) && s.every((v) => Math.abs(v - 1) < 1e-6)
}

// ---------------------------------------------------------------------------
// Pure stage: parse + validate both GLBs, return geometry handles.
// Exported for tests (no canvas APIs touched).
// ---------------------------------------------------------------------------
export function prepareSkinBlend(genBuf, paintBuf) {
  const gen = parseGlb(genBuf)
  const paint = parseGlb(paintBuf)
  const g = firstMeshPrimitive(gen.json)
  const p = firstMeshPrimitive(paint.json)
  if (!nodeIsIdentity(g.node))
    throw new Error('mesh has a node transform — face blend supports plain exports only')
  if (!gen.json.images?.length) throw new Error('generated mesh has no texture to blend into')
  if (g.prim.indices === undefined) throw new Error('non-indexed meshes are not supported by the face blend')

  const posG = readF32(gen.json, gen.bin, g.prim.attributes.POSITION, 3)
  const uvG = readF32(gen.json, gen.bin, g.prim.attributes.TEXCOORD_0, 2)
  const idxG = readIndices(gen.json, gen.bin, g.prim.indices)
  const uvP = readF32(paint.json, paint.bin, p.prim.attributes.TEXCOORD_0, 2)
  const idxP = readIndices(paint.json, paint.bin, p.prim.indices)
  if (idxG.length !== idxP.length) throw new Error('paint re-meshed the model — face blend needs matching faces')

  // corner-aligned correspondence check (paint only re-unwraps)
  const posP = readF32(paint.json, paint.bin, p.prim.attributes.POSITION, 3)
  const nFaces = (idxG.length / 3) | 0
  for (let f = 0; f < nFaces; f++) {
    for (let c = 0; c < 3; c++) {
      const gi = idxG[f * 3 + c] * 3
      const pi = idxP[f * 3 + c] * 3
      for (let k = 0; k < 3; k++) {
        if (Math.abs(posG[gi + k] - posP[pi + k]) > 1e-4)
          throw new Error('paint changed the geometry — face blend unavailable for this pair')
      }
    }
  }

  return { gen, paint, posG, uvG, idxG, uvP, idxP, g, p }
}

// ---------------------------------------------------------------------------
// Browser stage: decode, rasterize, blend, re-encode.
// ---------------------------------------------------------------------------
async function decodeImage(bytes) {
  const bmp = await createImageBitmap(new Blob([bytes]))
  const cv = new OffscreenCanvas(bmp.width, bmp.height)
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bmp, 0, 0)
  const data = ctx.getImageData(0, 0, bmp.width, bmp.height)
  bmp.close?.()
  return data
}

async function encodePng(imageData) {
  const cv = new OffscreenCanvas(imageData.width, imageData.height)
  cv.getContext('2d').putImageData(imageData, 0, 0)
  const blob = await cv.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}

export async function hybridSkinBlend(genBlob, paintBlob, onStatus) {
  const genBuf = new Uint8Array(await genBlob.arrayBuffer())
  const paintBuf = new Uint8Array(await paintBlob.arrayBuffer())
  const ctx = prepareSkinBlend(genBuf, paintBuf)
  const { gen, paint, posG, uvG, idxG, uvP, idxP } = ctx

  onStatus?.('Face blend · decoding textures…')
  const baseG = await decodeImage(imageBytes(gen.json, gen.bin, imageSourceIndex(gen.json, 'base')))
  const baseP = await decodeImage(imageBytes(paint.json, paint.bin, imageSourceIndex(paint.json, 'base')))
  const W = baseG.width
  const H = baseG.height
  const Wp = baseP.width
  const Hp = baseP.height
  const nPix = W * H

  const gMrIdx = imageSourceIndex(gen.json, 'mr')
  const pMrIdx = imageSourceIndex(paint.json, 'mr')
  const mrG = gMrIdx >= 0 ? await decodeImage(imageBytes(gen.json, gen.bin, gMrIdx)) : null
  const mrP = pMrIdx >= 0 ? await decodeImage(imageBytes(paint.json, paint.bin, pMrIdx)) : null

  // ---- face box from the generated mesh bbox ----
  let xmin = Infinity, ymin = Infinity, zmin = Infinity
  let xmax = -Infinity, ymax = -Infinity, zmax = -Infinity
  for (let i = 0; i < posG.length; i += 3) {
    const x = posG[i], y = posG[i + 1], z = posG[i + 2]
    if (x < xmin) xmin = x
    if (x > xmax) xmax = x
    if (y < ymin) ymin = y
    if (y > ymax) ymax = y
    if (z < zmin) zmin = z
    if (z > zmax) zmax = z
  }
  const h = ymax - ymin
  const B = SKIN_BLEND_BOX
  const xT = B.xTf * h
  const fy0 = ymax - B.y0f * h
  const fy1 = ymax - B.y1f * h
  const fz0 = zmin + B.z0f * (zmax - zmin)
  const fx = B.fxf * h
  const fyy = B.fyf * h
  const fz = B.fzf * h
  const lipY = fy0 + B.lipYf * (fy1 - fy0)

  const alphaAt = (x, y, z) =>
    smooth((xT - Math.abs(x)) / fx) * smooth((y - fy0) / fyy) * smooth((fy1 - y) / fyy) * smooth((z - fz0) / fz)

  // ---- candidate faces: 3D bbox overlaps the expanded box ----
  onStatus?.('Face blend · projecting paint into the face region…')
  const pcolor = new Uint8ClampedArray(nPix * 4)
  const palpha = new Uint8Array(nPix)
  const pcov = new Uint8Array(nPix)
  const ymap = new Float32Array(nPix)
  ymap.fill(-1e9)
  const mrout = mrP ? new Uint8ClampedArray(nPix * 4) : null
  const gd = baseG.data
  const pd = baseP.data
  const gmd = mrG?.data
  const pmd = mrP?.data
  const faces = idxG.length / 3

  for (let f = 0; f < faces; f++) {
    const a3 = idxG[f * 3] * 3, b3 = idxG[f * 3 + 1] * 3, c3 = idxG[f * 3 + 2] * 3
    const ax = posG[a3], ay = posG[a3 + 1], az = posG[a3 + 2]
    const bx = posG[b3], by = posG[b3 + 1], bz = posG[b3 + 2]
    const cx = posG[c3], cy = posG[c3 + 1], cz = posG[c3 + 2]
    const tminx = Math.min(ax, bx, cx), tmaxx = Math.max(ax, bx, cx)
    const tminy = Math.min(ay, by, cy), tmaxy = Math.max(ay, by, cy)
    const tminz = Math.min(az, bz, cz)
    if (!(tmaxx > -xT - fx && tminx < xT + fx && tmaxy > fy0 - fyy && tminy < fy1 + fyy && tminz > fz0 - fz)) continue

    // faces are corner-aligned by position, but VERTEX INDICES differ
    const pi0 = idxP[f * 3] * 2, pi1 = idxP[f * 3 + 1] * 2, pi2 = idxP[f * 3 + 2] * 2
    const gi0 = idxG[f * 3] * 2, gi1 = idxG[f * 3 + 1] * 2, gi2 = idxG[f * 3 + 2] * 2
    const gx0 = uvG[gi0] * (W - 1), gy0 = uvG[gi0 + 1] * (H - 1)
    const gx1 = uvG[gi1] * (W - 1), gy1 = uvG[gi1 + 1] * (H - 1)
    const gx2 = uvG[gi2] * (W - 1), gy2 = uvG[gi2 + 1] * (H - 1)
    const qx0 = uvP[pi0] * (Wp - 1), qy0 = uvP[pi0 + 1] * (Hp - 1)
    const qx1 = uvP[pi1] * (Wp - 1), qy1 = uvP[pi1 + 1] * (Hp - 1)
    const qx2 = uvP[pi2] * (Wp - 1), qy2 = uvP[pi2 + 1] * (Hp - 1)

    let minx = Math.max(Math.floor(Math.min(gx0, gx1, gx2)), 0)
    let maxx = Math.min(Math.ceil(Math.max(gx0, gx1, gx2)), W - 1)
    let miny = Math.max(Math.floor(Math.min(gy0, gy1, gy2)), 0)
    let maxy = Math.min(Math.ceil(Math.max(gy0, gy1, gy2)), H - 1)
    if (minx > maxx || miny > maxy) continue

    const v0x = gx1 - gx0, v0y = gy1 - gy0
    const v1x = gx2 - gx0, v1y = gy2 - gy0
    const d = v0x * v1y - v0y * v1x
    if (Math.abs(d) < 1e-9) continue
    const invd = 1 / d

    for (let py = miny; py <= maxy; py++) {
      for (let px = minx; px <= maxx; px++) {
        const ex = px - gx0, ey = py - gy0
        // w0 = weight of B, w1 = weight of C, w2 = weight of A
        const w0 = (ex * v1y - ey * v1x) * invd
        const w1 = (v0x * ey - v0y * ex) * invd
        const w2 = 1 - w0 - w1
        if (w0 < -0.0002 || w1 < -0.0002 || w2 < -0.0002) continue
        const px3 = w2 * ax + w0 * bx + w1 * cx
        const py3 = w2 * ay + w0 * by + w1 * cy
        const pz3 = w2 * az + w0 * bz + w1 * cz
        const a = alphaAt(px3, py3, pz3)
        if (a <= 0.003) continue

        const u = w2 * qx0 + w0 * qx1 + w1 * qx2
        const v = w2 * qy0 + w0 * qy1 + w1 * qy2
        const fxv = Math.min(Math.max(u, 0), Wp - 1.001)
        const fyv = Math.min(Math.max(v, 0), Hp - 1.001)
        const x0 = fxv | 0
        const y0i = fyv | 0
        const tx = fxv - x0
        const ty = fyv - y0i
        const x1 = Math.min(x0 + 1, Wp - 1)
        const y1i = Math.min(y0i + 1, Hp - 1)
        const w00 = (1 - tx) * (1 - ty)
        const w01 = tx * (1 - ty)
        const w10 = (1 - tx) * ty
        const w11 = tx * ty
        const i00 = (y0i * Wp + x0) * 4, i01 = (y0i * Wp + x1) * 4
        const i10 = (y1i * Wp + x0) * 4, i11 = (y1i * Wp + x1) * 4
        const o = (py * W + px) * 4
        pcolor[o] = pd[i00] * w00 + pd[i01] * w01 + pd[i10] * w10 + pd[i11] * w11
        pcolor[o + 1] = pd[i00 + 1] * w00 + pd[i01 + 1] * w01 + pd[i10 + 1] * w10 + pd[i11 + 1] * w11
        pcolor[o + 2] = pd[i00 + 2] * w00 + pd[i01 + 2] * w01 + pd[i10 + 2] * w10 + pd[i11 + 2] * w11
        pcolor[o + 3] = 255
        if (mrout && pmd) {
          mrout[o] = pmd[i00] * w00 + pmd[i01] * w01 + pmd[i10] * w10 + pmd[i11] * w11
          mrout[o + 1] = pmd[i00 + 1] * w00 + pmd[i01 + 1] * w01 + pmd[i10 + 1] * w10 + pmd[i11 + 1] * w11
          mrout[o + 2] = pmd[i00 + 2] * w00 + pmd[i01 + 2] * w01 + pmd[i10 + 2] * w10 + pmd[i11 + 2] * w11
          mrout[o + 3] = 255
        }
        palpha[py * W + px] = Math.round(a * 255)
        pcov[py * W + px] = 1
        ymap[py * W + px] = py3
      }
    }
  }

  // ---- gap fill: frontier expansion over unwritten active texels ----
  let need = []
  for (let i = 0; i < nPix; i++) if (palpha[i] >= 4 && !pcov[i]) need.push(i)
  for (let iter = 0; iter < 40 && need.length; iter++) {
    const next = []
    let filled = 0
    for (const i of need) {
      const y = (i / W) | 0
      const x = i - y * W
      let r = 0, g = 0, b = 0, av = 0, n = 0
      let mr = 0, mg = 0, mb = 0
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const j = ny * W + nx
        if (!pcov[j]) continue
        r += pcolor[j * 4]; g += pcolor[j * 4 + 1]; b += pcolor[j * 4 + 2]
        av += palpha[j]; n++
        if (mrout) { mr += mrout[j * 4]; mg += mrout[j * 4 + 1]; mb += mrout[j * 4 + 2] }
      }
      if (!n) { next.push(i); continue }
      pcolor[i * 4] = r / n; pcolor[i * 4 + 1] = g / n; pcolor[i * 4 + 2] = b / n; pcolor[i * 4 + 3] = 255
      palpha[i] = av / n
      if (mrout) {
        mrout[i * 4] = mr / n
        mrout[i * 4 + 1] = mg / n
        mrout[i * 4 + 2] = mb / n
        mrout[i * 4 + 3] = 255
      }
      pcov[i] = 1
      filled++
    }
    if (!filled) break
    need = next
  }

  // ---- artifact cleanup (paint's scratch lines + chin blob) ----
  onStatus?.('Face blend · cleaning paint artifacts…')
  const lum = (i) => (pcolor[i * 4] + pcolor[i * 4 + 1] + pcolor[i * 4 + 2]) / 3
  const chroma = (i) => Math.max(pcolor[i * 4], pcolor[i * 4 + 1], pcolor[i * 4 + 2]) - Math.min(pcolor[i * 4], pcolor[i * 4 + 1], pcolor[i * 4 + 2])

  const median3 = (i) => {
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

  for (let i = 0; i < nPix; i++) {
    if (!pcov[i]) continue
    if (lum(i) <= 150 || chroma(i) >= 80) continue
    const med = median3(i)
    const d = Math.hypot(pcolor[i * 4] - med[0], pcolor[i * 4 + 1] - med[1], pcolor[i * 4 + 2] - med[2])
    if (d > 6) {
      pcolor[i * 4] = med[0]; pcolor[i * 4 + 1] = med[1]; pcolor[i * 4 + 2] = med[2]
    }
  }

  // Pre-kill smoothstep ramp: force-to-paint below must derive from the
  // geometric feather, not from post-kill palpha (kills zero it exactly
  // where gen's own cool patches would otherwise show through).
  const palphaRamp = palpha.slice()

  const inZone = new Uint8Array(nPix)
  const zoneIdx = []
  for (let i = 0; i < nPix; i++) {
    if (ymap[i] > -1e8 && ymap[i] < lipY) { inZone[i] = 1; zoneIdx.push(i) }
  }

  const chinOk = new Uint8Array(nPix)
  for (const i of zoneIdx) chinOk[i] = palpha[i] >= 5 && pcov[i] ? 1 : 0
  const dilateSet = (set, radius) => {
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
          if (!out.has(j)) { out.add(j); nf.push(j) }
        }
      }
      frontier = nf
      if (!frontier.length) break
    }
    return out
  }
  const killRaw = []
  for (let i = 0; i < nPix; i++) {
    if (chinOk[i] && lum(i) > 140 && chroma(i) < 110) killRaw.push(i)
  }
  const killzone = dilateSet(killRaw, 2)
  for (const i of dilateSet(killRaw, 5)) {
    if (chinOk[i] && lum(i) < 135 && chroma(i) < 100) killzone.add(i)
  }
  // Dark-speck kill: only ISOLATED dark islands. A real dark beard/stubble
  // is one large contiguous region — killing it and gaussian-filling from
  // skin tone is what smeared the jawline. 4-connected components: keep
  // the kill for components under SPECK_MAX texels, spare anything bigger.
  const SPECK_MAX = 80
  const speckCand = new Uint8Array(nPix)
  for (let i = 0; i < nPix; i++) {
    if (chinOk[i] && lum(i) < 95 && chroma(i) < 110) speckCand[i] = 1
  }
  const speck = new Uint8Array(nPix)
  {
    const seen = new Uint8Array(nPix)
    const stack = []
    const comp = []
    for (let seed = 0; seed < nPix; seed++) {
      if (!speckCand[seed] || seen[seed]) continue
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
          if (speckCand[j] && !seen[j]) { seen[j] = 1; stack.push(j) }
        }
      }
      if (comp.length <= SPECK_MAX) for (const i of comp) speck[i] = 1
    }
  }
  const killMask = new Uint8Array(nPix)
  for (const i of killzone) { killMask[i] = 1; palpha[i] = 0 }
  for (let i = 0; i < nPix; i++) if (speck[i]) palpha[i] = 0

  // ---- zone tone alignment: paint chin -> gen chin (constant shift) --------
  // Paint's chin is tonally FLAT but orange (zone mean blue ~60 vs gen ~80);
  // gen's chin carries huge low-freq patches. Shift paint by ONE constant
  // (zone medians) — never follow gen's spatially varying field, which would
  // transplant its patches. Zone-restricted so lips/eyes keep their color.
  onStatus?.('Face blend · aligning chin tone…')
  const toneDelta = [0, 1, 2].map((c) => {
    const gArr = new Float64Array(zoneIdx.length)
    const pArr = new Float64Array(zoneIdx.length)
    for (let k = 0; k < zoneIdx.length; k++) {
      gArr[k] = gd[zoneIdx[k] * 4 + c]
      pArr[k] = pcolor[zoneIdx[k] * 4 + c]
    }
    gArr.sort(); pArr.sort()
    return gArr[gArr.length >> 1] - pArr[pArr.length >> 1]
  })
  for (const i of zoneIdx) {
    const o = i * 4
    for (let c = 0; c < 3; c++) {
      let v = pcolor[o + c] + toneDelta[c]
      pcolor[o + c] = v < 0 ? 0 : v > 255 ? 255 : v
    }
  }

  // Force the chin-zone interior to a single source (tone-matched paint):
  // the mixed gen-show/paint-show patchwork was itself the visible mottle.
  // The jaw/box-edge feather (palphaRamp -> 0) is preserved by the guard.
  for (const i of zoneIdx) {
    const f = Math.min(Math.max((palphaRamp[i] - 12.75) / 63.75, 0), 1) * 255
    if (f > palpha[i]) palpha[i] = f
  }

  // ---- global blend into the generated textures ----
  onStatus?.('Face blend · compositing…')
  for (let i = 0; i < nPix; i++) {
    const a = palpha[i] / 255
    if (a <= 0) continue
    const o = i * 4
    gd[o] = gd[o] * (1 - a) + pcolor[o] * a
    gd[o + 1] = gd[o + 1] * (1 - a) + pcolor[o + 1] * a
    gd[o + 2] = gd[o + 2] * (1 - a) + pcolor[o + 2] * a
    if (gmd && mrout) {
      gmd[o + 1] = gmd[o + 1] * (1 - a) + mrout[o + 1] * a // G = roughness
      gmd[o + 2] = gmd[o + 2] * (1 - a) + mrout[o + 2] * a // B = metallic (R = AO kept)
    }
  }

  // ---- chin zone repair: iterative masked-gaussian fill ---------------------
  // Bad content here is PATCH-SCALE (paint dark specks spanning 100+ texels,
  // bright blobs, hue outliers) plus the alpha-kill masks themselves. A local
  // median stays trapped inside a patch; instead fill from the
  // zone-restricted gaussian of GOOD neighbors (sigma ~60, 2 passes).
  onStatus?.('Face blend · repairing chin patches…')
  const bad = new Uint8Array(nPix)
  const midOf = (arr) => { arr.sort((a, b) => a - b); return arr[40] }
  // Dark-rule guard: only flag darkness as BAD when the texel is NOT part
  // of a large dark neighborhood (7×7 window ≥ 8 dark texels = beard/
  // stubble, which must survive). Isolated dark outliers still get fixed.
  for (const i of zoneIdx) {
    const y = (i / W) | 0
    const x = i - y * W
    const lums = [], chrs = [], bs = [], rs = []
    let darkNear = 0
    for (let dy = -3; dy <= 3; dy++) {
      const ny = Math.min(Math.max(y + dy, 0), H - 1)
      for (let dx = -3; dx <= 3; dx++) {
        const nx = Math.min(Math.max(x + dx, 0), W - 1)
        const o2 = (ny * W + nx) * 4
        const gr = gd[o2], gg = gd[o2 + 1], gb = gd[o2 + 2]
        if ((gr + gg + gb) / 3 < 110) darkNear++
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
        bs.push(b); rs.push(r)
      }
    }
    const ml = midOf(lums), mc = midOf(chrs), mB = midOf(bs), mR = midOf(rs)
    const o = i * 4
    const r = gd[o], g = gd[o + 1], b = gd[o + 2]
    const fl = (r + g + b) / 3
    const fch = Math.max(r, g, b) - Math.min(r, g, b)
    if ((fl > ml + 14) && fl > 140) bad[i] = 1
    else if ((fl < ml - 16) && fl < 115 && darkNear < 8) bad[i] = 1
    else if (fch > mc + 22 && fch > 95) bad[i] = 1
    else if (fl > 130 && fch < mc - 22 && fl > ml + 6) bad[i] = 1
    else if (b > mB + 16) bad[i] = 1
    else if (r > mR + 18 && b < mB + 5 && fl > 125) bad[i] = 1
  }
  for (let i = 0; i < nPix; i++) if (killMask[i] || speck[i]) bad[i] = 1

  let repairCount = 0
  for (let i = 0; i < nPix; i++) if (bad[i]) repairCount++
  if (repairCount) {
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
      boxH(src, s1); boxV(s1, s2)
      boxH(s2, s1); boxV(s1, dst)
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
  }

  // ---- encode + rebuild the generated GLB with the new images ----
  onStatus?.('Face blend · encoding…')
  const baseBytes = await encodePng(baseG)
  const mrBytes = gmd && mrout ? await encodePng(mrG) : null

  const parts = []
  let cursor = gen.bin.length
  const pad4 = () => {
    const p = (4 - (cursor % 4)) % 4
    if (p) { parts.push(new Uint8Array(p)); cursor += p }
  }
  const addView = (bytes) => {
    pad4()
    const byteOffset = cursor
    parts.push(bytes)
    cursor += bytes.length
    gen.json.bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.length })
    return gen.json.bufferViews.length - 1
  }
  if (!gen.json.bufferViews) gen.json.bufferViews = []
  const baseView = addView(baseBytes)
  const gBaseIdx = imageSourceIndex(gen.json, 'base')
  gen.json.images[gBaseIdx].bufferView = baseView
  gen.json.images[gBaseIdx].mimeType = 'image/png'
  delete gen.json.images[gBaseIdx].uri
  if (mrBytes) {
    const mrView = addView(mrBytes)
    const gMrIdx = imageSourceIndex(gen.json, 'mr')
    gen.json.images[gMrIdx].bufferView = mrView
    gen.json.images[gMrIdx].mimeType = 'image/png'
    delete gen.json.images[gMrIdx].uri
  }

  const binPad = (4 - (cursor % 4)) % 4
  const newBin = new Uint8Array(cursor + binPad)
  newBin.set(gen.bin, 0)
  {
    let p = gen.bin.length
    for (const seg of parts) { newBin.set(seg, p); p += seg.length }
  }
  gen.json.buffers[0].byteLength = newBin.length

  const enc = new TextEncoder().encode(JSON.stringify(gen.json))
  const jsonPad = (4 - (enc.length % 4)) % 4
  const jsonChunkLen = enc.length + jsonPad
  const binChunkLen = newBin.length
  const total = 12 + 8 + jsonChunkLen + 8 + binChunkLen
  const out = new Uint8Array(total)
  const odv = new DataView(out.buffer)
  out.set([0x67, 0x6c, 0x54, 0x46], 0)
  odv.setUint32(4, 2, true)
  odv.setUint32(8, total, true)
  odv.setUint32(12, jsonChunkLen, true)
  odv.setUint32(16, 0x4e4f534a, true)
  out.set(enc, 20)
  out.fill(0x20, 20 + enc.length, 20 + jsonChunkLen)
  odv.setUint32(20 + jsonChunkLen, binChunkLen, true)
  odv.setUint32(20 + jsonChunkLen + 4, 0x004e4942, true)
  out.set(newBin, 20 + jsonChunkLen + 8)

  let blended = 0
  for (let i = 0; i < nPix; i++) if (palpha[i] > 0) blended++
  return {
    blob: new Blob([out], { type: 'model/gltf-binary' }),
    stats: { blendedTexels: blended, chinRepair: repairCount, width: W, height: H },
  }
}
