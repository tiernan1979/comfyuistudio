import { useRef, useState } from 'react'
import { probeAnimationFiles, listLocalAnimations, uploadAnimationFiles } from '../../lib/threed'

// Animation checkboxes + FBX uploader for the rig step. The ComfyUI picker
// list is startup-cached, so `probeAnimationFiles` marks files that vanished
// from disk instead of letting a doomed run queue.
export default function useAnimationList({ base, busy, setRun, initialSelection = [] }) {
  const [animOptions, setAnimOptions] = useState([])
  const [animMissing, setAnimMissing] = useState([])
  const [animSel, setAnimSel] = useState(initialSelection)
  const [uploadNote, setUploadNote] = useState('')
  const animFileRef = useRef(null)

  const refreshAnimList = async () => {
    const list = await listLocalAnimations(base)
    setAnimOptions(list)
    try {
      const { missing } = await probeAnimationFiles(base, list)
      setAnimMissing(missing)
      if (missing.length > 0) setAnimSel((prev) => prev.filter((a) => !missing.includes(a)))
    } catch {
      /* probe failed — leave the list as-is, queue-time check catches it */
    }
  }

  const handleAnimUpload = async (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (files.length === 0 || busy) return
    setRun({ stage: 'working', status: 'Starting upload…', error: null })
    try {
      const stored = await uploadAnimationFiles(base, files, (s) =>
        setRun({ stage: 'working', status: s }),
      )
      setRun({ stage: 'done', status: '', error: null })
      await refreshAnimList()
      setAnimSel((prev) => [...new Set([...prev, ...stored])])
      setUploadNote(
        `${stored.length} animation file${stored.length > 1 ? 's' : ''} uploaded. ` +
          `Restart ComfyUI once so the dropdown refreshes, then tick ${stored.length > 1 ? 'them' : 'it'} below.`,
      )
    } catch (err) {
      setRun({ stage: 'error', status: '', error: err.message || String(err) })
    }
  }

  return {
    animOptions,
    animMissing,
    animSel,
    setAnimSel,
    uploadNote,
    animFileRef,
    refreshAnimList,
    handleAnimUpload,
  }
}
