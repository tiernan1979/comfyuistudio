// Post-processing for AI-written prompts. Local models sometimes ignore the
// per-mode system prompt and hand back an image caption ("cinematic shot of
// seamless packed soil texture") for SFX, or a scene description for a
// texture sheet. This guard repairs the obvious cross-mode contamination
// deterministically, so the generator never receives the wrong kind of text.

const SFX_SOUND_RE =
  /\b(sound|audio|sfx|noise|impact|hit|thud|thump|clack|clank|clink|crack|crackl(?:e|ing)|rumb(?:le|ling)|boom(?:ing)?|bang|whoosh(?:ing)?|swoosh|rustl(?:e|ing)|crunch(?:ing)?|scrap(?:e|ing)|scuff(?:ed|ing)?|footstep|steps?|knock|latch(?:ing)?|slam(?:ming|med)?|shatter(?:ing|ed)?|echo(?:ing)?|reverb|hum(?:ming)?|buzz(?:ing)?|hiss(?:ing)?|sizzl(?:e|ing)|pop|click(?:ing)?|chime|ring(?:ing|s)?|roar(?:ing)?|growl(?:ing)?|scream(?:ing)?|shout(?:ing)?|whisper(?:ing)?|breath|crowd|applause|rain|wind|breeze|leaves|ambien(?:ce|t)|fire|campfire|flame|explosion|blast|thunder|lightning|splash(?:ing)?|drip(?:ping)?|bubble|engine|motor|servo|beep|alarm|coin|pickup|reload|magic|zap|spark|fizz|flutter|tick|creak(?:ing)?|groan(?:ing)?|sigh|laugh(?:ing|ter)?|cry|gasp|gulp|chew|bite|pour(?:ing)?|sip|page|paper|cloth|leather|gravel|sand|snow|grass|dirt|soil|mud|puddle|footsteps)\b/gi

const SFX_VISUAL_RE =
  /\b(cinematic|shot|close[- ]?up|macro|wide[- ]?shot|camera|lens|bokeh|depth of field|composition|framing|perspective|lighting|render|image|photo|photograph|portrait|seamless|texture|background|scene|environment|4k|8k|photorealistic)\b/gi

const SURFACE_RE =
  /(?:packed\s+)?(?:dirt|soil|earth|ground|mud|gravel|sand|snow|grass|leaves|forest floor|wood(?:en)? floor|stone floor|tile floor|concrete floor)/i

const count = (text, re) => (String(text || '').match(re) || []).length

