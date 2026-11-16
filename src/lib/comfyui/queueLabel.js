// Turn a queued ComfyUI API graph into a one-line description for the queue
// panel: the pipeline it belongs to ("Image", "Image edit", "Video", …) plus
// the first few words of the positive prompt. ComfyUI gives us the raw graph
// (the row's 3rd element), not a mode, so the label is inferred from the node
// classes each builder emits. Best effort — an unknown graph just falls back
// to "Unknown" so the row never renders "[object Object]".

// Node classes that carry prompt text, in the order we'd trust them.
const TEXT_NODES = new Set([
  'CLIPTextEncode',
  'TextEncodeQwenImageEdit',
  'TextEncodeAceStepAudio1.5',
  'MiniMaxMusic3TextEncode',
  'PatinaMaterialNode',
])

// First matching rule wins, so the most distinctive classes come first.
const MODE_RULES = [
  ['3D', ['MeshToolsLoad', 'SaveGLB', 'Preview3D', 'Get3DComponents', 'TripoImageToModelNode', 'UniRigApplyAnimation', 'UltraShapeLoadModel', 'MIALoadModel', 'Load3DAdvanced']],
  ['Material', ['PatinaMaterialNode', 'PatinaMaterialExtractNode', 'PatinaPBRMapsNode']],
  ['Sprite', ['MediaPipeFaceLandmarker', 'LoadMediaPipeFaceLandmarker']],
  ['Split', ['AutoSplitOrchestratorSAM3']],
  ['Video', ['SaveVideo', 'MiniMaxH3ImageToVideo', 'EmptyHunyuanLatentVideo', 'CreateVideo', 'SamplerCustomAdvanced']],
  ['Music', ['EmptyMiniMaxMusic3LatentAudio', 'MiniMaxMusic3TextEncode', 'EmptyAceStep1.5LatentAudio', 'TextEncodeAceStepAudio1.5']],
  ['SFX', ['EmptyLatentAudio', 'ConditioningStableAudio']],
  ['Audio', ['SaveAudio', 'SaveAudioMP3', 'VAEDecodeAudio', 'VAEDecodeAudioTiled']],
]

function classTypes(graph) {
  const set = new Set()
  for (const node of Object.values(graph || {})) {
    if (node?.class_type) set.add(node.class_type)
  }
  return set
}

function hasSavePrefix(graph, prefix) {
  return Object.values(graph || {}).some(
    (node) =>
      node?.class_type === 'SaveImage' &&
      String(node?.inputs?.filename_prefix || '').startsWith(prefix),
  )
}

function pipelineLabel(graph) {
  if (hasSavePrefix(graph, 'flipbook/')) return 'Flipbook'
  if (hasSavePrefix(graph, 'texture/')) return 'Texture'
  if (hasSavePrefix(graph, 'material/')) return 'Material'
  const classes = classTypes(graph)
  for (const [label, markers] of MODE_RULES) {
    if (markers.some((c) => classes.has(c))) return label
  }
  // Masked/two-image flows are edits; plain text-to-image is everything else.
  if (classes.has('LoadImageMask') || classes.has('SetLatentNoiseMask')) return 'Image edit'
  if (classes.has('CLIPTextEncode') || classes.has('TextEncodeQwenImageEdit')) return 'Image'
  return 'Unknown'
}

// Prefer the text node actually wired into the sampler's positive conditioning
// so a negative prompt is never shown by mistake.
function positiveText(graph) {
  const nodes = graph || {}
  for (const node of Object.values(nodes)) {
    const link = node?.inputs?.positive || node?.inputs?.conditioning
    if (!Array.isArray(link)) continue
    const src = nodes[link[0]]
    if (src && TEXT_NODES.has(src.class_type) && (src.inputs?.text || src.inputs?.prompt)) {
      return String(src.inputs.text || src.inputs.prompt)
    }
  }
  for (const node of Object.values(nodes)) {
    if (TEXT_NODES.has(node?.class_type) && (node?.inputs?.text || node?.inputs?.prompt)) {
      return String(node.inputs.text || node.inputs.prompt)
    }
  }
  return ''
}

// First `words` words of the prompt, with a trailing ellipsis when cut short.
function shorten(text, words = 6) {
  const parts = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
  if (!parts.length) return ''
  const head = parts.slice(0, words).join(' ')
  return parts.length > words ? `${head}…` : head
}

export function describeQueuePrompt(graph) {
  const text = positiveText(graph)
  return {
    label: pipelineLabel(graph),
    snippet: shorten(text),
    text,
  }
}
