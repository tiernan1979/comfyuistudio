// Public surface of the AI prompt writer, split by concern:
// config (providers/endpoints) · prompts (system messages) · parse (reply →
// shape) · structure (song planning) · style (genre/artist grounding) ·
// arrangement (lyric-map repair) · request (HTTP transport).
export { PROVIDERS, MODEL_SUGGESTIONS, LLM_ENDPOINT_FALLBACKS, pickDefaultModel, resolveLlmConfig, fetchLlmModels, fetchLlmLoaded, classifyLlmModels } from './config.js'
export { buildRewriteSystem } from './prompts.js'
export { sanitizeRewrite } from './guard.js'
export { parseRewrite, parseLyricSections, parseVocalShare } from './parse.js'
export {
  PLANNER_SECONDS_PER_SECTION,
  plannerSectionTarget,
  DENSE_SECONDS_PER_SECTION,
  sectionCeiling,
  MAX_CONSECUTIVE_WORDLESS,
  plannerCapDuration,
  vocalFormCycles,
  vocalPassBudget,
  SECONDS_PER_SUNG_LINE,
  trimVocalSections,
  trimSectionBudget,
  suggestDurationFromLyrics,
} from './structure.js'
export { detectMusicStyle, defaultVocalShare, detectArtistRefs, stripArtistRefs, injectSignatureSounds } from './style.js'
export { padInstrumentalSections, ensureOutroLead, collapseConsecutiveWordless } from './arrangement.js'
export { rewritePrompt } from './request.js'
