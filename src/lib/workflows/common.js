// Shared sizing primitives for the ComfyUI graph builders.
// Snap a requested size to the nearest multiple of 8 (the VAE stride) inside
// sane bounds — 100x100 becomes 104x104, 100x104 stays 104x104, etc.
export function snap8(v, min = 32, max = 4096) {
  const n = Number(v)
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, Math.round(n / 8) * 8))
}

export const ASPECT_RATIOS = {
  '1:1': { width: 1328, height: 1328 },
  '16:9': { width: 1664, height: 928 },
  '9:16': { width: 928, height: 1664 },
  '4:3': { width: 1472, height: 1140 },
  '3:4': { width: 1140, height: 1472 },
  '3:2': { width: 1584, height: 1056 },
  '2:3': { width: 1056, height: 1584 },
}

export const VIDEO_RESOLUTIONS = {
  '480p': { width: 832, height: 480 },
  '720p': { width: 1280, height: 720 },
  // Fast 1080p: sample at 960×544 (the official H3 "fast" size — 4× fewer
  // tokens than 1920×1088) and upscale with 4x-UltraSharp at the end.
  '1080p-fast': { width: 1920, height: 1080, genWidth: 960, genHeight: 544, upscale: '4x-UltraSharp.pth' },
  '1080p': { width: 1920, height: 1080 },
}
