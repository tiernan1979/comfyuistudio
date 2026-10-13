// Multi-provider AI prompt writer.
// Providers: LM Studio (local), OpenAI, Anthropic (Claude), or any
// OpenAI-compatible endpoint (OpenRouter, Groq, Ollama, vLLM, ...).
// Every request goes through the app's nginx proxy (same-origin), so
// browser CORS never blocks us and provider CORS rules don't apply.

export const PROVIDERS = {
  lmstudio: { label: 'LM Studio (local)', short: 'LM Studio', keyRequired: false, modelsBtn: true },
  openai: { label: 'OpenAI (ChatGPT)', short: 'ChatGPT', keyRequired: true, modelsBtn: false },
  anthropic: { label: 'Anthropic (Claude)', short: 'Claude', keyRequired: true, modelsBtn: false },
  custom: { label: 'OpenAI-compatible (OpenRouter, Groq, Ollama...)', short: 'custom LLM', keyRequired: false, modelsBtn: true },
}

export const MODEL_SUGGESTIONS = {
  openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'],
  anthropic: ['claude-haiku-4-5', 'claude-sonnet-4-5', 'claude-opus-4-1'],
}

// OpenAI-compatible servers expose their API under /v1. If the user gave
// a bare origin (e.g. http://host:1234 or http://host:11434), add it;
// if they gave a base with a path (e.g. https://openrouter.ai/api/v1), keep it.
function openaiCompatBase(url) {
  const base = (url || '').trim().replace(/\/+$/, '')
  if (!base) return base
  try {
    const u = new URL(base)
    const p = (u.pathname || '').replace(/\/+$/, '')
    if (!p || p === '/') {
      u.pathname = '/v1'
      return u.toString().replace(/\/$/, '')
    }
  } catch { /* not parseable — use as given */ }
  return base
}

// Wrap an absolute URL into the app's dynamic proxy path:
//   https://api.openai.com/v1/... → /proxy/https/api.openai.com/443/v1/...
//   http://host:1234/v1/...       → /proxy/host/1234/v1/...
function proxyWrap(absoluteUrl) {
  const u = new URL(absoluteUrl)
  const https = u.protocol === 'https:'
  const port = u.port || (https ? '443' : '80')
  return `/proxy/${https ? 'https/' : ''}${u.hostname}/${port}${u.pathname || '/'}${u.search || ''}`
}

// Fallbacks so resolveLlmConfig works even with partial persisted state
const DEFAULT_CONFIGS = {
  lmstudio: { url: 'http://host.docker.internal:1234', model: '' },
  openai: { key: '', model: 'gpt-4o-mini' },
  anthropic: { key: '', model: 'claude-haiku-4-5' },
  custom: { url: '', key: '', model: '' },
}

// Turn persisted store state into the request config for the active provider.
export function resolveLlmConfig(state) {
  const provider = state.llmProvider || 'lmstudio'
  const c = { ...DEFAULT_CONFIGS[provider], ...(state.llmConfigs?.[provider] || {}) }
  const label = PROVIDERS[provider]?.short || 'AI'

  if (provider === 'openai') {
    return { provider, label, style: 'openai', url: 'https://api.openai.com/v1', key: (c.key || '').trim(), model: (c.model || '').trim() }
  }
  if (provider === 'anthropic') {
    return { provider, label, style: 'anthropic', url: 'https://api.anthropic.com/v1', key: (c.key || '').trim(), model: (c.model || '').trim() }
  }
  const url = openaiCompatBase(
    provider === 'lmstudio' ? (c.url || 'http://host.docker.internal:1234') : (c.url || '')
  )
  return { provider, label, style: 'openai', url, key: (c.key || '').trim(), model: (c.model || '').trim() }
}

// List models from an OpenAI-compatible endpoint (LM Studio, custom).
export async function fetchLlmModels(rawUrl) {
  const base = openaiCompatBase(rawUrl)
  if (!base) throw new Error('Enter the endpoint URL first.')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  let res
  try {
    res = await fetch(proxyWrap(`${base}/models`), { signal: controller.signal })
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`No response from ${base} (15s)`)
    throw new Error(`Could not reach ${base} (${err.message})`)
  } finally {
    clearTimeout(timeout)
  }
  if (!res.ok) throw new Error(`${base} returned HTTP ${res.status}`)
  const data = await res.json()
  return (data.data || []).map((m) => m.id).filter(Boolean)
}

