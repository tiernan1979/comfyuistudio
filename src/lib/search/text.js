// Web/text search: same providers as image search, but returning
// TITLE + SNIPPET. Used by music mode to research an artist's sound
// ("sounds like Avicii") before the AI writes the caption — snippets are
// enough to pin down genre, BPM range, era and production character.

import { toProxyPath, proxyFetch, httpError, needKey } from './proxy.js'

function toTextResults(list) {
  return list
    .filter((r) => r && (r.title || r.snippet))
    .map((r) => ({
      title: String(r.title || '').slice(0, 200),
      page: String(r.page || ''),
      snippet: String(r.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 400),
    }))
    .slice(0, 8)
}

async function searxngTextSearch(searchUrl, query, signal) {
  const base = (searchUrl || '').trim().replace(/\/+$/, '')
  if (!base) {
    throw new Error(
      'No SearXNG URL set — open Settings → Web Image Search and enter your instance URL.'
    )
  }
  let target
  try {
    const u = new URL(`${base}/search`)
    u.searchParams.set('q', query)
    u.searchParams.set('categories', 'general')
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
  return toTextResults(
    (data.results || []).map((r) => ({
      title: r.title || '',
      page: r.url || '',
      snippet: r.content || '',
    }))
  )
}

async function serperTextSearch(apiKey, query, signal) {
  const res = await proxyFetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': needKey(apiKey), 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, num: 8 }),
    signal,
  })
  if (!res.ok) return httpError(res, 'Serper')
  const data = await res.json()
  return toTextResults(
    (data.organic || []).map((r) => ({
      title: r.title || '',
      page: r.link || '',
      snippet: r.snippet || '',
    }))
  )
}

async function serpApiTextSearch(apiKey, query, signal) {
  const u = new URL('https://serpapi.com/search.json')
  u.searchParams.set('engine', 'google')
  u.searchParams.set('q', query)
  u.searchParams.set('num', '8')
  u.searchParams.set('api_key', needKey(apiKey))
  const res = await proxyFetch(u.toString(), { signal })
  if (!res.ok) return httpError(res, 'SerpAPI')
  const data = await res.json()
  if (data.error) throw new Error(`SerpAPI: ${data.error}`)
  return toTextResults(
    (data.organic_results || []).map((r) => ({
      title: r.title || '',
      page: r.link || '',
      snippet: r.snippet || '',
    }))
  )
}

async function braveTextSearch(apiKey, query, signal) {
  const u = new URL('https://api.search.brave.com/res/v1/web/search')
  u.searchParams.set('q', query)
  u.searchParams.set('count', '8')
  const res = await proxyFetch(u.toString(), {
    headers: { 'X-Subscription-Token': needKey(apiKey), Accept: 'application/json' },
    signal,
  })
  if (!res.ok) return httpError(res, 'Brave Search')
  const data = await res.json()
  return toTextResults(
    (data.web?.results || []).map((r) => ({
      title: r.title || '',
      page: r.url || '',
      snippet: r.description || '',
    }))
  )
}

async function googleCseTextSearch(apiKey, cseId, query, signal) {
  const id = (cseId || '').trim()
  if (!id) {
    throw new Error(
      'No Search Engine ID set — open Settings → Web Image Search and paste your CSE id (cx).'
    )
  }
  const u = new URL('https://customsearch.googleapis.com/customsearch/v1')
  u.searchParams.set('key', needKey(apiKey))
  u.searchParams.set('cx', id)
  u.searchParams.set('q', query)
  u.searchParams.set('num', '8')
  const res = await proxyFetch(u.toString(), { signal })
  if (!res.ok) return httpError(res, 'Google Custom Search')
  const data = await res.json()
  if (data.error) throw new Error(`Google Custom Search: ${data.error.message}`)
  return toTextResults(
    (data.items || []).map((i) => ({
      title: i.title || '',
      page: i.link || '',
      snippet: i.snippet || '',
    }))
  )
}

// settings: { engine, searchUrl, apiKey, cseId } — same shape searchImages
// takes. Returns [{ title, page, snippet }] (up to 8).
export async function searchText(settings, query, signal) {
  const engine = settings?.engine || 'searxng'
  let results
  switch (engine) {
    case 'serper':
      results = await serperTextSearch(settings.apiKey, query, signal)
      break
    case 'serpapi':
      results = await serpApiTextSearch(settings.apiKey, query, signal)
      break
    case 'brave':
      results = await braveTextSearch(settings.apiKey, query, signal)
      break
    case 'google_cse':
      results = await googleCseTextSearch(settings.apiKey, settings.cseId, query, signal)
      break
    case 'searxng':
    default:
      results = await searxngTextSearch(settings?.searchUrl, query, signal)
      break
  }
  if (results.length === 0) {
    throw new Error('No web results found — try different words.')
  }
  return results
}
