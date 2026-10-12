// Live three.js viewer for FBX models — the modal's <model-viewer> path can
// only render glTF/GLB, so rigged+animated FBX history entries came up blank.
// Renders the model with orbit controls and plays the embedded AnimationClip
// (Mixamo walk/run/etc.) if one came in with the file.
import { useEffect, useRef, useState } from 'react'
import { Loader2, Box } from 'lucide-react'

// Lazy-load three + FBXLoader + OrbitControls. FBXLoader is ESM-only and
// bare-imports "three", which the index.html import map resolves.
let threeModPromise = null
function loadThreeMods() {
  if (threeModPromise) return threeModPromise
  threeModPromise = (async () => {
    const [three, fbxMod, orbitMod] = await Promise.all([
      import('three'),
      import('https://unpkg.com/three@0.160.0/examples/jsm/loaders/FBXLoader.js'),
      import('https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js'),
    ])
    return { THREE: three, FBXLoader: fbxMod.FBXLoader, OrbitControls: orbitMod.OrbitControls }
  })()
  return threeModPromise
}

export default function FbxViewer({ url }) {
  const hostRef = useRef(null)
  const [state, setState] = useState('loading') // loading | ready | error
  const [hasClip, setHasClip] = useState(false)
  const [playing, setPlaying] = useState(true)
  // The render loop closes over this ref (not state) so the Play/Pause
  // button can flip playback without rebuilding the whole scene.
  const playingRef = useRef(true)

  useEffect(() => {
    let disposed = false
    let cleanup = () => {}
    setState('loading')
    if (!url) {
      setState('error')
      return
    }
    ;(async () => {
      const host = hostRef.current
      if (!host) return
      let renderer, mixer, frameId
      try {
        const { THREE, FBXLoader, OrbitControls } = await loadThreeMods()
        if (disposed) return

        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        renderer.setSize(host.clientWidth, host.clientHeight)
        renderer.setClearColor(0x000000, 0)
        renderer.outputColorSpace = THREE.SRGBColorSpace
        host.appendChild(renderer.domElement)

        const scene = new THREE.Scene()
        const camera = new THREE.PerspectiveCamera(
          40,
          host.clientWidth / Math.max(host.clientHeight, 1),
          0.01,
          5000
        )
        scene.add(new THREE.AmbientLight(0xffffff, 0.75))
        const key = new THREE.DirectionalLight(0xffffff, 1.25)
        key.position.set(3, 5, 4)
        scene.add(key)
        const fill = new THREE.DirectionalLight(0xffffff, 0.5)
        fill.position.set(-3, -1, -3)
        scene.add(fill)

        const loader = new FBXLoader()
        const model = await loader.loadAsync(url)
        if (disposed) return
        scene.add(model)

        // Frame the model with a little padding.
        const box = new THREE.Box3().setFromObject(model)
        const center = box.getCenter(new THREE.Vector3())
        const sphere = box.getBoundingSphere(new THREE.Sphere())
        const radius = sphere.radius || 1
        const dist = radius / Math.tan((camera.fov * Math.PI) / 360) * 1.2
        camera.position.set(center.x + dist * 0.5, center.y + dist * 0.3, center.z + dist * 0.85)
        camera.lookAt(center)

        const controls = new OrbitControls(camera, renderer.domElement)
        controls.enableDamping = true
        controls.dampingFactor = 0.08
        controls.target.copy(center)
        controls.autoRotate = true
        controls.autoRotateSpeed = 1.6

        // Play the embedded clip (Mixamo walk/run/etc.) if present.
        if (model.animations && model.animations.length > 0) {
          mixer = new THREE.AnimationMixer(model)
          mixer.clipAction(model.animations[0]).play()
          playingRef.current = true
          setHasClip(true)
          setPlaying(true)
        } else {
          setHasClip(false)
        }

        const clock = new THREE.Clock()
        const render = () => {
          if (disposed) return
          frameId = requestAnimationFrame(render)
          const dt = clock.getDelta()
          if (mixer && playingRef.current) mixer.update(dt)
          controls.update()
          renderer.render(scene, camera)
        }
        render()

        const onResize = () => {
          if (!host || disposed) return
          const w = host.clientWidth
          const h = Math.max(host.clientHeight, 1)
          camera.aspect = w / h
          camera.updateProjectionMatrix()
          renderer.setSize(w, h)
        }
        window.addEventListener('resize', onResize)

        cleanup = () => {
          window.removeEventListener('resize', onResize)
          if (frameId) cancelAnimationFrame(frameId)
          controls.dispose()
          model.traverse((o) => {
            if (o.geometry) o.geometry.dispose()
            const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
            mats.forEach((m) => {
              for (const v of Object.values(m)) if (v && v.isTexture) v.dispose()
              m.dispose()
            })
          })
          renderer.dispose()
          renderer.forceContextLoss?.()
          if (renderer.domElement.parentNode) {
            renderer.domElement.parentNode.removeChild(renderer.domElement)
          }
        }
        setState('ready')
      } catch (err) {
        if (!disposed) {
          console.warn('FBX viewer failed:', err)
          cleanup?.()
          setState('error')
        }
      }
    })()
    return () => {
      disposed = true
      cleanup?.()
    }
    // `playing` is intentionally excluded: toggling it must not rebuild the
    // scene — the render loop reads the latest value via closure refresh below.
  }, [url])

  // Toggle playback without tearing down the scene — the render loop reads
  // playingRef.current each frame, so flipping the ref is enough.
  const togglePlay = () => {
    const next = !playingRef.current
    playingRef.current = next
    setPlaying(next)
  }

  return (
    <div className="relative w-full h-full" data-testid="fbx-viewer">
      <div ref={hostRef} className="absolute inset-0" />
      {state === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="animate-spin text-accent" size={28} />
        </div>
      )}
      {state === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
          <Box size={36} className="text-text-muted" />
          <p className="text-sm text-text-secondary">Couldn't load this FBX.</p>
          <p className="text-xs text-text-muted">
            If the preview is empty, download the FBX and open it in Blender.
          </p>
        </div>
      )}
      {state === 'ready' && hasClip && (
        <button
          onClick={togglePlay}
          className="absolute bottom-3 left-3 rounded-md bg-black/60 px-3 py-1.5 text-xs text-white/90 hover:bg-black/80"
        >
          {playing ? 'Pause' : 'Play'}
        </button>
      )}
    </div>
  )
}
