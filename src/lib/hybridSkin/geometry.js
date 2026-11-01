// Geometry validation for the face blend: both GLBs must describe the same
// mesh (paint only re-unwraps UVs), otherwise the texel correspondence is
// meaningless and we refuse to produce a hybrid model.

import { parseGlb, firstMeshPrimitive, nodeIsIdentity, readF32, readIndices } from './glb.js'

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

export const smooth = (t) => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t
  return x * x * (3 - 2 * x)
}

// Pure stage: parse + validate both GLBs, return geometry handles.
// Exported for tests (no canvas APIs touched).
export function prepareSkinBlend(genBuf, paintBuf) {
  const gen = parseGlb(genBuf)
  const paint = parseGlb(paintBuf)
  const g = firstMeshPrimitive(gen.json)
  const p = firstMeshPrimitive(paint.json)
  if (!nodeIsIdentity(g.node))
    throw new Error('mesh has a node transform — face blend supports plain exports only')
  if (!gen.json.images?.length) throw new Error('generated mesh has no texture to blend into')
  if (g.prim.indices === undefined)
    throw new Error('non-indexed meshes are not supported by the face blend')

  const posG = readF32(gen.json, gen.bin, g.prim.attributes.POSITION, 3)
  const uvG = readF32(gen.json, gen.bin, g.prim.attributes.TEXCOORD_0, 2)
  const idxG = readIndices(gen.json, gen.bin, g.prim.indices)
  const uvP = readF32(paint.json, paint.bin, p.prim.attributes.TEXCOORD_0, 2)
  const idxP = readIndices(paint.json, paint.bin, p.prim.indices)
  if (idxG.length !== idxP.length)
    throw new Error('paint re-meshed the model — face blend needs matching faces')

  // Corner-aligned correspondence check (paint only re-unwraps).
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
