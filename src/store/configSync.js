// Apply deployment config (config.json) as shared, cross-browser settings.
//
// Fresh browsers always take it. Browsers saved before config-sync existed
// keep their own values until a Settings → Save marks the server config with
// `synced: true` — that way a stale browser can't clobber the server on
// upgrade. `config` is pre-sanitized by src/lib/config.js (whitelisted
// fields, keys stripped). `{ force: true }` (Settings → Update from server)
// applies a synced config regardless of the gate.

import { CONFIG_FIELDS, SETTING_GROUPS, DEFAULT_PRESETS } from './defaults.js'
import { FRESH_INSTALL } from './helpers.js'

function mergeNested(current, incoming) {
  const out = {}
  for (const k of new Set([...Object.keys(current || {}), ...Object.keys(incoming || {})])) {
    out[k] = { ...(current?.[k] || {}), ...(incoming?.[k] || {}) }
  }
  return out
}

export function applyServerConfig(set, config, { force = false } = {}) {
  if (!config || Object.keys(config).length === 0) return
  if (!force && !FRESH_INSTALL && config.synced !== true) return
  set((s) => {
    const patch = {}
    for (const key of CONFIG_FIELDS) {
      if (config[key] !== undefined) patch[key] = config[key]
    }
    // Server wins for url/model; browser keeps its API keys.
    if (config.llmConfigs) patch.llmConfigs = mergeNested(s.llmConfigs, config.llmConfigs)
    if (config.models) patch.models = mergeNested(s.models, config.models)

    if (config.presets) {
      const presets = { ...s.presets }
      for (const [k, v] of Object.entries(config.presets)) {
        if (!Array.isArray(v)) continue
        // Keep the server's order/entries, but make sure every built-in
        // ENGINE preset (the ones carrying an explicit `engine`, e.g.
        // Stable Audio 3) is available. Without this, a device that loads a
        // saved config never sees an engine added after that config was
        // written. Non-engine defaults (Wan, MiniMax) are left to the server
        // list alone, so a deliberately removed preset doesn't reappear.
        const engines = new Set(v.map((p) => p?.engine).filter(Boolean))
        const extra = (DEFAULT_PRESETS[k] || []).filter((p) => p?.engine && !engines.has(p.engine))
        presets[k] = extra.length ? [...v, ...extra] : v
      }
      patch.presets = presets
    }
    if (config.active && typeof config.active === 'object') {
      patch.active = { ...s.active, ...config.active }
    }
    // Per-mode generation settings — server wins per key.
    for (const k of SETTING_GROUPS) {
      if (config[k]) patch[k] = { ...s[k], ...config[k] }
    }
    if (config.threeD) patch.threeD = { ...s.threeD, ...config.threeD }
    return patch
  })
}
