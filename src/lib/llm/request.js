// HTTP transport for the prompt rewrite; provider errors become actionable.
import { LLM_ENDPOINT_FALLBACKS, PROVIDERS, openaiCompatBase, proxyWrap } from './config.js'
import { parseRewrite } from './parse.js'
import { buildRewriteSystem } from './prompts.js'

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
// Returns { prompt, searchQuery, lyrics?, duration?, negative?, suggestions? }
// — music mode fills in lyrics (tagged sections) and duration (seconds)
// alongside the caption; SFX fills in duration/negative/title/suggestions.
// `research` (optional, music mode): web snippets about an artist's sound
// ("sounds like Avicii" → genre/BPM/production facts) appended to the user
// message so the caption is grounded in reality, not the LLM's memory.
export async function rewritePrompt(cfg, { text, styleLabel, mode, research, context }, signal) {
  if (!cfg.url) throw new Error('No endpoint URL — open Settings → AI Prompt Writer.')
  if (!cfg.model) throw new Error('No model selected — open Settings → AI Prompt Writer.')
  if (PROVIDERS[cfg.provider]?.keyRequired && !cfg.key) {
    throw new Error(`No API key for ${cfg.label} — open Settings → AI Prompt Writer and paste your key.`)
  }

  const isAnthropic = cfg.style === 'anthropic'
  const system = buildRewriteSystem(styleLabel, mode)
  const baseContent = research
    ? `${text}\n\nSTYLE RESEARCH (from the web) — extract the signature instruments, BPM range, and production techniques below and put them IN the Global Metadata. Do NOT write a generic genre description instead:\n${research}`
    : text
  // The SELECTED OPTIONS block tells the model what the user has actually
  // chosen in the UI (mode, output size, sprite cell, part slot, style…), so
  // the prompt it writes fits those choices instead of being generic.
  const userContent = context
    ? `${baseContent}\n\nSELECTED OPTIONS (the user's current UI settings — tailor the result to these and do NOT contradict them):\n${context}`
    : baseContent
  // Music writes a caption plus full tagged lyrics — a 4-minute song's
  // lyrics alone run well past the 500-token budget other modes use. The
  // caption also grew (signature instruments, production techniques), so 4000
  // was occasionally truncating the reply BEFORE the trailing fields arrived
  // — the missing "title" is why downloads fell back to track_00001.mp3.
  // (title is now FIRST in the JSON too, but the headroom matters for lyrics.)
  const maxTokens = mode === 'music' ? 6000 : mode === 'sfx' ? 800 : 500

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

  // Local servers move around (the ComfyUI box hosts LM Studio on
  // 10.1.1.102:1234, the Docker host does not) and a stale saved URL is the
  // #1 reason the AI button dies with "Could not reach …". Retry the known
  // hosts instead of failing on the first dead one. Every candidate goes
  // through openaiCompatBase so a bare origin still becomes …/v1/…
  // (otherwise the retry 404s on /chat/completions and looks "reachable").
  const bases = []
  for (const u of [cfg.url, ...(isAnthropic ? [] : LLM_ENDPOINT_FALLBACKS)]) {
    const base = isAnthropic ? String(u || '').trim() : openaiCompatBase(u)
    if (base && !bases.includes(base)) bases.push(base)
  }

  let res = null
  let lastErr = null
  for (const base of bases) {
    const url = proxyWrap(isAnthropic ? `${base}/messages` : `${base}/chat/completions`)
    try {
      res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error(`AI rewrite timed out (120s) — is ${cfg.label} running and the model loaded?`)
      }
      lastErr = new Error(`Could not reach ${base} (${err.message})`)
      continue
    }
    // 502/503/504 = the proxy reached nothing — try the next host.
    if (!res.ok && res.status >= 500 && bases.length > 1) {
      lastErr = new Error(`${base} returned HTTP ${res.status}`)
      res = null
      continue
    }
    break
  }
  if (!res) throw lastErr || new Error(`Could not reach ${cfg.label}.`)
  if (!res.ok) throw await httpError(res, cfg)

  const data = await res.json()
  const content = isAnthropic
    ? (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('')
    : data.choices?.[0]?.message?.content
  return parseRewrite(content)
}
