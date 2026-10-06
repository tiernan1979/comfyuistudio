import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Download, Maximize2, X, Play, Pause } from 'lucide-react'
import useStore from '../store/useStore'
import { looksLikeVideoModel } from '../lib/comfyui'

export default function VideoPlayer() {
  const outputVideo = useStore((s) => s.outputVideo)
  const videoUnet = useStore((s) => s.models?.video?.unet)
  const generating = useStore((s) => s.generating)
  const progress = useStore((s) => s.progress)
  const [playing, setPlaying] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const videoRef = useRef(null)

  // mp4/webm need <video>; animated webp only renders in <img>.
  const mediaIsMp4 = /\.(mp4|webm|mov)\b/i.test(outputVideo || '')

  const handleDownload = async () => {
    if (!outputVideo) return
    const res = await fetch(outputVideo)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const m = /[?&]filename=([^&]+)/.exec(outputVideo)
    const name = m ? decodeURIComponent(m[1]) : ''
    const ext = (name.match(/\.\w+$/) || ['.mp4'])[0]
    const a = document.createElement('a')
    a.href = url
    a.download = `comfyui-video-${Date.now()}${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }

  const togglePlay = () => {
    if (videoRef.current) {
      if (playing) {
        videoRef.current.pause()
      } else {
        videoRef.current.play()
      }
      setPlaying(!playing)
    }
  }

  return (
    <>
      <div className="relative w-full h-full flex items-center justify-center rounded-2xl overflow-hidden bg-bg-card border border-border">
        <AnimatePresence mode="wait">
          {generating && !outputVideo ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-4 p-8"
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
              <p className="text-sm text-text-secondary">Creating your video...</p>
              <p className="text-xs text-text-muted">This may take a few minutes</p>
            </motion.div>
          ) : outputVideo ? (
            <motion.div
              key="video"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="relative w-full h-full group"
            >
              {mediaIsMp4 ? (
                <video
                  ref={videoRef}
                  src={outputVideo}
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="w-full h-full object-contain"
                />
              ) : (
                <img
                  src={outputVideo}
                  alt="Generated video"
                  className="w-full h-full object-contain"
                />
              )}

              {/* Play/pause overlay (video files only) */}
              {mediaIsMp4 && (
                <div
                  className="absolute inset-0 flex items-center justify-center cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={togglePlay}
                >
                  <div className="w-14 h-14 rounded-full glass flex items-center justify-center bg-black/40">
                    {playing ? <Pause size={24} /> : <Play size={24} className="ml-1" />}
                  </div>
                </div>
              )}

              {/* Download button */}
              <div className="absolute bottom-3 right-3 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={handleDownload}
                  className="p-2 rounded-lg glass hover:bg-white/10 transition-colors"
                  title="Download video"
                >
                  <Download size={16} />
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setFullscreen(true)}
                  className="p-2 rounded-lg glass hover:bg-white/10 transition-colors"
                  title="Fullscreen"
                >
                  <Maximize2 size={16} />
                </motion.button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center gap-3 p-8 text-center"
            >
              <div className="w-16 h-16 rounded-2xl bg-bg-hover flex items-center justify-center">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-muted">
                  <polygon points="5,3 19,12 5,21" />
                </svg>
              </div>
              <p className="text-sm text-text-muted">
                Enter a prompt to generate a video
              </p>
              <p className={`text-xs ${videoUnet && looksLikeVideoModel(videoUnet) ? 'text-text-muted/60' : 'text-warning'}`}>
                {videoUnet && looksLikeVideoModel(videoUnet)
                  ? `Uses ${videoUnet} via ComfyUI`
                  : 'No video model configured — open Settings → Models'}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Fullscreen overlay */}
      <AnimatePresence>
        {fullscreen && outputVideo && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-8"
            onClick={() => setFullscreen(false)}
          >
            <motion.button
              className="absolute top-4 right-4 p-2 rounded-full glass hover:bg-white/10"
              whileHover={{ scale: 1.1 }}
            >
              <X size={20} />
            </motion.button>
            {mediaIsMp4 ? (
              <motion.video
                initial={{ scale: 0.8 }}
                animate={{ scale: 1 }}
                src={outputVideo}
                autoPlay
                loop
                muted
                playsInline
                className="max-w-full max-h-full object-contain rounded-lg"
              />
            ) : (
              <motion.img
                initial={{ scale: 0.8 }}
                animate={{ scale: 1 }}
                src={outputVideo}
                alt="Generated video"
                className="max-w-full max-h-full object-contain rounded-lg"
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
