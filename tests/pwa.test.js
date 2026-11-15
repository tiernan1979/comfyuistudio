import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url))
const text = (file) => read(file).toString('utf8')

// PNG IHDR: width and height are big-endian uint32 at bytes 16 and 20.
function pngSize(buffer) {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

test('web app manifest is installable and every icon exists', () => {
  const manifest = JSON.parse(text('public/manifest.webmanifest'))
  assert.equal(manifest.name, 'ComfyUI Studio')
  assert.equal(manifest.short_name, 'ComfyUI')
  assert.equal(manifest.start_url, '/')
  assert.equal(manifest.scope, '/')
  assert.ok(manifest.display === 'standalone' || manifest.display_override?.includes('standalone'))
  assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i)

  assert.ok(manifest.icons.length >= 3)
  for (const icon of manifest.icons) {
    const buffer = read(`public${icon.src}`)
    assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${icon.src} is a PNG`)
    const size = Number(icon.sizes.split('x')[0])
    assert.deepEqual(pngSize(buffer), { width: size, height: size })
  }
})

test('service worker caches the shell and bypasses live API traffic', () => {
  const sw = text('public/sw.js')
  assert.match(sw, /manifest\.webmanifest/)
  assert.match(sw, /\/index\.html/)
  assert.match(sw, /addEventListener\('fetch'/)
  assert.match(sw, /BYPASS/)
  assert.ok(sw.includes('api'))
  assert.ok(sw.includes('proxy'))
  // It must not cache the live config or itself.
  assert.ok(sw.includes('config\\.json'))
  assert.ok(sw.includes('sw\\.js'))
})

test('index.html advertises the manifest and platform install metadata', () => {
  const html = text('index.html')
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/)
  assert.match(html, /rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png"/)
  assert.match(html, /name="theme-color"/)
  assert.match(html, /name="apple-mobile-web-app-capable"/)
  assert.match(html, /name="apple-mobile-web-app-title"/)
  assert.match(html, /rel="icon" type="image\/svg\+xml" href="\/favicon\.svg"/)
})

test('the app registers the service worker in production', () => {
  const pwa = text('src/lib/pwa.js')
  assert.match(pwa, /serviceWorker\.register\('\/sw\.js'\)/)
  assert.match(pwa, /import\.meta\.env\?\.PROD/)
  assert.match(pwa, /beforeinstallprompt/)
  assert.match(pwa, /appinstalled/)
})
