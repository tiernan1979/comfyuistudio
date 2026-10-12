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
      '60 seconds of vocals ≈ TWO short verses + ONE chorus (4–6 vocal sections total). Write 2–3\n' +
      'DISTINCT verses with different words — never repeat the same verse. The chorus repeats\n' +
      'identically each time (it\'s the hook). Verses are 4–6 lines, chorus is 4–6 lines.\n' +
      'The remaining ~75% is instrumental — stack descriptive instrumental tags with time spans in\n' +
      'the arrangement. The tag map must mirror the prompt\'s Arrangement section for section, in\n' +
      'the same order.\n' +
      'If the user says instrumental / no vocals: ONLY the tag map, no words, still enough sections\n' +
      'to cover the whole duration. If the user says nothing about vocals: return "" for lyrics.\n' +
      'If the user mentions vocals / singing / lyrics but doesn\'t state a share: default to ~20%\n' +
      '(2–3 verse→chorus cycles, 4–6 vocal sections), rest is instrumental.\n' +
      '\n' +
      'Lyric writing rules:\n' +
      '— 6–10 syllables per line (the model aligns syllables to beats; uneven lines sound strange).\n' +
      '— Keep similar syllable counts for lines in the same position across verses.\n' +
      '— UPPERCASE lines in the chorus for high-intensity delivery.\n' +
      '— Parentheses = background vocals / harmonies: "We rise together (together)".\n' +
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
  return Math.min(3, Math.max(2, byLength))
}

