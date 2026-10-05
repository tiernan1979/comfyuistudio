import { useState } from 'react'
import { motion } from 'framer-motion'
import { Sparkles, ChevronDown, ChevronUp, Wand2, Bot, Loader2, Globe, BookmarkPlus } from 'lucide-react'
import useStore from '../store/useStore'
import { STYLES, enhancePrompt } from '../lib/enhance'
import { rewritePrompt, resolveLlmConfig, PROVIDERS } from '../lib/llm'
import Dropdown from './Dropdown'

const EXAMPLES = [
  'A majestic dragon flying over a medieval castle at sunset, dramatic lighting, highly detailed',
  'Cyberpunk city street at night with neon reflections in puddles, cinematic',
  'A cozy coffee shop interior with warm lighting, plants, and rain outside the window',
  'Portrait of a futuristic astronaut floating in space with nebula reflections on the helmet',
]

const PLACEHOLDERS = {
  image: 'Describe what you want to create...',
  edit: "Describe the change... e.g. 'change the background to a beach at sunset, keep the person the same'",
  video: 'Describe the video... e.g. a fox running through snowy woods at sunset',
  music:
    'Describe the song, e.g.\n' +
    'Global Metadata: melodic trance, 126 BPM, F# minor, euphoric, clean club mix.\n' +
    'Arrangement: atmospheric intro → rising build → soaring breakdown → big drop → stripped outro',
}

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
  const [showNegative, setShowNegative] = useState(false)
  const [rewriting, setRewriting] = useState(false)

  const styleOptions = Object.entries(STYLES).map(([key, s]) => ({ value: key, label: s.label }))

  const insertExample = () => {
    const ex = EXAMPLES[Math.floor(Math.random() * EXAMPLES.length)]
    setPrompt(ex)
  }

  const saveCurrentPrompt = () => {
    if (!prompt.trim()) return
    addSavedPrompt({ prompt, negativePrompt, style })
  }

  const applyStyle = (styleKey) => {
    setStyle(styleKey)
    // Fill the negative prompt from the style, but never overwrite user text
    if (!negativePrompt.trim() && STYLES[styleKey]?.negative) {
      setNegativePrompt(STYLES[styleKey].negative)
    }
  }

  const handleEnhance = () => {
    if (!prompt.trim()) return
    setPrompt(enhancePrompt(prompt, style))
    if (!negativePrompt.trim() && STYLES[style]?.negative) {
      setNegativePrompt(STYLES[style].negative)
    }
  }

  const handleAiRewrite = async () => {
    if (!prompt.trim() || rewriting) return
    const cfg = resolveLlmConfig(useStore.getState())
    if (!cfg.model) {
      setError('No model selected — open Settings → AI Prompt Writer and pick one.')
      return
    }
    setRewriting(true)
    clearError()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120000)
    try {
      const out = await rewritePrompt(
        cfg,
        {
          text: prompt.trim(),
          styleLabel: STYLES[style]?.label || 'photorealistic',
          mode,
        },
        controller.signal
      )
      setPrompt(out.prompt)
      setSearchQuery(out.searchQuery || '')
      if (!negativePrompt.trim() && STYLES[style]?.negative) {
        setNegativePrompt(STYLES[style].negative)
      }
      // End-to-end: in image mode continue straight into the web reference search
      if (mode === 'image' && out.searchQuery) {
        setShowWebSearch(true)
      }
    } catch (err) {
      setError(`AI rewrite failed: ${err.message}`)
    } finally {
      clearTimeout(timeout)
      setRewriting(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {mode !== 'edit' && mode !== 'music' && (
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
                  music captions, so the offline button stays hidden there
                  (the AI button below writes proper music captions instead). */}
              {mode !== 'music' && (
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
                disabled={generating || rewriting || !prompt.trim()}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-purple-500/15 text-purple-300 hover:bg-purple-500/25 transition-colors disabled:opacity-40 shrink-0"
                title={`Rewrite with ${PROVIDERS[llmProvider]?.short || 'AI'}${
                  llmConfigs[llmProvider]?.model ? ` (${llmConfigs[llmProvider].model})` : ' (not configured)'
                } — configure in Settings`}
              >
                {rewriting ? <Loader2 size={12} className="animate-spin" /> : <Bot size={12} />}
                {rewriting ? 'Writing...' : 'AI'}
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
            title="Save this prompt to the sidebar"
          >
            <BookmarkPlus size={14} />
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

      {/* MiniMax Music has no negative conditioning — hide the field, explain why */}
      {mode === 'music' && (
        <p className="text-[11px] text-text-muted leading-snug">
          MiniMax Music 3 has no negative prompt — put exclusions in the caption itself
          (e.g. “no vocals, no choir”). A “Negative Prompt: …” section is converted
          into the caption automatically. The AI button writes the structured
          Global Metadata + Arrangement caption for you.
        </p>
      )}
      {mode !== 'music' && (
        <motion.button
          onClick={() => setShowNegative(!showNegative)}
          className="flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary transition-colors"
        >
          {showNegative ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          Negative prompt
        </motion.button>
      )}

      {showNegative && mode !== 'music' && (
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
