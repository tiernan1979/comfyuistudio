// Minimal STORE-only ZIP writer (no dependency). PNG/JPEG are already
// compressed, so store (method 0) is fine and keeps this tiny. Produces a
// standard .zip that Windows Explorer, macOS and Godot all read.

let CRC_TABLE = null
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  CRC_TABLE = t
  return t
}

function crc32(bytes) {
  const t = crcTable()
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) crc = t[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

const utf8 = (s) => new TextEncoder().encode(s)

// files: [{ name: 'parts/head.png', data: ArrayBuffer|Uint8Array }]
export function makeZip(files) {
  const now = new Date()
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2)) & 0xffff
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff

  const chunks = []
  const central = []
  let offset = 0

  for (const f of files) {
    const nameBytes = utf8(f.name)
    const data = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data)
    const crc = crc32(data)

    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true) // version needed
    local.setUint16(6, 0x0800, true) // UTF-8 names
    local.setUint16(8, 0, true) // method: store
    local.setUint16(10, dosTime, true)
    local.setUint16(12, dosDate, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, data.length, true)
    local.setUint32(22, data.length, true)
    local.setUint16(26, nameBytes.length, true)
    local.setUint16(28, 0, true)
    chunks.push(new Uint8Array(local.buffer), nameBytes, data)

    central.push({ nameBytes, crc, size: data.length, offset })
    offset += 30 + nameBytes.length + data.length
  }

  const centralStart = offset
  for (const c of central) {
    const h = new DataView(new ArrayBuffer(46))
    h.setUint32(0, 0x02014b50, true)
    h.setUint16(4, 20, true)
    h.setUint16(6, 20, true)
    h.setUint16(8, 0x0800, true)
    h.setUint16(10, 0, true)
    h.setUint16(12, dosTime, true)
    h.setUint16(14, dosDate, true)
    h.setUint32(16, c.crc, true)
    h.setUint32(20, c.size, true)
    h.setUint32(24, c.size, true)
    h.setUint16(28, c.nameBytes.length, true)
    h.setUint32(42, c.offset, true)
    chunks.push(new Uint8Array(h.buffer), c.nameBytes)
    offset += 46 + c.nameBytes.length
  }

  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, central.length, true)
  end.setUint16(10, central.length, true)
  end.setUint32(12, offset - centralStart, true)
  end.setUint32(16, centralStart, true)
  chunks.push(new Uint8Array(end.buffer))

  return new Blob(chunks, { type: 'application/zip' })
}
