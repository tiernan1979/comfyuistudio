// Normalize one parsed rewrite object into the shape every mode consumes.
// `negative` + `suggestions` are SFX-only extras; other modes simply ignore
// them (their models never return those keys).
function rewriteResult(obj) {
  const suggestions = Array.isArray(obj.suggestions)
    ? obj.suggestions
        .filter((s) => typeof s === 'string' && s.trim())
        .map((s) => s.trim().slice(0, 120))
        .slice(0, 5)
    : []
  return {
    prompt: String(obj.prompt || '').trim(),
    searchQuery: String(obj.search_query || obj.searchQuery || '').trim(),
    lyrics: typeof obj.lyrics === 'string' ? obj.lyrics.trim() : '',
    duration: parseDuration(obj.duration),
    title: typeof obj.title === 'string' ? obj.title.trim().slice(0, 80) : '',
    negative: typeof obj.negative === 'string' ? obj.negative.trim().slice(0, 300) : '',
    suggestions,
  }
}

// Parse the model's reply into { prompt, searchQuery, lyrics?, duration?,
// title?, negative?, suggestions? }.
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
      if (obj && typeof obj.prompt === 'string' && obj.prompt.trim()) return rewriteResult(obj)
    } catch { /* fall through to regex extraction */ }

    // Malformed JSON but the fields may still be extractable
    const pm = segment.match(/"prompt"\s*:\s*"((?:[^"\\]|\\.)*)"/)
    if (pm) {
      const sm = segment.match(/"search_query"\s*:\s*"((?:[^"\\]|\\.)*)"/)
      const lm = segment.match(/"lyrics"\s*:\s*"((?:[^"\\]|\\.)*)"/)
      const dm = segment.match(/"duration"\s*:\s*"?(\d{1,3})"?/)
      const tm = segment.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/) || segment.match(/"title"\s*:\s*"([^"]*)$/)
      const nm = segment.match(/"negative"\s*:\s*"((?:[^"\\]|\\.)*)"/)
      const sug = []
      const arr = segment.match(/"suggestions"\s*:\s*\[([\s\S]*?)\]/)
      if (arr) {
        for (const m of arr[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)) sug.push(unescapeJsonStr(m[1]))
      }
      return rewriteResult({
        prompt: unescapeJsonStr(pm[1]),
        search_query: sm ? unescapeJsonStr(sm[1]) : '',
        lyrics: lm ? unescapeJsonStr(lm[1]).trim() : '',
        duration: dm ? dm[1] : 0,
        title: tm ? unescapeJsonStr(tm[1]).trim().slice(0, 80) : '',
        negative: nm ? unescapeJsonStr(nm[1]) : '',
        suggestions: sug,
      })
    }
  }

  // Not JSON at all: use the text as the prompt (strip only a fully
  // quote-wrapped reply, not a stray trailing quote inside prose)
  let fallback = t
  if (/^["'][\s\S]*["']$/.test(fallback)) fallback = fallback.slice(1, -1)
  fallback = fallback.trim()
  if (fallback) {
    return {
      prompt: fallback,
      searchQuery: '',
      lyrics: '',
      duration: 0,
      title: '',
      negative: '',
      suggestions: [],
    }
  }
  throw new Error('Could not understand the AI rewrite output.')
}

// Song length in seconds. Music mode's "Max length" knob runs 10–2000
// (MiniMax planner caps at 360 internally; ACE can go longer).
// Sound effects need the SAME field but at the other end of the scale
// (1–47s), so the floor here is 1 — music clamps its own value on apply.
// 0 (or junk) means "keep the current setting".
function parseDuration(v) {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(2000, Math.max(1, n))
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
export function parseLyricSections(lyrics) {
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
