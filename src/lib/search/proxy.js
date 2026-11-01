// Proxy plumbing shared by every search provider.
//
// Everything is fetched through the app's nginx proxy, so CORS and
// self-signed TLS certs are non-issues in the browser:
//   /proxy/<host>/<port>/<path>            → http upstream
//   /proxy/https/<host>/<port>/<path>      → https upstream

export function toProxyPath(absoluteUrl) {
  if (!absoluteUrl) return null
  let u
  try {
    u = new URL(absoluteUrl.startsWith('//') ? `https:${absoluteUrl}` : absoluteUrl)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  const https = u.protocol === 'https:'
  const port = u.port || (https ? '443' : '80')
  const path = u.pathname || '/'
  return `/proxy/${https ? 'https/' : ''}${u.hostname}/${port}${path}${u.search || ''}`
}

export async function proxyFetch(url, opts = {}) {
  const path = toProxyPath(url)
  if (!path) throw new Error(`Invalid search URL: ${url}`)
  return fetch(path, opts)
}

export async function httpError(res, what) {
  let detail = ''
  try {
    const body = await res.text()
    try {
      const j = JSON.parse(body)
      detail = j.message || j.error || j.errors?.[0]?.message || ''
    } catch {
      detail = body.slice(0, 140)
    }
  } catch {
    /* ignore */
  }
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

export function needKey(apiKey) {
  const key = (apiKey || '').trim()
  if (!key) {
    throw new Error('No API key set — open Settings → Web Image Search and paste your API key.')
  }
  return key
}
