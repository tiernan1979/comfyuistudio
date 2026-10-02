import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Download, Maximize2, X, Copy, Check } from 'lucide-react'
import useStore from '../store/useStore'

// ClipboardItem only reliably accepts image/png — ComfyUI outputs webp —
// and canvas re-encode gives us a guaranteed PNG either way.
function toPng(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(blob)
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      canvas.getContext('2d').drawImage(img, 0, 0)
      URL.revokeObjectURL(url)
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('PNG conversion failed'))),
        'image/png'
      )
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('could not read the image'))
    }
    img.src = url
  })
}

// Clipboard API is unavailable over plain HTTP (e.g. http://192.168.x.x:5555).
// Selecting the <img> and execCommand('copy') still copies the image itself
// in Chromium and Firefox.
function copyViaSelection(blob) {
  return new Promise((resolve, reject) => {
    const img = document.createElement('img')
    const url = URL.createObjectURL(blob)
    img.src = url
    img.style.position = 'fixed'
    img.style.left = '-9999px'
    document.body.appendChild(img)
    const select = () => {
      const range = document.createRange()
      range.selectNode(img)
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
    }
    let ok = false
    try {
      select()
      ok = document.execCommand('copy')
    } catch { /* rejected */ }
    window.getSelection()?.removeAllRanges()
    document.body.removeChild(img)
    URL.revokeObjectURL(url)
    if (ok) resolve()
    else reject(new Error('browser refused the copy'))
  })
}

export default function ImageViewer() {
  const outputImage = useStore((s) => s.outputImage)
  const generating = useStore((s) => s.generating)
  const progress = useStore((s) => s.progress)
  const setError = useStore((s) => s.setError)
  const [fullscreen, setFullscreen] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleDownload = async () => {
    if (!outputImage) return
    const res = await fetch(outputImage)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `comfyui-${Date.now()}.webp`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleCopy = async () => {
    if (!outputImage) return
    setError(null)
    try {
      const res = await fetch(outputImage)
      if (!res.ok) throw new Error(`could not fetch the image (HTTP ${res.status})`)
      const png = await toPng(await res.blob())

      if (window.isSecureContext && navigator.clipboard?.write) {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
        } catch {
          // Permissions or ClipboardItem rejected — try the selection fallback
          await copyViaSelection(png)
        }
      } else {
        await copyViaSelection(png)
      }

      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      setError(`Copy failed: ${err.message}. Use Download instead, or right-click the image → Copy image.`)
    }
  }

  return (
    <>
      <div className="relative w-full h-full flex items-center justify-center rounded-2xl overflow-hidden bg-bg-card border border-border">
        <AnimatePresence mode="wait">
          {generating && !outputImage ? (
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
              <p className="text-sm text-text-secondary">Creating your image...</p>
            </motion.div>
          ) : outputImage ? (
            <motion.div
              key="image"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="relative w-full h-full group"
            >
              <img
                src={outputImage}
                alt="Generated"
                className="w-full h-full object-contain"
              />

              {/* Overlay controls */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <div className="absolute bottom-3 right-3 flex gap-2">
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={handleCopy}
                    className="p-2 rounded-lg glass hover:bg-white/10 transition-colors"
                    title="Copy to clipboard"
                  >
                    {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={handleDownload}
                    className="p-2 rounded-lg glass hover:bg-white/10 transition-colors"
                    title="Download"
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
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="m21 15-5-5L5 21" />
                </svg>
              </div>
              <p className="text-sm text-text-muted">
                Enter a prompt and click Generate
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Fullscreen overlay */}
      <AnimatePresence>
        {fullscreen && outputImage && (
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
            <motion.img
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              src={outputImage}
              alt="Generated fullscreen"
              className="max-w-full max-h-full object-contain rounded-lg"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
