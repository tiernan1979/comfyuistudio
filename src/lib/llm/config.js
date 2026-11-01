// Multi-provider AI prompt writer.
// Providers: LM Studio (local), OpenAI, Anthropic (Claude), or any
// OpenAI-compatible endpoint (OpenRouter, Groq, Ollama, vLLM, ...).
// Every request goes through the app's nginx proxy (same-origin), so
// browser CORS never blocks us and provider CORS rules don't apply.

export const PROVIDERS = {
  lmstudio: { label: 'LM Studio (local)', short: 'LM Studio', keyRequired: false, modelsBtn: true },
  openai: { label: 'OpenAI (ChatGPT)', short: 'ChatGPT', keyRequired: true, modelsBtn: false },
  anthropic: { label: 'Anthropic (Claude)', short: 'Claude', keyRequired: true, modelsBtn: false },
  custom: { label: 'OpenAI-compatible (OpenRouter, Groq, Ollama...)', short: 'custom LLM', keyRequired: false, modelsBtn: true },
}

export const MODEL_SUGGESTIONS = {
  openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'],
  anthropic: ['claude-haiku-4-5', 'claude-sonnet-4-5', 'claude-opus-4-1'],
}

// OpenAI-compatible servers expose their API under /v1. If the user gave
// a bare origin (e.g. http://host:1234 or http://host:11434), add it;
// if they gave a base with a path (e.g. https://openrouter.ai/api/v1), keep it.
export function openaiCompatBase(url) {
  const base = (url || '').trim().replace(/\/+$/, '')
  if (!base) return base
  try {
    const u = new URL(base)
    const p = (u.pathname || '').replace(/\/+$/, '')
    if (!p || p === '/') {
      u.pathname = '/v1'
      return u.toString().replace(/\/$/, '')
    }
  } catch { /* not parseable — use as given */ }
  return base
}

// Wrap an absolute URL into the app's dynamic proxy path:
//   https://api.openai.com/v1/... → /proxy/https/api.openai.com/443/v1/...
//   http://host:1234/v1/...       → /proxy/host/1234/v1/...
export function proxyWrap(absoluteUrl) {
  const u = new URL(absoluteUrl)
  const https = u.protocol === 'https:'
  const port = u.port || (https ? '443' : '80')
  return `/proxy/${https ? 'https/' : ''}${u.hostname}/${port}${u.pathname || '/'}${u.search || ''}`
}

// Fallbacks so resolveLlmConfig works even with partial persisted state
const DEFAULT_CONFIGS = {
  lmstudio: { url: 'http://host.docker.internal:1234', model: '' },
  openai: { key: '', model: 'gpt-4o-mini' },
  anthropic: { key: '', model: 'claude-haiku-4-5' },
  custom: { url: '', key: '', model: '' },
}

// Extra local hosts to try when the saved endpoint is unreachable. LM Studio
// lives on the ComfyUI machine (10.1.1.102:1234) here; the Docker host
// (host.docker.internal) does NOT run it, so the shipped default alone fails
// from inside the container.
export const LLM_ENDPOINT_FALLBACKS = [
  'http://10.1.1.102:1234',
  'http://host.docker.internal:1234',
  'http://127.0.0.1:1234',
]

// Model ids that are not chat models — never auto-pick these.
const NON_CHAT_MODEL_RE = /embed|nomic|bge|mxbai|rerank|jina|whisper|tts|vae|clip/i
// Strong signal that a model is a general instruct/chat model.
const CHAT_MODEL_RE = /qwen|gemma|llama|mistral|phi-?\d|glm|yi-|deepseek|intern|smol|gpt-4|claude|llava/i

// No model saved (or the one saved is gone): ask the server what it has and
// pick something that will actually chat — prefer a model already resident in
// VRAM (no load wait), then any instruct-class model, then anything chat-ish.
// Returns '' when the endpoint can't be reached or lists nothing usable.
export async function pickDefaultModel(cfg) {
  if (!cfg?.url) return ''
  if (cfg.provider === 'openai' || cfg.provider === 'anthropic') return cfg.model || ''

  let ids = []
  try {
    ids = await fetchLlmModels(cfg.url)
  } catch {
    ids = []
  }
  if (!ids.length) {
    for (const u of LLM_ENDPOINT_FALLBACKS) {
      if (u === cfg.url) continue
      try {
        ids = await fetchLlmModels(u)
      } catch {
        continue
      }
      if (ids.length) break
    }
  }
  const chat = ids.filter((id) => !NON_CHAT_MODEL_RE.test(id))
  if (!chat.length) return ''

  const loaded = await fetchLlmLoaded(cfg.url).catch(() => null)
  const resident = (loaded || []).find((m) => m.id && chat.includes(m.id) && m.state !== 'unloaded')
  if (resident) return resident.id

  return chat.find((id) => CHAT_MODEL_RE.test(id)) || chat[0]
}

