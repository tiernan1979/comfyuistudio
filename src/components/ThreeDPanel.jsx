import { useEffect, useRef, useState } from 'react'
import Dropdown from './Dropdown'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Box,
  Upload,
  X,
  Hammer,
  Download,
  Loader2,
  AlertTriangle,
  Settings,
  Sparkles,
  Maximize2,
  Brush,
  Eye,
} from 'lucide-react'
import clsx from 'clsx'
import useStore from '../store/useStore'
import DragDivider from './DragDivider'
import { resolveApiBase, getViewUrl, downloadFileAs, saveBlobAs, getNodeComboOptions, checkNodes } from '../lib/comfyui'
import {
  runGenerateMesh,
  runRigMesh,
  runRigImported,
  runTripo,
  runMeshUpscale,
  runPaintSkin,
  listLocalAnimations,
  listTripoPresets,
  requiredThreeDNodes,
  describeNode,
} from '../lib/threed'
import { injectIdleAnimation, loadGlbGeometry } from '../lib/idleAnim'
import { captureGlbSnapshot } from '../lib/snapshot3d'

const BTN = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed'
const BTN_PRIMARY = `${BTN} bg-accent hover:bg-accent-hover text-white`
const BTN_GHOST = `${BTN} bg-bg-hover hover:bg-accent/20 hover:text-accent text-text-secondary`

function StepBadge({ n }) {
  return (
    <span className="w-5 h-5 rounded-full bg-accent/20 text-accent text-[10px] flex items-center justify-center font-bold shrink-0">
      {n}
    </span>
  )
}

