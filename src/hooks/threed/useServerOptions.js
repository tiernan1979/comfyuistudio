import { useEffect, useState } from 'react'
import { getNodeComboOptions } from '../../lib/comfyui'
import { listTripoPresets } from '../../lib/threed'

// Server-driven option lists. Everything here comes from ComfyUI's
// object_info, so the UI always matches what the installed nodes accept;
// failures are non-fatal (the field just stays empty).
export default function useServerOptions({ base, isLocal, tripoPreset, refreshAnimList }) {
  const [meshHints, setMeshHints] = useState([])
  const [presets, setPresets] = useState([])
  const [presetSel, setPresetSel] = useState(tripoPreset || 'preset:walk')
  const [usCheckpoints, setUsCheckpoints] = useState([])

  useEffect(() => {
    let dead = false
    ;(async () => {
      if (isLocal) {
        await refreshAnimList().catch(() => {})
        if (dead) return
        // Stale-cached UniRig mesh list — only ever used as *suggestions*
        // for the server-path combobox (MeshToolsLoad reads any path).
        try {
          const hints = await getNodeComboOptions(base, 'UniRigLoadMesh', 'file_path')
          if (!dead && Array.isArray(hints)) setMeshHints(hints)
        } catch {
          /* UniRig pack absent — no suggestions */
        }
        try {
          const ck = await getNodeComboOptions(base, 'UltraShapeLoadModel', 'checkpoint')
          if (!dead) setUsCheckpoints((ck || []).filter((c) => c !== '(select file)'))
        } catch {
          /* UltraShape pack absent — the Upscale button explains itself */
        }
      } else {
        const list = await listTripoPresets(base)
        if (!dead) {
          setPresets(list)
          setPresetSel((prev) => {
            if (list.length === 0 || list.includes(prev)) return prev
            if (list.includes(tripoPreset)) return tripoPreset
            if (list.includes('preset:walk')) return 'preset:walk'
            return list[0]
          })
        }
      }
    })()
    return () => {
      dead = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, isLocal])

  return { meshHints, presets, presetSel, setPresetSel, usCheckpoints }
}
