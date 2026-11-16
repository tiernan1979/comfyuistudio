// Turn a generated texture into a tile that actually repeats. Prompt wording
// alone cannot guarantee matching edges: the model paints a nice square, not
// a wrap-around surface. The old mirror pass made the outer edges equal but
// repeated the edge pebbles in a visible line, so this version offsets the
// image by half (moving the original joins into the centre) and clones a
// clean band over that centre seam.
//
// Runs in the browser with canvas — no ComfyUI node pack or extra model.

import { getViewUrl, uploadImage } from './comfyui'

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load the texture for the seamless pass.'))
    img.src = url
  })
}

// Wrap the image by half its width/height. The original left/right and
// top/bottom joins end up in the middle, where they can be repaired; the new
// outer edges are pixels that were already adjacent inside the source.
function offsetHalf(src, width, height) {
  const out = new Uint8ClampedArray(src.length)
  const ox = Math.floor(width / 2)
  const oy = Math.floor(height / 2)
  for (let y = 0; y < height; y += 1) {
    const sy = (y + oy) % height
    for (let x = 0; x < width; x += 1) {
      const sx = (x + ox) % width
      const di = (y * width + x) * 4
      const si = (sy * width + sx) * 4
      out[di] = src[si]
      out[di + 1] = src[si + 1]
      out[di + 2] = src[si + 2]
      out[di + 3] = src[si + 3]
    }
  }
  return out
}

// Copy a clean band from the quarter line over the centre seam, feathering
// the edges with a cosine ramp. Blending the two sides (the previous method)
// averaged detail into a soft stripe; cloning keeps the source grain intact.
function cloneSeam(src, width, height, band, vertical) {
  const out = new Uint8ClampedArray(src)
  const limit = vertical ? width : height
  const center = Math.floor(limit / 2)
  const source = Math.floor(limit / 4)
  const start = Math.max(0, center - band)
  const end = Math.min(limit - 1, center + band)
  const span = Math.max(1, band * 2)
  for (let i = start; i <= end; i += 1) {
    const t = (i - (center - band)) / span
    const weight = 0.5 - 0.5 * Math.cos(Math.PI * t)
    const si = (source + (i - center) + limit) % limit
    if (vertical) {
      for (let y = 0; y < height; y += 1) {
        const di = (y * width + i) * 4
        const ci = (y * width + si) * 4
        out[di] = src[di] + (src[ci] - src[di]) * weight
        out[di + 1] = src[di + 1] + (src[ci + 1] - src[di + 1]) * weight
        out[di + 2] = src[di + 2] + (src[ci + 2] - src[di + 2]) * weight
      }
    } else {
      const di0 = i * width * 4
      const ci0 = si * width * 4
      for (let x = 0; x < width; x += 1) {
        const di = di0 + x * 4
        const ci = ci0 + x * 4
        out[di] = src[di] + (src[ci] - src[di]) * weight
        out[di + 1] = src[di + 1] + (src[ci + 1] - src[di + 1]) * weight
        out[di + 2] = src[di + 2] + (src[ci + 2] - src[di + 2]) * weight
      }
    }
  }
  return out
}

// Crop the outer border first (models often paint a darker vignette), then
// wrap and repair both axes. 12% crop / 14% seam band tested best on the
// packed-soil texture: no visible grid, no duplicated edge pebbles.
export async function makeSeamlessTexture(base, url, { crop = 0.12, band = 0.14 } = {}) {
  const img = await loadImage(url)
  const trimX = Math.round(img.naturalWidth * crop)
  const trimY = Math.round(img.naturalHeight * crop)
  const cw = Math.max(8, img.naturalWidth - trimX * 2)
  const ch = Math.max(8, img.naturalHeight - trimY * 2)

  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Could not prepare the seamless canvas.')
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(img, trimX, trimY, cw, ch, 0, 0, cw, ch)

  const source = ctx.getImageData(0, 0, cw, ch)
  const bandPx = Math.max(8, Math.min(Math.floor(Math.min(cw, ch) / 4), Math.round(Math.min(cw, ch) * band)))
  let pixels = offsetHalf(source.data, cw, ch)
  pixels = cloneSeam(pixels, cw, ch, bandPx, true)
  pixels = cloneSeam(pixels, cw, ch, bandPx, false)
  ctx.putImageData(new ImageData(pixels, cw, ch), 0, 0)

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not encode the seamless texture.')
  const file = new File([blob], `seamless-${Date.now()}.png`, { type: 'image/png' })
  const uploaded = await uploadImage(base, file)
  return getViewUrl(base, uploaded.name, uploaded.subfolder, uploaded.type)
}