// LM Studio's own idea of what's resident in VRAM, plus per-model activity.
// GET /v1/models/loaded → { models: [{ id, state, ... }], ... }. `state` is
// "loaded" / "active" / "pending" when the model is resident (or warming up).
// Some builds don't expose this endpoint at all — those return null and the
// caller falls back to the plain /v1/models list.
export async function fetchLlmLoaded(rawUrl) {
  const base = openaiCompatBase(rawUrl)
  if (!base) return null
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6000)
  try {
    const res = await fetch(proxyWrap(`${base}/v1/models/loaded`), { signal: controller.signal })
    if (!res.ok) return null
    const data = await res.json()
    if (!Array.isArray(data?.models)) return null
    return data.models.map((m) => ({
      id: String(m.id || m.model || ''),
      state: String(m.state || 'loaded'),
    })).filter((m) => m.id)
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

// Should generation hold off for a big LLM sharing the card?
//   'free'    — no other model resident (or the endpoint is unavailable) → go
//   'unload'  — another model is resident AND ComfyUI is idle → free ComfyUI
//   'busy'    — another model is resident AND ComfyUI has work queued → block
// `own` is the prompt-writer model the user picked in Settings; it never
// counts as "another model" (it's the one the AI button needs resident).
// A model stem "belongs to" `own` when it is the own stem itself, or the own
// stem followed by a separator ('-', '_', '.'). Plain substring would wrongly
// match 'qwen3-4b-instruct-2507-diff' as the own 'qwen3-4b-instruct-2507'.
function sameModel(stem, ownStem) {
  if (!ownStem) return false
  if (stem === ownStem) return true
  return stem.startsWith(ownStem) && /^[-_.]/.test(stem.slice(ownStem.length))
}

export function classifyLlmModels(models, own) {
  const norm = (s) => String(s || '').replace(/\.(gguf|safetensors|bin)$/i, '').toLowerCase()
  const ownStem = norm(own)
  const others = (models || []).filter((m) => !sameModel(norm(m.id), ownStem))
  return others.length > 0 ? { kind: 'unload', others } : { kind: 'free', others: [] }
}

// Per-mode system prompts. The old shared prompt assumed images ("subject,
// environment, lighting…") — in music/video mode it wrote picture prompts.
export function buildRewriteSystem(styleLabel, mode) {
  if (mode === 'music') {
    return (
      'You are an expert song-writer for AI text-to-music models (MiniMax Music 3 / ACE-Step in ComfyUI).\n' +
      'Turn the user\'s idea into a complete song package. Reply ONLY with a JSON object, no markdown:\n' +
      '{"prompt":"...","lyrics":"...","duration":0,"search_query":"","title":""}\n' +
      '\n' +
      'prompt — ONE caption, 50–120 words, plain text, two sections:\n' +
      'Global Metadata: genre, BPM, key/mode, mood, listening scenario, production profile (specific\n' +
      'instruments, groove, texture — vague adjectives make short songs). Do NOT put BPM/key in the\n' +
      'Arrangement — they belong in Global Metadata only.\n' +
      'When a STYLE RESEARCH block is included after the user\'s request, GROUND the Global Metadata\n' +
      'and Arrangement in its concrete details — real BPM range, era, signature instruments, production\n' +
      'techniques, vocal character, song structure — so the result actually sounds like that artist.\n' +
      'This is MANDATORY, not optional: you MUST name the artist\'s signature instruments and production\n' +
      'tricks from the research in the Global Metadata (e.g. a folk-house artist needs the banjo/acoustic\n' +
      'guitar/folk melody named, a lo-fi artist needs the vinyl crackle/warm tape named). Writing a\n' +
      'generic genre description ("electronic dance music, layered synths, festival atmosphere") when\n' +
      'the research lists specific signature sounds is a critical failure — the song will not sound\n' +
      'like the artist. Pull the BPM/key from the research too; do not invent a round number.\n' +
      'Summarize the sound in your own words; never quote the research verbatim and never put the\n' +
      'artist\'s name in the caption or the lyrics.\n' +
      'Arrangement: a section-by-section map of the WHOLE song with time spans. Account for every\n' +
      'minute. EVERY section needs a time span, including instrumentals — "1:30–2:00 extended guitar\n' +
      'solo" tells the model how long; a bare tag lets it compress to a few seconds. Match the style:\n' +
      'ballads get intro→verse→chorus→verse→chorus→bridge→chorus→outro; electronic gets intro→build→\n' +
      'drop→breakdown→build→drop→outro; rock gets verses with guitar solos between. There is no negative\n' +
      'prompt — fold exclusions into a short positive ban ("no vocals, no choir"). Artist/style refs\n' +
      '("Avicii style") shape genre/BPM/arrangement/production but NEVER appear in lyrics.\n' +
      '\n' +
      'lyrics — section tags, each on its own line in square brackets, a blank line after every tag:\n' +
      '[Intro] [Verse] [Pre-Chorus] [Chorus] [Post-Chorus] [Bridge] [Outro]\n' +
      '[Instrumental] [Guitar Solo] [Piano Interlude] [Drum Break] [Build] [Drop] [Breakdown]\n' +
      'EVERY song must start with [Intro] and end with [Outro] — no exceptions.\n' +
      'Tags can carry ONE modifier after a dash: [Chorus - anthemic], [Bridge - whispered],\n' +
      '[Guitar Solo - expressive], [Instrumental - extended]. Never stack more than one modifier.\n' +
      'Use descriptive instrumental tags instead of bare [Instrumental] when you can — [Guitar Solo],\n' +
      '[Piano Interlude], [Drum Break] give the model more to work with and the sections last longer.\n' +
      'Do NOT invent new tag names like [Drop + Chorus 3] or [Final Chorus 4] — use the standard\n' +
      'tags above with at most one dash modifier. Numbers in tags confuse the structure planner.\n' +
      '\n' +
      'Vocal share rule: size the vocal sections to what the user asked. "25% of a 4-minute song" =\n' +
      '60 seconds of vocals. Each sung line takes ~3–4 seconds. So 60s of vocals ≈ 15–20 lines TOTAL\n' +
      'across ALL vocal sections. Split that as: 2 verses × 4 lines + 1 chorus × 4 lines = 12 lines\n' +
      '(~48s), or 2 verses × 3 lines + 2 choruses × 3 lines = 12 lines. NEVER exceed the line budget.\n' +
      'Write 2–3 DISTINCT verses with different words — never repeat the same verse. The chorus\n' +
      'repeats identically each time (it\'s the hook) but MUST have DIFFERENT words from the verse —\n' +
      'the verse tells the story, the chorus is its own hook; copying verse text into the chorus is\n' +
      'a critical error. Keep verses and choruses to 3–5 lines each.\n' +
      'The rest is instrumental — stack descriptive instrumental tags with time spans in\n' +
      'the arrangement. The tag map MUST mirror the Arrangement section for section, in the same\n' +
      'order: every time span in the Arrangement (including bridge, breakdown, build, drop, interlude,\n' +
      'guitar solo) gets its OWN tag line in the lyrics, in the same sequence. A bridge described in\n' +
      'the Arrangement but missing from the tag map is a critical error — the structure planner reads\n' +
      'ONLY the tag map, so an untagged section silently disappears from the song.\n' +
      'If the user says instrumental / no vocals: ONLY the tag map, no words, still enough sections\n' +
      'to cover the whole duration. If the user says nothing about vocals: return "" for lyrics.\n' +
      'If the user mentions vocals / singing / lyrics but doesn\'t state a share: default by genre —\n' +
      '~50% for pop/rock (3–4 verse→chorus passes, 3–5 lines per section), ~45% for ballads,\n' +
      'but only ~15% for trance/EDM where instrumentals carry the song (2 passes, 2–3 lines each).\n' +
      'Rest is instrumental.\n' +
      '\n' +
      'Lyric writing rules:\n' +
      '— 6–10 syllables per line (the model aligns syllables to beats; uneven lines sound strange).\n' +
      '— NEVER split or hyphenate words to hit a syllable count ("to gether", "wea- ther") — keep\n' +
      'every word whole; change the line instead.\n' +
      '— Keep similar syllable counts for lines in the same position across verses.\n' +
      '— UPPERCASE lines in the chorus for high-intensity delivery.\n' +
      '— Parentheses = backup vocals: append a short echo to the line, e.g.\n' +
      '"WE RISE TOGETHER (rise up), LIGHT IN THE DARK (never fall)". Put them on lines in\n' +
      'EVERY chorus and on at least one verse line — they cue layered/backup vocals.\n' +
      '— One core metaphor per song — explore its facets, don\'t jump between unrelated images.\n' +
      '— Avoid adjective stacking ("neon skies, electric hearts, endless dreams") — vague filler.\n' +
      '— Tags are labels only — never "Verse 1:", no titles, no commentary. Rhyme where natural.\n' +
      '\n' +
      'duration — total seconds as an integer, ONLY when the user states a length ("4 minutes" → 240,\n' +
      '"3:30" → 210); otherwise 0 (keep the current setting). Clamp to 10–2000.\n' +
      '\n' +
      'title — a short, memorable song title (2–5 words), in Title Case, that captures the mood/theme.\n' +
      'Not the prompt, not a description — a real song name. If the user gave a title, use it as-is.\n' +
      '\n' +
      'EXAMPLE — user asks: "4 min pop ballad about a rainy train station, female vocal, 25% lyrics"\n' +
      '{"prompt":"Global Metadata: emotional pop ballad, 78 BPM, A minor, intimate and melancholic, solo female breathy vocal, acoustic piano, soft strings, gentle brushed drums, warm reverb, building to a powerful final chorus. Arrangement: 0:00–0:25 solo piano intro with rain ambience; 0:25–0:55 verse 1 — breathy vocal over sparse piano; 0:55–1:25 chorus 1 — strings enter, drums soft; 1:25–1:50 piano interlude; 1:50–2:20 verse 2 — fuller arrangement with bass; 2:20–2:50 chorus 2 — more intense, layered harmonies; 2:50–3:10 bridge — stripped back, whispered vocal; 3:10–3:45 final chorus — full arrangement, powerful belting; 3:45–4:00 outro — piano and strings fade.","lyrics":"[Intro - piano]\\n\\n[Verse]\\nRain on the platform window pane\\nWatching the city fade in the grey\\n\\n[Chorus - anthemic]\\nIM WAITING FOR A TRAIN THAT NEVER COMES\\nHOLDING ON TO WHAT WE USED TO BE\\n\\n[Interlude - piano]\\n\\n[Verse]\\nTicket in my hand, cold as the rain\\nEvery departure feels the same\\n\\n[Chorus - anthemic]\\nIM WAITING FOR A TRAIN THAT NEVER COMES\\nHOLDING ON TO WHAT WE USED TO BE\\n\\n[Bridge - whispered]\\nIf you had stayed, maybe I would too\\n\\n[Chorus - powerful]\\nIM WAITING FOR A TRAIN THAT NEVER COMES\\nHOLDING ON TO WHAT WE USED TO BE\\n\\n[Outro - fade out]","duration":240,"search_query":"","title":"Platform Nine"}\n' +
      'Note: TWO distinct verses with different words, chorus repeats identically (UPPERCASE for\n' +
      'intensity), descriptive instrumental tags ([Interlude - piano]), time spans for EVERY section\n' +
      'including the interlude, tag modifiers for delivery, one metaphor (rain/waiting), title is a\n' +
      'real song name.'
    )
  }
  if (mode === 'edit') {
    return (
      'You are an expert prompt writer for AI image editing (instruction-based edit models in ComfyUI).\n' +
      "Rewrite the user's change request into ONE concise edit instruction (15 to 45 words):\n" +
      'what to change, how to change it, and what must stay untouched.\n' +
      `- Match this style: ${styleLabel}.\n` +
      '- Also pick a web image search query: 3-8 lowercase keywords for a reference photo of the subject (subject words only, no style words, no punctuation).\n' +
      'Reply with ONLY a JSON object, no markdown, no explanations:\n' +
      '{"prompt": "<the edit instruction>", "search_query": "<3-8 keywords>"}'
    )
  }
  const video = mode === 'video'
  return (
    (video
      ? 'You are an expert prompt writer for AI VIDEO generation (ComfyUI, Wan). '
      : 'You are an expert prompt writer for AI image generation (ComfyUI, Qwen-Image). ') +
    `Rewrite the user's simple idea into ONE rich, detailed paragraph prompt.\n` +
    'Rules:\n' +
    `- The prompt must be 40 to 90 words covering subject, environment, lighting, colors, composition${
      video ? ', and explicit visible motion with camera movement over time' : ''
    }.\n` +
    `- Match this style: ${styleLabel}.\n` +
    '- Also pick a web image search query: 3-8 lowercase keywords that would find good reference photos of the subject (subject words only, no style words, no punctuation).\n' +
    '- Also pick a short title (2–5 words, Title Case) that captures the scene — like a clip name, not a description.\n' +
    'Reply with ONLY a JSON object, no markdown, no explanations:\n' +
    '{"prompt": "<the full prompt>", "search_query": "<3-8 keywords>", "title": "<short title>"}'
  )
}

// Parse the model's reply into { prompt, searchQuery, lyrics?, duration? }.
// Tolerates markdown fences, surrounding prose, and malformed JSON —
// falls back to treating the whole reply as the prompt.
export function parseRewrite(content) {
  let t = (content || '').trim()
  if (!t) throw new Error('The AI returned an empty rewrite.')

  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')

  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start !== -1) {
    // A truncated reply (max_tokens cut off) has no closing brace — still
    // try to extract the fields from whatever arrived.
    const segment = end > start ? t.slice(start, end + 1) : t.slice(start)
    try {
      const obj = JSON.parse(segment)
      if (obj && typeof obj.prompt === 'string' && obj.prompt.trim()) {
        return {
          prompt: obj.prompt.trim(),
          searchQuery: String(obj.search_query || obj.searchQuery || '').trim(),
          lyrics: typeof obj.lyrics === 'string' ? obj.lyrics.trim() : '',
          duration: parseDuration(obj.duration),
          title: typeof obj.title === 'string' ? obj.title.trim().slice(0, 80) : '',
        }
      }
    } catch { /* fall through to regex extraction */ }

    // Malformed JSON but the fields may still be extractable
    const pm = segment.match(/"prompt"\s*:\s*"((?:[^"\\]|\\.)*)"/)
    if (pm) {
      const sm = segment.match(/"search_query"\s*:\s*"((?:[^"\\]|\\.)*)"/)
      const lm = segment.match(/"lyrics"\s*:\s*"((?:[^"\\]|\\.)*)"/)
      const dm = segment.match(/"duration"\s*:\s*"?(\d{1,3})"?/)
      const tm = segment.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/) || segment.match(/"title"\s*:\s*"([^"]*)$/)
      return {
        prompt: unescapeJsonStr(pm[1]),
        searchQuery: sm ? unescapeJsonStr(sm[1]) : '',
        lyrics: lm ? unescapeJsonStr(lm[1]).trim() : '',
        duration: parseDuration(dm ? dm[1] : 0),
        title: tm ? unescapeJsonStr(tm[1]).trim().slice(0, 80) : '',
      }
    }
  }

  // Not JSON at all: use the text as the prompt (strip only a fully
  // quote-wrapped reply, not a stray trailing quote inside prose)
  let fallback = t
  if (/^["'][\s\S]*["']$/.test(fallback)) fallback = fallback.slice(1, -1)
  fallback = fallback.trim()
  if (fallback) return { prompt: fallback, searchQuery: '', lyrics: '', duration: 0 }
  throw new Error('Could not understand the AI rewrite output.')
}

// Song length in seconds. Music mode's "Max length" knob runs 10–2000
// (MiniMax planner caps at 360 internally; ACE can go longer).
// 0 (or junk) means "keep the current setting".
function parseDuration(v) {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(2000, Math.max(10, n))
}

// Decode a JSON string body without JSON.parse — the malformed-JSON
// fallback path can capture raw newlines JSON.parse would reject.
function unescapeJsonStr(s) {
  return String(s || '')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
}

// Parse a tagged lyric map into sections: { tag, words, raw }.
function parseLyricSections(lyrics) {
  return String(lyrics || '')
    // The AI often writes section tags INLINE — "[Intro] [Verse]We ride..."
    // — separated by spaces on one line, or by a single newline. Splitting
    // only on blank lines (\n\s*\n) treats the whole run as ONE section,
    // leaving every inline tag embedded in `words`. The rebuild then
    // synthesizes a Chorus from those polluted words and the inline
    // "[Verse]" tag rides along, shipping "[Chorus]\n[Verse]\n..." artifacts.
    // Force every "[Tag]" onto its own line (space-separated case), then
    // ensure a blank line precedes each tag (newline-separated case), THEN
    // split on blank lines. Tags must start with a letter so bracketed
    // annotations like "[2x]" aren't treated as section boundaries.
    .replace(/(\S)[ \t]+(?=\[[A-Za-z][^\]]*\])/g, '$1\n')
    .replace(/\n(?=\[[A-Za-z][^\]]*\])/g, '\n\n')
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((raw) => {
      const m = raw.match(/^\[([^\]]+)\]\s*([\s\S]*)$/)
      if (!m) return { tag: '', words: raw, raw }
      return { tag: m[1].trim(), words: m[2].trim(), raw }
    })
}

