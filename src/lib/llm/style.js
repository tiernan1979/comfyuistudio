// Detect the musical style family from the caption/prompt text so the
// arrangement can follow genre convention. Dance/electronic styles put a
// long breakdown in the MIDDLE of the song (the emotional peak sits between
// the two chorus passes); ballads and rock spread their instrumental weight
// more evenly and lean on a bridge. Returns 'electronic' | 'dance' | 'ballad'
// | 'rock' | 'generic'.
export function detectMusicStyle(text) {
  const t = String(text || '').toLowerCase()
  if (/\b(trance|techno|house|edm|progressive|deep house|hardstyle|drum and bass|dnb|garage|dubstep|electro|synthwave|future bass|melodic (house|techno))\b/.test(t)) {
    return 'dance'
  }
  if (/\b(electronic|electronica|ambient|chillout|lo-?fi| downtempo|synthpop|indietronica)\b/.test(t)) {
    return 'electronic'
  }
  if (/\b(ballad|acoustic|folk|country|singer.?songwriter|lullaby|hymn)\b/.test(t)) return 'ballad'
  if (/\b(rock|metal|punk|grunge|indie rock|alternative|hard rock|blues|jazz)\b/.test(t)) return 'rock'
  return 'generic'
}

// Default vocal share when the user didn't state one, per style family.
// Trance/EDM is instrumental-first — 15% keeps the breakdowns and drops that
// define the genre. Pop/rock are vocal-forward: the voice IS the song, so
// half the track is lyrics. Ballads sit just under that. An explicit
// "25% of the song" from the user always wins over this default.
export function defaultVocalShare(style) {
  switch (style) {
    case 'dance': return 0.15
    case 'electronic': return 0.2
    case 'ballad': return 0.45
    case 'rock': return 0.5
    default: return 0.5 // pop / generic
  }
}

// Artist-style references in a user prompt: "sounds like Avicii", "in the
// style of Tame Impala", "Avicii vibes". Triggers a web research pass in
// music mode so the caption is grounded in the artist's real sound instead
// of the LLM's memory. Returns up to 2 candidate names (empty = none).

// Common genre/instrument nouns that appear before "-style"/"style" in music
// prompts but are NOT artist names. Used as a negative lookahead so the
// lowercase single-word detector doesn't eat "house style" / "bass style".
const STYLE_NOUN_DENYLIST =
  'house|garage|trance|techno|edm|dance|pop|rock|metal|punk|jazz|blues|soul|funk|disco|folk|country|indie|ambient|lofi|lo-fi|chill|downtempo|synthwave|electro|dubstep|drum|bass|dnb|hip|hop|rap|trap|wave|core|step|ballad|acoustic|electronic|alternative|grunge|emo|reggae|ska|latin|afro|orchestral|cinematic|epic|uplifting|dark|deep|progressive|melodic|future|tropical|vocal|instrumental|guitar|piano|synth|beat|drop|break|remix|bootleg|edit|cover'

