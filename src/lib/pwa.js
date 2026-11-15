// PWA install prompt + service-worker registration.
//
// Chrome/Edge fire `beforeinstallprompt` when the manifest, icons, service
// worker and secure context all satisfy the installability checks. We defer
// the event so the sidebar can offer an explicit "install" button instead of
// relying on the browser's own UI. Safari/iOS never fires it — the button
// falls back to instructions for "Add to Home Screen".

let deferredPrompt = null
const listeners = new Set()

function emit() {
  for (const fn of listeners) fn(deferredPrompt)
}

export function getInstallPrompt() {
  return deferredPrompt
}

export function subscribeInstallPrompt(fn) {
  listeners.add(fn)
  fn(deferredPrompt)
  return () => listeners.delete(fn)
}

export function isStandalone() {
  if (typeof window === 'undefined') return false
  return (
    !!window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  )
}

// Resolves { outcome: 'accepted' | 'dismissed' | 'unavailable' }. The prompt
// object can only be used once, so it is cleared before showing it.
export async function promptInstall() {
  if (!deferredPrompt) return { outcome: 'unavailable' }
  const event = deferredPrompt
  deferredPrompt = null
  emit()
  try {
    await event.prompt()
    const choice = await event.userChoice
    return { outcome: choice?.outcome || 'dismissed' }
  } catch {
    return { outcome: 'dismissed' }
  }
}

export function initPwa() {
  if (typeof window === 'undefined') return

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferredPrompt = event
    emit()
  })

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    emit()
  })

  // Register only in the built app. In Vite dev a stale worker would cache
  // the source modules and serve the previous HMR state.
  if (import.meta.env?.PROD && 'serviceWorker' in navigator) {
    window.addEventListener(
      'load',
      () => {
        navigator.serviceWorker.register('/sw.js').catch((err) => {
          console.warn('Service worker registration failed:', err)
        })
      },
      { once: true },
    )
  }
}