// Extract a vocal-share fraction (0–1) from the user's request text.
// "25% of the song for lyrics" → 0.25. Returns null when unstated.
export function parseVocalShare(text) {
  const m = String(text || '').match(/(\d{1,3})\s*%/)
  if (!m) return null
  const pct = Number(m[1])
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return null
  return pct / 100
}

// The MiniMax/ACE AR structure planner sizes the song from the NUMBER of
// [Tag] sections in the lyric map, capped by max_duration. It ignores prose
// time spans ("0:00–0:40 intro") in the caption entirely. Live probe in
// workflows.js: tiny lyric → 24s, a STRUCTURE_TAGS map (9 sections) → 151s,
// both under one 360s cap.
//
// Measured: 16 sections → 2:47 (167s) = ~10.4s per section, not 15s — the
// planner compresses sections stacked late in the map. Budget ~8s each so
// a 300s target gets 38 sections (not 30), giving the planner enough
// sections to actually reach the duration. Rely on max_duration headroom
// (see buildMusicWorkflow) for the rest.
export const PLANNER_SECONDS_PER_SECTION = 8
export function plannerSectionTarget(duration) {
  const dur = Number(duration) || 0
  if (dur <= 0) return 3
  return Math.max(3, Math.ceil(dur / PLANNER_SECONDS_PER_SECTION))
}

