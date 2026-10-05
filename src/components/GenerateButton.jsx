import { motion } from 'framer-motion'
import { Loader2, Zap } from 'lucide-react'
import useStore from '../store/useStore'
import { useComfyUI } from '../hooks/useComfyUI'

export default function GenerateButton() {
  const generating = useStore((s) => s.generating)
  const prompt = useStore((s) => s.prompt)
  const connected = useStore((s) => s.connected)
  const mode = useStore((s) => s.mode)
  const sourceImage = useStore((s) => s.sourceImage)
  const { generate } = useComfyUI()

  const needsSource = mode === 'edit' && !sourceImage
  const canGenerate = prompt.trim() && !generating && connected && !needsSource

  return (
    <motion.button
      whileHover={canGenerate ? { scale: 1.02 } : {}}
      whileTap={canGenerate ? { scale: 0.98 } : {}}
      onClick={generate}
      disabled={!canGenerate}
      className="relative w-full py-3 rounded-xl font-semibold text-sm transition-all duration-300 overflow-hidden group"
      style={{
        background: canGenerate
          ? 'linear-gradient(135deg, #6366f1, #8b5cf6, #a855f7)'
          : undefined,
        opacity: canGenerate ? 1 : 0.5,
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
          <>
            <Loader2 size={16} className="animate-spin" />
            Generating...
          </>
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
