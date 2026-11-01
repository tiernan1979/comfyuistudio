// Download a search result as a File ready for ComfyUI upload.

import { toProxyPath } from './proxy.js'

function filenameFrom(src, mime) {
  let base = 'web-image'
  try {
    if (src.startsWith('/proxy/')) {
      const withoutQuery = src.split('?')[0]
      base = decodeURIComponent(withoutQuery.split('/').filter(Boolean).pop() || 'web-image')
    } else {
      const u = new URL(src.startsWith('//') ? `https:${src}` : src)
      base = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || 'web-image')
    }
  } catch {
    /* keep default */
  }
  base = base.slice(0, 60).replace(/[^\w.\-]+/g, '_')
  if (!/\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(base)) {
    const ext =
      {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/webp': 'webp',
        'image/gif': 'gif',
        'image/avif': 'avif',
      }[mime] || 'jpg'
    base = `${base}.${ext}`
  }
  return base
}

function hostFrom(src, path) {
  // Proxy path: /proxy/https/<host>/... or /proxy/<host>/...
  try {
    const parts = path.split('/')
    if (parts[1] === 'proxy') {
      const h = parts[2] === 'https' || parts[2] === 'http' ? parts[3] : parts[2]
      if (h) return h
    }
  } catch {
    /* fall through */
  }
  try {
    return new URL(src.startsWith('//') ? `https:${src}` : src).hostname
  } catch {
    /* fall through */
  }
  return 'the site'
}

// Accepts either an absolute URL (http/https) or an already-built
// /proxy/... path — callers pass whichever they have on hand.
export async function downloadImage(src) {
  const path = src.startsWith('/proxy/') ? src : toProxyPath(src)
  if (!path) throw new Error(`Unsupported image URL: ${src}`)
  const host = hostFrom(src, path)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20000)
  let res
  try {
    res = await fetch(path, { signal: controller.signal })
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`${host} took too long to respond (20s)`)
    }
    throw new Error(`could not download from ${host} (${err.message})`)
  } finally {
    clearTimeout(timeout)
  }
  if (!res.ok) {
    throw new Error(`${host} refused the download (HTTP ${res.status})`)
  }

  const blob = await res.blob()
  const mime = blob.type || ''
  if (mime && !mime.startsWith('image/')) {
    throw new Error(`${host} returned ${mime}, not an image`)
  }
  if (blob.size === 0) {
    throw new Error(`${host} sent an empty file`)
  }
  if (blob.size > 45 * 1024 * 1024) {
    throw new Error(`image from ${host} is too large (over 45MB)`)
  }
  return new File([blob], filenameFrom(src, mime), {
    type: mime || 'image/jpeg',
  })
}