// A SPARSE map (a handful of tags, lots of air) runs ~8s per section, but a
// DENSE one — several vocal passes plus ~30 instrumental breaks — measures
// ~10.4s per section live (16 sections → 167s). Budgeting a dense map at 8s
// is what let a 300s request ship 38 sections (304s "fits") and render
// 344s+, overrunning the lyrics. Use the measured density for the hard
// ceiling so the tag count can't promise more seconds than were asked for.
export const DENSE_SECONDS_PER_SECTION = 10.4
export function sectionCeiling(duration) {
  const dur = Number(duration) || 0
  if (dur <= 0) return 3
  // floor, not round — a rounded-up ceiling can promise a few seconds past
  // the request (29 sections × 10.4s = 302s for a 300s ask).
  return Math.max(4, Math.floor(dur / DENSE_SECONDS_PER_SECTION))
}

// Cap headroom: the planner ends the song when the music is done, so a
// max_duration set exactly at the request makes the cap the limiter
// (a 240s ask came back 167s). Ask for 30% more than the target so the
// planner's own length decision — driven by the section count — is the
// thing that ends the song.
export function plannerCapDuration(duration) {
  const dur = Number(duration) > 0 ? Math.round(Number(duration)) : 300
  return Math.min(360, Math.max(10, Math.ceil(dur * 1.3)))
}

// Structural tags that form the repeating "hook" of a song. Each occurrence
// with its own words is one pass through the form, so a 25% map that has
// only one Verse and one Chorus is under-formed no matter how many
// instrumental sections pad around it.
const CORE_VOCAL = ['verse', 'chorus']

// A form-completing CHORUS tag. "Pre-Chorus" and "Post-Chorus" contain the
// substring "chorus" but are NOT choruses — matching them made a Verse +
// Pre-Chorus map look like a balanced V-C form, so no real [Chorus] was
// synthesized and the song shipped without a hook. The AI also writes
// [Chorus - euphoric], [Final Chorus], [Drop + Chorus] — those all count.
function isChorusTag(tag) {
  return /chorus/i.test(tag) && !/pre[- ]?chorus/i.test(tag) && !/post[- ]?chorus/i.test(tag)
}

// How many times the vocal form should repeat for a given length. A real
// song runs verse→chorus 2–3 times; a short one gets a single pass. This
// is a floor on form repeats, independent of the vocal-share percentage —
// sharing 25% of the song to lyrics must not collapse it to one pass. Capped
// at 3 (the cap matters: cycles feed the instrumental-fill pass, so an
// over-large floor would starve the instrumental sections that carry the
// remaining 75%).
export function vocalFormCycles(duration, share) {
  const dur = Number(duration) > 0 ? Number(duration) : 0
  // Rough seconds of one vocal form pass (verse+chorus) in a sparse map.
  const secondsPerCycle = 40
  const byLength = Math.round(dur / secondsPerCycle)
  // Cap at 3 only for long songs. A 300s request hitting the 3-cycle floor
  // rebuilt a 4th duplicate pass (verses 1↔3 and 2↔4 identical), which is
  // what pushed the map past the duration. Two passes is a complete form
  // (verse→chorus→verse→chorus); the third is reserved for >5 min.
  const cap = dur > 300 ? 3 : 2
  return Math.min(cap, Math.max(2, byLength))
}

// Vocal form budget in PASSES for a duration + share. The structural floor
// (vocalFormCycles) and the share target (sung seconds ÷ seconds per pass)
// compete: trance at 15%/300s wants 1 pass by share but the floor forces 2;
// pop at 35%/300s wants 3 and the floor must not cut it back to 2. Both
// trimVocalSections (build the form) and trimSectionBudget (protect the
// built form from dedup) use this so they always agree.
//
// `style` lifts the dance floor to 3 passes on long songs: with only 2
// passes, the second vocal lands at the very end of a trance track (the
// long middle breakdown eats the song), where the planner has no time left
// to play it. Three passes spread the vocals across the track so each one
// has airtime.
export function vocalPassBudget(duration, share, style) {
  const dur = Number(duration) > 0 ? Number(duration) : 300
  const s = Number(share) > 0 && Number(share) < 1 ? Number(share) : 0.2
  const byShare = Math.round((dur * s) / 40)
  // Only lifts LOW-share maps: an explicit "25% vocals" request gets its
  // requested passes (2 longer ones) — the floor exists to stop the
  // 15%-default trance map from collapsing to a form whose second pass has
  // no airtime, not to override an explicit share.
  const danceFloor = style === 'dance' && dur >= 240 && s <= 0.2 ? 3 : 0
  return Math.max(vocalFormCycles(dur, s), byShare, danceFloor)
}

// Rough seconds for one sung line. A line is 6–10 syllables; the model
// aligns syllables to beats, so a line lands around 3–4s. Use 3.5 as the
// working estimate when budgeting lyrics against a duration.
export const SECONDS_PER_SUNG_LINE = 3.5

// Count the sung lines in a parsed section (blank-line separated lines
// within the words block). Instrumental sections have no words → 0.
function countSungLines(section) {
  const words = String(section?.words || '').trim()
  if (!words) return 0
  return words.split(/\n/).map((l) => l.trim()).filter(Boolean).length
}

// Trim a parsed section to at most `maxLines` sung lines, keeping the head.
function trimSectionLines(section, maxLines) {
  if (maxLines <= 0) return null
  const lines = String(section.words || '')
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length <= maxLines) return section
  const kept = lines.slice(0, maxLines).join('\n')
  const tag = section.tag ? `[${section.tag}]\n` : ''
  return { tag: section.tag, words: kept, raw: `${tag}${kept}` }
}

