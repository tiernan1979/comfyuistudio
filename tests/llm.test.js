import test from 'node:test'
import assert from 'node:assert/strict'

import {
  parseRewrite,
  parseLyricSections,
  parseVocalShare,
  plannerCapDuration,
  detectMusicStyle,
  defaultVocalShare,
  stripArtistRefs,
  buildRewriteSystem,
} from '../src/lib/llm/index.js'

test('parseLyricSections splits inline tags and blank-line sections', () => {
  const sections = parseLyricSections('[Intro] [Verse]We ride\nat dawn\n\n[Chorus]\nWe ride')
  assert.deepEqual(
    sections.map((s) => s.tag),
    ['Intro', 'Verse', 'Chorus'],
  )
  assert.equal(sections[1].words, 'We ride\nat dawn')
  assert.equal(sections[2].words, 'We ride')
})

test('parseLyricSections leaves bracket annotations inside a line', () => {
  const sections = parseLyricSections('[Verse]la la [2x] la')
  assert.equal(sections.length, 1)
  assert.equal(sections[0].tag, 'Verse')
  assert.ok(sections[0].words.includes('[2x]'))
})

test('parseLyricSections keeps untagged text as one section', () => {
  const sections = parseLyricSections('just a line')
  assert.deepEqual(sections, [{ tag: '', words: 'just a line', raw: 'just a line' }])
})

test('parseVocalShare only accepts a sane percentage', () => {
  assert.equal(parseVocalShare('25% of the song for lyrics'), 0.25)
  assert.equal(parseVocalShare('100%'), 1)
  assert.equal(parseVocalShare('0%'), null)
  assert.equal(parseVocalShare('150%'), null)
  assert.equal(parseVocalShare('no percentage here'), null)
})

test('plannerCapDuration applies 1.1x headroom inside 10–360s', () => {
  assert.equal(plannerCapDuration(30), 33)
  assert.equal(plannerCapDuration(5), 10)
  assert.equal(plannerCapDuration(1000), 360)
  assert.equal(plannerCapDuration(0), 330)
})

test('detectMusicStyle recognises the main genre families', () => {
  assert.equal(detectMusicStyle('melodic techno with a rolling bassline'), 'dance')
  assert.equal(detectMusicStyle('lo-fi beats to study to'), 'electronic')
  assert.equal(detectMusicStyle('acoustic ballad, fingerpicked guitar'), 'ballad')
  assert.equal(detectMusicStyle('indie rock anthem'), 'rock')
  assert.equal(detectMusicStyle('a chiptune adventure'), 'generic')
})

test('defaultVocalShare follows genre convention', () => {
  assert.equal(defaultVocalShare('dance'), 0.15)
  assert.equal(defaultVocalShare('electronic'), 0.2)
  assert.equal(defaultVocalShare('ballad'), 0.45)
  assert.equal(defaultVocalShare('rock'), 0.5)
  assert.equal(defaultVocalShare('generic'), 0.5)
})

test('stripArtistRefs removes names and attached style words', () => {
  const trailing = stripArtistRefs('uplifting trance in the style of Avicii', ['Avicii'])
  assert.ok(!/avicii/i.test(trailing))
  assert.equal(stripArtistRefs('Avicii-style piano house', ['Avicii']), 'piano house')
  assert.equal(stripArtistRefs('nothing to strip', []), 'nothing to strip')
})

test('parseRewrite reads JSON, fenced JSON and plain text', () => {
  const json = parseRewrite('{"prompt":"a red fox","search_query":"red fox","duration":12}')
  assert.equal(json.prompt, 'a red fox')
  assert.equal(json.searchQuery, 'red fox')
  assert.equal(json.duration, 12)

  const fenced = parseRewrite('```json\n{"prompt":"a blue whale"}\n```')
  assert.equal(fenced.prompt, 'a blue whale')

  const plain = parseRewrite('a sleepy village')
  assert.equal(plain.prompt, 'a sleepy village')
  assert.deepEqual(plain.suggestions, [])
  assert.equal(plain.title, '')
})

test('parseRewrite rejects empty output', () => {
  assert.throws(() => parseRewrite('   '), /empty rewrite/)
})

test('every UI mode has its own AI prompt writer instructions', () => {
  const modes = ['image', 'video', 'edit', 'music', 'sfx', 'sprite', 'parts', 'custom']
  const prompts = modes.map((mode) => buildRewriteSystem('photorealistic', mode))

  // No mode silently falls back to the image prompt.
  assert.equal(new Set(prompts).size, modes.length)
  assert.match(prompts[0], /AI image generation/)
  assert.match(prompts[1], /AI VIDEO generation/)
  assert.match(prompts[2], /AI image editing/)
  assert.match(prompts[3], /text-to-music/)
  assert.match(prompts[4], /SOUND-EFFECT/)
  assert.match(prompts[5], /SPRITE/)
  assert.match(prompts[6], /PART generation/)
  assert.match(prompts[7], /user-imported ComfyUI workflow/)
})

test('custom workflow prompt writer covers visual and audio output types', () => {
  const system = buildRewriteSystem('photorealistic', 'custom')
  assert.match(system, /workflow output type/i)
  assert.match(system, /image:/)
  assert.match(system, /video:/)
  assert.match(system, /audio:/)
  assert.match(system, /NEVER use visual/)
})
