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

// ---- Providers ------------------------------------------------------
// SearXNG is the self-hosted option (URL, no key). The others are hosted
// APIs that need an API key; all of them are reached through the app's
// /proxy/https/... path, so CORS never enters the picture.
export const SEARCH_ENGINES = [
  {
    value: 'searxng',
    label: 'SearXNG — self-hosted',
    needsUrl: true,
    hint: 'Your own SearXNG instance (JSON API enabled). No account needed.',
    docs: '',
  },
  {
    value: 'serper',
    label: 'Google via Serper.dev',
    needsKey: true,
    hint: 'Google results, simple JSON API, free tier of 2,500 queries.',
    docs: 'https://serper.dev',
  },
  {
    value: 'serpapi',
    label: 'Google Images via SerpAPI',
    needsKey: true,
    hint: 'Google Images with sizes/pages. 100 free searches per month.',
    docs: 'https://serpapi.com/google-images-api',
  },
  {
    value: 'brave',
    label: 'Brave Search (Images)',
    needsKey: true,
    hint: 'Independent index, free tier of ~2,000 queries/month.',
    docs: 'https://brave.com/search/api/',
  },
  {
    value: 'google_cse',
    label: 'Google Custom Search (Images)',
    needsKey: true,
    needsCse: true,
    hint: 'Google Programmable Search — needs an API key + a Search Engine ID. 100 free queries/day.',
    docs: 'https://developers.google.com/custom-search/v1/overview',
  },
]

export function searchEngineInfo(engine) {
  return SEARCH_ENGINES.find((e) => e.value === engine) || SEARCH_ENGINES[0]
}

// Reject the junk that's useless as a ComfyUI source image: SVG icons
// and any icon-set engine (they return SVGs even for "photo" queries).
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

function usable(full, thumb, engine) {
  if (!full) return false
  if (/\.svg(\?|$)/i.test(full) || /\.svg(\?|$)/i.test(thumb || '')) return false
  if (/\.ico(\?|$)/i.test(full)) return false
  if (engine && ICON_ENGINES.has(String(engine).toLowerCase())) return false
  return true
}

function toResults(list) {
  return list
    .map((r) => ({
      thumbPath: toProxyPath(r.thumb || r.full),
      fullPath: toProxyPath(r.full),
      title: r.title || '',
      page: r.page || '',
      resolution: r.resolution || '',
    }))
    .filter((r) => r.thumbPath && r.fullPath)
    .slice(0, 48)
}

async function httpError(res, what) {
  let detail = ''
  try {
    const body = await res.text()
    try {
      const j = JSON.parse(body)
      detail = j.message || j.error || j.errors?.[0]?.message || ''
    } catch {
      detail = body.slice(0, 140)
    }
  } catch { /* ignore */ }
  const hint =
    res.status === 401 || res.status === 403
      ? ' — check the API key in Settings → Web Image Search'
      : res.status === 402
        ? ' — the plan/quota for this API key is exhausted'
        : res.status === 429
          ? ' — rate limited, try again in a moment'
          : ''
  throw new Error(`${what} returned HTTP ${res.status}${detail ? `: ${detail}` : ''}${hint}`)
}

async function proxyFetch(url, opts = {}) {
  const path = toProxyPath(url)
  if (!path) throw new Error(`Invalid search URL: ${url}`)
  return fetch(path, opts)
}

async function searchSearexng(searchUrl, query, signal) {
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
    .filter((r) => r.img_src && usable(r.img_src, r.thumbnail_src, r.engine))
    .map((r) => ({
      full: r.img_src,
      thumb: r.thumbnail_src || r.img_src,
      title: r.title || '',
      page: r.url || '',
      resolution: r.resolution || '',
    }))
  return toResults(results)
}

function needKey(apiKey) {
  const key = (apiKey || '').trim()
  if (!key) {
    throw new Error('No API key set — open Settings → Web Image Search and paste your API key.')
  }
  return key
}

