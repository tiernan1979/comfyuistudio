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
function openaiCompatBase(url) {
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
function proxyWrap(absoluteUrl) {
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

function buildRewriteSystem(styleLabel, mode) {
  const motion =
    mode === 'video'
      ? ' Describe visible motion, atmosphere changes, and camera movement.'
      : ''
  return (
    'You are an expert prompt writer for AI image and video generation ' +
    `(ComfyUI, Qwen-Image, Wan). Rewrite the user's simple idea into ONE rich, ` +
    'detailed paragraph prompt.\n' +
    'Rules:\n' +
    '- The prompt must be 40 to 90 words covering subject, environment, lighting, colors, composition.\n' +
    `- Match this style: ${styleLabel}.${motion}\n` +
    '- Also pick a web image search query: 3-8 lowercase keywords that would find good reference photos of the subject (subject words only, no style words, no punctuation).\n' +
    'Reply with ONLY a JSON object, no markdown, no explanations:\n' +
    '{"prompt": "<the full prompt>", "search_query": "<3-8 keywords>"}'
  )
}

// Parse the model's reply into { prompt, searchQuery }.
// Tolerates markdown fences, surrounding prose, and malformed JSON —
// falls back to treating the whole reply as the prompt.
export function parseRewrite(content) {
  let t = (content || '').trim()
  if (!t) throw new Error('The AI returned an empty rewrite.')

  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')

  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try {
      const obj = JSON.parse(t.slice(start, end + 1))
      if (obj && typeof obj.prompt === 'string' && obj.prompt.trim()) {
        return {
          prompt: obj.prompt.trim(),
          searchQuery: String(obj.search_query || obj.searchQuery || '').trim(),
        }
      }
    } catch { /* fall through to regex extraction */ }

    // Malformed JSON but the fields may still be extractable
    const segment = t.slice(start, end + 1)
    const pm = segment.match(/"prompt"\s*:\s*"((?:[^"\\]|\\.)*)"/)
    if (pm) {
      try {
        const sm = segment.match(/"search_query"\s*:\s*"((?:[^"\\]|\\.)*)"/)
        return {
          prompt: JSON.parse(`"${pm[1]}"`),
          searchQuery: sm ? JSON.parse(`"${sm[1]}"`) : '',
        }
      } catch { /* fall through */ }
    }
  }

  // Not JSON at all: use the text as the prompt (strip only a fully
  // quote-wrapped reply, not a stray trailing quote inside prose)
  let fallback = t
  if (/^["'][\s\S]*["']$/.test(fallback)) fallback = fallback.slice(1, -1)
  fallback = fallback.trim()
  if (fallback) return { prompt: fallback, searchQuery: '' }
  throw new Error('Could not understand the AI rewrite output.')
}

async function httpError(res, cfg) {
  let detail = ''
  try {
    const err = await res.json()
    detail = err?.error?.message || err?.message || ''
  } catch { /* non-JSON error body */ }
  const d = detail ? `: ${detail}` : ''

  if (res.status === 401 || res.status === 403) {
    return new Error(`${cfg.label} rejected the API key (HTTP ${res.status})${d} — check it in Settings.`)
  }
  if (res.status === 429) {
    return new Error(`${cfg.label} rate-limited the request (HTTP 429)${d}`)
  }
  if (res.status === 404) {
    if (cfg.provider === 'lmstudio') {
      return new Error(`Model "${cfg.model}" isn't loaded in LM Studio — open the Developer tab, load it, and start the server.`)
    }
    if (cfg.provider === 'openai') {
      return new Error(`OpenAI doesn't know model "${cfg.model}"${d} — pick a current model id in Settings.`)
    }
    return new Error(`Endpoint didn't recognize the path or model (HTTP 404)${d} — check the base URL (usually ends in /v1) and model name.`)
  }
  return new Error(`${cfg.label} returned HTTP ${res.status}${d}`)
}

// Rewrite the user's idea via the configured provider.
// Returns { prompt, searchQuery }.
export async function rewritePrompt(cfg, { text, styleLabel, mode }, signal) {
  if (!cfg.url) throw new Error('No endpoint URL — open Settings → AI Prompt Writer.')
  if (!cfg.model) throw new Error('No model selected — open Settings → AI Prompt Writer.')
  if (PROVIDERS[cfg.provider]?.keyRequired && !cfg.key) {
    throw new Error(`No API key for ${cfg.label} — open Settings → AI Prompt Writer and paste your key.`)
  }

  const isAnthropic = cfg.style === 'anthropic'
  const system = buildRewriteSystem(styleLabel, mode)
  const url = proxyWrap(
    isAnthropic ? `${cfg.url}/messages` : `${cfg.url}/chat/completions`
  )

  const headers = { 'Content-Type': 'application/json' }
  let body
  if (isAnthropic) {
    headers['x-api-key'] = cfg.key
    headers['anthropic-version'] = '2023-06-01'
    // Required for browser-origin requests; harmless when proxied
    headers['anthropic-dangerous-direct-browser-access'] = 'true'
    body = {
      model: cfg.model,
      max_tokens: 500,
      temperature: 0.8,
      system,
      messages: [{ role: 'user', content: text }],
    }
  } else {
    if (cfg.key) headers['Authorization'] = `Bearer ${cfg.key}`
    body = {
      model: cfg.model,
      temperature: 0.8,
      max_tokens: 500,
      stream: false,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: text },
      ],
    }
  }

  let res
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`AI rewrite timed out (120s) — is ${cfg.label} running and the model loaded?`)
    }
    throw new Error(`Could not reach ${cfg.label} (${err.message})`)
  }
  if (!res.ok) throw await httpError(res, cfg)

  const data = await res.json()
  const content = isAnthropic
    ? (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('')
    : data.choices?.[0]?.message?.content
  return parseRewrite(content)
}
