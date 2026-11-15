import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Download, Maximize2, X, Copy, Check, ImagePlus, Clapperboard, Grid3X3 } from 'lucide-react'
import useStore from '../store/useStore'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { fileFromDrop } from '../lib/dropImage'
import { downloadFileAs } from '../lib/comfyui'

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

// Ground tiles: a plain full-frame downscale keeps the generated image's
// outer border, which turns into a faint grid when repeated. Crop the middle
// 80% first (that border is where vignettes/edge artifacts live), downscale
// through an intermediate canvas, then snap to a 32×32 PNG.
function toGroundTile(blob, size = 32) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(blob)
    img.onload = () => {
      try {
        const side = Math.min(img.naturalWidth, img.naturalHeight)
        const crop = Math.max(1, Math.round(side * 0.8))
        const sx = Math.round((img.naturalWidth - crop) / 2)
        const sy = Math.round((img.naturalHeight - crop) / 2)

        const mid = document.createElement('canvas')
        mid.width = 256
        mid.height = 256
        const mctx = mid.getContext('2d')
        mctx.imageSmoothingEnabled = true
        mctx.imageSmoothingQuality = 'high'
        mctx.drawImage(img, sx, sy, crop, crop, 0, 0, 256, 256)

        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(mid, 0, 0, 256, 256, 0, 0, size, size)

        URL.revokeObjectURL(url)
        resolve(canvas.toDataURL('image/png'))
      } catch (err) {
        URL.revokeObjectURL(url)
        reject(err)
      }
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
  const batchImages = useStore((s) => s.batchImages)
  const setOutputImage = useStore((s) => s.setOutputImage)
  const generating = useStore((s) => s.generating)
  const progress = useStore((s) => s.progress)
  const setError = useStore((s) => s.setError)
  const mode = useStore((s) => s.mode)
  const sourceImage = useStore((s) => s.sourceImage)
  const setSourceImage = useStore((s) => s.setSourceImage)
  const setMode = useStore((s) => s.setMode)
  const setVideoSourceImage = useStore((s) => s.setVideoSourceImage)
  const videoTitle = useStore((s) => s.titles?.video)
  const [fullscreen, setFullscreen] = useState(false)
  const [copied, setCopied] = useState(false)
  // 32×32 ground tile preview/download (see toGroundTile above).
  const [tileOpen, setTileOpen] = useState(false)
  const [tileUrl, setTileUrl] = useState('')
  // Edit mode: the whole canvas doubles as a drop target for the source image.
  const [dragOver, setDragOver] = useState(false)
  const dragDepth = useRef(0)
  const fullscreenRef = useRef(null)
  const tileRef = useRef(null)
  useFocusTrap(fullscreenRef, !!(fullscreen && outputImage))
  useFocusTrap(tileRef, tileOpen)

  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e) => {
      if (e.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])

  useEffect(() => {
    if (!tileOpen) return
    const onKey = (e) => {
      if (e.key === 'Escape') setTileOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tileOpen])

  const onDropImage = async (e) => {
    if (mode !== 'edit') return
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current = 0
    setDragOver(false)
    if (generating) return
    try {
      const file = await fileFromDrop(e)
      if (!file) return
      if (sourceImage?.preview) URL.revokeObjectURL(sourceImage.preview)
      setSourceImage({ file, preview: URL.createObjectURL(file), name: file.name })
    } catch (err) {
      setError(`Could not use that dropped image — ${err.message}`)
    }
  }

  const handleDownload = async () => {
    if (!outputImage) return
    await downloadFileAs(outputImage, `comfyui-${Date.now()}.webp`)
  }

  const handleGroundTile = async () => {
    if (!outputImage) return
    setTileOpen(true)
    setTileUrl('')
    try {
      const res = await fetch(outputImage)
      if (!res.ok) throw new Error(`could not fetch the image (HTTP ${res.status})`)
      setTileUrl(await toGroundTile(await res.blob()))
    } catch (err) {
      setTileOpen(false)
      setError(`Could not build the 32×32 tile: ${err.message}`)
    }
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
      <div
        className={`relative w-full h-full flex items-center justify-center rounded-2xl overflow-hidden bg-bg-card border transition-colors ${
          mode === 'edit' && dragOver ? 'border-accent ring-2 ring-accent/40' : 'border-border'
        }`}
        onDragEnter={(e) => {
          if (mode !== 'edit') return
          e.preventDefault()
          dragDepth.current += 1
          if (!generating) setDragOver(true)
        }}
        onDragOver={(e) => {
          if (mode !== 'edit') return
          e.preventDefault()
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
        }}
        onDragLeave={(e) => {
          if (mode !== 'edit') return
          e.preventDefault()
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (dragDepth.current === 0) setDragOver(false)
        }}
        onDrop={onDropImage}
      >
        {mode === 'edit' && dragOver && (
          <div className="absolute inset-0 z-10 pointer-events-none flex flex-col items-center justify-center gap-2 bg-accent/15 backdrop-blur-[1px] text-sm font-medium text-white">
            <ImagePlus size={26} className="text-accent" />
            Drop to use as the source image
          </div>
        )}
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
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-generated-image', outputImage)
                  e.dataTransfer.setData('text/plain', outputImage)
                }}
                className="w-full h-full object-contain cursor-grab active:cursor-grabbing"
              />

              {/* Batched render: pick which frame fills the canvas. */}
              {batchImages.length > 1 && (
                <div className="absolute left-3 top-3 flex max-w-[75%] gap-1.5 overflow-x-auto rounded-xl border border-white/10 bg-black/55 p-1.5 backdrop-blur no-scrollbar">
                  {batchImages.map((url, i) => (
                    <button
                      key={url}
                      type="button"
                      onClick={() => setOutputImage(url)}
                      aria-label={`Show image ${i + 1} of ${batchImages.length}`}
                      aria-pressed={url === outputImage}
                      className={`h-11 w-11 shrink-0 overflow-hidden rounded-md border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/80 ${
                        url === outputImage
                          ? 'border-accent ring-1 ring-accent/60'
                          : 'border-white/15 opacity-75 hover:opacity-100'
                      }`}
                    >
                      <img src={url} alt="" className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              )}

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
                    onClick={() => {
                      setVideoSourceImage({
                        url: outputImage,
                        preview: outputImage,
                        name: videoTitle || 'first-frame',
                      })
                      setMode('video')
                    }}
                    disabled={generating}
                    className="p-2 rounded-lg glass hover:bg-white/10 transition-colors disabled:opacity-40"
                    title={generating ? 'Wait for the current render to finish' : 'Animate this still (image-to-video)'}
                    aria-label="Animate this still"
                  >
                    <Clapperboard size={16} />
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={handleGroundTile}
                    className="p-2 rounded-lg glass hover:bg-white/10 transition-colors"
                    title="Make a 32×32 tiling ground texture"
                    aria-label="Make a 32×32 tiling ground texture"
                  >
                    <Grid3X3 size={16} />
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
            ref={fullscreenRef}
            role="dialog"
            aria-modal="true"
            aria-label="Generated image fullscreen"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-8"
            onClick={() => setFullscreen(false)}
          >
            <motion.button
              type="button"
              onClick={() => setFullscreen(false)}
              aria-label="Close fullscreen"
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
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/x-generated-image', outputImage)
                e.dataTransfer.setData('text/plain', outputImage)
              }}
              className="max-w-full max-h-full object-contain rounded-lg cursor-grab active:cursor-grabbing"
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 32×32 ground tile preview + download */}
      <AnimatePresence>
        {tileOpen && (
          <motion.div
            ref={tileRef}
            role="dialog"
            aria-modal="true"
            aria-label="32×32 ground tile preview"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-6"
            onClick={() => setTileOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-sm rounded-2xl border border-border bg-bg-card p-5 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-text-primary">32×32 ground tile</h3>
                  <p className="mt-1 text-xs text-text-muted">
                    Center-cropped 80% and downscaled, so the edges repeat without a grid.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setTileOpen(false)}
                  className="rounded-lg p-1.5 text-text-muted hover:bg-white/10 hover:text-text-primary"
                  aria-label="Close ground tile preview"
                >
                  <X size={18} />
                </button>
              </div>
              <div
                className="mx-auto mt-4 h-64 w-64 overflow-hidden rounded-xl border border-border bg-black/20"
                style={
                  tileUrl
                    ? {
                        backgroundImage: `url(${tileUrl})`,
                        backgroundSize: '32px 32px',
                        backgroundRepeat: 'repeat',
                      }
                    : undefined
                }
              >
                {!tileUrl && (
                  <div className="flex h-full items-center justify-center text-xs text-text-muted">
                    Building tile…
                  </div>
                )}
              </div>
              <div className="mt-4 flex items-center justify-between gap-3">
                <span className="text-[11px] text-text-muted">Preview repeated 8×8</span>
                {tileUrl ? (
                  <a
                    href={tileUrl}
                    download="ground-tile-32.png"
                    className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent/90"
                  >
                    Download 32×32 PNG
                  </a>
                ) : (
                  <span className="rounded-lg bg-white/5 px-3 py-2 text-xs font-medium text-text-muted">
                    Download 32×32 PNG
                  </span>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
