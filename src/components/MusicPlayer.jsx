import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Download, Music, Scissors, Loader2, Piano } from 'lucide-react'
import useStore from '../store/useStore'
import { looksLikeMusicModel } from '../lib/comfyui'

// Extract the real output filename from a ComfyUI /view URL.
function filenameFromViewUrl(url) {
  try {
    const u = new URL(url, window.location.origin)
    const fn = u.searchParams.get('filename')
    if (fn) return fn
  } catch {
    /* fall through */
  }
  return `comfyui-music-${Date.now()}`
}

function formatElapsed(s) {
  if (!Number.isFinite(s) || s < 0) s = 0
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`
}

export default function MusicPlayer() {
  const outputAudio = useStore((s) => s.outputAudio)
  const musicUnet = useStore((s) => s.models?.music?.unet)
  const generating = useStore((s) => s.generating)
  const progress = useStore((s) => s.progress)
  const progressLabel = useStore((s) => s.progressLabel)
  const elapsedTime = useStore((s) => s.elapsedTime)
  const setShowMusicEditor = useStore((s) => s.setShowMusicEditor)
  const [loading, setLoading] = useState(false)

  // Stop the "Loading track..." state once the element can play
  const audioRef = useRef(null)
  useEffect(() => {
    setLoading(false)
  }, [outputAudio])

  const handleDownload = async () => {
    if (!outputAudio) return
    try {
      const res = await fetch(outputAudio)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filenameFromViewUrl(outputAudio)
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('download failed', err)
    }
  }

  return (
    <div className="relative w-full h-full flex flex-col rounded-2xl overflow-hidden bg-bg-card border border-border">
      <AnimatePresence mode="wait">
        {generating && !outputAudio ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 flex flex-col items-center justify-center gap-4 p-8"
          >
            <div className="relative w-20 h-20">
              <div className="absolute inset-0 rounded-full border-2 border-accent/20" />
              <div className="absolute inset-0 rounded-full border-2 border-accent border-t-transparent animate-spin" />
              {progress && (
                <span className="absolute inset-0 flex items-center justify-center text-xs text-accent font-mono">
                  {progress.max > 0 ? Math.round((progress.step / progress.max) * 100) : 0}%
                </span>
              )}
            </div>
            <p className="text-sm text-text-secondary">
              {progressLabel ? `${progressLabel}…` : 'Composing your track...'}
            </p>
            <p className="text-xs text-text-muted">
              {progressLabel
                ? `${formatElapsed(elapsedTime)} elapsed — decoding is the slow part`
                : 'Music generation is typically faster than video'}
            </p>
          </motion.div>
        ) : outputAudio ? (
          <motion.div
            key="player"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 flex flex-col items-center justify-center gap-5 p-6"
          >
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-purple-500/30 to-accent/25 flex items-center justify-center shadow-lg">
              <Piano size={34} className="text-accent" />
            </div>
            <p className="text-sm text-text-secondary text-center max-w-md">
              Your track is ready — play it below, then open the Studio to edit
              every part of the arrangement.
            </p>

            <audio
              ref={audioRef}
              src={outputAudio}
              controls
              preload="metadata"
              className="w-full max-w-xl"
              onLoadStart={() => setLoading(true)}
              onCanPlay={() => setLoading(false)}
            />
            {loading && <Loader2 size={14} className="animate-spin text-text-muted" />}

            <div className="flex items-center gap-2">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setShowMusicEditor(true)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-accent hover:bg-accent-hover text-white shadow-lg shadow-accent/25 transition-colors"
              >
                <Scissors size={15} />
                Open in Studio
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleDownload}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-bg-hover hover:bg-white/10 text-text-secondary transition-colors"
              >
                <Download size={15} />
                Download
              </motion.button>
            </div>

            <p className="text-[11px] text-text-muted font-mono text-center break-all max-w-xl">
              {filenameFromViewUrl(outputAudio)}
            </p>
          </motion.div>
        ) : (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center"
          >
            <div className="w-16 h-16 rounded-2xl bg-bg-hover flex items-center justify-center">
              <Music size={30} className="text-text-muted" />
            </div>
            <p className="text-sm text-text-muted">
              Describe a song and generate music
            </p>
            <p className={`text-[11px] max-w-sm leading-relaxed ${musicUnet && looksLikeMusicModel(musicUnet) ? 'text-text-muted/70' : 'text-warning'}`}>
              {musicUnet && looksLikeMusicModel(musicUnet)
                ? `Uses ${musicUnet} via ComfyUI`
                : 'No music model configured — open Settings → Music Models'}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
