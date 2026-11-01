import { useEffect, useState } from 'react'
import { checkNodes } from '../../lib/comfyui'
import { requiredThreeDNodes, describeNode } from '../../lib/threed'

// Fail fast on open: if the required node packs aren't installed on this
// server, say so immediately instead of letting the first button die.
export default function useNodeCheck({ base, pipeline, setRun }) {
  useEffect(() => {
    let dead = false
    ;(async () => {
      const { missing, unreachable, busy: serverBusy } = await checkNodes(
        base,
        requiredThreeDNodes(pipeline),
      )
      if (dead) return
      if (missing.length > 0) {
        setRun({
          stage: 'error',
          status: '',
          error:
            `Missing node pack(s) on the ComfyUI server: ${missing.map(describeNode).join('; ')}. ` +
            'Install them in custom_nodes/ and restart ComfyUI, or change the pipeline in Settings → 3D.',
        })
      } else if (serverBusy) {
        setRun({
          stage: 'error',
          status: '',
          error:
            'ComfyUI is busy or stuck (it stopped answering) — finish or interrupt the current run there ' +
            '(ComfyUI → Queue → Cancel All), then retry. This is not a missing-pack problem.',
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, pipeline])
}
