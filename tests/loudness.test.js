import test from 'node:test'
import assert from 'node:assert/strict'

import { applyLoudness } from '../src/lib/workflows/loudness.js'

test('string node ids keep their prefix and increment numerically', () => {
  const wf = {}
  const out = applyLoudness(wf, 'a70', ['a9', 0], { loudEq: true, loudVolume: true })

  assert.equal(wf.a70.class_type, 'AudioEqualizer3Band')
  assert.deepEqual(wf.a70.inputs.audio, ['a9', 0])
  assert.equal(wf.a71.class_type, 'AudioAdjustVolume')
  assert.deepEqual(wf.a71.inputs.audio, ['a70', 0])
  assert.deepEqual(out.audioRef, ['a71', 0])
  assert.equal(out.nextId, 'a72')
  assert.equal(wf.NaN, undefined)
})

test('numeric node ids still increment as numbers', () => {
  const wf = {}
  const out = applyLoudness(wf, 70, ['9', 0], { loudEq: false, loudVolume: true })

  assert.equal(wf[70].class_type, 'AudioAdjustVolume')
  assert.deepEqual(out.audioRef, ['70', 0])
  assert.equal(out.nextId, 71)
})