// Normalise whitespace/punctuation left behind after removing a phrase.
function tidy(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,.;:!?])\s*([,.;:!?])/g, '$1')
    .replace(/^[\s,.;:!?-]+|[\s,.;:!?-]+$/g, '')
    .replace(/\b(of|with|and)\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// Remove camera/framing language without touching the actual subject.
function stripFraming(text) {
  let out = String(text || '')
  out = out.replace(
    /^\s*(?:a|an|the)?\s*(?:cinematic|photorealistic|hyperrealistic|detailed|dramatic)?\s*(?:photo|photograph|image|render|shot|close[- ]?up|macro)\s+(?:of|showing)\s+/i,
    '',
  )
  out = out.replace(/\b(cinematic|photorealistic|hyperrealistic|4k|8k)\b/gi, ' ')
  out = out.replace(/\b(camera|lens|bokeh|depth of field|composition|framing|perspective|viewpoint)\b/gi, ' ')
  out = out.replace(/\b(close[- ]?up|macro|wide[- ]?shot|zoom|pan|tilt|dolly|handheld)\b/gi, ' ')
  return tidy(out)
}

// Texture/material/flipbook/sprite/parts: drop cinematic staging, scenes and
// directional lighting, but keep the subject and material words.
function stripFramingScene(text) {
  let out = stripFraming(text)
  out = out.replace(/\b(?:no|without)\s+(?:scene|environment|background|shadows?|highlights?)\b/gi, ' ')
  out = out.replace(/\b(?:the\s+)?(?:scene|environment|setting|backdrop)\b/gi, ' ')
  out = out.replace(/\b(?:on|against)\s+(?:a|an|the)?\s*[a-z -]{0,24}?\bbackground\b/gi, ' ')
  out = out.replace(/\bbackground\b/gi, ' ')
  out = out.replace(/\b(?:dramatic|moody|studio|volumetric|rim|backlit|side-lit)\s+lighting\b/gi, ' ')
  out = out.replace(/\b(?:shadows?|highlights?)\b/gi, ' ')
  return tidy(out)
}

// Sprites/parts are cutouts: remove any leftover lighting phrase as well as
// the scene terms, but keep the subject and material description.
function stripAssetScene(text) {
  return tidy(stripFramingScene(text).replace(/\b(?:[a-z]+\s+){0,2}lighting\b/gi, ' '))
}

// Music/custom: these modes legitimately use "cinematic" and "texture", so
// only strip unmistakable image nouns.
function stripImageNouns(text) {
  return tidy(
    String(text || '')
      .replace(/^\s*(?:a|an|the)?\s*(?:photo|photograph|image|picture|render)\s+(?:of|showing)\s+/i, '')
      .replace(/\b(?:photo|photograph|image|picture|render)\s+of\b/gi, ' '),
  )
}

function surfaceLabel(text) {
  const hit = String(text || '').match(SURFACE_RE)
  return hit ? hit[0].toLowerCase() : ''
}

function sfxSubject(input) {
  return tidy(
    stripFraming(input)
      .replace(/\b(seamless|texture|tileable|tiling|image|photo|render|background)\b/gi, ' ')
      .replace(/^(?:a|an|the)\s+/i, ''),
  )
}

// Translate a visual idea into one concrete, recordable sound. This is the
// safety net for prompts like "packed soil texture", which a small local LLM
// happily turns into an image caption instead of footsteps.
function sfxFallback(input) {
  const subject = sfxSubject(input)
  const lower = `${input || ''} ${subject}`.toLowerCase()
  if (SURFACE_RE.test(lower)) {
    const surface = surfaceLabel(lower) || 'packed soil'
    return `footsteps on ${surface}, granular crunch underfoot, close, light outdoor ambience`
  }
  if (/door|gate|hatch/.test(lower)) return 'heavy door slamming shut, hard impact, concrete room echo'
  if (/glass|window|bottle|vase/.test(lower)) return 'glass shattering on a hard floor, bright shards, close'
  if (/lightning|thunder|storm/.test(lower)) {
    return 'a single close lightning crack followed by a deep rolling thunder rumble, outdoors'
  }
  if (/rain|water|river|ocean|wave|drip|splash/.test(lower)) {
    return 'steady rain on a tin roof, close droplets, soft outdoor ambience'
  }
  if (/fire|campfire|flame|torch/.test(lower)) return 'campfire crackle with soft flame roar, close, outdoor night'
  if (/metal|steel|iron|sword|armor|armour/.test(lower)) {
    return 'heavy metal impact with a short ringing decay, close, concrete room echo'
  }
  if (/wood|timber|plank|log/.test(lower)) return 'dull wooden impact, dry creak and splinter, close'
  if (/stone|rock|brick|concrete|castle/.test(lower)) {
    return 'heavy stone impact and crumbling grit, close, stone room echo'
  }
  if (/coin|gold|gem|crystal|pickup|treasure|item/.test(lower)) {
    return 'bright coin pickup chime with a short metallic ring, close and clean'
  }
  if (/explosion|bomb|blast|grenade/.test(lower)) {
    return 'a short explosion with a deep boom and falling debris, outdoors'
  }
  if (/magic|spell|portal|rune|energy/.test(lower)) {
    return 'a rising magical whoosh with crackling energy and a soft shimmering tail'
  }
  if (/gun|rifle|pistol|weapon/.test(lower)) {
    return 'a single gunshot with a sharp crack and a long outdoor echo'
  }
  if (/click|ui|button|menu|interface/.test(lower)) {
    return 'a short, clean UI click with a soft confirmation tone, close'
  }
  if (subject) return `a close, tactile ${subject} impact with a short natural decay, detailed room tone`
  return 'a short, punchy UI confirmation blip, clean and close'
}

function sfxTitle(input) {
  const text = String(input || '').toLowerCase()
  if (SURFACE_RE.test(text) || /footstep|walk|step/.test(text)) {
    const surface = surfaceLabel(text)
    return surface ? `${surface.replace(/\b\w/g, (c) => c.toUpperCase())} Footsteps` : 'Footsteps'
  }
  if (/door|gate|hatch/.test(text)) return 'Door Slam'
  if (/glass|window|bottle|vase/.test(text)) return 'Glass Shatter'
  if (/lightning|thunder|storm/.test(text)) return 'Thunder Crack'
  if (/rain|water|river|ocean|wave|drip|splash/.test(text)) return 'Water Splash'
  if (/fire|campfire|flame|torch/.test(text)) return 'Fire Crackle'
  if (/metal|steel|iron|sword|armor|armour/.test(text)) return 'Metal Impact'
  if (/wood|timber|plank|log/.test(text)) return 'Wood Impact'
  if (/stone|rock|brick|concrete|castle/.test(text)) return 'Stone Impact'
  if (/coin|gold|gem|crystal|pickup|treasure|item/.test(text)) return 'Coin Pickup'
  if (/explosion|bomb|blast|grenade/.test(text)) return 'Short Explosion'
  if (/magic|spell|portal|rune|energy/.test(text)) return 'Magic Whoosh'
  if (/gun|rifle|pistol|weapon/.test(text)) return 'Gunshot Crack'
  if (/click|ui|button|menu|interface/.test(text)) return 'UI Click'
  return 'Sound Effect'
}

function guardSfx(out, input) {
  const original = String(out.prompt || '').trim()
  const visual = count(original, SFX_VISUAL_RE)
  const sound = count(original, SFX_SOUND_RE)
  let prompt = original
  if (visual > 0) {
    prompt = tidy(
      stripFraming(original)
        .replace(/\b(seamless|texture)\b/gi, ' ')
        .replace(/\b(lighting|colors?|colour|palette)\b/gi, ' '),
    )
  }
  const soundAfter = count(prompt, SFX_SOUND_RE)
  const visualAfter = count(prompt, SFX_VISUAL_RE)
  // Image caption, or a prompt with no audible content at all: translate the
  // user's subject into a concrete sound instead of passing the caption on.
  if (
    !prompt ||
    (visual > 0 && soundAfter < 2) ||
    (visualAfter > 0 && visualAfter >= soundAfter)
  ) {
    prompt = sfxFallback(input || original)
  }
  return {
    ...out,
    prompt: tidy(prompt),
    negative: out.negative?.trim() || 'music, vocals, digital artifacts',
    duration: Number(out.duration) > 0 ? out.duration : 3,
    title: out.title?.trim() || sfxTitle(input || original),
    suggestions: Array.isArray(out.suggestions)
      ? out.suggestions
          .filter((s) => count(s, SFX_VISUAL_RE) === 0 && count(s, SFX_SOUND_RE) > 0)
          .slice(0, 3)
      : [],
  }
}

const CLEANERS = {
  texture: stripFramingScene,
  material: stripFramingScene,
  flipbook: stripFramingScene,
  sprite: stripAssetScene,
  parts: stripAssetScene,
  pixel: stripFramingScene,
  music: stripImageNouns,
  custom: stripImageNouns,
}

// Entry point for PromptInput / PartsPanel. Returns the same shape as
// parseRewrite so callers can apply the guard without branching.
export function sanitizeRewrite(mode, out, input = '') {
  if (!out || typeof out.prompt !== 'string') return out
  if (mode === 'sfx') return guardSfx(out, input)
  const cleaner = CLEANERS[mode]
  if (!cleaner) return out
  const prompt = cleaner(out.prompt)
  return { ...out, prompt: prompt || tidy(input) || out.prompt }
}