// Trim or EXPAND the vocal map to the requested share of the song, while
// never dropping below two passes of the vocal form (verse→chorus at
// least twice, three times on longer songs). Weak models write a single
// Verse+Chorus for a 25% request, which reads as a fragment, not a song —
// so this both cuts lyric-heavy maps and repeats sparse ones.
export function trimVocalSections(lyrics, duration, share) {
  if (!lyrics || !duration || !share || share <= 0 || share >= 1) return lyrics
  const sections = parseLyricSections(lyrics)
  if (sections.length === 0) return lyrics

  const isVocal = (s) => s.tag !== '' && s.words !== ''
  const vocal = sections.map((s, i) => ({ s, i })).filter(({ s }) => isVocal(s))
  if (vocal.length === 0) return lyrics

  // Budget = the requested share of the planner's section count, but never
  // fewer sections than two passes of the vocal form need.
  const total = plannerSectionTarget(duration)
  const minForm = vocalFormCycles(duration, share) * CORE_VOCAL.length
  const budget = Math.max(minForm, Math.round(total * share))

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
  // [Final Chorus] etc., not just bare tags.
  const verses = vocal.filter(({ s }) => /verse/i.test(s.tag))
  const choruses = vocal.filter(({ s }) => /chorus/i.test(s.tag))
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
        out.push(wordsOf(verseList[vi % verseList.length]))
        vi++
      } else {
        out.push(wordsOf(chorus))
      }
    }
    return out
  }

  // Keep the model's original vocal order when it already fits the budget —
  // a well-formed map should not be rewritten. Otherwise rebuild.
  if (vocal.length === budget) return lyrics
  const rebuilt = rebuild(budget)
  const out = []
  let ri = 0
  for (const sec of sections) {
    if (isVocal(sec)) {
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
  return out.map((s) => s.raw).join('\n\n')
}

// Enforce instrumental section density in an AI-written tag map.
// MiniMax's AR planner sizes the song from the section map — a long song
// with stacked vocal sections and one [Instrumental] gap comes out short
// and lyric-heavy. Weak/local models ignore that instruction, so fix it
// deterministically: parse the sections, and if a long song has too few
// instrumental ones, fill the span between the last vocal section and the
// outro with varied section types. Never touches sections that have words.
export function padInstrumentalSections(lyrics, duration = 0) {
  const text = String(lyrics || '').trim()
  if (!text) return text
  const dur = Number(duration) || 0
  if (dur < 180) return text // short songs don't need padding

  const sections = parseLyricSections(text)
  if (sections.length === 0) return text

  const isVocal = (s) => s.tag !== '' && s.words !== ''
  const vocalCount = sections.filter(isVocal).length

  // Section budget: the planner sizes the song from the section COUNT and
  // ignores prose time spans, so a 240s request needs ~24 sections, not 10.
  // Intro and outro each take a fixed slot; the rest is fillers.
  let outroIdx = -1
  let introIdx = -1
  sections.forEach((s, i) => {
    if (/outro/i.test(s.tag)) outroIdx = i
    else if (/intro/i.test(s.tag)) introIdx = i
  })
  const total = Math.max(3, plannerSectionTarget(dur))
  // The outro is always present — written or synthesized below — so it always
  // takes a slot. Counting it as optional made every outro-less map one
  // section over budget. The intro is only a slot when the model wrote one.
  const fixedSlots = 1 + (introIdx >= 0 ? 1 : 0)
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
  // Match any tag containing "chorus" — the AI writes [Chorus - euphoric],
  // [Drop + Chorus], [Final Chorus] etc., not just bare [Chorus].
  const chorusIdxs = vocalSecs
    .map((s, i) => (/chorus/i.test(s.tag) ? i : -1))
    .filter((i) => i >= 0)
  const breakAfter = chorusIdxs.length > 1
    ? chorusIdxs.slice(0, -1) // all choruses except the last
    : chorusIdxs.length === 1
      ? [] // single chorus: no trailing break, goes straight to outro
      : [Math.max(0, vocalSecs.length - 1)] // no chorus: one break at the end
  const gaps = breakAfter.length
  const perGap = gaps > 0 ? Math.floor(target / gaps) : 0
  let extra = gaps > 0 ? target - perGap * gaps : target

  // Fillers cycle descriptive tags with modifiers so consecutive tags differ
  // and the model gives each section real length (a bare [Instrumental] run
  // reads as ONE section and compresses to a few seconds). [Intro] is
  // deliberately NOT a filler — the counter would stamp it into every break.
  // [Post-Chorus]/[Bridge] are excluded too: the planner reads a bare one
  // as a vocal section, so repeating them empty inflates the vocal count.
  // Tag modifiers ([Instrumental - extended]) per the ACE-Step tutorial give
  // the model a duration/character hint beyond the bare tag.
  const FILLER = [
    'Instrumental - extended',
    'Guitar Solo - expressive',
    'Instrumental - building',
    'Piano Interlude',
    'Instrumental - driving',
    'Drum Break',
  ]
  const breakAt = new Map()
  breakAfter.forEach((vi, k) => {
    const n = perGap + (extra > 0 ? 1 : 0)
    if (extra > 0) extra--
    breakAt.set(vi, n)
  })

  // Reassemble: intro (if the model wrote one) at the head, then the vocal
  // passes with an instrumental break after each chorus, then the outro.
  // Every map ends on [Outro] — a song that stops on a chorus reads as
  // truncated and the planner ends the track there.
  let fi = 0
  const body = vocalSecs.flatMap((v, i) => {
    const n = breakAt.get(i) || 0
    const breaks = Array.from({ length: n }, (_, k) => {
      const tag = FILLER[fi++ % FILLER.length]
      return { tag, words: '', raw: `[${tag}]` }
    })
    return [v, ...breaks]
  })

  // Pure instrumental map: no vocal passes to hang breaks on, so the whole
  // filler budget lands between the intro and the outro.
  const fillerOnly = vocalSecs.length === 0
    ? Array.from({ length: target }, (_, k) => {
        const tag = FILLER[k % FILLER.length]
        return { tag, words: '', raw: `[${tag}]` }
      })
    : []

  // Extended outro: when there are vocals, add 2–3 instrumental sections
  // before the [Outro] tag so the ending isn't a 10-second stub. The
  // planner plays through them because the outro tag signals the end —
  // it won't cut early like it did with trailing instrumentals after the
  // last chorus (those had no outro tag after them).
  const outroLead = vocalSecs.length > 0
    ? Array.from({ length: Math.min(3, Math.max(1, Math.floor(dur / 120))) }, (_, k) => {
        const tag = FILLER[(fi + k) % FILLER.length]
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
export async function rewritePrompt(cfg, { text, styleLabel, mode }, signal) {
  if (!cfg.url) throw new Error('No endpoint URL — open Settings → AI Prompt Writer.')
  if (!cfg.model) throw new Error('No model selected — open Settings → AI Prompt Writer.')
  if (PROVIDERS[cfg.provider]?.keyRequired && !cfg.key) {
    throw new Error(`No API key for ${cfg.label} — open Settings → AI Prompt Writer and paste your key.`)
  }

  const isAnthropic = cfg.style === 'anthropic'
  const system = buildRewriteSystem(styleLabel, mode)
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
      messages: [{ role: 'user', content: text }],
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
        { role: 'user', content: text },
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
