import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Sparkles, ChevronDown, ChevronUp, Wand2, Bot, Loader2, Globe, BookmarkPlus, BookmarkCheck } from 'lucide-react'
import useStore from '../store/useStore'
import { STYLES, enhancePrompt } from '../lib/enhance'
import { rewritePrompt, resolveLlmConfig, PROVIDERS, pickDefaultModel, padInstrumentalSections, trimVocalSections, trimSectionBudget, parseVocalShare, detectMusicStyle, defaultVocalShare, detectArtistRefs, stripArtistRefs, injectSignatureSounds, suggestDurationFromLyrics, ensureOutroLead, collapseConsecutiveWordless, sectionCeiling, sanitizeRewrite } from '../lib/llm'
import { STABLE_AUDIO_MAX_SECONDS } from '../lib/workflows'
import { searchText } from '../lib/search'
import Dropdown from './Dropdown'
import { EXAMPLES, SFX_EXAMPLES, TEXTURE_EXAMPLES, FLIPBOOK_EXAMPLES, MATERIAL_EXAMPLES, PLACEHOLDERS, buildSelectionContext } from './prompt/context'

export default function PromptInput() {
  const prompt = useStore((s) => s.prompt)
  const setPrompt = useStore((s) => s.setPrompt)
  const negativePrompt = useStore((s) => s.negativePrompt)
  const setNegativePrompt = useStore((s) => s.setNegativePrompt)
  const generating = useStore((s) => s.generating)
  const mode = useStore((s) => s.mode)
  const style = useStore((s) => s.style)
  const setStyle = useStore((s) => s.setStyle)
  const llmProvider = useStore((s) => s.llmProvider)
  const llmConfigs = useStore((s) => s.llmConfigs)
  const setError = useStore((s) => s.setError)
  const clearError = useStore((s) => s.clearError)
  const setShowWebSearch = useStore((s) => s.setShowWebSearch)
  const searchQuery = useStore((s) => s.searchQuery)
  const setSearchQuery = useStore((s) => s.setSearchQuery)
  const addSavedPrompt = useStore((s) => s.addSavedPrompt)
  const setLyrics = useStore((s) => s.setLyrics)
  const setMusicSettings = useStore((s) => s.setMusicSettings)
  const setSfxSettings = useStore((s) => s.setSfxSettings)
  const setTitle = useStore((s) => s.setTitle)
  const [showNegative, setShowNegative] = useState(false)
  const [rewriting, setRewriting] = useState(false)
  const [researching, setResearching] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  // SFX only: extra sound-effect ideas the AI proposed when the box was empty.
  const [suggestions, setSuggestions] = useState([])

  // SFX conditions on the negative prompt (music doesn't) and the AI fills it
  // in, so open that box when the tab is picked; drop any sound-effect ideas
  // left over from another mode.
  useEffect(() => {
    if (mode === 'sfx') setShowNegative(true)
    setSuggestions([])
  }, [mode])

  const styleOptions = Object.entries(STYLES).map(([key, s]) => ({ value: key, label: s.label }))

  const insertExample = () => {
    const bank =
      mode === 'sfx'
        ? SFX_EXAMPLES
        : mode === 'texture'
          ? TEXTURE_EXAMPLES
          : mode === 'flipbook'
            ? FLIPBOOK_EXAMPLES
            : mode === 'material'
              ? MATERIAL_EXAMPLES
              : EXAMPLES
    const ex = bank[Math.floor(Math.random() * bank.length)]
    setPrompt(ex)
    if (mode === 'sfx') setSuggestions([])
  }

  const saveCurrentPrompt = () => {
    if (!prompt.trim()) return
    addSavedPrompt({ prompt, negativePrompt, style })
    // Saved prompts persist to localStorage — flash the icon so it's obvious.
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 1600)
  }

  const applyStyle = (styleKey) => {
    setStyle(styleKey)
    // Apply the positive tags immediately: selecting a style used to leave the
    // prompt untouched until Enhance was clicked, so a ground prompt like
    // "soil" still rendered as a centred pile. enhancePrompt() also strips the
    // previous style first, so switching styles never stacks tags.
    if (prompt.trim()) setPrompt(enhancePrompt(prompt, styleKey))
    // Fill the negative prompt from the style, but never overwrite user text.
    // SFX/sprites have their own negative fields with no style defaults.
    if (mode !== 'sfx' && mode !== 'sprite' && mode !== 'pixel' && !negativePrompt.trim() && STYLES[styleKey]?.negative) {
      setNegativePrompt(STYLES[styleKey].negative)
    }
  }

  const handleEnhance = () => {
    if (!prompt.trim()) return
    setPrompt(enhancePrompt(prompt, style))
    if (mode !== 'sfx' && mode !== 'sprite' && mode !== 'pixel' && !negativePrompt.trim() && STYLES[style]?.negative) {
      setNegativePrompt(STYLES[style].negative)
    }
  }

  const handleAiRewrite = async () => {
    // SFX lets the button run on an EMPTY box — the AI then invents a usable
    // effect plus a few alternatives to pick from.
    if (rewriting) return
    if (!prompt.trim() && mode !== 'sfx') return
    let cfg = resolveLlmConfig(useStore.getState())
    if (!cfg.model) {
      // No model saved (fresh deploy, or the saved one was deleted): ask the
      // server what it has instead of refusing to run. Best effort — a failed
      // lookup just falls through to the normal error below.
      try {
        const picked = await pickDefaultModel(cfg)
        if (picked) cfg = { ...cfg, model: picked }
      } catch {
        /* fall through */
      }
    }
    if (!cfg.model) {
      setError('No model selected — open Settings → AI Prompt Writer and pick one.')
      return
    }
    setRewriting(true)
    clearError()
    setSuggestions([])
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120000)
    try {
      // Music: an artist reference ("sounds like Avicii") triggers a quick
      // web search so the caption is grounded in the artist's REAL sound
      // (BPM range, era, production) instead of the LLM's memory. Best
      // effort — any search failure (no engine configured, offline, quota)
      // just proceeds without the research block.
      let research = ''
      let artistRefs = []
      if (mode === 'music') {
        const artists = detectArtistRefs(prompt.trim())
        artistRefs = artists
        if (artists.length) {
          const s = useStore.getState()
          const engine = s.searchEngine || 'searxng'
          const configured = engine === 'searxng'
            ? !!(s.searchUrl || '').trim()
            : !!(s.searchApiKey || '').trim()
          if (configured) {
            setResearching(true)
            try {
              const results = await searchText(
                { engine, searchUrl: s.searchUrl, apiKey: s.searchApiKey, cseId: s.searchCseId },
                `${artists[0]} signature sound folk acoustic instruments BPM genre production`,
                controller.signal
              )
              research = results
                .map((r) => `- ${r.title}${r.snippet ? `: ${r.snippet}` : ''}`)
                .filter((l) => l.length > 4)
                .join('\n')
                .slice(0, 1600)
            } catch (err) {
              // Best-effort — but DON'T hide it: a silently-empty research
              // block is why "Avicii style" produced generic EDM (the LLM
              // fell back to its own memory). Log so the user can see the
              // search never actually reached the engine.
              console.warn('[music research] search failed, proceeding without:', err?.message || err)
            }
            setResearching(false)
          }
        }
      }
      let out = await rewritePrompt(
        cfg,
        {
          // Empty SFX box: tell the model to invent something rather than
          // echoing an empty string back as the prompt.
          text: prompt.trim() || (mode === 'sfx' ? 'invent a sound effect' : ''),
          styleLabel: STYLES[style]?.label || 'photorealistic',
          mode,
          research,
          context: buildSelectionContext(useStore.getState()),
        },
        controller.signal
      )
      // Local models occasionally ignore the per-mode system prompt and
      // return an image caption for SFX (or a scene for a texture). Repair
      // the obvious cross-mode language before it reaches the generator.
      out = sanitizeRewrite(mode, out, prompt.trim())
      // The system prompt forbids naming the artist in the caption/lyrics,
      // but LLMs leak them anyway ("Avicii-style trance"). Strip detected
      // artist refs from the generated text as a hard guarantee.
      if (artistRefs.length) {
        out.prompt = stripArtistRefs(out.prompt, artistRefs)
        if (out.lyrics) out.lyrics = stripArtistRefs(out.lyrics, artistRefs)
      }
      // Weak LLMs ignore the research grounding and write generic genre
      // captions ("Avicii = EDM" with zero folk/acoustic elements). Force
      // the artist's signature instruments from the research into the
      // caption so the music model always sees them.
      if (mode === 'music' && research) {
        out.prompt = injectSignatureSounds(out.prompt, research)
      }
      setPrompt(out.prompt)
      setSearchQuery(out.searchQuery || '')
      if (out.title && (mode === 'music' || mode === 'video' || mode === 'sfx' || mode === 'sprite')) setTitle(mode, out.title)
      // Music mode: the AI writes the full song package — tagged lyrics
      // fill the Lyrics box, and a stated length moves the Max length knob.
      // Weak/local models ignore the vocal-share rule, so enforce it
      // deterministically: trim vocal sections to the requested share,
      // then pad instrumental sections to fill the rest of the duration.
      if (mode === 'music') {
        // The AI now always picks a length, but weak models still return 0
        // — which used to keep the 300s (5-min) knob default, making EVERY
        // song 4–5 minutes. Fall back to the lyric map's section count
        // (~10.4s/section, the planner's real sizing) instead.
        const raw = out.duration || suggestDurationFromLyrics(out.lyrics) || useStore.getState().musicSettings.duration || 300
        // parseDuration now floors at 1 (SFX needs 1–47s) — music's knob
        // still starts at 10.
        const dur = Math.min(2000, Math.max(10, raw))
        if (dur !== useStore.getState().musicSettings.duration) setMusicSettings({ duration: dur })
        if (out.lyrics) {
          // Detect the style family from the prompt: it drives the MIDDLE
          // breakdown weight (trance/dance) AND the default vocal share —
          // trance is instrumental-first (~15%), vocal-led styles get
          // 35–45% so pop/ballads don't ship as lyric fragments. An
          // explicit "25% of the song" from the user always wins.
          const musicStyle = detectMusicStyle(out.prompt || prompt)
          const share = parseVocalShare(prompt) || defaultVocalShare(musicStyle)
          // Pipeline: vocal trim → instrumental pad → section budget →
          // collapse consecutive wordless + rebalance (AR planner loops
          // long wordless runs; rebalance re-inserts instrumentals into
          // vocal gaps to fill back to the ceiling) → outro lead.
          const trimmed = trimVocalSections(out.lyrics, dur, share, musicStyle)
          const padded = padInstrumentalSections(trimmed, dur, musicStyle)
          const budgeted = trimSectionBudget(padded, dur, share, musicStyle)
          const collapsed = collapseConsecutiveWordless(budgeted, sectionCeiling(dur))
          setLyrics(ensureOutroLead(collapsed, musicStyle))
        }
      }
      // SFX mode: the AI writes the whole generation setup — a sized clip
      // length (a coin ping is not 20s), a take-ruining negative, the title
      // used for the download filename, and alternatives when the box was
      // empty. Duration only moves if the AI actually chose one.
      if (mode === 'sfx') {
        if (out.duration) {
          const dur = Math.min(STABLE_AUDIO_MAX_SECONDS, Math.max(1, out.duration))
          if (dur !== useStore.getState().sfxSettings.duration) setSfxSettings({ duration: dur })
        }
        if (out.negative && !negativePrompt.trim()) setNegativePrompt(out.negative)
        setSuggestions(out.suggestions || [])
      }
      // Image / video / edit: the AI now writes a negative too. Prefer its
      // take-ruining list; only fall back to the style preset when it gave none.
      if (mode === 'image' || mode === 'video' || mode === 'edit' || mode === 'custom') {
        if (!negativePrompt.trim()) {
          if (out.negative) setNegativePrompt(out.negative)
          else if (STYLES[style]?.negative) setNegativePrompt(STYLES[style].negative)
        }
        setShowNegative(true)
      } else if (
        // Game-asset writers return a mode-specific negative (texture edges,
        // flipbook artefacts, PBR map mistakes, sprite/parts framing). Use it
        // instead of a style negative, which has nothing to do with these
        // pipelines and can override the builder's tuned default.
        (mode === 'texture' || mode === 'flipbook' || mode === 'material' || mode === 'sprite' || mode === 'pixel') &&
        !negativePrompt.trim() &&
        out.negative
      ) {
        setNegativePrompt(out.negative)
      }
      // End-to-end: in image mode continue straight into the web reference search
      if (mode === 'image' && out.searchQuery) {
        setShowWebSearch(true)
      }
    } catch (err) {
      setError(`AI rewrite failed: ${err.message}`)
    } finally {
      clearTimeout(timeout)
      setResearching(false)
      setRewriting(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {mode !== 'edit' && mode !== 'music' && mode !== 'sfx' && mode !== 'sprite' && mode !== 'pixel' && mode !== 'material' && (
          <>
            <span className="text-xs text-text-muted shrink-0">Style</span>
            <div className="flex-1 min-w-36">
              <Dropdown
                value={style}
                onChange={applyStyle}
                options={styleOptions}
                disabled={generating}
                ariaLabel="Style"
              />
            </div>
          </>
        )}
        {mode !== 'edit' && (
          <div className="flex items-center gap-1.5 shrink-0">
              {/* Enhance appends image-style quality tags — meaningless for
                  music and sound-effect captions, so the offline button stays
                  hidden there (the AI button below writes proper prompts). */}
              {mode !== 'music' && mode !== 'sfx' && mode !== 'sprite' && mode !== 'pixel' && mode !== 'material' && (
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={handleEnhance}
                  disabled={generating || rewriting || !prompt.trim()}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-accent/15 text-accent hover:bg-accent/25 transition-colors disabled:opacity-40 shrink-0"
                  title="Expand plain words into a detailed prompt (offline)"
                >
                  <Wand2 size={12} />
                  Enhance
                </motion.button>
              )}
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleAiRewrite}
                disabled={generating || rewriting || (!prompt.trim() && mode !== 'sfx')}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-purple-500/15 text-purple-300 hover:bg-purple-500/25 transition-colors disabled:opacity-40 shrink-0"
                title={
                  mode === 'sfx' && !prompt.trim()
                    ? `Invent a sound effect (plus a few ideas to try) with ${PROVIDERS[llmProvider]?.short || 'AI'} — configure in Settings`
                    : `Rewrite with ${PROVIDERS[llmProvider]?.short || 'AI'}${
                        llmConfigs[llmProvider]?.model ? ` (${llmConfigs[llmProvider].model})` : ' (not configured)'
                      } — configure in Settings`
                }
              >
                {rewriting ? <Loader2 size={12} className="animate-spin" /> : <Bot size={12} />}
                {rewriting
                  ? researching
                    ? 'Researching…'
                    : 'Writing...'
                  : !prompt.trim() && mode === 'sfx'
                    ? 'Suggest'
                    : 'AI'}
              </motion.button>
            </div>
        )}
        {/* Reference-image web search only makes sense for image/edit —
            hidden from Video, Music and 3D (their prompts take no source image). */}
        {(mode === 'image' || mode === 'edit') && (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowWebSearch(true)}
            disabled={generating}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-sky-500/15 text-sky-300 hover:bg-sky-500/25 transition-colors disabled:opacity-40 shrink-0"
            title="Search the web for a reference image, then AI-update it (SearXNG)"
          >
            <Globe size={12} />
            Web
          </motion.button>
        )}
      </div>
      <div className="relative">
        <textarea
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value)
            // a manually edited prompt invalidates the AI-picked search query
            if (searchQuery) setSearchQuery('')
            // ...and the AI's alternative ideas (they described the old text)
            if (suggestions.length) setSuggestions([])
          }}
          placeholder={PLACEHOLDERS[mode] || PLACEHOLDERS.image}
          disabled={generating}
          rows={4}
          className="w-full min-h-28 px-4 py-3 rounded-xl bg-bg-card border border-border text-text-primary placeholder:text-text-muted resize-y focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-all duration-200 text-sm leading-relaxed disabled:opacity-50"
        />
        <div className="absolute bottom-2 right-3 flex items-center gap-2">
          <span className="text-[10px] text-text-muted">{prompt.length}</span>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={saveCurrentPrompt}
            disabled={generating || !prompt.trim()}
            className="p-1 rounded-md bg-bg-hover hover:bg-accent/20 text-text-muted hover:text-accent transition-colors disabled:opacity-50"
            title={savedFlash ? 'Saved to the sidebar' : 'Save this prompt to the sidebar'}
          >
            {savedFlash ? (
              <BookmarkCheck size={14} className="text-accent" />
            ) : (
              <BookmarkPlus size={14} />
            )}
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={insertExample}
            disabled={generating}
            className="p-1 rounded-md bg-bg-hover hover:bg-accent/20 text-text-muted hover:text-accent transition-colors disabled:opacity-50"
            title="Random example"
          >
            <Sparkles size={14} />
          </motion.button>
        </div>
      </div>

      {/* SFX: alternative effects the AI proposed when the box was empty —
          click one to load it into the prompt. */}
      {mode === 'sfx' && suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-text-muted">Ideas</span>
          {suggestions.map((s) => (
            <motion.button
              key={s}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => {
                setPrompt(s)
                setSuggestions([])
              }}
              disabled={generating}
              className="px-2.5 py-1 rounded-lg text-[11px] bg-purple-500/10 text-purple-200 hover:bg-purple-500/20 border border-purple-500/20 transition-colors disabled:opacity-50"
              title="Use this sound effect"
            >
              {s}
            </motion.button>
          ))}
        </div>
      )}

      {/* Music hides the negative-prompt field entirely (the model has no
          negative conditioning). SFX keeps it OPEN by default — the AI fills
          it in and Stable Audio actually conditions on it. */}
      {mode !== 'music' && (
        <motion.button
          onClick={() => setShowNegative(!showNegative)}
          className="flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary transition-colors"
        >
          {showNegative ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          Negative prompt
        </motion.button>
      )}

      {showNegative && mode !== 'music' && mode !== 'material' && (
        <motion.textarea
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          value={negativePrompt}
          onChange={(e) => setNegativePrompt(e.target.value)}
          placeholder="Things to avoid..."
          disabled={generating}
          rows={2}
          className="w-full min-h-16 px-4 py-2.5 rounded-xl bg-bg-card border border-border text-text-primary placeholder:text-text-muted resize-y focus:outline-none focus:ring-2 focus:ring-danger focus:border-transparent transition-all duration-200 text-xs disabled:opacity-50"
        />
      )}
    </div>
  )
}