export default function ThreeDPanel() {
  const serverUrl = useStore((s) => s.serverUrl)
  const useProxy = useStore((s) => s.useProxy)
  const threeD = useStore((s) => s.threeD)
  const models = useStore((s) => s.models)
  const run = useStore((s) => s.threeDRun)
  const setRun = useStore((s) => s.setThreeDRun)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const controlsWidth = useStore((s) => s.controlsWidth)
  const setControlsWidth = useStore((s) => s.setControlsWidth)
  const addToHistory = useStore((s) => s.addToHistory)
  const sourceImage = useStore((s) => s.sourceImage)

  const base = resolveApiBase(serverUrl, useProxy)
  const busy = run.stage === 'working'

  // Record a finished GLB in history so it shows up in the sidebar grid
  // (Box tile) and can be re-opened in the 3D viewer modal. `entry` is the
  // ComfyUI file ref { filename, subfolder, type }; label describes the step.
  const record3dHistory = async (entry, label) => {
    if (!entry?.filename) return
    try {
      const url = await getViewUrl(base, entry.filename, entry.subfolder || '', entry.type || 'output')
      // Render a quick offscreen snapshot so the history tile shows the
      // actual model instead of a Box icon. Best-effort — null → Box fallback.
      const thumbnail = await captureGlbSnapshot(url).catch(() => null)
      addToHistory({
        id: `3d-${Date.now()}-${entry.filename}`,
        type: '3d',
        prompt: label,
        data: url,
        thumbnail: thumbnail || undefined,
        timestamp: Date.now(),
        settings: { pipeline: threeD.pipeline, meshMode: threeD.meshMode, qualityPreset: threeD.qualityPreset },
      })
    } catch {
      /* history is best-effort — never block the run on it */
    }
  }
  const srcLabel = sourceImage?.name ? ` from ${sourceImage.name}` : ''
  const isLocal = threeD.pipeline !== 'tripo'

  // Edit-stack model names for the face-fix passes; threed.js resolves them
  // against the server's live lists (fresh profiles carry foreign defaults).
  const editModels = {
    unet: models.edit?.unet || '',
    clip: models.image?.clip || '',
    vae: models.image?.vae || '',
  }

  const [image, setImage] = useState(null) // { file, preview, name }
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef(null)
  const [importedMesh, setImportedMesh] = useState(null) // { file, name } — user-supplied .glb
  const glbRef = useRef(null)
  const [animOptions, setAnimOptions] = useState([])
  const [animSel, setAnimSel] = useState(threeD.localAnimationFile || '')
  const [presets, setPresets] = useState([])
  const [presetSel, setPresetSel] = useState(threeD.tripoPreset || 'preset:walk')
  const [usCheckpoints, setUsCheckpoints] = useState([])
  const [usBusy, setUsBusy] = useState(false)
  const [paintBusy, setPaintBusy] = useState(false)
  // Idle animation (client-side morph injection): pick mode + result.
  const [idleMesh, setIdleMesh] = useState(null) // { file, name } — GLB with the idle clip
  const [idleBusy, setIdleBusy] = useState(false)
  const [pickStage, setPickStage] = useState(null) // null | 1 (left eye) | 2 (right eye)
  const pickEyesRef = useRef([])
  const geoRef = useRef(null)
  const [idleNote, setIdleNote] = useState('')
  const mvRef = useRef(null)
  const pickLock = pickStage != null

  // Dynamic option lists come from the ComfyUI server (object_info), so the
  // UI always matches what the nodes actually accept.
  useEffect(() => {
    let dead = false
    ;(async () => {
      if (isLocal) {
        const list = await listLocalAnimations(base)
        if (!dead) setAnimOptions(list)
        const ck = await getNodeComboOptions(base, 'UltraShapeLoadModel', 'checkpoint')
        if (!dead) setUsCheckpoints(ck.filter((c) => c !== '(select file)'))
      } else {
        const list = await listTripoPresets(base)
        if (!dead) {
          setPresets(list)
          setPresetSel((prev) => {
            if (list.length === 0 || list.includes(prev)) return prev
            if (list.includes(threeD.tripoPreset)) return threeD.tripoPreset
            if (list.includes('preset:walk')) return 'preset:walk'
            return list[0]
          })
        }
      }
    })()
    return () => {
      dead = true
    }
  }, [base, isLocal]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fail fast on open: if the required node packs aren't installed on this
  // server, say so immediately instead of letting the first button die.
  useEffect(() => {
    let dead = false
    ;(async () => {
      const { missing, unreachable } = await checkNodes(base, requiredThreeDNodes(threeD.pipeline))
      if (dead) return
      if (missing.length > 0) {
        setRun({
          stage: 'error',
          status: '',
          error:
            `Missing node pack(s) on the ComfyUI server: ${missing.map(describeNode).join('; ')}. ` +
            'Install them in custom_nodes/ and restart ComfyUI, or change the pipeline in Settings → 3D.',
        })
      } else if (unreachable) {
        setRun({
          stage: 'error',
          status: '',
          error: 'ComfyUI is unreachable — check the Server URL in Settings.',
        })
      }
    })()
    return () => {
      dead = true
    }
  }, [base, threeD.pipeline]) // eslint-disable-line react-hooks/exhaustive-deps

  // GLB preview — <model-viewer> comes from the CDN on demand; offline we
  // fall back to a filename card (nothing here blocks generation).
  const [mvReady, setMvReady] = useState(false)
  const [mvFailed, setMvFailed] = useState(false)
  useEffect(() => {
    if (typeof window !== 'undefined' && window.customElements?.get('model-viewer')) {
      setMvReady(true)
      return
    }
    let loaded = false
    const el = document.createElement('script')
    el.type = 'module'
    el.src = 'https://unpkg.com/@google/model-viewer@3.5.0/dist/model-viewer.min.js'
    el.onload = () => {
      loaded = true
      setMvReady(true)
    }
    el.onerror = () => setMvFailed(true) // offline — filename card instead
    document.head.appendChild(el)
    const t = setTimeout(() => {
      if (!loaded) setMvFailed(true)
    }, 10000)
    return () => clearTimeout(t)
  }, [])

  const [preview, setPreview] = useState(null) // { url, name }
  const createdUrlRef = useRef(null)
  useEffect(() => {
    let dead = false
    ;(async () => {
      try {
        if (createdUrlRef.current) {
          URL.revokeObjectURL(createdUrlRef.current)
          createdUrlRef.current = null
        }
        let url = null
        let name = ''
        const glbResult = (run.results || []).find((r) => /\.glb$/i.test(r.filename || ''))
        if (idleMesh?.file) {
          url = URL.createObjectURL(idleMesh.file)
          createdUrlRef.current = url
          name = idleMesh.name
        } else if (importedMesh?.file) {
          url = URL.createObjectURL(importedMesh.file)
          createdUrlRef.current = url
          name = importedMesh.name
        } else if (run.mesh?.filename) {
          url = await getViewUrl(base, run.mesh.filename, run.mesh.subfolder, run.mesh.type)
          name = run.mesh.filename
        } else if (glbResult) {
          url = await getViewUrl(base, glbResult.filename, glbResult.subfolder, glbResult.type)
          name = glbResult.filename
        }
        if (dead) return
        setPreview(url ? { url, name } : null)
      } catch {
        if (!dead) setPreview(null)
      }
    })()
    return () => {
      dead = true
    }
  }, [run.mesh, run.results, importedMesh, idleMesh, base])

  const pick = (f) => {
    if (!f || !f.type.startsWith('image/')) return
    if (image?.preview) URL.revokeObjectURL(image.preview)
    setImage({ file: f, preview: URL.createObjectURL(f), name: f.name })
  }

  // Accept drags from the in-app history tiles / image viewer (custom MIME)
  // as well as OS files and pasted image URLs (text/uri-list).
  const dropImage = async (e) => {
    e.preventDefault()
    setDragOver(false)
    if (busy) return
    const url = (
      e.dataTransfer.getData('application/x-generated-image') ||
      (e.dataTransfer.getData('text/uri-list') || '').split('\n')[0]
    ).trim()
    if (url && !e.dataTransfer.files?.length) {
      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`server responded ${res.status}`)
        const blob = await res.blob()
        const type = blob.type || 'image/png'
        if (!type.startsWith('image/')) throw new Error('that link is not an image')
        let name = 'generated.png'
        try {
          const u = new URL(url, window.location.href)
          name = u.searchParams.get('filename') || u.pathname.split('/').pop() || name
        } catch { /* data: URLs etc. — keep the fallback name */ }
        pick(new File([blob], decodeURIComponent(name), { type }))
      } catch (err) {
        setRun({ error: `Could not load that image — ${err.message || err}` })
      }
      return
    }
    pick(e.dataTransfer.files?.[0])
  }

  const clearImage = () => {
    if (image?.preview) URL.revokeObjectURL(image.preview)
    setImage(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const guard = (startPatch) => (fn) => async () => {
    if (busy || pickLock || !fn) return
    setRun({ stage: 'working', status: 'Starting…', pct: null, error: null, ...startPatch })
    try {
      await fn()
    } catch (err) {
      setRun({ stage: 'error', status: '', error: err.message || String(err) })
    }
  }

  const pickGlb = (f) => {
    if (!f) return
    if (!/\.glb$/i.test(f.name)) {
      setRun({ error: `"${f.name}" is not a .glb file — export your mesh as GLB and try again` })
      return
    }
    setRun({ error: null })
    setImportedMesh({ file: f, name: f.name })
    setIdleMesh(null)
    // newest source wins: drop any previously generated mesh
    if (run.mesh) setRun({ mesh: null })
    if (glbRef.current) glbRef.current.value = ''
  }

  const clearImported = () => {
    setImportedMesh(null)
    setIdleMesh(null)
    if (glbRef.current) glbRef.current.value = ''
  }

  // --- Idle animation (client-side) -------------------------------------
  // Source bytes: the idle-mesh in progress, else whatever mesh is current.
  const sourceBlob = async () => {
    if (idleMesh?.file) return idleMesh.file
    if (importedMesh?.file) return importedMesh.file
    const glbResult = (run.results || []).find((r) => /\.glb$/i.test(r.filename || ''))
    const entry = run.mesh?.filename ? run.mesh : glbResult
    if (!entry) throw new Error('Generate or import a mesh first')
    const res = await fetch(await getViewUrl(base, entry.filename, entry.subfolder, entry.type))
    if (!res.ok) throw new Error(`could not load the current mesh (HTTP ${res.status})`)
    return res.blob()
  }
  const sourceName = () =>
    idleMesh?.name || importedMesh?.name || run.mesh?.filename ||
    (run.results || []).find((r) => /\.glb$/i.test(r.filename || ''))?.filename || 'mesh.glb'

  const cancelPick = () => {
    setPickStage(null)
    pickEyesRef.current = []
    geoRef.current = null
    setIdleNote('Cancelled — no changes made')
    setTimeout(() => setIdleNote(''), 4000)
  }

  const finishPick = async (eyes) => {
    setPickStage(null)
    setIdleBusy(true)
    try {
      const src = await sourceBlob()
      const { blob, stats } = await injectIdleAnimation(src, { eyes })
      const name = sourceName().replace(/\.[^.]+$/, '') + '_idle.glb'
      setIdleMesh({ file: new File([blob], name, { type: 'model/gltf-binary' }), name })
      setIdleNote(
        stats.blink
          ? 'Idle added — breathing + eye blinks, 8s loop. The preview plays it.'
          : 'Idle added — breathing only (eye pick skipped), 8s loop.'
      )
      setTimeout(() => setIdleNote(''), 6000)
    } catch (err) {
      setRun({ error: err.message || String(err) })
    } finally {
      setIdleBusy(false)
      pickEyesRef.current = []
      geoRef.current = null
    }
  }

  const startIdle = async () => {
    if (busy || idleBusy || pickLock) return
    setRun({ error: null })
    setIdleBusy(true)
    try {
      const src = await sourceBlob()
      geoRef.current = await loadGlbGeometry(src)
      pickEyesRef.current = []
      setPickStage(1)
    } catch (err) {
      setRun({ error: err.message || String(err) })
    } finally {
      setIdleBusy(false)
    }
  }

  // Click on the preview while picking: hit-test the model, keep model-space
  // points (the pick API may hand back world or local coords — accept the
  // reading that lands inside the mesh bbox).
  const onViewerClick = (e) => {
    if (!pickStage || !geoRef.current || !mvRef.current) return
    const mv = mvRef.current
    if (typeof mv.positionAndNormalFromPoint !== 'function') {
      setRun({ error: 'This viewer build cannot pick points — update the preview library (Settings → About reloads it).' })
      setPickStage(null)
      return
    }
    const rect = mv.getBoundingClientRect()
    const candidates = [
      [e.clientX, e.clientY],
      [e.clientX - rect.left, e.clientY - rect.top],
    ]
    let modelPt = null
    for (const [x, y] of candidates) {
      const hit = mv.positionAndNormalFromPoint(x, y)
      if (!hit?.position) continue
      const raw = [hit.position.x, hit.position.y, hit.position.z]
      const geo = geoRef.current
      if (geo.inBbox(raw)) {
        modelPt = raw
        break
      }
      const local = geo.toModel(raw)
      if (geo.inBbox(local)) {
        modelPt = local
        break
      }
    }
    if (!modelPt) {
      setRun({ error: 'Missed the model — click directly on the character.' })
      return
    }
    const eyes = pickEyesRef.current.concat([modelPt])
    pickEyesRef.current = eyes
    if (eyes.length < 2) {
      setPickStage(2)
      return
    }
    const [a, b] = eyes
    const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
    const diag = geoRef.current.bbox.diag
    if (d < diag * 0.004 || d > diag * 0.4) {
      pickEyesRef.current = []
      setPickStage(1)
      setRun({ error: 'Those two points are not a plausible eye pair — pick both eyes on the face.' })
      return
    }
    finishPick(eyes.map(([x, y, z]) => ({ x, y, z })))
  }

  // Pause auto-rotate while picking so the face sits still for the clicks.
  useEffect(() => {
    const mv = mvRef.current
    if (!mv) return
    if (pickStage) mv.removeAttribute('auto-rotate')
    else mv.setAttribute('auto-rotate', '')
  }, [pickStage])

  // UltraShape 1.0: refine/upscale the mesh itself (local, free). Runs on
  // the generated mesh or an imported .glb, guided by the source image; the
  // refined GLB replaces the current mesh so Rig picks it up next.
  const handleMeshUpscale = guard({})(async () => {
    if (!image) throw new Error('Pick the source image first — UltraShape refines the mesh guided by your image')
    if (!run.mesh && !importedMesh) throw new Error('Generate or import a mesh first')
    if (usCheckpoints.length === 0) {
      throw new Error(
        'UltraShape checkpoint not found — put ultrashape_v1.pt in ComfyUI/models/UltraShape/ and run ' +
          'pip install -r requirements.txt in custom_nodes/ComfyUI-UltraShape1, then restart ComfyUI'
      )
    }
    setUsBusy(true)
    try {
      const localFile = idleMesh?.file || importedMesh?.file
      const res = await runMeshUpscale(
        base,
        {
          cfg: threeD,
          imageFile: image.file,
          meshEntry: localFile ? undefined : run.mesh || undefined,
          meshFile: localFile,
          meshName: localFile ? idleMesh?.name || importedMesh?.name : run.mesh.filename,
        },
        (s) => setRun({ status: s })
      )
      if (localFile) {
        // client-side source (imported or idle) → result becomes the new local mesh
        setImportedMesh({ file: new File([res.blob], res.name, { type: 'model/gltf-binary' }), name: res.name })
        setIdleMesh(null)
        setRun({ stage: 'done', status: '', error: null, mesh: null })
      } else {
        setRun({ stage: 'done', status: '', error: null, mesh: res.entry })
      }
    } finally {
      setUsBusy(false)
    }
  })

  // Hunyuan3D-Paint: skin the current mesh (generated or imported) from the
  // source picture — local, free, PBR baseColor + metallic/roughness. The
  // painted GLB replaces the current mesh so Rig/download pick it up next.
  const handlePaint = guard({})(async () => {
    if (!image) throw new Error('Pick the source picture first — Hunyuan3D-Paint skins the mesh from your image')
    if (!run.mesh && !importedMesh) throw new Error('Generate or import a mesh first')
    setPaintBusy(true)
    try {
      const localFile = idleMesh?.file || importedMesh?.file
      const res = await runPaintSkin(
        base,
        {
          cfg: threeD,
          imageFile: image.file,
          meshEntry: localFile ? undefined : run.mesh || undefined,
          meshFile: localFile,
          meshName: localFile ? idleMesh?.name || importedMesh?.name : run.mesh.filename,
          editModels,
        },
        (s) => setRun({ status: s })
      )
      if (localFile) {
        setImportedMesh({ file: new File([res.blob], res.name, { type: 'model/gltf-binary' }), name: res.name })
        setIdleMesh(null)
        setRun({ stage: 'done', status: '', error: null, mesh: null })
      } else {
        setRun({ stage: 'done', status: '', error: null, mesh: res.entry })
      }
      await record3dHistory(res.entry, `Painted skin${srcLabel}`)
    } finally {
      setPaintBusy(false)
    }
  })

  const handleGenerate = guard({ mesh: null, results: [] })(async () => {
    if (!image) return
    setImportedMesh(null)
    setIdleMesh(null)
    if (isLocal) {
      const glb = await runGenerateMesh(
        base,
        image.file,
        threeD,
        (s, meta) => setRun({ status: s, pct: meta?.pct ?? null }),
        editModels
      )
      setRun({ stage: 'done', status: '', mesh: glb, results: [] })
      await record3dHistory(glb, `3D mesh${srcLabel}`)
    } else {
      const files = await runTripo(base, image.file, threeD, presetSel, (s) => setRun({ status: s }))
      setRun({
        stage: 'done',
        status: '',
        results: files.map((f) => ({ ...f, blob: null })),
      })
      const glb = files.find((f) => /\.glb$/i.test(f.filename))
      if (glb) await record3dHistory(glb, `Tripo model${srcLabel}`)
    }
  })

  const handleRig = guard({ results: [] })(async () => {
    if (!run.mesh && !importedMesh && !idleMesh) return
    const localSrc = idleMesh?.file || importedMesh?.file
    const files = localSrc
      ? await runRigImported(base, localSrc, threeD, animSel, (s) => setRun({ status: s }))
      : await runRigMesh(base, run.mesh, threeD, animSel, (s) => setRun({ status: s }))
    setRun({
      stage: 'done',
      status: '',
      results: files.map((f) => ({ ...f, blob: f.blob || null })),
    })
    const rigged = files.find((f) => !f.blob && /\.(glb|fbx)$/i.test(f.filename))
    if (rigged) await record3dHistory(rigged, `Rigged model${srcLabel}`)
  })

  const download = async (r) => {
    try {
      if (r.blob) {
        saveBlobAs(r.blob, r.filename)
      } else {
        await downloadFileAs(await getViewUrl(base, r.filename, r.subfolder, r.type), r.filename)
      }
    } catch (err) {
      setRun({ error: err.message || String(err) })
    }
  }

  const downloadMesh = () => {
    if (idleMesh) download({ filename: idleMesh.name, blob: idleMesh.file })
    else if (importedMesh) download({ filename: importedMesh.name, blob: importedMesh.file })
    else if (run.mesh) download({ ...run.mesh, blob: null })
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Controls panel — same layout as the other tabs */}
      <div
        data-testid="controls-panel"
        className="flex flex-col border-r border-border bg-bg-secondary/30 overflow-y-auto shrink-0"
        style={{ width: controlsWidth }}
      >
        <div className="p-4 space-y-4 flex-1">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent/20 flex items-center justify-center">
              <Box size={20} className="text-accent" />
            </div>
            <div>
              <h2 className="text-lg font-bold">3D Generation</h2>
              <p className="text-xs text-text-muted">
                {isLocal
                  ? 'Local · image → mesh (Pixal3D/TRELLIS.2) + MIA auto-rig on your ComfyUI'
                  : 'Tripo cloud · image → model → rig → preset animation'}
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowSettings(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-text-secondary hover:text-accent hover:bg-bg-hover transition-colors"
          >
            <Settings size={14} />
            Configure
          </button>
        </div>

        {/* Source image */}
        <div className="space-y-1.5">
          <label className="text-xs text-text-muted block">Character image</label>
          <AnimatePresence mode="wait">
            {image ? (
              <motion.div
                key="preview"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOver(true)
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={dropImage}
                className={clsx(
                  'relative rounded-xl overflow-hidden border group transition-all',
                  dragOver ? 'border-accent ring-2 ring-accent/50' : 'border-border'
                )}
              >
                <img src={image.preview} alt="Source" className="w-full max-h-52 object-contain bg-black/30" />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pt-6 pb-2 flex items-center justify-between">
                  <span className="text-[10px] text-white/80 truncate max-w-[240px]">{image.name}</span>
                  {!busy && (
                    <motion.button
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={clearImage}
                      className="p-1.5 rounded-lg bg-black/50 hover:bg-red-500/60 transition-colors"
                      title="Remove image"
                    >
                      <X size={12} />
                    </motion.button>
                  )}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="dropzone"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => !busy && fileRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOver(true)
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={dropImage}
                className={clsx(
                  'rounded-xl border-2 border-dashed px-4 py-8 flex flex-col items-center gap-2 text-center transition-all cursor-pointer',
                  dragOver
                    ? 'border-accent bg-accent/10'
                    : 'border-border hover:border-accent/50 hover:bg-bg-card',
                  busy && 'opacity-50 cursor-default'
                )}
              >
                {dragOver ? (
                  <Upload size={22} className="text-accent" />
                ) : (
                  <Box size={22} className="text-text-muted" />
                )}
                <p className="text-xs text-text-secondary">
                  Drop a character image here, drag one from your generations, or{' '}
                  <span className="text-accent font-medium">browse</span>
                </p>
                <p className="text-[10px] text-text-muted">
                  Full-body or 3/4 view works best — one clear character
                </p>
              </motion.div>
            )}
          </AnimatePresence>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => pick(e.target.files?.[0])}
          />
        </div>

        {/* Pipeline */}
        {isLocal ? (
          <>
            {/* Step 1: generate mesh */}
            <div className="rounded-xl bg-bg-card border border-border p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold flex items-center gap-2">
                    <StepBadge n={1} />
                    Generate mesh
                  </p>
                  <p className="text-[11px] text-text-muted mt-1">
                    The native 3D engine turns the image into a textured GLB on your ComfyUI box (built into ComfyUI ≥
                    0.39 — first run loads the model).
                  </p>
                </div>
                <button onClick={handleGenerate} disabled={!image || busy} className={BTN_PRIMARY}>
                  {busy && run.stage === 'working' && run.mesh === null ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Sparkles size={13} />
                  )}
                  Generate
                </button>
              </div>
              {run.mesh && (
                <div className="flex items-center justify-between gap-3 rounded-lg bg-bg-secondary border border-border px-3 py-2">
                  <span className="text-xs font-mono truncate text-text-secondary">
                    {idleMesh ? idleMesh.name : run.mesh.filename}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={handlePaint}
                      disabled={!image || busy || pickLock}
                      className={BTN_GHOST}
                      title="Skin the mesh with the character picture — Hunyuan3D-Paint PBR textures (local, free)"
                    >
                      {paintBusy ? <Loader2 size={13} className="animate-spin" /> : <Brush size={13} />}
                      Skin
                    </button>
                    <button
                      onClick={handleMeshUpscale}
                      disabled={busy || pickLock}
                      className={BTN_GHOST}
                      title="Refine the mesh with UltraShape 1.0 — sharpens geometry detail (local, free)"
                    >
                      {usBusy ? <Loader2 size={13} className="animate-spin" /> : <Maximize2 size={13} />}
                      Upscale
                    </button>
                    <button
                      onClick={startIdle}
                      disabled={busy || idleBusy || pickLock}
                      className={BTN_GHOST}
                      title="Add a looping idle animation — breathing plus eye blinks. You click both eyes on the preview (or skip to breathing only). Runs entirely in the browser."
                    >
                      {idleBusy || pickLock ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />}
                      Idle
                    </button>
                    <button onClick={downloadMesh} className={BTN_GHOST} disabled={busy}>
                      <Download size={13} />
                      Download
                    </button>
                  </div>
                </div>
              )}
              {!run.mesh && !importedMesh && (
                <p className="text-[11px] text-text-muted">
                  Once a mesh exists, <span className="text-accent font-medium">Skin</span> (Hunyuan3D-Paint),{' '}
                  <span className="text-accent font-medium">Upscale</span> (UltraShape 1.0) and{' '}
                  <span className="text-accent font-medium">Idle</span> (breathing + blinks) buttons appear here — or
                  import a .glb below to work on an existing model.
                </p>
              )}
            </div>

            {/* Already have a mesh? import it and skip Step 1 */}
            <div className="rounded-xl bg-bg-card border border-border p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold flex items-center gap-2">
                    <Upload size={14} className="text-text-muted" />
                    Have a mesh already?
                  </p>
                  <p className="text-[11px] text-text-muted mt-1">
                    Pick a .glb from your computer — then Skin (Hunyuan3D-Paint), Upscale (UltraShape 1.0 refine),
                    Idle (breathing + blinks) or go straight to Rig.
                  </p>
                </div>
                <button onClick={() => !busy && glbRef.current?.click()} disabled={busy || pickLock} className={BTN_GHOST + ' shrink-0'}>
                  <Upload size={13} />
                  Choose .glb
                </button>
              </div>
              {importedMesh && (
                <div className="flex items-center justify-between gap-3 rounded-lg bg-accent/10 border border-accent/30 px-3 py-2">
                  <span className="text-xs font-mono truncate text-accent">{idleMesh ? idleMesh.name : importedMesh.name}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={handlePaint}
                      disabled={!image || busy || pickLock}
                      className={BTN_GHOST}
                      title="Skin the mesh with the character picture — Hunyuan3D-Paint PBR textures (local, free)"
                    >
                      {paintBusy ? <Loader2 size={13} className="animate-spin" /> : <Brush size={13} />}
                      Skin
                    </button>
                    <button
                      onClick={handleMeshUpscale}
                      disabled={busy || pickLock}
                      className={BTN_GHOST}
                      title="Refine the mesh with UltraShape 1.0 using the character image above (local, free)"
                    >
                      {usBusy ? <Loader2 size={13} className="animate-spin" /> : <Maximize2 size={13} />}
                      Upscale
                    </button>
                    <button
                      onClick={startIdle}
                      disabled={busy || idleBusy || pickLock}
                      className={BTN_GHOST}
                      title="Add a looping idle animation — breathing plus eye blinks. You click both eyes on the preview (or skip to breathing only). Runs entirely in the browser."
                    >
                      {idleBusy || pickLock ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />}
                      Idle
                    </button>
                    {!busy && !pickLock && (
                      <button onClick={clearImported} className={BTN_GHOST} title="Remove imported mesh">
                        <X size={13} />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
            <input
              ref={glbRef}
              type="file"
              accept=".glb,model/gltf-binary"
              className="hidden"
              onChange={(e) => pickGlb(e.target.files?.[0])}
            />

            {/* Step 2: rig + optional animation */}
            <div
              className={clsx(
                'rounded-xl bg-bg-card border border-border p-4 space-y-3',
                !run.mesh && !importedMesh && 'opacity-50'
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold flex items-center gap-2">
                    <StepBadge n={2} />
                    Rig {animSel ? '& animate' : ''}
                  </p>
                  <p className="text-[11px] text-text-muted mt-1">
                    MIA auto-rigs the mesh
                    {animSel ? (
                      <>
                        {' '}
                        and applies <span className="font-mono text-accent">{animSel}</span>
                      </>
                    ) : (
                      ' (skips animation)'
                    )}
                    . Output: FBX ready for Godot/Unity.
                  </p>
                </div>
                <button
                  onClick={handleRig}
                  disabled={(!run.mesh && !importedMesh && !idleMesh) || busy || pickLock}
                  className={BTN_PRIMARY}
                >
                  {busy && !usBusy && run.stage === 'working' && (run.mesh || importedMesh) ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Hammer size={13} />
                  )}
                  {animSel ? 'Rig & animate' : 'Rig only'}
                </button>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-text-secondary">Animation</label>
                <Dropdown
                  value={animSel}
                  onChange={setAnimSel}
                  disabled={busy}
                  options={[
                    { value: '', label: 'Rig only — no animation' },
                    ...animOptions.map((o) => ({ value: o, label: o })),
                  ]}
                  ariaLabel="Animation"
                  className="text-xs"
                />
                <p className="text-[10px] text-text-muted">
                  {animOptions.length > 0
                    ? `${animOptions.length} animation file(s) on server — add more FBX files to ComfyUI's input/animation_templates/mixamo/ and restart ComfyUI`
                    : 'Animation file list not loaded — is the ComfyUI server reachable?'}
                </p>
              </div>
            </div>
          </>
        ) : (
          /* Tripo pipeline: one chain */
          <div className="rounded-xl bg-bg-card border border-border p-4 space-y-3">
            <p className="text-sm font-semibold flex items-center gap-2">
              <StepBadge n={1} />
              Generate, rig & animate
            </p>
            <p className="text-[11px] text-text-muted -mt-1">
              One Tripo cloud job: image → model → skeleton → preset animation. Requires ComfyUI signed in to
              comfy.org (Settings → API keys) and uses your Tripo credits.
            </p>
            <div className="space-y-1">
              <label className="text-xs text-text-secondary">Animation preset</label>
              <Dropdown
                value={presetSel}
                onChange={setPresetSel}
                disabled={busy}
                options={
                  presets.length === 0
                    ? [{ value: presetSel, label: presetSel }]
                    : presets.map((o) => ({ value: o, label: o.replace('preset:', '') }))
                }
                ariaLabel="Animation preset"
                className="text-xs"
              />
              <p className="text-[10px] text-text-muted">
                {presets.length > 0
                  ? `${presets.length} presets on server (walk, run, jump, …)`
                  : 'Preset list not loaded — using the saved selection'}
              </p>
            </div>
            <div className="flex justify-end">
              <button onClick={handleGenerate} disabled={!image || busy} className={BTN_PRIMARY}>
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                Generate & animate
              </button>
            </div>
          </div>
        )}

          </div>

          {/* Status / error footer (mirrors the other tabs' Generate area) */}
          <div className="p-4 border-t border-border space-y-3">
            {busy && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-accent">
                  <Loader2 size={14} className="animate-spin shrink-0" />
                  <span>{run.status || 'Working…'}</span>
                  {run.pct != null && (
                    <span className="ml-auto tabular-nums text-text-secondary">{run.pct}%</span>
                  )}
                </div>
                {run.pct != null && (
                  <div className="w-full h-1.5 rounded-full bg-bg-card overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-accent to-purple-500 transition-all duration-700 ease-out"
                      style={{ width: `${run.pct}%` }}
                    />
                  </div>
                )}
              </div>
            )}
            {idleNote && !busy && (
              <div className="rounded-lg bg-accent/10 border border-accent/30 px-3 py-2.5 text-xs text-accent">
                {idleNote}
              </div>
            )}
            {run.error && (
              <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2.5 text-xs text-red-300 flex gap-2">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                <span className="leading-relaxed">{run.error}</span>
              </div>
            )}
          </div>
        </div>

        <DragDivider
          label="Resize controls panel"
          value={controlsWidth}
          min={240}
          max={560}
          defaultValue={320}
          onChange={setControlsWidth}
          direction={1}
        />

        {/* Viewer — the 3D result, like the other tabs' result pane */}
        <div className="flex-1 p-4 flex flex-col gap-3 overflow-hidden">
          <div
            data-testid="glb-frame"
            className="flex-1 min-h-0 rounded-2xl border border-border bg-bg-card relative overflow-hidden"
          >
            {pickStage && (
              <div className="absolute top-0 inset-x-0 z-10 flex flex-wrap items-center justify-center gap-2 bg-black/75 px-3 py-2 text-xs text-white">
                <span className="font-medium">
                  {pickStage === 1 ? 'Click the LEFT eye on the character' : 'Click the RIGHT eye on the character'}
                </span>
                <button
                  onClick={() => finishPick([])}
                  className="rounded px-2 py-0.5 bg-white/15 hover:bg-white/30 transition-colors"
                  title="Skip the eye pick — the idle clip will breathe only"
                >
                  Breathing only
                </button>
                {pickStage === 2 && (
                  <button
                    onClick={() => {
                      pickEyesRef.current = []
                      setPickStage(1)
                    }}
                    className="rounded px-2 py-0.5 bg-white/15 hover:bg-white/30 transition-colors"
                  >
                    Redo left eye
                  </button>
                )}
                <button
                  onClick={cancelPick}
                  className="rounded px-2 py-0.5 bg-red-500/40 hover:bg-red-500/60 transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
            {preview ? (
              mvReady && !mvFailed ? (
                <model-viewer
                  ref={mvRef}
                  src={preview.url}
                  camera-controls
                  auto-rotate
                  rotation-per-second="24deg"
                  shadow-intensity="1"
                  exposure="0.95"
                  data-testid="glb-preview"
                  onClick={onViewerClick}
                  style={{ width: '100%', height: '100%', display: 'block', backgroundColor: 'transparent' }}
                ></model-viewer>
              ) : mvFailed ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
                  <Box size={34} className="text-text-muted/50" />
                  <p className="text-xs text-text-secondary">
                    Interactive preview unavailable (the viewer library needs internet)
                  </p>
                  <p className="text-[11px] font-mono text-text-muted break-all max-w-sm">{preview.name}</p>
                  <p className="text-[11px] text-text-muted">Use the Download buttons to open it in Blender / Godot / Unity.</p>
                </div>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
                  <Loader2 size={18} className="animate-spin text-accent" />
                  <p className="text-xs text-text-secondary">Loading 3D preview…</p>
                </div>
              )
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
                <Box size={40} className="text-text-muted/50" />
                <p className="text-sm text-text-secondary">No mesh yet</p>
                <p className="text-[11px] text-text-muted max-w-xs leading-relaxed">
                  Upload a character image and press Generate — the model preview appears here, with
                  Skin, Upscale and Rig in the panel on the left.
                </p>
              </div>
            )}
            {preview && (
              <span className="absolute left-2 bottom-2 max-w-[70%] truncate rounded bg-black/60 px-2 py-1 text-[10px] font-mono text-white/80">
                {preview.name}
              </span>
            )}
          </div>

          {/* Results */}
          {run.results.length > 0 && (
            <div className="shrink-0 rounded-xl bg-bg-card border border-border p-4 space-y-2">
              <p className="text-xs font-semibold text-text-primary">Results</p>
              {run.results.map((r, i) => (
                <div
                  key={`${r.type}/${r.subfolder}/${r.filename}/${i}`}
                  className="flex items-center justify-between gap-3 rounded-lg bg-bg-secondary border border-border px-3 py-2"
                >
                  <span className="text-xs font-mono truncate text-text-secondary">{r.filename}</span>
                  <button onClick={() => download(r)} className={BTN_GHOST} disabled={busy}>
                    <Download size={13} />
                    Download
                  </button>
                </div>
              ))}
            </div>
          )}

          <p className="shrink-0 text-[11px] text-text-muted">
            Files are saved in ComfyUI's output folder on the server — downloads here are a convenience copy.
          </p>
        </div>
    </div>
  )
}
