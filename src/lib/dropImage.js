// Extract an image File from a drag-and-drop event.
//
// Handles three sources:
//   • OS files            → dataTransfer.files
//   • in-app tiles/viewer → dataTransfer 'application/x-generated-image'
//   • other browsers/pages → 'text/uri-list'
//
// Returns a File, or null when the drop carried nothing we can use. Throws
// when the drop *looked* like an image (a URL was present) but couldn't be
// fetched — so callers can surface a real error instead of silently ignoring.
export async function fileFromDrop(e) {
  const dt = e?.dataTransfer
  if (!dt) return null

  const files = dt.files
  if (files && files.length) {
    const f = files[0]
    return f && (f.type ? f.type.startsWith('image/') : true) ? f : null
  }

  const url = (
    dt.getData('application/x-generated-image') ||
    (dt.getData('text/uri-list') || '').split('\n')[0] ||
    ''
  ).trim()
  if (!url) return null

  const res = await fetch(url)
  if (!res.ok) throw new Error(`could not load the image (HTTP ${res.status})`)
  const blob = await res.blob()
  const type = blob.type || 'image/png'
  if (!type.startsWith('image/')) throw new Error('that drop is not an image')

  let name = 'dropped.png'
  try {
    const u = new URL(url, window.location.href)
    name = u.searchParams.get('filename') || u.pathname.split('/').pop() || name
  } catch {
    /* data:/blob: URLs — keep the fallback name */
  }
  try {
    name = decodeURIComponent(name)
  } catch {
    /* leave as-is if it isn't percent-encoded */
  }
  return new File([blob], name, { type })
}
