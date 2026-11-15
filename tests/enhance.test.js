import test from 'node:test'
import assert from 'node:assert/strict'

import { STYLES, enhancePrompt, stripStyleTags } from '../src/lib/enhance.js'

test('ground style turns a material word into a flat full-frame texture prompt', () => {
  assert.equal(STYLES.ground.label, 'Seamless Ground')
  assert.match(STYLES.ground.prefix, /photograph/i)
  assert.match(STYLES.ground.suffix, /entire frame/i)
  assert.match(STYLES.ground.suffix, /directly above/i)
  assert.match(STYLES.ground.negative, /blurry/i)

  const out = enhancePrompt('mossy stone', 'ground')
  assert.ok(out.startsWith('a photograph of mossy stone'))
  assert.ok(out.endsWith(STYLES.ground.suffix.trim()))
  assert.ok(out.includes('mossy stone'))
})

test('enhancing twice does not duplicate the style tags', () => {
  const once = enhancePrompt('cracked lava', 'ground')
  assert.equal(enhancePrompt(once, 'ground'), once)
})

test('switching styles replaces tags instead of stacking them', () => {
  const ground = enhancePrompt('soil', 'ground')
  const photo = enhancePrompt(ground, 'photoreal')
  assert.ok(photo.startsWith('soil'))
  assert.ok(!photo.toLowerCase().includes('covering the entire frame'))
  assert.ok(photo.endsWith(STYLES.photoreal.suffix.trim()))
})

test('none strips every style tag', () => {
  const ground = enhancePrompt('soil', 'ground')
  assert.equal(enhancePrompt(ground, 'none'), 'soil')
  assert.equal(stripStyleTags(ground), 'soil')
})
