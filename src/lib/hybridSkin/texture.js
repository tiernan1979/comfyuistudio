// Browser-only texture decode/encode via OffscreenCanvas.

export async function decodeImage(bytes) {
  const bmp = await createImageBitmap(new Blob([bytes]))
  const cv = new OffscreenCanvas(bmp.width, bmp.height)
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bmp, 0, 0)
  const data = ctx.getImageData(0, 0, bmp.width, bmp.height)
  bmp.close?.()
  return data
}

export async function encodePng(imageData) {
  const cv = new OffscreenCanvas(imageData.width, imageData.height)
  cv.getContext('2d').putImageData(imageData, 0, 0)
  const blob = await cv.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}