export function detectArtistRefs(text) {
  const t = String(text || '')
  const found = []
  const addOne = (name) => {
    const clean = String(name || '').trim().replace(/[\s,.;:!?"'-]+$/, '')
    if (!clean || clean.length < 2 || clean.length > 40) return
    // Function-word-only phrases aren't names ("like the song") — but an
    // article first word is fine ("The Weeknd").
    const stop = new Set(['the', 'a', 'an', 'my', 'your', 'some', 'very', 'when', 'like', 'with', 'and', 'but', 'for', 'of', 'to', 'in', 'on', 'it', 'its', 'that', 'this', 'more', 'just', 'really', 'something', 'someone'])
    if (clean.split(/\s+/).every((w) => stop.has(w.toLowerCase()))) return
    const key = clean.toLowerCase()
    if (!found.some((f) => f.toLowerCase() === key)) found.push(clean)
  }
  // "inspired by A and B" captures both as one phrase — split the join.
  const add = (name) => {
    for (const part of String(name || '').split(/\s+and\s+/i)) addOne(part)
  }
  // Name words: Proper Case, allow article/preposition connectors so
  // "Boards of Canada" and "DJ Seinfeld" survive.
  const NAME = String.raw`((?:[A-Z][\w'&.-]*)(?:\s+(?:[A-Z][\w'&.-]*|of|the|and)){0,3})`
  const patterns = [
    // "sounds like X", "in the style of X", "inspired by X", plain "like X".
    // Proper Case required — "sounds like home" would false-positive on any
    // lowercase noun.
    new RegExp(String.raw`\b(?:sounds? like|singing like|in the style of|reminiscent of|resembling|inspired by|similar to|akin to|like)\s+` + NAME, 'g'),
    // "X style", "X-style", "X vibes", "X-esque", "X influence" — Proper Case
    // (handles multi-word names like "Boards of Canada").
    new RegExp(String.raw`\b` + NAME + String.raw`\s*[-\s]+\s*(?:style|vibes?|esque|influence)\b`, 'g'),
    // Lowercase single-word artist names before a style-word ("avicii style
    // track", "flume vibes"). The Proper-Case patterns above miss these, and
    // missing them skipped BOTH the research pass and the name-strip — which
    // is how "Avicii-style trance" shipped in a caption. The trailing
    // style-word is the guard; the denylist keeps genre/instrument nouns
    // ("house style", "bass style", "garage style") from being eaten.
    new RegExp(String.raw`\b(?!` + STYLE_NOUN_DENYLIST + String.raw`)([a-z][a-z0-9&'-]{2,30})\s*[-\s]+\s*(?:style|vibes?|esque|influence)\b`, 'gi'),
  ]
  for (const re of patterns) {
    let m
    while ((m = re.exec(t)) !== null) {
      add(m[1])
      if (found.length >= 3) break
    }
    if (found.length >= 3) break
  }
  return found.slice(0, 2)
}

// Deterministically remove artist names from generated text. The system
// prompt forbids naming the artist in the caption/lyrics, but LLMs leak
// them anyway ("Avicii-style trance", "in the style of Avicii"). This runs
// AFTER generation as a safety net so the rule can't be broken. Removes the
// name plus the trailing style-word it was attached to ("-style", "style",
// "vibes", "esque", "influence", "'s"), then tidies leftover punctuation
// and whitespace. Case-insensitive; whole-word match so "avicii" inside
// another word is untouched.
export function stripArtistRefs(text, artists) {
  let out = String(text || '')
  for (const raw of artists || []) {
    const name = String(raw || '').trim()
    if (!name) continue
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // "Avicii-style", "Avicii style", "Avicii's", "Avicii vibes" … — kill the
    // name AND the attached style-word in one pass so no orphan "style" stays.
    const re = new RegExp(
      String.raw`\b${esc}\b(?:'s)?\s*(?:[-–—]?\s*)?(?:style|vibes?|esque|influence|sound|aesthetic)?`,
      'gi'
    )
    out = out.replace(re, ' ')
  }
  // Collapse the gaps left behind and tidy dangling punctuation.
  return out
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,.;:!?])\s*$/, '$1')
    .replace(/[-–—]\s*$/, '')
    .trim()
}

// Curated signature-sound vocabulary, ordered by how strongly each term
// pins down a specific artist's sound. Generic terms ("synth", "bass",
// "drums") are deliberately ABSENT — every EDM track has those, so they
// can't distinguish Avicii (banjo/acoustic) from Deadmau5 (nocturnal
// minimal) from Skrillex (distorted bass). Only distinctive, genre-signing
// instruments/textures make the list, so injecting them into a caption is
// always a net signal gain.
const SIGNATURE_SOUNDS = [
  // folk / organic fusion (the folk-house sound)
  'banjo', 'acoustic guitar', 'harmonica', 'ukulele', 'mandolin', 'fiddle',
  'accordion', 'bluegrass', 'country', 'folk',
  // analog / vintage texture
  'vinyl crackle', 'tape saturation', 'warm tape', 'analog warmth', 'analog-style',
  'rotary speaker', ' Hammond', ' mellotron', ' wurlitzer', ' rhodes', ' wurst',
  // live / acoustic ensemble
  'live drums', 'upright bass', 'string section', 'brass section', 'choir',
  'handclaps', 'tambourine', 'marimba', ' glockenspiel', ' vibraphone',
  // production signature
  'sidechain', 'gated reverb', 'room reverb', 'vocal chops', 'pitched vocals',
]

