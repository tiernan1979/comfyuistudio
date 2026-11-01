// Rasterise the painted atlas into the generated atlas' UV space for the
// face region only: for every generated texel covered by a face-box triangle,
// barycentrically map its 3D position into the same triangle of the paint
// mesh and bilinearly sample the paint texture there.

import { SKIN_BLEND_BOX, smooth } from './geometry.js'

export function projectPaintAtlas({ posG, uvG, idxG, uvP, idxP, baseG, baseP, mrG, mrP }) {
  const W = baseG.width
  const H = baseG.height
  const Wp = baseP.width
  const Hp = baseP.height
  const nPix = W * H

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
    smooth((xT - Math.abs(x)) / fx) *
    smooth((y - fy0) / fyy) *
    smooth((fy1 - y) / fyy) *
    smooth((z - fz0) / fz)

  // ---- candidate faces: 3D bbox overlaps the expanded box ----
  const pcolor = new Uint8ClampedArray(nPix * 4)
  const palpha = new Uint8Array(nPix)
  const pcov = new Uint8Array(nPix)
  const ymap = new Float32Array(nPix)
  ymap.fill(-1e9)
  const mrout = mrP ? new Uint8ClampedArray(nPix * 4) : null
  const pd = baseP.data
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
    if (!(tmaxx > -xT - fx && tminx < xT + fx && tmaxy > fy0 - fyy && tminy < fy1 + fyy && tminz > fz0 - fz))
      continue

    // Faces are corner-aligned by position, but VERTEX INDICES differ.
    const pi0 = idxP[f * 3] * 2, pi1 = idxP[f * 3 + 1] * 2, pi2 = idxP[f * 3 + 2] * 2
    const gi0 = idxG[f * 3] * 2, gi1 = idxG[f * 3 + 1] * 2, gi2 = idxG[f * 3 + 2] * 2
    const gx0 = uvG[gi0] * (W - 1), gy0 = uvG[gi0 + 1] * (H - 1)
    const gx1 = uvG[gi1] * (W - 1), gy1 = uvG[gi1 + 1] * (H - 1)
    const gx2 = uvG[gi2] * (W - 1), gy2 = uvG[gi2 + 1] * (H - 1)
    const qx0 = uvP[pi0] * (Wp - 1), qy0 = uvP[pi0 + 1] * (Hp - 1)
    const qx1 = uvP[pi1] * (Wp - 1), qy1 = uvP[pi1 + 1] * (Hp - 1)
    const qx2 = uvP[pi2] * (Wp - 1), qy2 = uvP[pi2 + 1] * (Hp - 1)

    const minx = Math.max(Math.floor(Math.min(gx0, gx1, gx2)), 0)
    const maxx = Math.min(Math.ceil(Math.max(gx0, gx1, gx2)), W - 1)
    const miny = Math.max(Math.floor(Math.min(gy0, gy1, gy2)), 0)
    const maxy = Math.min(Math.ceil(Math.max(gy0, gy1, gy2)), H - 1)
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
        r += pcolor[j * 4]
        g += pcolor[j * 4 + 1]
        b += pcolor[j * 4 + 2]
        av += palpha[j]
        n++
        if (mrout) {
          mr += mrout[j * 4]
          mg += mrout[j * 4 + 1]
          mb += mrout[j * 4 + 2]
        }
      }
      if (!n) {
        next.push(i)
        continue
      }
      pcolor[i * 4] = r / n
      pcolor[i * 4 + 1] = g / n
      pcolor[i * 4 + 2] = b / n
      pcolor[i * 4 + 3] = 255
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

  return { pcolor, palpha, pcov, ymap, mrout, W, H, nPix, lipY }
}
