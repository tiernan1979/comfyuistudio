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
  sanitizeRewrite,
} from '../src/lib/llm/index.js'
import { buildSelectionContext } from '../src/components/prompt/context.js'

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
  const modes = ['image', 'video', 'edit', 'music', 'sfx', 'pixel', 'sprite', 'parts', 'custom']
  const system = Object.fromEntries(
    modes.map((mode) => [mode, buildRewriteSystem('photorealistic', mode)]),
  )

  // No mode silently falls back to the image prompt.
  assert.equal(new Set(Object.values(system)).size, modes.length)
  assert.match(system.image, /AI image generation/)
  assert.match(system.video, /AI VIDEO generation/)
  assert.match(system.edit, /AI image editing/)
  assert.match(system.music, /text-to-music/)
  assert.match(system.sfx, /SOUND-EFFECT/)
  assert.match(system.pixel, /PIXEL ART/)
  assert.match(system.sprite, /SPRITE/)
  assert.match(system.parts, /PART generation/)
  assert.match(system.custom, /user-imported ComfyUI workflow/)
})

test('custom workflow prompt writer covers visual and audio output types', () => {
  const system = buildRewriteSystem('photorealistic', 'custom')
  assert.match(system, /workflow output type/i)
  assert.match(system, /image:/)
  assert.match(system, /video:/)
  assert.match(system, /audio:/)
  assert.match(system, /NEVER use visual/)
})

test('SFX guard translates a visual caption into a usable sound effect', () => {
  const out = sanitizeRewrite(
    'sfx',
    {
      prompt: 'cinematic shot of seamless packed soil texture, photorealistic, 4k',
      negative: '',
      duration: 0,
      title: '',
      suggestions: [
        'a heavy metal latch clicking shut, close',
        'cinematic shot of mossy stone texture',
        'a soft breeze through dry leaves, outdoor ambience',
      ],
    },
    'packed soil',
  )
  assert.match(out.prompt, /footsteps on packed soil/i)
  assert.doesNotMatch(out.prompt, /cinematic|seamless|texture|photorealistic|4k/i)
  assert.match(out.title, /Footsteps/i)
  assert.ok(out.duration >= 1)
  assert.match(out.negative, /music/i)
  assert.deepEqual(out.suggestions, [
    'a heavy metal latch clicking shut, close',
    'a soft breeze through dry leaves, outdoor ambience',
  ])
})

test('SFX guard leaves a real sound description alone', () => {
  const prompt = 'heavy steel door slamming shut, hard impact, concrete room echo'
  const out = sanitizeRewrite('sfx', { prompt, duration: 4, negative: '', title: '' }, 'door')
  assert.equal(out.prompt, prompt)
  assert.equal(out.duration, 4)
})

test('texture guard removes camera and scene language but keeps the material', () => {
  const out = sanitizeRewrite(
    'texture',
    { prompt: 'cinematic photo of mossy stone wall, dramatic lighting, camera close-up, 8k' },
    'mossy stone wall',
  )
  assert.match(out.prompt, /mossy stone wall/i)
  assert.doesNotMatch(out.prompt, /cinematic|photo|camera|close-up|dramatic lighting|8k/i)
})

test('flipbook guard removes staging while keeping the effect', () => {
  const out = sanitizeRewrite(
    'flipbook',
    { prompt: 'cinematic shot of a fireball exploding, dark background, camera zoom' },
    'fireball',
  )
  assert.match(out.prompt, /fireball exploding/i)
  assert.doesNotMatch(out.prompt, /cinematic|shot|background|camera|zoom/i)
})

test('material guard removes photo and studio language', () => {
  const out = sanitizeRewrite(
    'material',
    { prompt: 'photo of rusty steel, studio lighting, background' },
    'rusty steel',
  )
  assert.match(out.prompt, /rusty steel/i)
  assert.doesNotMatch(out.prompt, /photo|studio lighting|background/i)
})

test('sprite and parts guards keep the subject and drop staging', () => {
  const sprite = sanitizeRewrite(
    'sprite',
    { prompt: 'cinematic close-up of a knight, full body, on a white background, dramatic lighting' },
    'knight',
  )
  assert.match(sprite.prompt, /knight/i)
  assert.doesNotMatch(sprite.prompt, /cinematic|close-up|white background|dramatic lighting/i)

  const parts = sanitizeRewrite(
    'parts',
    { prompt: 'a photo of an isolated sword, on a white background, camera close-up' },
    'sword',
  )
  assert.match(parts.prompt, /sword/i)
  assert.doesNotMatch(parts.prompt, /photo|white background|camera|close-up/i)
})

test('music guard keeps cinematic and texture, but drops image nouns', () => {
  const out = sanitizeRewrite(
    'music',
    { prompt: 'image of a cinematic synthwave track with warm analog texture' },
    'synthwave',
  )
  assert.match(out.prompt, /cinematic/i)
  assert.match(out.prompt, /texture/i)
  assert.doesNotMatch(out.prompt, /image of/i)
})

test('pixel guard removes photo staging but keeps the pixel-art subject', () => {
  const out = sanitizeRewrite(
    'pixel',
    { prompt: 'cinematic photo of a pixel art knight, on a white background, 8k' },
    'pixel art knight',
  )
  assert.match(out.prompt, /pixel art knight/i)
  assert.doesNotMatch(out.prompt, /cinematic|photo|white background|8k/i)
})

test('part guard drops negative background wording cleanly', () => {
  const out = sanitizeRewrite(
    'parts',
    { prompt: 'an isolated sword, no background, soft lighting, camera close-up' },
    'sword',
  )
  assert.match(out.prompt, /isolated sword/i)
  assert.doesNotMatch(out.prompt, /background|soft lighting|camera|close-up|\bno\b/i)
})

test('SFX selection context reinforces a single audible event', () => {
  const context = buildSelectionContext({
    mode: 'sfx',
    sfxSettings: { duration: 4, quality: 'wav' },
  })
  assert.match(context, /Sound effect: ONE isolated sound event/i)
  assert.match(context, /Clip length: 4s/i)
  assert.doesNotMatch(context, /Style preset:/i)
})

test('SFX system prompt explains how to translate a texture into a sound', () => {
  const system = buildRewriteSystem('photorealistic', 'sfx')
  assert.match(system, /seamless packed soil texture/i)
  assert.match(system, /footsteps crunching on packed soil/i)
})
