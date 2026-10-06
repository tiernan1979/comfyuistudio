import { useState } from 'react'
import { motion } from 'framer-motion'
import { Loader2, Zap, Square } from 'lucide-react'
import useStore from '../store/useStore'
import { useComfyUI } from '../hooks/useComfyUI'
import { resolveApiBase, stopGeneration } from '../lib/comfyui'

export default function GenerateButton() {
  const generating = useStore((s) => s.generating)
  const prompt = useStore((s) => s.prompt)
  const connected = useStore((s) => s.connected)
  const mode = useStore((s) => s.mode)
  const sourceImage = useStore((s) => s.sourceImage)
  const serverUrl = useStore((s) => s.serverUrl)
  const useProxy = useStore((s) => s.useProxy)
  const currentPromptId = useStore((s) => s.currentPromptId)
  const { generate } = useComfyUI()
  const [stopping, setStopping] = useState(false)

  const needsSource = mode === 'edit' && !sourceImage
  const canGenerate = prompt.trim() && !generating && connected && !needsSource

  // Second click while running = stop. The run settles through the WS
  // execution_interrupted / history path; keep the button live meanwhile.
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
    <motion.button
      whileHover={generating || canGenerate ? { scale: 1.02 } : {}}
      whileTap={generating || canGenerate ? { scale: 0.98 } : {}}
      onClick={generating ? handleStop : generate}
      disabled={generating ? stopping : !canGenerate}
      title={generating ? 'Stop the current generation' : undefined}
      className="relative w-full py-3 rounded-xl font-semibold text-sm transition-all duration-300 overflow-hidden group"
      style={{
        background: generating
          ? 'linear-gradient(135deg, #ef4444, #dc2626)'
          : canGenerate
            ? 'linear-gradient(135deg, #6366f1, #8b5cf6, #a855f7)'
            : undefined,
        opacity: generating ? (stopping ? 0.7 : 1) : canGenerate ? 1 : 0.5,
      }}
    >
      {generating && (
        <motion.div
          className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
          animate={{ x: ['-100%', '100%'] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
        />
      )}
      <span className="relative flex items-center justify-center gap-2 text-white">
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
            {mode === 'music' ? 'Generate Music' : 'Generate'}
          </>
        )}
      </span>
      {!connected && (
        <span className="absolute -bottom-5 left-0 right-0 text-[10px] text-red-400 text-center">
          ComfyUI server not connected
        </span>
      )}
    </motion.button>
  )
}