// Trim or EXPAND the vocal map to the requested share of the song, while
// never dropping below two passes of the vocal form (verse→chorus at
// least twice, three times on longer songs). Weak models write a single
// Verse+Chorus for a 25% request, which reads as a fragment, not a song —
// so this both cuts lyric-heavy maps and repeats sparse ones.
export function trimVocalSections(lyrics, duration, share, style = 'generic') {
  if (!lyrics || !duration || !share || share <= 0 || share >= 1) return lyrics
  const sections = parseLyricSections(lyrics)
  if (sections.length === 0) return lyrics

  const isVocal = (s) => s.tag !== '' && s.words !== ''
  const vocal = sections.map((s, i) => ({ s, i })).filter(({ s }) => isVocal(s))
  if (vocal.length === 0) return lyrics

  // Budget in FORM PASSES (a verse→chorus pair), then convert to section
  // slots. Two independent floors: the share-based target (how many seconds
  // of singing the user asked for, ÷ the seconds one pass takes) and the
  // structural minimum (so a sparse map still expands to a real form). The
  // share term used to be computed in raw SLOTS and compared against the
  // pass floor directly, which let a 20%/300s request inflate to 8 slots
  // (4 passes) instead of the intended 2 — verses cycled four deep and the
  // choruses got crowded together.
  const dur = Number(duration) > 0 ? Number(duration) : 300
  const vocalSecondsTarget = dur * share
  // Pass budget shared with trimSectionBudget's dedup floor: structural
  // minimum (sparse maps still expand to a real form) vs the share target
  // (pop at 35% gets 3 passes even though the floor is only 2).
  const passes = vocalPassBudget(dur, share, style)
  const budget = passes * CORE_VOCAL.length
  // Lines per vocal section from the SINGING budget: each section's share
  // of the target sung seconds ÷ seconds per line, capped at 5 (verses and
  // choruses are 3–5 lines in real songs; the old planner-slot derivation
  // floor(8/3.5) = 2 lines made every song a lyric fragment — and a cap of
  // 4 undershot a 50% pop request by a third).
  const capacityPerSection = (vocalSecondsTarget / budget) / SECONDS_PER_SUNG_LINE
  const linesPerSection = Math.max(2, Math.min(5, Math.floor(capacityPerSection)))

  // Normalize the base to a clean form pass (verse→chorus). The model's own
  // extras are dropped rather than ranked-and-kept: keeping a stray
  // Pre-Chorus or a 6th verse is what made maps read as broken form. When a
  // tag is missing (verse-only, or pre/post-heavy with no verse/chorus) the
  // missing one is synthesized from the model's own words — the planner
  // needs both halves of the pass to size the song correctly.
  const wordsOf = (s) => ({ tag: s.tag, words: s.words, raw: s.raw })
  const synthesize = (tag, from) => {
    const src = from || vocal[0]?.s
    if (!src) return null
    const words = src.words
    return { tag, words, raw: `[${tag}]\n${words}` }
  }
  // Collect ALL distinct verses and choruses the model wrote — verses get
  // cycled (verse 1, verse 2, verse 3 each with different words), the
  // chorus repeats identically (it's the hook). Match any tag containing
  // "verse"/"chorus" — the AI writes [Verse 1], [Chorus - euphoric],
  // [Final Chorus] etc., not just bare tags. Choruses use isChorusTag so a
  // lone [Pre-Chorus] does NOT pass as the hook — that match leaked here
  // before and kept a Verse+Pre-Chorus map "balanced", shipping songs with
  // no real chorus at all.
  const verses = vocal.filter(({ s }) => /verse/i.test(s.tag))
  const choruses = vocal.filter(({ s }) => isChorusTag(s.tag))
  const verse = verses[0]?.s || synthesize('Verse', vocal[0]?.s)
  const chorus = choruses[0]?.s || synthesize('Chorus', vocal[vocal.length - 1]?.s)

  // Rebuild the vocal list as repeated clean passes. Verses cycle through
  // the model's distinct verses; the chorus repeats. Wordless tags
  // (instrumentals) and the outro keep their original positions — only the
  // vocal slots are refilled, so the arrangement's shape survives.
  const rebuild = (slots) => {
    if (slots === 0 || !verse || !chorus) return []
    const verseList = verses.length > 0 ? verses.map((v) => v.s) : [verse]
    const out = []
    let vi = 0
    for (let i = 0; i < slots; i++) {
      if (CORE_VOCAL[i % CORE_VOCAL.length] === 'verse') {
        const trimmed = trimSectionLines(verseList[vi % verseList.length], linesPerSection)
        if (trimmed) out.push(wordsOf(trimmed))
        vi++
      } else {
        const trimmed = trimSectionLines(chorus, linesPerSection)
        if (trimmed) out.push(wordsOf(trimmed))
      }
    }
    return out
  }

  // Keep the model's original vocal order ONLY when it already fits the
  // budget AND reads as a balanced form (roughly alternating verse/chorus).
  // A map that happens to have the right COUNT but a lopsided order — say
  // three verses then one chorus crammed at the end — is not well-formed;
  // keeping it buries the chorus and crowds the verses, so it gets rebuilt.
  // Still trim any section whose lines overrun the ~8s slot either way.
  const chorusShare = vocal.filter(({ s }) => isChorusTag(s.tag)).length / vocal.length
  const balancedForm = chorusShare >= 0.3 && chorusShare <= 0.7
  if (vocal.length === budget && balancedForm) {
    const out = []
    for (const sec of sections) {
      if (isVocal(sec)) {
        const trimmed = trimSectionLines(sec, linesPerSection)
        out.push(trimmed || sec)
      } else {
        out.push(sec)
      }
    }
    return out.map((s) => s.raw).join('\n\n')
  }
  const rebuilt = rebuild(budget)
  // Non-core word-carrying sections (a ballad's [Bridge], a [Post-Chorus])
  // are part of the form, not junk — the rebuild only cycles verse/chorus,
  // so they'd be discarded along with their lyrics. Set them aside and
  // re-insert before the outro after the rebuilt passes.
  const isExtraVocal = (s) =>
    isVocal(s) && !/verse|chorus/i.test(s.tag) && !/outro/i.test(s.tag)
  const setAside = []
  const out = []
  let ri = 0
  for (const sec of sections) {
    if (isVocal(sec)) {
      if (isExtraVocal(sec)) {
        setAside.push(sec)
        continue
      }
      if (ri < rebuilt.length) out.push(rebuilt[ri++])
    } else {
      out.push(sec)
    }
  }
  // Instrumentals outnumbered vocals (or the map had none): the extra
  // rebuilt passes land before the outro.
  while (ri < rebuilt.length) {
    const at = out.findIndex((sec) => /outro/i.test(sec.tag))
    out.splice(at >= 0 ? at : out.length, 0, rebuilt[ri++])
  }
  for (const sec of setAside) {
    const at = out.findIndex((s) => /outro/i.test(s.tag))
    out.splice(at >= 0 ? at : out.length, 0, sec)
  }
  return out.map((s) => s.raw).join('\n\n')
}

