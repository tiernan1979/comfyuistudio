// ComfyUI Studio service worker — installability and a small offline shell.
//
// Generation, the Studio API, the ComfyUI proxy and config.json are always
// network-only: caching them would show stale queue/history data or let a
// stale config override Settings. Only the app shell and static assets are
// cached. Bump VERSION when the caching strategy changes (not for ordinary
// app builds — navigation is network-first and Vite fingerprints assets).

const VERSION = 'v2'
const PRECACHE = `comfyui-studio-precache-${VERSION}`
const RUNTIME = `comfyui-studio-runtime-${VERSION}`

const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
]

const BYPASS = [
  /^\/api\//,
  /^\/proxy\//,
  /^\/config\.json$/,
  /^\/manifest\.webmanifest$/,
  /^\/sw\.js$/,
]

async function precacheShell() {
  const cache = await caches.open(PRECACHE)
  await cache.addAll(APP_SHELL)

  // Vite fingerprints the JS/CSS bundles, so discover them from the built
  // HTML instead of hard-coding names. Best effort: the shell above is
  // enough if parsing fails.
  try {
    const res = await fetch('/index.html', { cache: 'reload' })
    if (!res.ok) return
    const html = await res.text()
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1])
    if (assets.length > 0) await cache.addAll([...new Set(assets)])
  } catch {
    /* offline install is best-effort */
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('comfyui-studio-') && !key.endsWith(VERSION))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (BYPASS.some((pattern) => pattern.test(url.pathname))) return

  // Pages: network-first so a rebuilt image is picked up immediately; fall
  // back to the last shell when ComfyUI/Studio is offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            event.waitUntil(
              caches
                .open(RUNTIME)
                .then((cache) => cache.put('/', copy))
                .catch(() => {}),
            )
          }
          return res
        })
        .catch(async () => {
          const cache = await caches.open(PRECACHE)
          return (await cache.match('/index.html')) || (await cache.match('/')) || Response.error()
        }),
    )
    return
  }

  // Static assets: cache-first, then network and keep a copy. Hashed Vite
  // bundles never change under the same URL, so this is safe.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request).then((res) => {
        if (res.ok) {
          const copy = res.clone()
          event.waitUntil(
            caches
              .open(RUNTIME)
              .then((cache) => cache.put(request, copy))
              .catch(() => {}),
          )
        }
        return res
      })
    }),
  )
})
