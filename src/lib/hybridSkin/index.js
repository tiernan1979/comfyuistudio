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

import { imageSourceIndex, imageBytes, replaceGlbTextures } from './glb.js'
import { prepareSkinBlend, SKIN_BLEND_BOX } from './geometry.js'
import { decodeImage, encodePng } from './texture.js'
import { projectPaintAtlas } from './project.js'
import { refinePaintAtlas, repairChinZone } from './repair.js'

export { prepareSkinBlend, SKIN_BLEND_BOX }

export async function hybridSkinBlend(genBlob, paintBlob, onStatus) {
  const genBuf = new Uint8Array(await genBlob.arrayBuffer())
  const paintBuf = new Uint8Array(await paintBlob.arrayBuffer())
  const ctx = prepareSkinBlend(genBuf, paintBuf)
  const { gen, paint, posG, uvG, idxG, uvP, idxP } = ctx

  onStatus?.('Face blend · decoding textures…')
  const baseG = await decodeImage(imageBytes(gen.json, gen.bin, imageSourceIndex(gen.json, 'base')))
  const baseP = await decodeImage(
    imageBytes(paint.json, paint.bin, imageSourceIndex(paint.json, 'base'))
  )

  const gMrIdx = imageSourceIndex(gen.json, 'mr')
  const pMrIdx = imageSourceIndex(paint.json, 'mr')
  const mrG = gMrIdx >= 0 ? await decodeImage(imageBytes(gen.json, gen.bin, gMrIdx)) : null
  const mrP = pMrIdx >= 0 ? await decodeImage(imageBytes(paint.json, paint.bin, pMrIdx)) : null

  onStatus?.('Face blend · projecting paint into the face region…')
  const atlas = projectPaintAtlas({ posG, uvG, idxG, uvP, idxP, baseG, baseP, mrG, mrP })
  const { pcolor, palpha, mrout, W, H, nPix } = atlas
  const gd = baseG.data
  const gmd = mrG?.data

  const masks = refinePaintAtlas(atlas, gd, onStatus)

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

  const repairCount = repairChinZone(gd, masks, W, H, onStatus)

  // ---- encode + rebuild the generated GLB with the new images ----
  onStatus?.('Face blend · encoding…')
  const baseBytes = await encodePng(baseG)
  const mrBytes = gmd && mrout ? await encodePng(mrG) : null
  const out = replaceGlbTextures(gen, baseBytes, mrBytes)

  let blended = 0
  for (let i = 0; i < nPix; i++) if (palpha[i] > 0) blended++
  return {
    blob: new Blob([out], { type: 'model/gltf-binary' }),
    stats: { blendedTexels: blended, chinRepair: repairCount, width: W, height: H },
  }
}