// Trim a tag map that OVERSHOOTS the duration. The planner sizes the song
// from the section COUNT (~8s each), so a 300s request with 43 sections
// (344s) runs past the lyrics — the song ends before the last vocal. Cut the
// instrumental bulk (never the vocal form) until total×8s fits the duration,
// keeping at least one break between consecutive form passes and the
// intro/outro bookends. Returns the original text when it already fits.
export function trimSectionBudget(lyrics, duration, share = 0.2, style = 'generic') {
  const text = String(lyrics || '').trim()
  if (!text) return text
  const dur = Number(duration) || 0
  if (dur <= 0) return text

  let sections = parseLyricSections(text)
  const isVocal = (s) => s.tag !== '' && s.words !== ''
  const isOutro = (s) => /outro/i.test(s.tag)
  const isIntro = (s) => /intro/i.test(s.tag)
  // Real choruses only — a Pre-Chorus must not protect its duplicate
  // pre-chorus text from dedup (isChorusTag excludes pre/post-chorus).
  const isChorus = (s) => isChorusTag(s.tag)

  // Ceiling adjusted for how heavy the vocal sections actually are. The
  // dense-map constant (10.4s/section) assumes a mixed average; a 4-line
  // vocal section needs ~14s of singing, so subtract the difference from
  // the duration before dividing — 6 four-line vocals in a 300s song
  // reserve 84s for lyrics and leave the rest for instrumentals, instead
  // of promising 28×10.4s of sections on top of the singing. Light maps
  // (2-line trance vocals) compute a negative extra → plain ceiling.
  const vocalSecs = sections.filter(isVocal)
  const sungSeconds = vocalSecs.reduce((n, s) => n + countSungLines(s) * SECONDS_PER_SUNG_LINE, 0)
  const sungExtra = Math.max(0, sungSeconds - vocalSecs.length * DENSE_SECONDS_PER_SECTION)
  const maxSections = Math.max(4, Math.floor((dur - sungExtra) / DENSE_SECONDS_PER_SECTION))

  if (sections.length <= maxSections) return text

  // De-duplicate IDENTICAL vocal sections first. The AI repeats verse 1 as
  // verse 3 word-for-word; the chorus is the hook and is meant to repeat, so
  // only verses/bridges are deduped. Drop the duplicate vocal AND the vocal
  // form that trails it (its chorus) as one run — removing just the verse
  // leaves an orphan chorus after the form already completed, which makes
  // the AR planner end the track early.
  //
  // Floor: never drop below the structural minimum (2 form passes, 3 on
  // long songs). trimVocalSections EXPANDS a sparse map by cycling the
  // model's single verse, so the second pass looks "duplicate" here — but
  // dropping it undid the expansion and shipped a 1-verse/1-chorus fragment.
  // The floor is SHARE-aware (same budget trimVocalSections built with), so
  // a pop 35% map keeps its 3 passes while a repeated-verse AI map still
  // gets its junk passes deduped down to the floor.
  const minVocal = vocalPassBudget(dur, share, style) * CORE_VOCAL.length
  const vocalTotal = sections.reduce((n, s) => n + (isVocal(s) ? 1 : 0), 0)
  const runs = []
  const seenWords = new Set()
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]
    if (!isVocal(s) || isChorus(s)) continue
    const key = s.words.trim()
    if (key && seenWords.has(key)) {
      // This duplicate plus any following vocal sections until the next
      // unique (non-duplicate) vocal — i.e. the trailing form pass.
      const run = new Set([i])
      for (let j = i + 1; j < sections.length; j++) {
        if (isVocal(sections[j])) {
          const k2 = sections[j].words.trim()
          if (k2 && !seenWords.has(k2) && !isChorus(sections[j])) break // next real verse ends the run
          run.add(j)
          if (!isChorus(sections[j])) break
        }
      }
      runs.push(run)
    } else if (key) {
      seenWords.add(key)
    }
  }
  const dropRun = new Set()
  let remainingVocal = vocalTotal
  for (const run of runs) {
    const runVocals = [...run].filter((i) => isVocal(sections[i])).length
    if (remainingVocal - runVocals < minVocal) continue // floor holds the expansion
    run.forEach((i) => dropRun.add(i))
    remainingVocal -= runVocals
  }
  if (dropRun.size) sections = sections.filter((_, i) => !dropRun.has(i))
  if (sections.length <= maxSections) return sections.map((s) => s.raw).join('\n\n')

  // Mark which sections are protected (never dropped): the form skeleton is
  // intro + every vocal + the outro. We additionally protect ONE instrumental
  // break between consecutive vocal passes and the final break before the
  // outro, so the arrangement keeps its shape and the ending has a lead-out.
  const protectedIdx = new Set()
  sections.forEach((s, i) => {
    if (isVocal(s) || isOutro(s) || isIntro(s)) protectedIdx.add(i)
  })
  const vocalIdxs = sections.map((s, i) => (isVocal(s) ? i : -1)).filter((i) => i >= 0)
  const outroIdx = sections.findIndex(isOutro)
  if (outroIdx > 0) {
    for (let i = outroIdx - 1; i >= 0; i--) {
      if (!isVocal(sections[i])) { protectedIdx.add(i); break }
    }
  }
  for (let k = 1; k < vocalIdxs.length; k++) {
    const prev = vocalIdxs[k - 1]
    const cur = vocalIdxs[k]
    for (let i = cur - 1; i > prev; i--) {
      if (!isVocal(sections[i])) { protectedIdx.add(i); break }
    }
  }

  // Drop instrumentals from the END backward until we fit the budget. The
  // tail is what the planner compresses anyway, so thinning it costs the
  // least arrangement character.
  const drop = sections.length - maxSections
  const dropIdx = new Set()
  for (let i = sections.length - 1; i >= 0 && dropIdx.size < drop; i--) {
    if (protectedIdx.has(i)) continue
    dropIdx.add(i)
  }
  sections = sections.filter((_, i) => !dropIdx.has(i))
  return sections.map((s) => s.raw).join('\n\n')
}

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
function wantsMiddleBreakdown(style) {
  return style === 'dance' || style === 'electronic'
}

