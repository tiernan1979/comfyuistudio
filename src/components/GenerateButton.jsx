import { useState } from 'react'
import { motion } from 'framer-motion'
import { Loader2, Zap, Square, Clapperboard } from 'lucide-react'
import clsx from 'clsx'
import useStore from '../store/useStore'
import { useComfyUI } from '../hooks/useComfyUI'
import { resolveApiBase, stopGeneration } from '../lib/comfyui'
import EpisodePanel from './EpisodePanel'

export default function GenerateButton() {
  const generating = useStore((s) => s.generating)
  const prompt = useStore((s) => s.prompt)
  const connected = useStore((s) => s.connected)
  const mode = useStore((s) => s.mode)
  const sourceImage = useStore((s) => s.sourceImage)
  const serverUrl = useStore((s) => s.serverUrl)
  const useProxy = useStore((s) => s.useProxy)
  const currentPromptId = useStore((s) => s.currentPromptId)
  const episodeShots = useStore((s) => s.episodeShots)
  const { generate } = useComfyUI()
  const [stopping, setStopping] = useState(false)
  const [episodeOpen, setEpisodeOpen] = useState(false)

  const needsSource = mode === 'edit' && !sourceImage
  const canGenerate = prompt.trim() && !generating && connected && !needsSource

  const handleStop = async () => {
    if (stopping) return
    setStopping(true)
    try {
      await stopGeneration(resolveApiBase(serverUrl, useProxy), currentPromptId)
    } finally {
      setTimeout(() => setStopping(false), 2500)
    }
  }

  return (
    <div className="space-y-2">
      <motion.button
        type="button"
        whileHover={generating || canGenerate ? { scale: 1.01 } : {}}
        whileTap={generating || canGenerate ? { scale: 0.985 } : {}}
        onClick={generating ? handleStop : generate}
        disabled={generating ? stopping : !canGenerate}
        title={generating ? 'Stop the current generation' : undefined}
        className={clsx(
          'relative w-full py-3 rounded-xl font-semibold text-sm transition-all duration-200 overflow-hidden group',
          'border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary',
          generating
            ? 'border-red-500/40 shadow-lg shadow-red-500/20'
            : canGenerate
              ? 'border-transparent shadow-lg shadow-accent/25'
              : 'border-border bg-bg-hover',
        )}
        style={{
          background: generating
            ? 'linear-gradient(135deg, #ef4444, #dc2626)'
            : canGenerate
              ? 'linear-gradient(135deg, #6366f1, #8b5cf6)'
              : undefined,
          opacity: generating ? (stopping ? 0.7 : 1) : 1,
        }}
      >
        {generating && (
          <motion.div
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
            animate={{ x: ['-100%', '100%'] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
          />
        )}
        <span
          className={clsx(
            'relative flex items-center justify-center gap-2',
            generating || canGenerate ? 'text-white' : 'text-text-muted',
          )}
        >
          {generating ? (
            stopping ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Stopping…
              </>
            ) : (
              <>
                <Square size={14} fill="currentColor" />
                Generating… tap to stop
              </>
            )
          ) : (
            <>
              <Zap size={16} />
              {mode === 'music'
                ? 'Generate Music'
                : mode === 'sfx'
                  ? 'Generate SFX'
                  : mode === 'sprite'
                    ? 'Generate Sprites'
                    : 'Generate'}
            </>
          )}
        </span>
      </motion.button>

      {!connected && (
        <p className="px-1 text-center text-[10px] text-red-400">
          ComfyUI server not connected
        </p>
      )}

      {mode === 'video' && (
        <button
          type="button"
          onClick={() => setEpisodeOpen(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-bg-card px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          title="Plan and render a multi-shot episode"
        >
          <Clapperboard size={14} />
          Episode shots
          {episodeShots.length > 0 && (
            <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent">
              {episodeShots.filter((s) => s.status === 'done').length}/{episodeShots.length}
            </span>
          )}
        </button>
      )}

      <EpisodePanel
        open={episodeOpen}
        onClose={() => setEpisodeOpen(false)}
        generate={generate}
      />
    </div>
  )
}
