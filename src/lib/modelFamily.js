// Track which model family ComfyUI currently has resident so consecutive runs
// of the same pipeline reuse the weights, while a switch (image → video, music
// → SFX, a different UNET, …) unloads first instead of stacking both in VRAM.
// This is intentionally module-local: it is runtime state, not a persisted
// user setting.

const IMAGE_MODES = new Set(['image', 'edit', 'parts', 'sprite'])

const LABELS = {
  image: 'image models',
  video: 'video models',
  music: 'music models',
  sfx: 'SFX models',
  character: 'character animation models',
  custom: 'custom workflow models',
}

let loadedFamily = ''

export function getLoadedFamily() {
  return loadedFamily
}

export function setLoadedFamily(family) {
  loadedFamily = family || ''
}

function graphKey(graph) {
  const names = []
  for (const node of Object.values(graph || {})) {
    const inputs = node?.inputs || {}
    if (node?.class_type === 'UNETLoader' && inputs.unet_name) names.push(`unet:${inputs.unet_name}`)
    if (node?.class_type === 'CheckpointLoaderSimple' && inputs.ckpt_name) {
      names.push(`ckpt:${inputs.ckpt_name}`)
    }
  }
  return [...new Set(names)].sort().join('|')
}

// The family is "<mode group>:<weight files>". Including the weights means a
// preset switch inside image mode (e.g. Qwen 2.1 → 2.0) also triggers a
// reload, but two ordinary image prompts share one family.
export function familyForRun(state, prep) {
  if (prep?.chainPlan) {
    // Character animation runs two GGUF experts (high/low noise), not a
    // single `unet`; key on both so switching either expert reloads.
    const ch = state.models?.character || {}
    return `character:${ch.high || ''}|${ch.low || ''}`
  }
  const mode = state.mode || 'image'
  const group = IMAGE_MODES.has(mode) ? 'image' : mode === '3d' ? 'character' : mode
  const key = graphKey(prep?.workflow)
  return `${group}:${key || 'default'}`
}

export function familyLabel(family) {
  const group = String(family || '').split(':', 1)[0]
  return LABELS[group] || `${group || 'previous'} models`
}