// Turn persisted store state into the request config for the active provider.
export function resolveLlmConfig(state) {
  const provider = state.llmProvider || 'lmstudio'
  const c = { ...DEFAULT_CONFIGS[provider], ...(state.llmConfigs?.[provider] || {}) }
  const label = PROVIDERS[provider]?.short || 'AI'

  if (provider === 'openai') {
    return { provider, label, style: 'openai', url: 'https://api.openai.com/v1', key: (c.key || '').trim(), model: (c.model || '').trim() }
  }
  if (provider === 'anthropic') {
    return { provider, label, style: 'anthropic', url: 'https://api.anthropic.com/v1', key: (c.key || '').trim(), model: (c.model || '').trim() }
  }
  const url = openaiCompatBase(
    provider === 'lmstudio' ? (c.url || 'http://host.docker.internal:1234') : (c.url || '')
  )
  return { provider, label, style: 'openai', url, key: (c.key || '').trim(), model: (c.model || '').trim() }
}

// List models from an OpenAI-compatible endpoint (LM Studio, custom).
export async function fetchLlmModels(rawUrl) {
  const base = openaiCompatBase(rawUrl)
  if (!base) throw new Error('Enter the endpoint URL first.')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  let res
  try {
    res = await fetch(proxyWrap(`${base}/models`), { signal: controller.signal })
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`No response from ${base} (15s)`)
    throw new Error(`Could not reach ${base} (${err.message})`)
  } finally {
    clearTimeout(timeout)
  }
  if (!res.ok) throw new Error(`${base} returned HTTP ${res.status}`)
  const data = await res.json()
  return (data.data || []).map((m) => m.id).filter(Boolean)
}

// LM Studio's own idea of what's resident in VRAM, plus per-model activity.
// GET /v1/models/loaded → { models: [{ id, state, ... }], ... }. `state` is
// "loaded" / "active" / "pending" when the model is resident (or warming up).
// Some builds don't expose this endpoint at all — those return null and the
// caller falls back to the plain /v1/models list.
export async function fetchLlmLoaded(rawUrl) {
  const base = openaiCompatBase(rawUrl)
  if (!base) return null
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6000)
  try {
    // openaiCompatBase already appends /v1 — a second one 404s.
    const res = await fetch(proxyWrap(`${base}/models/loaded`), { signal: controller.signal })
    if (!res.ok) return null
    const data = await res.json()
    if (!Array.isArray(data?.models)) return null
    return data.models.map((m) => ({
      id: String(m.id || m.model || ''),
      state: String(m.state || 'loaded'),
    })).filter((m) => m.id)
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

// Should generation hold off for a big LLM sharing the card?
//   'free'    — no other model resident (or the endpoint is unavailable) → go
//   'unload'  — another model is resident AND ComfyUI is idle → free ComfyUI
//   'busy'    — another model is resident AND ComfyUI has work queued → block
// `own` is the prompt-writer model the user picked in Settings; it never
// counts as "another model" (it's the one the AI button needs resident).
// A model stem "belongs to" `own` when it is the own stem itself, or the own
// stem followed by a separator ('-', '_', '.'). Plain substring would wrongly
// match 'qwen3-4b-instruct-2507-diff' as the own 'qwen3-4b-instruct-2507'.
function sameModel(stem, ownStem) {
  if (!ownStem) return false
  if (stem === ownStem) return true
  return stem.startsWith(ownStem) && /^[-_.]/.test(stem.slice(ownStem.length))
}

export function classifyLlmModels(models, own) {
  const norm = (s) => String(s || '').replace(/\.(gguf|safetensors|bin)$/i, '').toLowerCase()
  const ownStem = norm(own)
  const others = (models || []).filter((m) => !sameModel(norm(m.id), ownStem))
  return others.length > 0 ? { kind: 'unload', others } : { kind: 'free', others: [] }
}