async function searchSerper(apiKey, query, signal) {
  const res = await proxyFetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': needKey(apiKey), 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, num: 60 }),
    signal,
  })
  if (!res.ok) return httpError(res, 'Serper')
  const data = await res.json()
  return toResults(
    (data.images || []).map((i) => ({
      full: i.imageUrl,
      thumb: i.thumbnailUrl || i.imageUrl,
      title: i.title || '',
      page: i.link || '',
      resolution: i.imageWidth && i.imageHeight ? `${i.imageWidth}x${i.imageHeight}` : '',
    }))
  )
}

async function searchSerpApi(apiKey, query, signal) {
  const u = new URL('https://serpapi.com/search.json')
  u.searchParams.set('engine', 'google_images')
  u.searchParams.set('q', query)
  u.searchParams.set('num', '100')
  u.searchParams.set('api_key', needKey(apiKey))
  const res = await proxyFetch(u.toString(), { signal })
  if (!res.ok) return httpError(res, 'SerpAPI')
  const data = await res.json()
  if (data.error) throw new Error(`SerpAPI: ${data.error}`)
  return toResults(
    (data.images_results || []).map((i) => ({
      full: i.original,
      thumb: i.thumbnail || i.original,
      title: i.title || '',
      page: i.link || '',
      resolution: i.original_width && i.original_height ? `${i.original_width}x${i.original_height}` : '',
    }))
  )
}

async function searchBrave(apiKey, query, signal) {
  const u = new URL('https://api.search.brave.com/res/v1/images/search')
  u.searchParams.set('q', query)
  u.searchParams.set('count', '50')
  const res = await proxyFetch(u.toString(), {
    headers: { 'X-Subscription-Token': needKey(apiKey), Accept: 'application/json' },
    signal,
  })
  if (!res.ok) return httpError(res, 'Brave Search')
  const data = await res.json()
  return toResults(
    (data.results || []).map((r) => ({
      full: r.properties?.url || r.url,
      thumb: r.thumbnail?.src || r.properties?.url || r.url,
      title: r.title || '',
      page: r.page || r.source?.url || '',
      resolution: '',
    }))
  )
}

async function searchGoogleCse(apiKey, cseId, query, signal) {
  const id = (cseId || '').trim()
  if (!id) {
    throw new Error('No Search Engine ID set — open Settings → Web Image Search and paste your CSE id (cx).')
  }
  const fetchPage = async (start) => {
    const u = new URL('https://customsearch.googleapis.com/customsearch/v1')
    u.searchParams.set('key', needKey(apiKey))
    u.searchParams.set('cx', id)
    u.searchParams.set('q', query)
    u.searchParams.set('searchType', 'image')
    u.searchParams.set('num', '10')
    u.searchParams.set('start', String(start))
    const res = await proxyFetch(u.toString(), { signal })
    if (!res.ok) return httpError(res, 'Google Custom Search')
    const data = await res.json()
    if (data.error) throw new Error(`Google Custom Search: ${data.error.message}`)
    return (data.items || []).map((i) => ({
      full: i.link,
      thumb: i.image?.thumbnailLink || i.link,
      title: i.title || '',
      page: i.displayLink || '',
      resolution: i.image?.width && i.image?.height ? `${i.image.width}x${i.image.height}` : '',
    }))
  }
  const [a, b] = await Promise.all([fetchPage(1), fetchPage(11)])
  return toResults([...a, ...b])
}

// settings: { engine, searchUrl, apiKey, cseId }
export async function searchImages(settings, query, signal) {
  const engine = settings?.engine || 'searxng'
  let results
  switch (engine) {
    case 'serper':
      results = await searchSerper(settings.apiKey, query, signal)
      break
    case 'serpapi':
      results = await searchSerpApi(settings.apiKey, query, signal)
      break
    case 'brave':
      results = await searchBrave(settings.apiKey, query, signal)
      break
    case 'google_cse':
      results = await searchGoogleCse(settings.apiKey, settings.cseId, query, signal)
      break
    case 'searxng':
    default:
      results = await searchSearexng(settings?.searchUrl, query, signal)
      break
  }

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
