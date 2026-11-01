import { friendlyNodeLabel, getClientId, state } from './state.js'

export function connectWebSocket(serverUrl) {
  if (state.socket) {
    state.socket.close()
  }

  const scheme = serverUrl.startsWith('https') ? 'wss' : 'ws'
  const host = serverUrl.replace(/^https?:\/\//, '')
  state.socket = new WebSocket(`${scheme}://${host}/ws?clientId=${getClientId()}`)

  state.socket.onopen = () => {
    console.log('WebSocket connected')
  }

  state.socket.onmessage = (event) => {
    if (typeof event.data === 'string') {
      const message = JSON.parse(event.data)
      handleWsMessage(message)
    } else {
      // Binary preview frame - skip for now
    }
  }

  state.socket.onerror = (err) => {
    console.error('WebSocket error:', err)
  }

  state.socket.onclose = () => {
    console.log('WebSocket closed')
  }

  return state.socket
}

// Raw WS listeners — long-running flows (3D panel) watch their own prompt
// by filtering execution/progress messages on prompt_id, without taking the
// image/video callbacks over.
const executionListeners = new Set()
export function addExecutionListener(fn) {
  executionListeners.add(fn)
  return () => executionListeners.delete(fn)
}

// exported for tests — the live socket feeds this in handleWsMessage
export function handleWsMessage(message) {
  const { type, data } = message

  for (const fn of executionListeners) {
    try {
      fn(message)
    } catch {
      // a broken listener must not break the socket
    }
  }

  switch (type) {
    case 'progress':
      if (state.progressCallback) {
        state.progressCallback({
          value: data.value,
          max: data.max,
          step: data.value,
          total: data.max,
          promptId: data.prompt_id,
        })
      }
      break

    case 'executing':
      if (data.node === null && data.prompt_id) {
        if (state.phaseCallback) state.phaseCallback(null, data.prompt_id)
        state.promptNodes.delete(data.prompt_id)
        if (state.completionCallback) {
          state.completionCallback(data.prompt_id)
        }
      } else if (data.node && data.prompt_id) {
        // Friendly phase for the node that just started (only for the most
        // recently queued prompt — older queue entries aren't ours to show).
        if (state.phaseCallback && data.prompt_id === state.latestPromptId) {
          const cls = state.promptNodes.get(data.prompt_id)?.[data.node]
          state.phaseCallback(friendlyNodeLabel(cls), data.prompt_id)
        }
      }
      break

    case 'execution_error':
      console.error('Execution error:', data)
      if (state.phaseCallback) state.phaseCallback(null, data.prompt_id)
      if (state.completionCallback) {
        state.completionCallback(null, data)
      }
      break

    case 'execution_interrupted':
      // User pressed Stop (or the server aborted us) — settle like a normal
      // completion so the UI doesn't sit on "Generating…" forever.
      console.log('Execution interrupted:', data)
      if (!data?.prompt_id) break
      if (state.phaseCallback) state.phaseCallback(null, data.prompt_id)
      state.promptNodes.delete(data.prompt_id)
      if (state.completionCallback) state.completionCallback(data.prompt_id)
      break

    case 'status':
      if (data.status?.exec_info) {
        // Queue update
      }
      break
  }
}

export function disconnectWebSocket() {
  if (state.socket) {
    state.socket.close()
    state.socket = null
  }
}
