import { useEffect, useRef, useState } from 'react'
import { getViewUrl, downloadFileAs, saveBlobAs } from '../lib/comfyui'
import {
  runGenerateMesh,
  runRigMesh,
  runRigImported,
  runRigServerFile,
  runTripo,
  runMeshUpscale,
  runPaintSkin,
} from '../lib/threed'
import { captureGlbSnapshot, captureFbxSnapshot } from '../lib/snapshot3d'
import useAnimationList from './threed/useAnimationList'
import useIdlePick from './threed/useIdlePick'
import useNodeCheck from './threed/useNodeCheck'
import useServerOptions from './threed/useServerOptions'

const isGlb = (r) => /\.glb$/i.test(r.filename || '')

// All 3D run state and side effects. ThreeDPanel used to carry this inline
// next to the JSX; keeping it here lets the panel stay a layout component.
export default function useThreeDRun({
  base,
  threeD,
  models,
  run,
  setRun,
  addToHistory,
  sourceImage,
}) {
  const busy = run.stage === 'working'
  const isLocal = threeD.pipeline !== 'tripo'

  const [image, setImage] = useState(null) // { file, preview, name }
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef(null)
  const [importedMesh, setImportedMesh] = useState(null) // { file, name }
  const glbRef = useRef(null)
  // Optional override: rig a mesh file already on the server (no upload).
  const [serverMesh, setServerMesh] = useState('')
  const [usBusy, setUsBusy] = useState(false)
  const [paintBusy, setPaintBusy] = useState(false)
  const mvRef = useRef(null)
  const [preview, setPreview] = useState(null) // { url, name }
  const createdUrlRef = useRef(null)
  // Object URL owned by the picked source image (see the cleanup effects).
  const imageUrlRef = useRef('')

  const srcLabel = sourceImage?.name ? ` from ${sourceImage.name}` : ''

  // Edit-stack model names for the face-fix passes; threed.js resolves them
  // against the server's live lists (fresh profiles carry foreign defaults).
  const editModels = {
    unet: models.edit?.unet || '',
    clip: models.image?.clip || '',
    vae: models.image?.vae || '',
  }

  const animations = useAnimationList({
    base,
    busy,
    setRun,
    // Multi-select: every ticked animation becomes its own FBX in ONE rig run.
    initialSelection: threeD.localAnimationFile ? [threeD.localAnimationFile] : [],
  })
  const options = useServerOptions({
    base,
    isLocal,
    tripoPreset: threeD.tripoPreset,
    refreshAnimList: animations.refreshAnimList,
  })
  useNodeCheck({ base, pipeline: threeD.pipeline, setRun })

  // --- Source bytes for the client-side idle pass ------------------------
  const sourceBlob = async () => {
    if (idle.idleMesh?.file) return idle.idleMesh.file
    if (importedMesh?.file) return importedMesh.file
    const glbResult = (run.results || []).find(isGlb)
    const entry = run.mesh?.filename ? run.mesh : glbResult
    if (!entry) throw new Error('Generate or import a mesh first')
    const res = await fetch(await getViewUrl(base, entry.filename, entry.subfolder, entry.type))
    if (!res.ok) throw new Error(`could not load the current mesh (HTTP ${res.status})`)
    return res.blob()
  }

  const sourceName = () =>
    idle.idleMesh?.name ||
    importedMesh?.name ||
    run.mesh?.filename ||
    (run.results || []).find(isGlb)?.filename ||
    'mesh.glb'

  const idle = useIdlePick({
    getSource: sourceBlob,
    getSourceName: sourceName,
    onError: (err) => setRun({ error: err ? err.message || String(err) : null }),
  })

  // Record a finished GLB in history so it shows up in the sidebar grid
  // (Box tile) and can be re-opened in the 3D viewer modal. `entry` is the
  // ComfyUI file ref { filename, subfolder, type }; label describes the step.
  const record3dHistory = async (entry, label) => {
    if (!entry?.filename) return
    try {
      const url = await getViewUrl(
        base,
        entry.filename,
        entry.subfolder || '',
        entry.type || 'output',
      )
      // Render a quick offscreen snapshot so the history tile shows the
      // actual model instead of a Box icon. Best-effort — null → Box fallback.
      // FBX (rigged/animated) needs its own loader; GLTFLoader can't parse it.
      const capture = /\.fbx$/i.test(entry.filename) ? captureFbxSnapshot : captureGlbSnapshot
      const thumbnail = await capture(url).catch(() => null)
      addToHistory({
        id: `3d-${Date.now()}-${entry.filename}`,
        type: '3d',
        prompt: label,
        data: url,
        thumbnail: thumbnail || undefined,
        timestamp: Date.now(),
        settings: {
          pipeline: threeD.pipeline,
          meshMode: threeD.meshMode,
          qualityPreset: threeD.qualityPreset,
        },
      })
    } catch {
      /* history is best-effort — never block the run on it */
    }
  }

  // Preview source priority: idle result → imported mesh → last generated
  // mesh → first GLB in the results list (Tripo).
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
        const glbResult = (run.results || []).find(isGlb)
        if (idle.idleMesh?.file) {
          url = URL.createObjectURL(idle.idleMesh.file)
          createdUrlRef.current = url
          name = idle.idleMesh.name
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
  }, [run.mesh, run.results, importedMesh, idle.idleMesh, base])

  // The picked image's preview is an object URL created here: revoke the
  // previous one when the image is replaced or cleared. Comparing against the
  // live value means a URL still on screen is never revoked.
  useEffect(() => {
    const preview = image?.preview || ''
    if (imageUrlRef.current && imageUrlRef.current !== preview) {
      URL.revokeObjectURL(imageUrlRef.current)
    }
    imageUrlRef.current = preview
  }, [image])

  // Drop the temporary preview URLs when the panel unmounts.
  useEffect(
    () => () => {
      if (createdUrlRef.current) URL.revokeObjectURL(createdUrlRef.current)
      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current)
      imageUrlRef.current = ''
    },
    [],
  )

  const pick = (f) => {
    if (!f || !String(f.type || '').startsWith('image/')) return
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
        } catch {
          /* data: URLs etc. — keep the fallback name */
        }
        pick(new File([blob], decodeURIComponent(name), { type }))
      } catch (err) {
        setRun({ error: `Could not load that image — ${err.message || err}` })
      }
      return
    }
    pick(e.dataTransfer.files?.[0])
  }

  const clearImage = () => {
    setImage(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const guard = (startPatch) => (fn) => async () => {
    if (busy || idle.pickStage != null || !fn) return
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
    idle.resetIdle()
    // newest source wins: drop any previously generated mesh
    if (run.mesh) setRun({ mesh: null })
    if (glbRef.current) glbRef.current.value = ''
  }

  const clearImported = () => {
    setImportedMesh(null)
    idle.resetIdle()
    if (glbRef.current) glbRef.current.value = ''
  }

  // Pause auto-rotate while picking so the face sits still for the clicks.
  useEffect(() => {
    const mv = mvRef.current
    if (!mv) return
    if (idle.pickStage) mv.removeAttribute('auto-rotate')
    else mv.setAttribute('auto-rotate', '')
  }, [idle.pickStage])

  // UltraShape 1.0: refine/upscale the mesh itself (local, free). Runs on
  // the generated mesh or an imported .glb, guided by the source image; the
  // refined GLB replaces the current mesh so Rig picks it up next.
  const handleMeshUpscale = guard({})(async () => {
    if (!image) {
      throw new Error(
        'Pick the source image first — UltraShape refines the mesh guided by your image',
      )
    }
    if (!run.mesh && !importedMesh) throw new Error('Generate or import a mesh first')
    if (options.usCheckpoints.length === 0) {
      throw new Error(
        'UltraShape checkpoint not found — put ultrashape_v1.pt in ComfyUI/models/UltraShape/ and run ' +
          'pip install -r requirements.txt in custom_nodes/ComfyUI-UltraShape1, then restart ComfyUI',
      )
    }
    setUsBusy(true)
    try {
      const localFile = idle.idleMesh?.file || importedMesh?.file
      const res = await runMeshUpscale(
        base,
        {
          cfg: threeD,
          imageFile: image.file,
          meshEntry: localFile ? undefined : run.mesh || undefined,
          meshFile: localFile,
          meshName: localFile ? idle.idleMesh?.name || importedMesh?.name : run.mesh.filename,
        },
        (s) => setRun({ status: s }),
      )
      if (localFile) {
        // client-side source (imported or idle) → result becomes the new local mesh
        setImportedMesh({
          file: new File([res.blob], res.name, { type: 'model/gltf-binary' }),
          name: res.name,
        })
        idle.resetIdle()
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
    if (!image) {
      throw new Error(
        'Pick the source picture first — Hunyuan3D-Paint skins the mesh from your image',
      )
    }
    if (!run.mesh && !importedMesh) throw new Error('Generate or import a mesh first')
    setPaintBusy(true)
    try {
      const localFile = idle.idleMesh?.file || importedMesh?.file
      const res = await runPaintSkin(
        base,
        {
          cfg: threeD,
          imageFile: image.file,
          meshEntry: localFile ? undefined : run.mesh || undefined,
          meshFile: localFile,
          meshName: localFile ? idle.idleMesh?.name || importedMesh?.name : run.mesh.filename,
          editModels,
        },
        (s) => setRun({ status: s }),
      )
      if (localFile) {
        setImportedMesh({
          file: new File([res.blob], res.name, { type: 'model/gltf-binary' }),
          name: res.name,
        })
        idle.resetIdle()
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
    idle.resetIdle()
    if (isLocal) {
      const glb = await runGenerateMesh(
        base,
        image.file,
        threeD,
        (s, meta) => setRun({ status: s, pct: meta?.pct ?? null }),
        editModels,
      )
      setRun({ stage: 'done', status: '', mesh: glb, results: [] })
      await record3dHistory(glb, `3D mesh${srcLabel}`)
    } else {
      const files = await runTripo(base, image.file, threeD, options.presetSel, (s) =>
        setRun({ status: s }),
      )
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
    const localSrc = idle.idleMesh?.file || importedMesh?.file
    const serverSrc = !localSrc && serverMesh.trim() ? serverMesh.trim() : ''
    if (!localSrc && !serverSrc && !run.mesh) return
    const files = localSrc
      ? await runRigImported(base, localSrc, threeD, animations.animSel, (s) => setRun({ status: s }))
      : serverSrc
        ? await runRigServerFile(base, serverSrc, threeD, animations.animSel, (s) =>
            setRun({ status: s }),
          )
        : await runRigMesh(base, run.mesh, threeD, animations.animSel, (s) => setRun({ status: s }))
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
    const mesh = idle.idleMesh || importedMesh
    if (mesh) download({ filename: mesh.name, blob: mesh.file })
    else if (run.mesh) download({ ...run.mesh, blob: null })
  }

  return {
    busy,
    isLocal,
    pickLock: idle.pickStage != null,
    image,
    pick,
    dropImage,
    clearImage,
    dragOver,
    setDragOver,
    fileRef,
    importedMesh,
    pickGlb,
    clearImported,
    glbRef,
    serverMesh,
    setServerMesh,
    usBusy,
    paintBusy,
    preview,
    mvRef,
    ...animations,
    ...options,
    ...idle,
    handleGenerate,
    handleRig,
    handlePaint,
    handleMeshUpscale,
    download,
    downloadMesh,
  }
}
