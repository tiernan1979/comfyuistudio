// Web image search via the user's own SearXNG instance (JSON API).
// Everything is fetched through the app's nginx proxy, so CORS and
// self-signed TLS certs are non-issues in the browser.
//
// Path scheme built by toProxyPath():
//   /proxy/<host>/<port>/<path>            → http upstream
//   /proxy/https/<host>/<port>/<path>      → https upstream

export function toProxyPath(absoluteUrl) {
  if (!absoluteUrl) return null
  let u
  try {
    u = new URL(
      absoluteUrl.startsWith('//') ? `https:${absoluteUrl}` : absoluteUrl
    )
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  const https = u.protocol === 'https:'
  const port = u.port || (https ? '443' : '80')
  const path = u.pathname || '/'
  return `/proxy/${https ? 'https/' : ''}${u.hostname}/${port}${path}${u.search || ''}`
}

// Icon-search engines sometimes rank at the top on SearXNG instances —
// they return SVGs, which are useless as ComfyUI source images anyway.
const ICON_ENGINES = new Set([
  'devicons',
  'lucide',
  'fontawesome',
  'material icons',
  'simpleicons',
  'openmoji',
  'twemoji',
  'iconify',
  'nerdfonts',
  'bootstrap icons',
  'feather icons',
  'css.gg',
])

function isUsableImage(result) {
  const src = result.img_src || ''
  if (/\.svg(\?|$)/i.test(src)) return false
  if (/\.ico(\?|$)/i.test(src)) return false
  const engine = (result.engine || '').toLowerCase()
  if (ICON_ENGINES.has(engine)) return false
  return true
}

export async function searchImages(searchUrl, query, signal) {
  const base = (searchUrl || '').trim().replace(/\/+$/, '')
  if (!base) {
    throw new Error('No SearXNG URL set — open Settings → Web Image Search and enter your instance URL.')
  }
  let target
  try {
    const u = new URL(`${base}/search`)
    u.searchParams.set('q', query)
    u.searchParams.set('categories', 'images')
    u.searchParams.set('format', 'json')
    target = toProxyPath(u.toString())
  } catch {
    throw new Error(`Invalid SearXNG URL: "${searchUrl}"`)
  }

  let res
  try {
    res = await fetch(target, { signal })
  } catch (err) {
    if (err.name === 'AbortError') throw err
    throw new Error(`Could not reach SearXNG at ${searchUrl} (${err.message})`)
  }
  if (!res.ok) {
    const hint =
      res.status === 403
        ? ' — make sure "json" is listed under search.formats in SearXNG settings.yml'
        : ''
    throw new Error(`SearXNG returned HTTP ${res.status}${hint}`)
  }

  const data = await res.json()
  const results = (data.results || [])
    .filter((r) => r.img_src && isUsableImage(r))
    .slice(0, 48)
    .map((r) => ({
      thumbPath: toProxyPath(r.thumbnail_src || r.img_src),
      fullPath: toProxyPath(r.img_src),
      title: r.title || '',
      page: r.url || '',
      resolution: r.resolution || '',
    }))
    .filter((r) => r.thumbPath && r.fullPath)

  if (results.length === 0) {
    throw new Error('No image results found — try different words.')
  }
  return results
}

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
  } catch { /* keep default */ }
  base = base.slice(0, 60).replace(/[^\w.\-]+/g, '_')
  if (!/\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(base)) {
    const ext = {
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
  } catch { /* fall through */ }
  try {
    return new URL(src.startsWith('//') ? `https:${src}` : src).hostname
  } catch { /* fall through */ }
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
