// Pack a flipbook's transparent frame PNGs into one horizontal sheet and
// publish it for the player (same stable-URL contract as sprite sheets).

import { getViewUrl, uploadImage } from '../../lib/comfyui'
import { packSpriteSheet } from '../../lib/sprite'
import useStore from '../../store/useStore'

export async function publishFlipbook(base, promptId, frames, fb, prompt) {
  const state = useStore.getState()
  const cellSize = fb.resolution || 512
  const packed = await packSpriteSheet(frames, {
    columns: frames.length,
    cellSize,
    rows: [{ name: 'effect', frames: frames.length }],
    background: 'transparent',
  })

  let sheetUrl = ''
  try {
    const up = await uploadImage(
      base,
      new File([packed.blob], `flipbook_${Date.now()}.png`, { type: 'image/png' }),
    )
    sheetUrl = await getViewUrl(base, up.name, up.subfolder || '', up.type || 'input')
  } catch {
    sheetUrl = URL.createObjectURL(packed.blob)
  }

  state.setOutputImage(sheetUrl)
  state.setBatchImages([])
  state.addToHistory({
    id: promptId,
    type: 'flipbook',
    prompt,
    data: sheetUrl,
    frames,
    timestamp: Date.now(),
    settings: {
      ...fb,
      columns: frames.length,
      cellSize,
      layout: [{ name: 'effect', frames: frames.length }],
    },
  })
  return sheetUrl
}
