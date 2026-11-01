import { useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Upload, X, ImagePlus, Loader2, Brush } from 'lucide-react'
import useStore from '../store/useStore'
import { fileFromDrop } from '../lib/dropImage'
import MaskEditor from './MaskEditor'

export default function ImageUpload() {
  const sourceImage = useStore((s) => s.sourceImage)
  const setSourceImage = useStore((s) => s.setSourceImage)
  const generating = useStore((s) => s.generating)
  const fileRef = useRef(null)
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [maskOpen, setMaskOpen] = useState(false)
  // dragenter/leave fire for every child the pointer crosses — count them so
  // the highlight doesn't flicker (and only clears when we truly leave).
  const dragDepth = useRef(0)

  const acceptFile = (file) => {
    if (!file || !(file.type ? file.type.startsWith('image/') : true)) return
    if (sourceImage?.preview) URL.revokeObjectURL(sourceImage.preview)
    setSourceImage({ file, preview: URL.createObjectURL(file), name: file.name })
  }

  const clear = () => {
    if (sourceImage?.preview) URL.revokeObjectURL(sourceImage.preview)
    setSourceImage(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const onDrop = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current = 0
    setDragOver(false)
    if (generating || busy) return
    try {
      setBusy(true)
      const file = await fileFromDrop(e)
      if (file) acceptFile(file)
    } catch (err) {
      console.error('image drop failed:', err)
      useStore.getState().setError(`Could not use that dropped image — ${err.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="space-y-1.5"
      onDragEnter={(e) => {
        e.preventDefault()
        dragDepth.current += 1
        if (!generating) setDragOver(true)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(e) => {
        e.preventDefault()
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragOver(false)
      }}
      onDrop={onDrop}
    >
      <label className="text-xs text-text-muted block">Source image</label>
      <AnimatePresence mode="wait">
        {sourceImage ? (
          <motion.div
            key="preview"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className={`relative rounded-xl overflow-hidden border group ${
              dragOver ? 'border-accent ring-2 ring-accent/40' : 'border-border'
            }`}
          >
            <img src={sourceImage.preview} alt="Source" className="w-full max-h-44 object-cover" />
            {dragOver && (
              <div className="absolute inset-0 bg-accent/20 backdrop-blur-[1px] flex items-center justify-center gap-2 text-xs font-medium text-white">
                <Upload size={16} /> Drop to replace
              </div>
            )}
            {sourceImage.mask && (
              <div className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-black/65 px-2 py-1 text-[10px] font-medium text-white backdrop-blur">
                <Brush size={11} /> Masked
              </div>
            )}
            {!generating && (
              <button
                type="button"
                onClick={() => setMaskOpen(true)}
                className="absolute right-2 top-2 rounded-lg bg-black/55 px-2 py-1.5 text-[10px] font-medium text-white/90 backdrop-blur transition-colors hover:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                title={sourceImage.mask ? 'Edit mask' : 'Paint a mask'}
              >
                {sourceImage.mask ? 'Edit mask' : 'Mask'}
              </button>
            )}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pt-6 pb-2 flex items-center justify-between">
              <span className="text-[10px] text-white/80 truncate max-w-[180px]">
                {sourceImage.name}
              </span>
              {!generating && (
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={clear}
                  className="p-1.5 rounded-lg bg-black/50 hover:bg-red-500/60 transition-colors"
                  title="Remove image"
                >
                  <X size={12} />
                </motion.button>
              )}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="dropzone"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !generating && fileRef.current?.click()}
            className={`rounded-xl border-2 border-dashed px-4 py-6 flex flex-col items-center gap-2 text-center transition-all cursor-pointer ${
              dragOver
                ? 'border-accent bg-accent/10'
                : 'border-border hover:border-accent/50 hover:bg-bg-card'
            } ${generating ? 'opacity-50 cursor-default' : ''}`}
          >
            {busy ? (
              <Loader2 size={22} className="text-accent animate-spin" />
            ) : dragOver ? (
              <Upload size={22} className="text-accent" />
            ) : (
              <ImagePlus size={22} className="text-text-muted" />
            )}
            <p className="text-xs text-text-secondary">
              Drop an image here or <span className="text-accent font-medium">browse</span>
            </p>
            <p className="text-[10px] text-text-muted">
              PNG or JPG — drop a file, or drag one in from your history tiles
            </p>
          </motion.div>
        )}
      </AnimatePresence>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => acceptFile(e.target.files?.[0])}
      />
      <MaskEditor
        open={maskOpen && !!sourceImage?.preview}
        image={sourceImage?.preview}
        initialMask={sourceImage?.mask || ''}
        onClose={() => setMaskOpen(false)}
        onApply={(mask) => {
          if (sourceImage) setSourceImage({ ...sourceImage, mask: mask || undefined })
          setMaskOpen(false)
        }}
      />
    </div>
  )
}
