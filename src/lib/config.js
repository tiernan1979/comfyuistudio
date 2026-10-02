// Runtime deployment config: GET /config.json
//
// In production the compose file mounts the host's config.json over this
// path inside the container; in dev, Vite serves public/config.json.
// The app reads it once at startup and seeds ONLY fresh browsers (no
// saved settings yet) — per-browser localStorage always wins afterwards.
//
// API keys are deliberately never read from disk: they stay in the
// browser that typed them.

const LLM_PROVIDERS = new Set(['lmstudio', 'openai', 'anthropic', 'custom'])
const MODEL_GROUPS = new Set(['image', 'video', 'edit'])

// Whitelist + type-check everything; unknown fields are dropped and any
// `key` fields are stripped so a shared config file can't leak secrets.
function sanitize(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object') return out

  if (typeof raw.serverUrl === 'string') out.serverUrl = raw.serverUrl
  if (typeof raw.useProxy === 'boolean') out.useProxy = raw.useProxy
  if (typeof raw.autoUnload === 'boolean') out.autoUnload = raw.autoUnload
  if (typeof raw.style === 'string') out.style = raw.style
  if (typeof raw.searchUrl === 'string') out.searchUrl = raw.searchUrl
  if (typeof raw.llmProvider === 'string' && LLM_PROVIDERS.has(raw.llmProvider)) {
    out.llmProvider = raw.llmProvider
  }

  if (raw.llmConfigs && typeof raw.llmConfigs === 'object') {
    const configs = {}
    for (const [name, c] of Object.entries(raw.llmConfigs)) {
      if (!LLM_PROVIDERS.has(name) || !c || typeof c !== 'object') continue
      const entry = {}
      if (typeof c.url === 'string') entry.url = c.url
      if (typeof c.model === 'string') entry.model = c.model
      // note: c.key intentionally ignored — keys are browser-only
      configs[name] = entry
    }
    if (Object.keys(configs).length > 0) out.llmConfigs = configs
  }

  if (raw.models && typeof raw.models === 'object') {
    const models = {}
    for (const [mode, group] of Object.entries(raw.models)) {
      if (!MODEL_GROUPS.has(mode) || !group || typeof group !== 'object') continue
      const entries = {}
      for (const [k, v] of Object.entries(group)) {
        if (typeof v === 'string') entries[k] = v
      }
      models[mode] = entries
    }
    if (Object.keys(models).length > 0) out.models = models
  }

  return out
}

export async function fetchRuntimeConfig() {
  try {
    const res = await fetch('/config.json', { cache: 'no-store' })
    if (!res.ok) return {}
    return sanitize(await res.json())
  } catch {
    // No config.json (e.g. plain `docker run` without the mount) is fine —
    // the built-in defaults still work.
    return {}
  }
}
