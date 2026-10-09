// Offscreen GLB snapshot — renders one frame of a 3D model to a small PNG
// data URL so history tiles can show the actual model instead of a Box icon.
// three.js + GLTFLoader are loaded from the CDN on demand (same pattern as
// model-viewer); offline or on any failure we return null and the caller
// falls back to the Box tile.

let threePromise = null
function loadThree() {
  if (threePromise) return threePromise
  threePromise = (async () => {
    if (!window.THREE) {
      await new Promise((resolve, reject) => {
        const el = document.createElement('script')
        el.src = 'https://unpkg.com/three@0.160.0/build/three.min.js'
        el.onload = resolve
        el.onerror = () => reject(new Error('three.js CDN failed'))
        document.head.appendChild(el)
      })
    }
    // GLTFLoader as a classic script (it attaches to THREE when the UMD
    // build is used); fall back to the module build if needed.
    if (!window.THREE.GLTFLoader && !window.__gltfLoaderReady) {
      window.__gltfLoaderReady = new Promise((resolve, reject) => {
        const el = document.createElement('script')
        el.src = 'https://unpkg.com/three@0.160.0/examples/js/loaders/GLTFLoader.js'
        el.onload = resolve
        el.onerror = () => reject(new Error('GLTFLoader CDN failed'))
        document.head.appendChild(el)
      })
    }
    if (window.__gltfLoaderReady) await window.__gltfLoaderReady
    return { THREE: window.THREE, GLTFLoader: window.THREE?.GLTFLoader }
  })()
  return threePromise
}

// Render one frame of a GLB at `url` and return a PNG data URL (≤ size px).
// Returns null on any failure (offline, CORS, decode error).
export async function captureGlbSnapshot(url, { size = 512, timeoutMs = 12000 } = {}) {
  if (!url || typeof document === 'undefined') return null
  let renderer = null
  try {
    const libs = await Promise.race([
      loadThree(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('three load timeout')), 8000)),
    ])
    const { THREE, GLTFLoader } = libs
    if (!THREE || !GLTFLoader) return null

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
    renderer.setSize(size, size)
    renderer.setClearColor(0x000000, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.domElement.style.position = 'fixed'
    renderer.domElement.style.left = '-99999px'
    renderer.domElement.style.width = `${size}px`
    renderer.domElement.style.height = `${size}px`
    document.body.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000)

    // Neutral studio lighting so textures read clearly.
    scene.add(new THREE.AmbientLight(0xffffff, 0.7))
    const key = new THREE.DirectionalLight(0xffffff, 1.2)
    key.position.set(2, 3, 4)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xffffff, 0.5)
    fill.position.set(-2, 1, -3)
    scene.add(fill)

    const loader = new GLTFLoader()
    const gltf = await Promise.race([
      loader.loadAsync(url),
      new Promise((_, rej) => setTimeout(() => rej(new Error('gltf load timeout')), timeoutMs)),
    ])
    const model = gltf.scene
    scene.add(model)

    // Frame the bounding box with a little padding.
    const box = new THREE.Box3().setFromObject(model)
    const center = box.getCenter(new THREE.Vector3())
    const sphere = box.getBoundingSphere(new THREE.Sphere())
    const radius = sphere.radius || 1
    const dist = radius / Math.tan((camera.fov * Math.PI) / 360) * 1.15
    camera.position.set(center.x + dist * 0.55, center.y + dist * 0.25, center.z + dist * 0.8)
    camera.lookAt(center)

    renderer.render(scene, camera)
    const dataUrl = renderer.domElement.toDataURL('image/png')

    // Cleanup.
    model.traverse((o) => {
      if (o.geometry) o.geometry.dispose()
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material]
        mats.forEach((m) => {
          for (const v of Object.values(m)) if (v && v.isTexture) v.dispose()
          m.dispose()
        })
      }
    })
    renderer.dispose()
    renderer.forceContextLoss?.()
    return dataUrl || null
  } catch {
    return null
  } finally {
    if (renderer?.domElement?.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement)
    renderer?.dispose?.()
  }
}
