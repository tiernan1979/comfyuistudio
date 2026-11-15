import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyCustomWorkflow,
  defaultMapping,
  inspectWorkflow,
  mappingIsValid,
  parseWorkflowJson,
  serializeWorkflow,
} from '../src/lib/customWorkflow.js'

const graph = {
  '1': {
    class_type: 'CLIPTextEncode',
    inputs: { clip: ['2', 0], text: 'a cat' },
  },
  '3': {
    class_type: 'CLIPTextEncode',
    inputs: { clip: ['2', 0], text: 'low quality, blurry' },
  },
  '5': {
    class_type: 'KSampler',
    inputs: { seed: 7, model: ['4', 0], positive: ['1', 0], negative: ['3', 0] },
  },
  '9': { class_type: 'SaveImage', inputs: { images: ['8', 0] } },
}

test('parseWorkflowJson accepts a raw API graph and rejects junk', () => {
  const parsed = parseWorkflowJson(JSON.stringify(graph))
  assert.equal(Object.keys(parsed.graph).length, 4)
  assert.throws(() => parseWorkflowJson('not json'), /Not valid JSON/)
  assert.throws(() => parseWorkflowJson('{}'), /no nodes/)
  assert.throws(() => parseWorkflowJson('{"1":{}}'), /class_type/)
})

test('parseWorkflowJson accepts this app’s exported wrapper', () => {
  const parsed = parseWorkflowJson(
    JSON.stringify({ name: 'My flow', workflow: graph, mapping: { outputType: 'video' } })
  )
  assert.equal(parsed.name, 'My flow')
  assert.equal(parsed.mapping.outputType, 'video')
})

test('inspectWorkflow finds text, seed and output nodes', () => {
  const info = inspectWorkflow(graph)
  assert.equal(info.nodeCount, 4)
  assert.equal(info.textNodes.length, 2)
  assert.equal(info.seedNodes[0].id, '5')
  assert.equal(info.outputs[0].type, 'image')
})

test('defaultMapping prefers the positive text node and flags the negative', () => {
  const mapping = defaultMapping(graph)
  assert.equal(mapping.promptNode, '1')
  assert.equal(mapping.negativeNode, '3')
  assert.equal(mapping.seedNode, '5')
  assert.equal(mapping.outputType, 'image')
  assert.equal(mappingIsValid(graph, mapping), true)
})

test('applyCustomWorkflow injects mapped fields and leaves the source intact', () => {
  const mapping = defaultMapping(graph)
  const out = applyCustomWorkflow(graph, mapping, {
    prompt: 'a dog',
    negative: 'watermark',
    seed: 123,
  })
  assert.equal(out['1'].inputs.text, 'a dog')
  assert.equal(out['3'].inputs.text, 'watermark')
  assert.equal(out['5'].inputs.seed, 123)
  // Deep clone: the stored graph is untouched.
  assert.equal(graph['1'].inputs.text, 'a cat')
  assert.equal(graph['5'].inputs.seed, 7)
})

test('applyCustomWorkflow randomises a -1 seed and rejects bad mappings', () => {
  const mapping = defaultMapping(graph)
  const out = applyCustomWorkflow(graph, mapping, { prompt: 'x', seed: -1 })
  assert.equal(typeof out['5'].inputs.seed, 'number')
  assert.notEqual(out['5'].inputs.seed, -1)
  assert.throws(
    () => applyCustomWorkflow(graph, { promptNode: '404' }, { prompt: 'x' }),
    /valid prompt node/
  )
})

test('applyCustomWorkflow clears a mapped negative prompt', () => {
  const mapping = defaultMapping(graph)
  const out = applyCustomWorkflow(graph, mapping, { prompt: 'a dog', negative: '' })
  assert.equal(out['3'].inputs.text, '')
})

test('applyCustomWorkflow rejects a seed mapping that is not a number input', () => {
  const linked = JSON.parse(JSON.stringify(graph))
  linked['5'].inputs.seed = 'not-a-number'
  assert.throws(
    () => applyCustomWorkflow(linked, defaultMapping(graph), { prompt: 'x', seed: 123 }),
    /not a number input/
  )
})

test('serializeWorkflow round-trips through parseWorkflowJson', () => {
  const record = { name: 'Round trip', graph, mapping: defaultMapping(graph) }
  const parsed = parseWorkflowJson(serializeWorkflow(record))
  assert.equal(parsed.name, 'Round trip')
  assert.deepEqual(parsed.graph, graph)
})