// Deterministically inject the artist's signature instruments into the
// caption. The LLM is supposed to ground the caption in the STYLE RESEARCH
// block, but weak/local models keep overriding it with their own prior
// ("Avicii = generic EDM") — three attempts in a row produced captions with
// zero folk/acoustic elements even though the research literally said
// "banjo and acoustic guitar as primary melodic instruments". This scans
// the research for distinctive sounds and appends any that the caption
// missed, so the music model always sees them. Returns the caption
// unchanged when there's no research or the caption already covers them.
export function injectSignatureSounds(caption, research) {
  const cap = String(caption || '')
  const res = String(research || '').toLowerCase()
  if (!cap || !res) return cap
  const capLower = cap.toLowerCase()
  const found = []
  for (const term of SIGNATURE_SOUNDS) {
    const t = term.trim().toLowerCase()
    if (!t) continue
    if (res.includes(t) && !capLower.includes(t)) {
      found.push(term.trim())
      if (found.length >= 4) break
    }
  }
  if (found.length === 0) return cap
  const clause = ` Signature elements: ${found.join(', ')}.`
  // Insert into Global Metadata (before the Arrangement section) so the
  // music model reads them as part of the production profile, not appended
  // prose. Fall back to appending at the end if there's no Arrangement.
  if (/\bArrangement\s*:/i.test(cap)) {
    return cap.replace(/\s*Arrangement\s*:/i, `${clause} Arrangement:`)
  }
  return `${cap}${clause}`
}

// Is this a style that wants its instrumental weight in the MIDDLE (a long
// breakdown between the two chorus passes) rather than bunched at the end?
export function wantsMiddleBreakdown(style) {
  return style === 'dance' || style === 'electronic'
}

// Instrumental tag sequences per style for the MIDDLE breakdown. Each entry
// is an ordered list of tags the planner reads as one long, developing
// middle section (not a stack of identical short breaks). Dance uses the
// canonical trance shape: breakdown → build → (drop lands on the next vocal).
export const MIDDLE_BREAKDOWN_TAGS = {
  dance: [
    ['Breakdown', 'Instrumental - atmospheric', 'Build'],
    ['Breakdown', 'Instrumental - extended', 'Build'],
    ['Instrumental - breakdown', 'Build'],
  ],
  electronic: [
    ['Breakdown', 'Build'],
    ['Instrumental - breakdown', 'Instrumental - building'],
  ],
  generic: [
    ['Instrumental - extended', 'Instrumental - building'],
    ['Guitar Solo - expressive', 'Instrumental - building'],
  ],
  ballad: [
    ['Bridge - instrumental', 'Instrumental - extended'],
    ['Piano Interlude', 'Instrumental - extended'],
  ],
  rock: [
    ['Guitar Solo - expressive', 'Instrumental - driving'],
    ['Instrumental - extended', 'Drum Break'],
  ],
}

// Instrumental tags for the small LEAD-IN/out gaps (before the first chorus
// pass, after the last). Kept short and generic — these are transitions, not
// the centrepiece. Style-aware: a trance track stamped with [Guitar Solo]
// and [Piano Interlude] drifts out of genre, so dance/electronic get
// build/drop/energy tags, ballads get piano, rock gets guitar.
const LEAD_GAP_TAGS_BY_STYLE = {
  dance: [
    'Drop',
    'Instrumental - driving',
    'Instrumental - extended',
    'Drum Break',
    'Build',
    'Instrumental - atmospheric',
    'Instrumental - building',
  ],
  electronic: [
    'Instrumental - driving',
    'Build',
    'Instrumental - extended',
    'Drop',
    'Drum Break',
    'Instrumental - atmospheric',
  ],
  ballad: [
    'Piano Interlude',
    'Instrumental - extended',
    'Bridge - instrumental',
    'Instrumental - atmospheric',
  ],
  rock: [
    'Guitar Solo - expressive',
    'Instrumental - driving',
    'Drum Break',
    'Instrumental - extended',
    'Bridge - instrumental',
  ],
  generic: [
    'Instrumental - extended',
    'Guitar Solo - expressive',
    'Instrumental - building',
    'Piano Interlude',
    'Instrumental - driving',
    'Drum Break',
  ],
}
export function leadGapTags(style) {
  return LEAD_GAP_TAGS_BY_STYLE[style] || LEAD_GAP_TAGS_BY_STYLE.generic
}
