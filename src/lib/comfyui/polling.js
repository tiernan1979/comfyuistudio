import { extractHistoryError } from './history.js'
import { addExecutionListener } from './websocket.js'

// Wait until a queued prompt finishes. Resolves with the history entry,
// rejects on execution error or timeout.
//
//   onTick(secondsElapsed, info) — info = { phase, queuePos, nodeLabel, progress, node }
//   nodes  — { nodeId: humanLabel } so WS "executing" messages can show
//            which step the server is on (built from the workflow object)
//   label  — job name used in timeout/error messages ("Pixal3D", "MIA rig")
//
// Progress sources: HTTP /queue every tick (queue position vs running) and
// the shared ComfyUI websocket (current executing node + step counts).
export function pollHistory(base, promptId, { timeoutMs = 600000, intervalMs = 3000, onTick, nodes = null, label = 'ComfyUI job' } = {}) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    let settled = false
    let timer = null
    let phase = null // 'queued' | 'running' | null (unknown/history lag)
    let queuePos = null
    let nodeLabel = ''
    let node = '' // raw workflow node id currently executing
    let progress = null
    let everQueued = false // seen in /queue at least once
    let goneTicks = 0 // consecutive ticks not in queue and no history

    const info = () => ({ phase, queuePos, nodeLabel, progress, node })

    const offListener = addExecutionListener((msg) => {
      const { type, data } = msg
      if (!data || data.prompt_id !== promptId) return
      if (type === 'executing' && data.node) {
        phase = 'running'
        node = String(data.node)
        nodeLabel = (nodes && nodes[data.node]) || data.node
        progress = null
      } else if (type === 'progress') {
        if (data.max > 1) progress = { value: data.value, max: data.max }
      } else if (type === 'execution_error') {
        const m = data.exception_message || data.message || `${label} failed on node ${data.node_id || '?'}`
        finish(reject, new Error(String(m).slice(0, 600)))
      } else if (type === 'execution_interrupted') {
        finish(reject, new Error('Generation stopped.'))
      }
    })

    const finish = (fn, arg) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      offListener()
      fn(arg)
    }

    const tick = async () => {
      if (settled) return
      if (Date.now() - start > timeoutMs) {
        const mins = Math.round(timeoutMs / 60000)
        finish(
          reject,
          new Error(
            `timed out after ${mins} min waiting for ${label}` +
              (nodeLabel ? ` (last step: ${nodeLabel})` : '') +
              ' — the job may still be running on the server; check the ComfyUI queue and try again'
          )
        )
        return
      }
      let entry = null
      try {
        const res = await fetch(`${base}/history/${promptId}`)
        const data = await res.json()
        entry = data?.[promptId]
        if (entry) {
          const st = entry.status || {}
          if (st.status_str === 'success' || (st.completed === true && st.status_str !== 'error')) {
            finish(resolve, entry)
            return
          }
          if (st.status_str === 'error') {
            finish(reject, new Error(extractHistoryError(entry) || 'workflow failed'))
            return
          }
        }
      } catch {
        // transient network hiccup — keep polling until the timeout
      }
      // Queue position vs running — cheap, and gives useful status even
      // when the websocket is disconnected (headless / remote browsers).
      try {
        const q = await (await fetch(`${base}/queue`)).json()
        const running = (q.queue_running || []).some((r) => r[1] === promptId)
        const pendingIdx = (q.queue_pending || []).findIndex((r) => r[1] === promptId)
        if (running) {
          phase = 'running'
          queuePos = null
          everQueued = true
          goneTicks = 0
        } else if (pendingIdx >= 0) {
          phase = 'queued'
          queuePos = pendingIdx + 1
          everQueued = true
          goneTicks = 0
        } else if (everQueued && !entry) {
          // Was queued, now gone from the queue with no history entry —
          // it was cleared before it ever ran (stop on a pending prompt).
          goneTicks += 1
          if (goneTicks >= 3) {
            finish(reject, new Error('Generation stopped.'))
            return
          }
        }
      } catch {
        // /queue unavailable — keep the last known phase
      }
      onTick?.(Math.round((Date.now() - start) / 1000), info())
      timer = setTimeout(tick, intervalMs)
    }

    tick()
  })
}
