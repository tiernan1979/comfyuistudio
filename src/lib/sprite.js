// Sprite-sheet post-processing (browser). The ComfyUI graph emits transparent
// per-frame PNGs row-major (row 0 left→right, then row 1…); here we pack them
// into a single alpha-preserving sheet and build a JSON atlas + a Godot 4
// SpriteFrames resource. Packing happens in the browser because KJNodes
// ImageGrid flattens alpha to RGB.
//
// `rows` is the layout from spriteRows() in workflows.js:
//   [{ name: 'walk-right', frames: 8 }, { name: 'idle', frames: 8 }, …]
// `columns` = frames per row (all rows share it; the sheet is rectangular and
// shorter rows are left transparent).

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`could not load frame ${url}`))
    img.src = url
  })
}

function normalizeRows(rows, fallbackFrames) {
  const list = Array.isArray(rows) && rows.length ? rows : [{ name: 'default', frames: fallbackFrames }]
  return list.map((r) => ({
    name: String(r?.name || 'default'),
    frames: Math.max(1, Math.round(r?.frames || fallbackFrames || 1)),
  }))
}

// Pack frame URLs into one transparent PNG sheet. Returns
// { blob, width, height, columns, rows }.
export async function packSpriteSheet(frameUrls, { columns = 4, cellSize = 256, rows = null, background = 'transparent' } = {}) {
  if (!frameUrls?.length) throw new Error('no frames to pack')
  const cols = Math.max(1, Math.min(64, Math.round(columns)))
  const cell = Math.max(1, Math.round(cellSize))
  const layout = normalizeRows(rows, cols)
  const canvas = document.createElement('canvas')
  canvas.width = cols * cell
  canvas.height = layout.length * cell
  const ctx = canvas.getContext('2d')
  // Sheet background: transparent (default, RGBA) or a key colour some engines
  // want (black / magenta chroma-key).
  if (background === 'black') {
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  } else if (background === 'magenta') {
    ctx.fillStyle = '#ff00ff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }
  const imgs = await Promise.all(frameUrls.map(loadImage))
  let idx = 0
  for (let r = 0; r < layout.length; r++) {
    for (let c = 0; c < layout[r].frames && idx < imgs.length; c++) {
      ctx.drawImage(imgs[idx++], c * cell, r * cell, cell, cell)
    }
  }
  const blob = await new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('canvas.toBlob failed'))), 'image/png')
  )
  return { blob, width: canvas.width, height: canvas.height, columns: cols, rows: layout.length, background }
}

function slug(s) {
  return (
    String(s || 'sprite')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 48) || 'sprite'
  )
}

// JSON atlas (engine-agnostic; also readable by TexturePacker-style importers).
// Each row becomes a named animation.
export function buildAtlas({ name = 'sprite', columns = 4, cellSize = 256, rows = null, fps = 12, frames = 1 }) {
  const cols = Math.max(1, Math.round(columns))
  const layout = normalizeRows(rows, cols || frames)
  const list = []
  const animations = {}
  layout.forEach((row, r) => {
    const indices = []
    for (let c = 0; c < row.frames; c++) {
      const g = r * cols + c
      list.push({
        index: g,
        x: c * cellSize,
        y: r * cellSize,
        w: cellSize,
        h: cellSize,
        duration: Number((1 / Math.max(1, fps)).toFixed(4)),
      })
      indices.push(g)
    }
    animations[row.name] = { frames: indices, fps, loop: true }
  })
  return {
    name,
    image: `${slug(name)}.png`,
    cellWidth: cellSize,
    cellHeight: cellSize,
    columns: cols,
    rows: layout.length,
    sheetWidth: cols * cellSize,
    sheetHeight: layout.length * cellSize,
    animations,
    frames: list,
  }
}

// Godot 4 SpriteFrames .tres (AnimatedSprite2D) with one animation per row.
// Import the sheet PNG to res://sprites/<name>.png and drop this .tres beside it.
export function buildGodotSpriteFrames({
  name = 'sprite',
  columns = 4,
  cellSize = 256,
  rows = null,
  fps = 12,
  frames = 1,
  sheetPath = '',
}) {
  const cols = Math.max(1, Math.round(columns))
  const layout = normalizeRows(rows, cols || frames)
  const path = sheetPath || `res://sprites/${slug(name)}.png`

  // One AtlasTexture per used cell (global index = row*cols + col).
  const used = []
  layout.forEach((row, r) => {
    for (let c = 0; c < row.frames; c++) used.push(r * cols + c)
  })
  const lines = []
  lines.push(`[gd_resource type="SpriteFrames" load_steps=${used.length + 2} format=3]`)
  lines.push('')
  lines.push(`[ext_resource type="Texture2D" path="${path}" id="1_sheet"]`)
  lines.push('')
  for (const g of used) {
    const x = (g % cols) * cellSize
    const y = Math.floor(g / cols) * cellSize
    lines.push(`[sub_resource type="AtlasTexture" id="AtlasTexture_${g}"]`)
    lines.push(`atlas = ExtResource("1_sheet")`)
    lines.push(`region = Rect2(${x}, ${y}, ${cellSize}, ${cellSize})`)
    lines.push('')
  }
  const anims = layout.map((row, r) => {
    const refs = []
    for (let c = 0; c < row.frames; c++) {
      refs.push(`{\n"duration": 1.0,\n"texture": SubResource("AtlasTexture_${r * cols + c}")\n}`)
    }
    return `{\n"frames": [${refs.join(', ')}],\n"loop": true,\n"name": &"${row.name}",\n"speed": ${Number(fps) || 12}.0\n}`
  })
  lines.push('[resource]')
  lines.push(`animations = [${anims.join(', ')}]`)
  lines.push('')
  return lines.join('\n')
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function downloadText(text, filename, mime = 'text/plain') {
  downloadBlob(new Blob([text], { type: mime }), filename)
}

export { slug as spriteSlug }
