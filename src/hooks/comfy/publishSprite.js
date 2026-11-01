// Pack sprite frames into an alpha-preserving sheet and publish it.

import { getViewUrl, uploadImage } from '../../lib/comfyui'
import { packSpriteSheet } from '../../lib/sprite'
import useStore from '../../store/useStore'

// Row-major frames → one sheet. Uploaded for a stable URL when possible,
// falling back to a session blob URL. Shared by the pose engine's
// single-prompt path and the video engine's chain finale.
export async function publishSpriteSheet(base, promptId, frames, sp, layout, prompt) {
  const state = useStore.getState()
  const rows = layout.map((r) => ({ name: r.name, frames: r.frames }))
  const columns = rows.reduce((m, r) => Math.max(m, r.frames), 1)
  const packed = await packSpriteSheet(frames, {
    columns,
    cellSize: sp.cellSize || 256,
    rows,
    background: sp.background || 'transparent',
  })
  console.log(
    `[sprite] packed ${frames.length} frames into ${packed.width}×${packed.height} ` +
      `(${columns} cols × ${rows.length} rows @ ${sp.cellSize || 256}px)`
  )

  let sheetUrl = ''
  try {
    const up = await uploadImage(
      base,
      new File([packed.blob], `sprite_${Date.now()}.png`, { type: 'image/png' })
    )
    sheetUrl = await getViewUrl(base, up.name, up.subfolder || '', up.type || 'input')
  } catch {
    // ComfyUI upload unavailable — fall back to a session blob URL.
    sheetUrl = URL.createObjectURL(packed.blob)
  }

  state.setOutputImage(sheetUrl)
  state.addToHistory({
    id: promptId,
    type: 'sprite',
    prompt,
    data: sheetUrl,
    frames,
    timestamp: Date.now(),
    settings: { ...sp, layout: rows, columns },
  })
  return sheetUrl
}