// Instrumental tag sequences per style for the MIDDLE breakdown. Each entry
// is an ordered list of tags the planner reads as one long, developing
// middle section (not a stack of identical short breaks). Dance uses the
// canonical trance shape: breakdown → build → (drop lands on the next vocal).
const MIDDLE_BREAKDOWN_TAGS = {
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
function leadGapTags(style) {
  return LEAD_GAP_TAGS_BY_STYLE[style] || LEAD_GAP_TAGS_BY_STYLE.generic
}

// Enforce instrumental section density in an AI-written tag map.
// MiniMax's AR planner sizes the song from the section map — a long song
// with stacked vocal sections and one [Instrumental] gap comes out short
// and lyric-heavy. Weak/local models ignore that instruction, so fix it
// deterministically: parse the sections, and if a long song has too few
// instrumental ones, fill the span between the last vocal section and the
// outro with varied section types. Never touches sections that have words.
export function padInstrumentalSections(lyrics, duration = 0, style = 'generic') {
  const text = String(lyrics || '').trim()
  if (!text) return text
  const dur = Number(duration) || 0
  if (dur < 180) return text // short songs don't need padding

  let sections = parseLyricSections(text)
  if (sections.length === 0) return text

  const isVocal = (s) => s.tag !== '' && s.words !== ''
  const isWordless = (s) =>
    s.tag !== '' && s.words === '' && !/intro/i.test(s.tag) && !/outro/i.test(s.tag)

  // Collapse adjacent duplicate tags — the AI sometimes writes [Drop][Drop]
  // back to back, which the planner reads as one repeated section.
  sections = sections.filter((s, i) => i === 0 || s.raw !== sections[i - 1].raw)

  let outroIdx = -1
  let introIdx = -1
  sections.forEach((s, i) => {
    if (/outro/i.test(s.tag)) outroIdx = i
    else if (/intro/i.test(s.tag)) introIdx = i
  })
  const vocalCount = sections.filter(isVocal).length

  const ensureOutro = (list) =>
    list.some((s) => /outro/i.test(s.tag))
      ? list
      : [...list, { tag: 'Outro', words: '', raw: '[Outro]' }]

  // PRESERVE a real AI arrangement. MiniMax's AR planner follows the tag
  // map, NOT the caption prose — so when the AI already wrote instrumental
  // sections that match its own caption (intro → verse → chorus → breakdown
  // → build → drop → … → outro), DISCARDING them and stamping a generic
  // trance stack is what made the song "not listen to the prompt". Only
  // regenerate for SPARSE maps (stacked vocals + a gap), which is the
  // original short-song bug this function was built to fix.
  const ceiling = sectionCeiling(dur)
  const aiInstrumentals = sections.filter(isWordless).length
  // Is every inter-chorus gap already filled with an instrumental? (A form
  // pass is verse→chorus with no break INSIDE it; the gaps that matter are
  // after each chorus except the last.)
  const vocalIdxs = sections.map((s, i) => (isVocal(s) ? i : -1)).filter((i) => i >= 0)
  const chorusIdxsP = sections
    .map((s, i) => (isVocal(s) && isChorusTag(s.tag) ? i : -1))
    .filter((i) => i >= 0)
  let arranged = chorusIdxsP.length >= 1
  for (let k = 0; k < chorusIdxsP.length - 1; k++) {
    const from = chorusIdxsP[k] + 1
    const nextVocal = vocalIdxs.find((vi) => vi > chorusIdxsP[k])
    const between = sections.slice(from, nextVocal != null ? nextVocal : sections.length)
    if (!between.some(isWordless)) { arranged = false; break }
  }
  // Dense enough to fill the duration, OR a fully-arranged AI map: keep it.
  if (sections.length >= ceiling || (arranged && aiInstrumentals >= 3)) {
    return ensureOutro(sections).map((s) => s.raw).join('\n\n')
  }

  // Section budget: the planner sizes the song from the section COUNT and
  // ignores prose time spans, so a 240s request needs ~16 sections, not 10.
  // This is a CEILING too — a map that already overshoots must not grow.
  const total = Math.max(3, plannerSectionTarget(dur))
  const fixedSlots = 1 + (introIdx >= 0 ? 1 : 0)
  // Never add instrumentals when the map is already at/over budget.
  if (sections.length >= total) return text
  const target = Math.max(0, total - vocalCount - fixedSlots)

  // Vocal sections in map order. The intro stays at the head of the map and
  // the outro at the tail — both keep their original slot. Only the gaps
  // between vocal passes are rebuilt. Dropping non-vocal tags is what
  // deleted the original [Intro] and left the map opening on a [Verse].
  const vocalSecs = sections.filter(isVocal)
  const intro = introIdx >= 0 ? [sections[introIdx]] : []
  const outro = outroIdx >= 0
    ? [sections[outroIdx]]
    : [{ tag: 'Outro', words: '', raw: '[Outro]' }]

  // Instrumental budget is split across the GAPS BETWEEN form passes, not
  // after every vocal section. A break between verse and chorus splits a
  // pass in half and the planner reads it as two half-forms; a break after
  // a chorus reads as a real instrumental break before the next pass.
  // gaps = (number of passes - 1), i.e. one slot after each chorus EXCEPT
  // the last — the final chorus is the climax and goes straight to the
  // outro. Trailing instrumentals after the last chorus make the AR planner
  // end the song early (it sees the vocal form complete and stops).
  // Match any real chorus tag — the AI writes [Chorus - euphoric],
  // [Drop + Chorus], [Final Chorus] etc., not just bare [Chorus]. Pre-Chorus
  // does NOT count (isChorusTag) — treating it as a form boundary put a
  // break after the pre-chorus and orphaned the real structure.
  const chorusIdxs = vocalSecs
    .map((s, i) => (isChorusTag(s.tag) ? i : -1))
    .filter((i) => i >= 0)
  const breakAfter = chorusIdxs.length > 1
    ? chorusIdxs.slice(0, -1) // all choruses except the last
    : chorusIdxs.length === 1
      ? [] // single chorus: no trailing break, goes straight to outro
      : [Math.max(0, vocalSecs.length - 1)] // no chorus: one break at the end

  // Distribute the instrumental budget ACROSS the gaps. Electronic/dance
  // styles put the long breakdown in the MIDDLE gap (between the two chorus
  // passes) — the emotional peak of a trance track sits there, not at the
  // end. Everything else splits the budget more evenly.
  //
  // The middle gap is CAPPED: the old 60% hoist stacked ~20 build/drop
  // sections in a row on a single-gap map, which pushed the second vocal
  // pass to the very end of the song where the planner has no time left to
  // play it (the "never got to the second chorus" failure). The uncapped
  // remainder extends the OUTRO LEAD — trailing sections before an [Outro]
  // tag ARE played by the planner (the outro tag signals the end) — and
  // trimSectionBudget thins the tail to the duration ceiling.
  const MIDDLE_GAP_CAP = { dance: 10, electronic: 8 }
  const gaps = breakAfter.length
  const midGap = Math.floor((gaps - 1) / 2) // index of the middle gap
  const isMiddle = (k) =>
    wantsMiddleBreakdown(style) && gaps > 0 && (gaps === 1 ? true : k === midGap)
  const gapCounts = new Array(gaps).fill(0)
  let outroExtra = 0
  if (gaps > 0) {
    if (wantsMiddleBreakdown(style)) {
      const middleCap = MIDDLE_GAP_CAP[style]
      const desiredMiddle = gaps === 1 ? target : Math.round(target * 0.6)
      const middleCount = middleCap != null
        ? Math.min(desiredMiddle, middleCap)
        : desiredMiddle
      gapCounts[midGap] = middleCount
      // Side gaps take a modest, even share so the middle stays the feature
      // (they must not grow BIGGER than the capped middle — the old math
      // left 12 sections for the single side gap after capping middle at
      // 10). Anything beyond their cap extends the outro lead.
      const sideCap = middleCap != null
        ? Math.max(4, Math.floor(middleCap * 0.6))
        : Infinity
      const sideGaps = gaps - 1
      const sideBudget = Math.max(0, target - middleCount)
      const even = sideGaps > 0
        ? Math.min(Math.floor(sideBudget / sideGaps), sideCap)
        : 0
      let li = 0
      for (let k = 0; k < gaps; k++) {
        if (k === midGap) continue
        const bonus = li < sideBudget - even * sideGaps ? 1 : 0
        gapCounts[k] = Math.min(sideCap, even + bonus)
        li++
      }
      const assigned = gapCounts.reduce((n, c) => n + c, 0)
      outroExtra = Math.max(0, target - assigned)
    } else {
      const even = Math.floor(target / gaps)
      const leftover = target - even * gaps
      for (let k = 0; k < gaps; k++) {
        gapCounts[k] = even + (k < leftover ? 1 : 0)
      }
    }
  } else {
    // No inter-vocal gap (a single vocal section): all the filler extends
    // the outro lead — trailing sections before [Outro] still play.
    outroExtra = target
  }

  // Lead-gap tags cycle descriptive names with modifiers so consecutive tags
  // differ and the model gives each section real length (a bare
  // [Instrumental] run reads as ONE section and compresses to a few seconds).
  // [Intro] is deliberately NOT a lead-gap tag — the counter would stamp it
  // into every break. [Post-Chorus]/[Bridge] are excluded too: the planner
  // reads a bare one as a vocal section, so repeating them empty inflates
  // the vocal count. Tag modifiers ([Instrumental - extended]) per the
  // ACE-Step tutorial give the model a duration/character hint.
  const gapCountAt = new Map()
  breakAfter.forEach((vi, k) => gapCountAt.set(vi, gapCounts[k]))

  // Reassemble: intro (if the model wrote one) at the head, then the vocal
  // passes with an instrumental break after each chorus, then the outro.
  // Every map ends on [Outro] — a song that stops on a chorus reads as
  // truncated and the planner ends the track there. The MIDDLE gap gets the
  // style's breakdown sequence (breakdown → build for trance) instead of a
  // stack of generic tags, so the long section reads as one developing
  // passage the planner stretches, not a pile of short breaks.
  //
  // Lead tags come from a no-immediate-repeat picker: cycling a short pool
  // with a plain modulo stamped [Instrumental - driving] three times in a
  // row (the user saw a 20-tag run of cycling Drop/Build/Drum). The picker
  // walks the pool and skips whatever was just used.
  let leadCursor = 0
  let lastLeadTag = ''
  const leadTags = leadGapTags(style)
  const nextLead = () => {
    for (let n = 0; n < leadTags.length; n++) {
      const tag = leadTags[(leadCursor + n) % leadTags.length]
      if (tag !== lastLeadTag) {
        leadCursor = (leadCursor + n + 1) % leadTags.length
        lastLeadTag = tag
        return tag
      }
    }
    const tag = leadTags[leadCursor++ % leadTags.length]
    lastLeadTag = tag
    return tag
  }
  const body = vocalSecs.flatMap((v, i) => {
    const n = gapCountAt.get(i) || 0
    const gapK = breakAfter.indexOf(i)
    const middleSeq = MIDDLE_BREAKDOWN_TAGS[style] || MIDDLE_BREAKDOWN_TAGS.generic
    const breaks = Array.from({ length: n }, (_, k) => {
      let tag
      if (n > 0 && gapK >= 0 && isMiddle(gapK)) {
        // Lay the breakdown sequence across the middle gap (rotated by gap
        // so multiple middle gaps don't all start on the same tag), then
        // pad the remainder with lead-gap tags so the section count still
        // lands.
        const seq = middleSeq[gapK % middleSeq.length]
        if (k < seq.length) tag = seq[k]
        else tag = nextLead()
      } else {
        tag = nextLead()
      }
      return { tag, words: '', raw: `[${tag}]` }
    })
    return [v, ...breaks]
  })

  // Pure instrumental map: no vocal passes to hang breaks on, so the whole
  // filler budget lands between the intro and the outro.
  const fillerOnly = vocalSecs.length === 0
    ? Array.from({ length: target }, () => {
        const tag = nextLead()
        return { tag, words: '', raw: `[${tag}]` }
      })
    : []

  // Extended outro: when there are vocals, add 2–3 instrumental sections
  // before the [Outro] tag so the ending isn't a 10-second stub. The
  // planner plays through them because the outro tag signals the end —
  // it won't cut early like it did with trailing instrumentals after the
  // last chorus (those had no outro tag after them). `outroExtra` is the
  // remainder left after the middle-gap cap (and side-gap caps) — the
  // uncapped budget that used to stack in the middle now extends the
  // ending instead, and trimSectionBudget thins the tail to the ceiling.
  const outroBase = Math.min(3, Math.max(1, Math.floor(dur / 120)))
  const outroLead = vocalSecs.length > 0
    ? Array.from({ length: outroBase + outroExtra }, () => {
        const tag = nextLead()
        return { tag, words: '', raw: `[${tag}]` }
      })
    : []

  return [...intro, ...body, ...fillerOnly, ...outroLead, ...outro].map((s) => s.raw).join('\n\n')
}

async function httpError(res, cfg) {
  let detail = ''
  try {
    const err = await res.json()
    detail = err?.error?.message || err?.message || ''
  } catch { /* non-JSON error body */ }
  const d = detail ? `: ${detail}` : ''

  if (res.status === 401 || res.status === 403) {
    return new Error(`${cfg.label} rejected the API key (HTTP ${res.status})${d} — check it in Settings.`)
  }
  if (res.status === 429) {
    return new Error(`${cfg.label} rate-limited the request (HTTP 429)${d}`)
  }
  if (res.status === 404) {
    if (cfg.provider === 'lmstudio') {
      return new Error(`Model "${cfg.model}" isn't loaded in LM Studio — open the Developer tab, load it, and start the server.`)
    }
    if (cfg.provider === 'openai') {
      return new Error(`OpenAI doesn't know model "${cfg.model}"${d} — pick a current model id in Settings.`)
    }
    return new Error(`Endpoint didn't recognize the path or model (HTTP 404)${d} — check the base URL (usually ends in /v1) and model name.`)
  }
  return new Error(`${cfg.label} returned HTTP ${res.status}${d}`)
}

// Rewrite the user's idea via the configured provider.
// Returns { prompt, searchQuery, lyrics?, duration? } — music mode fills in
// lyrics (tagged sections) and duration (seconds) alongside the caption.
// `research` (optional, music mode): web snippets about an artist's sound
// ("sounds like Avicii" → genre/BPM/production facts) appended to the user
// message so the caption is grounded in reality, not the LLM's memory.
export async function rewritePrompt(cfg, { text, styleLabel, mode, research }, signal) {
  if (!cfg.url) throw new Error('No endpoint URL — open Settings → AI Prompt Writer.')
  if (!cfg.model) throw new Error('No model selected — open Settings → AI Prompt Writer.')
  if (PROVIDERS[cfg.provider]?.keyRequired && !cfg.key) {
    throw new Error(`No API key for ${cfg.label} — open Settings → AI Prompt Writer and paste your key.`)
  }

  const isAnthropic = cfg.style === 'anthropic'
  const system = buildRewriteSystem(styleLabel, mode)
  const userContent = research
    ? `${text}\n\nSTYLE RESEARCH (from the web) — extract the signature instruments, BPM range, and production techniques below and put them IN the Global Metadata. Do NOT write a generic genre description instead:\n${research}`
    : text
  // Music writes a caption plus full tagged lyrics — a 4-minute song's
  // lyrics alone run well past the 500-token budget other modes use.
  const maxTokens = mode === 'music' ? 4000 : 500
  const url = proxyWrap(
    isAnthropic ? `${cfg.url}/messages` : `${cfg.url}/chat/completions`
  )

  const headers = { 'Content-Type': 'application/json' }
  let body
  if (isAnthropic) {
    headers['x-api-key'] = cfg.key
    headers['anthropic-version'] = '2023-06-01'
    // Required for browser-origin requests; harmless when proxied
    headers['anthropic-dangerous-direct-browser-access'] = 'true'
    body = {
      model: cfg.model,
      max_tokens: maxTokens,
      temperature: 0.8,
      system,
      messages: [{ role: 'user', content: userContent }],
    }
  } else {
    if (cfg.key) headers['Authorization'] = `Bearer ${cfg.key}`
    body = {
      model: cfg.model,
      temperature: 0.8,
      max_tokens: maxTokens,
      stream: false,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userContent },
      ],
    }
  }

  let res
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`AI rewrite timed out (120s) — is ${cfg.label} running and the model loaded?`)
    }
    throw new Error(`Could not reach ${cfg.label} (${err.message})`)
  }
  if (!res.ok) throw await httpError(res, cfg)

  const data = await res.json()
  const content = isAnthropic
    ? (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('')
    : data.choices?.[0]?.message?.content
  return parseRewrite(content)
}
