// Imported ComfyUI workflows (API format). A raw graph is a map of node id →
// { class_type, inputs }. We never execute anything ourselves — the graph is
// posted to ComfyUI unchanged apart from the prompt/negative/seed fields the
// user maps here.

const MAX_JSON = 512 * 1024
const TEXT_KEYS = ['text', 'prompt']
const SEED_KEYS = ['seed', 'noise_seed']

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

// Accepts either a raw API graph or the export shape this app writes
// ({ name, workflow, mapping }). Returns { graph, name }.
export function parseWorkflowJson(text) {
  const raw = String(text || '').trim()
  if (!raw) throw new Error('Paste a workflow JSON file first.')
  if (raw.length > MAX_JSON) throw new Error('That workflow file is too large (max 512 KB).')
  let data
  try {
    data = JSON.parse(raw)
  } catch (err) {
    throw new Error(`Not valid JSON — ${err.message}`)
  }
  const wrapped = isPlainObject(data) && isPlainObject(data.workflow)
  const graph = wrapped ? data.workflow : data
  if (!isPlainObject(graph)) throw new Error('Expected a ComfyUI API workflow object.')
  const entries = Object.entries(graph)
  if (!entries.length) throw new Error('The workflow has no nodes.')
  if (entries.length > 200) throw new Error('The workflow has too many nodes (max 200).')
  for (const [id, node] of entries) {
    if (!isPlainObject(node)) throw new Error(`Node ${id} is not an object.`)
    if (typeof node.class_type !== 'string' || !node.class_type) {
      throw new Error(`Node ${id} has no class_type.`)
    }
    if (node.inputs !== undefined && !isPlainObject(node.inputs)) {
      throw new Error(`Node ${id} has invalid inputs.`)
    }
  }
  return {
    graph,
    name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : '',
    mapping: isPlainObject(data.mapping) ? data.mapping : null,
  }
}

// Find the fields worth exposing in the UI: text/prompt inputs (for the
// positive and negative prompt) and sampler seed inputs.
export function inspectWorkflow(graph) {
  const textNodes = []
  const seedNodes = []
  const outputs = []
  for (const [id, node] of Object.entries(graph || {})) {
    const inputs = node?.inputs || {}
    for (const key of TEXT_KEYS) {
      if (typeof inputs[key] === 'string') {
        textNodes.push({
          id,
          key,
          classType: node.class_type,
          preview: inputs[key].slice(0, 120),
          looksNegative: /negative|low quality|blurry|worst quality|bad anatomy/i.test(
            inputs[key]
          ),
        })
        break
      }
    }
    for (const key of SEED_KEYS) {
      if (typeof inputs[key] === 'number') {
        seedNodes.push({ id, key, classType: node.class_type })
        break
      }
    }
    const cls = node?.class_type || ''
    if (cls === 'SaveImage' || cls === 'PreviewImage') outputs.push({ id, type: 'image', cls })
    else if (/SaveAnimatedWEBP|SaveVideo|VHS_VideoCombine|SaveWEBM/i.test(cls)) {
      outputs.push({ id, type: 'video', cls })
    } else if (/SaveAudio/i.test(cls)) outputs.push({ id, type: 'audio', cls })
  }
  return {
    textNodes,
    seedNodes,
    outputs,
    nodeCount: Object.keys(graph || {}).length,
  }
}

export function defaultMapping(graph) {
  const info = inspectWorkflow(graph)
  const negative = info.textNodes.find((n) => n.looksNegative)
  const positive = info.textNodes.find((n) => !n.looksNegative) || info.textNodes[0]
  const outputType = info.outputs.find((o) => o.type === 'image')
    ? 'image'
    : info.outputs.find((o) => o.type === 'video')
      ? 'video'
      : info.outputs.find((o) => o.type === 'audio')
        ? 'audio'
        : 'image'
  return {
    promptNode: positive?.id || '',
    promptKey: positive?.key || 'text',
    negativeNode: negative?.id || '',
    negativeKey: negative?.key || 'text',
    seedNode: info.seedNodes[0]?.id || '',
    seedKey: info.seedNodes[0]?.key || 'seed',
    outputType,
  }
}

export function mappingIsValid(graph, mapping) {
  if (!mapping?.promptNode) return false
  const node = graph?.[mapping.promptNode]
  if (!node) return false
  const key = mapping.promptKey || 'text'
  return typeof node.inputs?.[key] === 'string'
}

// Clone the graph and inject only mapped fields, leaving every other node
// (and all server-side defaults) exactly as imported.
export function applyCustomWorkflow(graph, mapping, { prompt, negative, seed } = {}) {
  if (!mappingIsValid(graph, mapping)) {
    throw new Error('Choose a valid prompt node for this workflow in Settings → Workflows.')
  }
  const out = JSON.parse(JSON.stringify(graph))
  const promptKey = mapping.promptKey || 'text'
  out[mapping.promptNode].inputs[promptKey] = String(prompt || '')

  if (negative !== undefined && mapping.negativeNode && out[mapping.negativeNode]) {
    const key = mapping.negativeKey || 'text'
    if (typeof out[mapping.negativeNode].inputs?.[key] === 'string') {
      out[mapping.negativeNode].inputs[key] = String(negative)
    }
  }

  if (mapping.seedNode) {
    const key = mapping.seedKey || 'seed'
    const node = out[mapping.seedNode]
    if (!node || typeof node.inputs?.[key] !== 'number') {
      throw new Error(
        `The mapped seed input (${mapping.seedNode}.${key}) is not a number input — ` +
          'remap it in Settings → Workflows or use a fixed seed in the graph.',
      )
    }
    node.inputs[key] =
      seed === -1 || seed === undefined || seed === null
        ? Math.floor(Math.random() * 2 ** 48)
        : seed
  }
  return out
}

// Export shape used by the download button and re-import.
export function serializeWorkflow(record) {
  return JSON.stringify(
    { name: record.name, mapping: record.mapping, workflow: record.graph },
    null,
    2
  )
}
