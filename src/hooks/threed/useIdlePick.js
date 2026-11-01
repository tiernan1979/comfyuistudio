import { useRef, useState } from 'react'
import { injectIdleAnimation, loadGlbGeometry } from '../../lib/idleAnim'

// Client-side idle animation: load the current GLB geometry, let the user
// click both eyes on the preview, then inject breathing + blink morphs.
// `getSource` returns the current mesh blob; `getSourceName` names the result.
export default function useIdlePick({ getSource, getSourceName, onError }) {
  const [idleMesh, setIdleMesh] = useState(null) // { file, name }
  const [idleBusy, setIdleBusy] = useState(false)
  const [idleNote, setIdleNote] = useState('')
  const [pickStage, setPickStage] = useState(null) // null | 1 (left eye) | 2 (right eye)
  const pickEyesRef = useRef([])
  const geoRef = useRef(null)

  const resetIdle = () => setIdleMesh(null)

  const redoLeftEye = () => {
    pickEyesRef.current = []
    setPickStage(1)
  }

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
      const src = await getSource()
      const { blob, stats } = await injectIdleAnimation(src, { eyes })
      const name = getSourceName().replace(/\.[^.]+$/, '') + '_idle.glb'
      setIdleMesh({ file: new File([blob], name, { type: 'model/gltf-binary' }), name })
      setIdleNote(
        stats.blink
          ? 'Idle added — breathing + eye blinks, 8s loop. The preview plays it.'
          : 'Idle added — breathing only (eye pick skipped), 8s loop.',
      )
      setTimeout(() => setIdleNote(''), 6000)
    } catch (err) {
      onError(err)
    } finally {
      setIdleBusy(false)
      pickEyesRef.current = []
      geoRef.current = null
    }
  }

  const startIdle = async () => {
    if (idleBusy || pickStage != null) return
    onError(null)
    setIdleBusy(true)
    try {
      const src = await getSource()
      geoRef.current = await loadGlbGeometry(src)
      pickEyesRef.current = []
      setPickStage(1)
    } catch (err) {
      onError(err)
    } finally {
      setIdleBusy(false)
    }
  }

  // Click on the preview while picking: hit-test the model, keep model-space
  // points (the pick API may hand back world or local coords — accept the
  // reading that lands inside the mesh bbox).
  const onViewerClick = (e, mv) => {
    if (!pickStage || !geoRef.current || !mv) return
    if (typeof mv.positionAndNormalFromPoint !== 'function') {
      onError(
        new Error(
          'This viewer build cannot pick points — update the preview library (Settings → About reloads it).',
        ),
      )
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
      onError(new Error('Missed the model — click directly on the character.'))
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
      onError(new Error('Those two points are not a plausible eye pair — pick both eyes on the face.'))
      return
    }
    finishPick(eyes.map(([x, y, z]) => ({ x, y, z })))
  }

  return {
    idleMesh,
    idleBusy,
    idleNote,
    pickStage,
    resetIdle,
    redoLeftEye,
    cancelPick,
    finishPick,
    startIdle,
    onViewerClick,
  }
}
