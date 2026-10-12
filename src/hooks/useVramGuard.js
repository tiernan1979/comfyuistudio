// VRAM guard — keep the GPU free for generation.
//
// The prompt-writer LLM in LM Studio and the ComfyUI diffusion models share
// one card. When a big LLM (anything other than the configured prompt-writer)
// is resident, ComfyUI's models are dropped from VRAM before a run so the two
// never collide. The other model reloads itself on its next use, so nothing
// is lost — the run just starts from a clean card.
//
// "Unload" is safe because ComfyUI's queue being empty means no job of ours
// needs the weights we're about to drop. If the queue is NOT empty, the run
// is blocked with a message instead of racing a running job into an OOM.
import { useCallback } from 'react'
import useStore from '../store/useStore'
import { resolveApiBase } from '../lib/comfyui'
import { fetchLlmLoaded, classifyLlmModels } from '../lib/llm'

// Free ComfyUI's model weights from VRAM (same call the idle timer uses).
async function freeLoadedModels(base) {
  const res = await fetch(`${base}/free`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unload_models: true, free_memory: false }),
  })
  return res.ok
}

// Returns null when generation can proceed, or throws with a human message
// when it must not (VRAM occupied by a busy job).
export async function checkVramGuard(state, onStatus) {
  if (!state.vramGuard) return
  const cfg = state.llmConfigs?.lmstudio || {}
  const llmUrl = cfg.url || 'http://host.docker.internal:1234'
  const own = cfg.model || ''

  onStatus?.('Checking GPU memory…')
  const [loaded, queue] = await Promise.all([
    fetchLlmLoaded(llmUrl).catch(() => null),
    fetch(`${resolveApiBase(state.serverUrl, state.useProxy)}/queue`)
      .then((r) => r.json())
      .catch(() => null),
  ])
  if (!loaded) return // LM Studio unreachable / endpoint unsupported → no guard

  const { kind, others } = classifyLlmModels(loaded, own)
  if (kind === 'free') return

  const names = others.map((m) => m.id).join(', ')
  const busy = (queue?.queue_running?.length || 0) + (queue?.queue_pending?.length || 0) > 0

  if (busy) {
    throw new Error(
      `GPU busy — ${names} is loaded and ComfyUI has a job running/queued. ` +
        `Wait for it to finish (or cancel it), then generate again.`
    )
  }

  // ComfyUI idle + another model resident → free our weights so the LLM owns
  // the card; the diffusion models reload on the next run.
  onStatus?.(`Freeing GPU for ${names}…`)
  const base = resolveApiBase(state.serverUrl, state.useProxy)
  if (await freeLoadedModels(base)) {
    state.setModelsUnloaded(true)
  }
  onStatus?.('GPU ready — loading generation models…')
}

export function useVramGuard() {
  return useCallback(async (onStatus) => {
    await checkVramGuard(useStore.getState(), onStatus)
  }, [])
}
