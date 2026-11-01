// Low-level GLB (glTF binary) container reading and rebuilding.
// Only what the skin blend needs: the first textured mesh primitive,
// its accessors, and the embedded texture images.

const COMPONENT_SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5124: 4, 5125: 4, 5126: 4 }
const TYPE_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }

export function parseGlb(buf) {
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
  return { a, bv, off, n: TYPE_COMPONENTS[a.type], es: COMPONENT_SIZE[a.componentType], count: a.count }
}

export function readF32(json, bin, i, comps) {
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

export function readIndices(json, bin, i) {
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

export function firstMeshPrimitive(json) {
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

// Resolved through the first PBR material; -1 = mesh has no such texture.
export function imageSourceIndex(json, slot) {
  const mat = json.materials?.[0]
  const tex =
    slot === 'base'
      ? mat?.pbrMetallicRoughness?.baseColorTexture
      : mat?.pbrMetallicRoughness?.metallicRoughnessTexture
  if (tex && json.textures?.[tex.index]?.source !== undefined) return json.textures[tex.index].source
  if (slot === 'base') return 0
  return -1
}

export function imageBytes(json, bin, idx) {
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

export function nodeIsIdentity(node) {
  if (!node) return true
  if (node.matrix) {
    const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    return node.matrix.every((v, i) => Math.abs(v - id[i]) < 1e-6)
  }
  const t = node.translation || [0, 0, 0]
  const r = node.rotation || [0, 0, 0, 1]
  const s = node.scale || [1, 1, 1]
  const rotId =
    Math.abs(r[0]) < 1e-9 &&
    Math.abs(r[1]) < 1e-9 &&
    Math.abs(r[2]) < 1e-9 &&
    Math.abs(Math.abs(r[3]) - 1) < 1e-9
  return rotId && t.every((v) => Math.abs(v) < 1e-6) && s.every((v) => Math.abs(v - 1) < 1e-6)
}

// Rewrite the GLB in place: swap the base-colour (and optionally the
// metallic-roughness) PNGs, then serialise a fresh binary container.
export function replaceGlbTextures(gen, baseBytes, mrBytes) {
  const { json, bin } = gen
  const chunks = []
  let cursor = bin.length

  const pad4 = () => {
    const p = (4 - (cursor % 4)) % 4
    if (p) {
      chunks.push(new Uint8Array(p))
      cursor += p
    }
  }
  const addView = (bytes) => {
    pad4()
    const byteOffset = cursor
    chunks.push(bytes)
    cursor += bytes.length
    if (!json.bufferViews) json.bufferViews = []
    json.bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.length })
    return json.bufferViews.length - 1
  }

  const baseIdx = imageSourceIndex(json, 'base')
  json.images[baseIdx].bufferView = addView(baseBytes)
  json.images[baseIdx].mimeType = 'image/png'
  delete json.images[baseIdx].uri

  if (mrBytes) {
    const mrIdx = imageSourceIndex(json, 'mr')
    json.images[mrIdx].bufferView = addView(mrBytes)
    json.images[mrIdx].mimeType = 'image/png'
    delete json.images[mrIdx].uri
  }

  const binPad = (4 - (cursor % 4)) % 4
  const newBin = new Uint8Array(cursor + binPad)
  newBin.set(bin, 0)
  let p = bin.length
  for (const seg of chunks) {
    newBin.set(seg, p)
    p += seg.length
  }
  json.buffers[0].byteLength = newBin.length

  const enc = new TextEncoder().encode(JSON.stringify(json))
  const jsonPad = (4 - (enc.length % 4)) % 4
  const jsonChunkLen = enc.length + jsonPad
  const total = 12 + 8 + jsonChunkLen + 8 + newBin.length
  const out = new Uint8Array(total)
  const odv = new DataView(out.buffer)
  out.set([0x67, 0x6c, 0x54, 0x46], 0)
  odv.setUint32(4, 2, true)
  odv.setUint32(8, total, true)
  odv.setUint32(12, jsonChunkLen, true)
  odv.setUint32(16, 0x4e4f534a, true)
  out.set(enc, 20)
  out.fill(0x20, 20 + enc.length, 20 + jsonChunkLen)
  odv.setUint32(20 + jsonChunkLen, newBin.length, true)
  odv.setUint32(20 + jsonChunkLen + 4, 0x004e4942, true)
  out.set(newBin, 20 + jsonChunkLen + 8)
  return out
}
