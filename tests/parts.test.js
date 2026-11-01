import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PART_DIRECTIONS,
  buildPartPrompt,
  normalizePartDirection,
  partDirectionPhrase,
} from '../src/lib/parts.js'

test('part directions expose distinct prompt phrases', () => {
  const phrases = PART_DIRECTIONS.map((d) => partDirectionPhrase(d.key))
  assert.equal(new Set(phrases).size, PART_DIRECTIONS.length)
  assert.match(partDirectionPhrase('front'), /front view/i)
  assert.match(partDirectionPhrase('side'), /90-degree side profile/i)
  assert.match(partDirectionPhrase('threeQuarter'), /three-quarter/i)
  assert.match(partDirectionPhrase('back'), /rear view/i)
})

test('unknown part directions fall back to front', () => {
  assert.equal(normalizePartDirection('diagonal'), 'front')
  assert.equal(normalizePartDirection(''), 'front')
  assert.equal(normalizePartDirection('side'), 'side')
})

test('armour prompt follows the selected view instead of hardcoding front', () => {
  const front = buildPartPrompt('armour', 'clay', '', 'front')
  const side = buildPartPrompt('armour', 'clay', '', 'side')
  assert.match(front, /front view/i)
  assert.doesNotMatch(front, /90-degree side profile/i)
  assert.match(side, /90-degree side profile/i)
  // The old slot phrase baked "front view" into every armour generation.
  assert.doesNotMatch(side, /front view/i)
  assert.match(side, /strict T-pose/i)
})

test('back and three-quarter views are honoured', () => {
  assert.match(buildPartPrompt('head', 'clay', '', 'back'), /rear view/i)
  assert.match(buildPartPrompt('helmet', 'clay', '', 'threeQuarter'), /three-quarter view/i)
})

test('weapons default to side-on when no view is passed', () => {
  const weapon = buildPartPrompt('weapon', 'steel')
  assert.match(weapon, /90-degree side profile/i)
  assert.doesNotMatch(weapon, /front view/i)
})

test('extra details are preserved after the view phrase', () => {
  const prompt = buildPartPrompt('chest', 'clay', 'gold trim', 'side')
  assert.match(prompt, /gold trim/)
  assert.ok(prompt.indexOf('side profile') < prompt.indexOf('gold trim'))
  assert.match(prompt, /plain pure white background/i)
})
