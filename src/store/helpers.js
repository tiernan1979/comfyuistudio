// Store helpers that don't touch React state.

import { viewFromUrl } from '../lib/comfyui.js'

// Build a display label for a preset: engine badge + unet stem.
export function presetLabel(p) {
  if (!p) return '(none)'
  const engine =
    p.engine === 'ace' || /ace[-_ ]?step/i.test(p.unet || '')
      ? 'ACE'
      : p.engine === 'stable_audio' || /stable[-_ ]?audio/i.test(p.unet || '')
        ? 'Stable Audio'
        : /minimax/i.test(p.unet || '')
          ? 'MiniMax'
          : ''
  const stem = String(p.unet || '').replace(/\.(safetensors|ckpt|pt|sft|bin)$/i, '')
  return engine ? `${engine} · ${stem}` : stem || p.name || '(unnamed)'
}

// Resolve the active model group for a mode. Returns the selected preset's
// fields (unet/clip/vae/lora/engine) when one is active, else the flat group
// (single-model, backward compatible). Callers should spread this over the
// flat group so unset fields (e.g. lora) still fall through.
export function resolveActiveModels(state, mode) {
  const flat = state.models?.[mode] || {}
  const idx = state.active?.[mode]
  const list = state.presets?.[mode] || []
  if (idx === null || idx === undefined || !list[idx]) return { ...flat }
  return { ...flat, ...list[idx] }
}

// Preset-backed groups (image/video/music/SFX) are resolved before preflight so
// the files checked are the same ones the workflow builds with. The flat group
// can still hold an old default — checking it alone rejects a run whose
// selected preset IS installed ("Video model \"wan2.1…\" is not on the server").
export function resolvePresetModels(state) {
  const out = { ...(state.models || {}) }
  for (const mode of ['image', 'video', 'music', 'sfx']) {
    if (out[mode] || state.presets?.[mode]?.length) out[mode] = resolveActiveModels(state, mode)
  }
  return out
}

// True when this browser has no saved settings yet.
export const FRESH_INSTALL = (() => {
  try {
    return !window.localStorage.getItem('comfyui-studio-storage')
  } catch {
    return true
  }
})()

// Browser without crypto.randomUUID (plain-HTTP LAN access)
export function uid() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch {
    /* fall through */
  }
  return `sp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

// Cross-browser deletion sync: the app's own API (nginx /api → studio-api)
// keeps a shared, persisted list of deleted history ids. Every browser
// pushes its deletes here and pulls the list on each history sync, so an
// item deleted anywhere disappears everywhere. Best-effort — offline the
// delete still applies locally.
export function pushHiddenIds(ids) {
  if (typeof window === 'undefined' || !ids?.length) return
  fetch('/api/hidden-ids', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids: ids.map(String) }),
  }).catch(() => {})
}

// Cross-browser/origin history: the app's own API keeps a durable,
// shared copy of generated entries (ComfyUI's own /history is in-memory
// and resets on restart/cleanup), so every browser — including other
// origins like https://… vs http://host:5555 — converges on the same
// list. Entries carry their `view` file params so each browser can
// rebuild the output URL against its own origin. Best-effort, like
// pushHiddenIds — offline the entry still lands locally and is re-pushed
// by the next successful sync's catch-up.
export function pushHistoryEntries(entries) {
  if (typeof window === 'undefined' || !entries?.length) return
  const list = entries
    .filter((e) => e?.id && e?.data)
    .slice(0, 200)
    .map((e) => {
      const view = e.view || viewFromUrl(e.data)
      return view ? { ...e, view } : e
    })
  if (!list.length) return
  fetch('/api/history', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entries: list }),
  }).catch(() => {})
}
