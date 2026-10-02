import { useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Upload, X, ImagePlus } from 'lucide-react'
import useStore from '../store/useStore'

export default function ImageUpload() {
  const sourceImage = useStore((s) => s.sourceImage)
  const setSourceImage = useStore((s) => s.setSourceImage)
  const generating = useStore((s) => s.generating)
  const fileRef = useRef(null)
  const [dragOver, setDragOver] = useState(false)

  const acceptFile = (file) => {
    if (!file || !file.type.startsWith('image/')) return
    if (sourceImage?.preview) URL.revokeObjectURL(sourceImage.preview)
    setSourceImage({
      file,
      preview: URL.createObjectURL(file),
      name: file.name,
    })
  }

  const clear = () => {
    if (sourceImage?.preview) URL.revokeObjectURL(sourceImage.preview)
    setSourceImage(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="space-y-1.5">
      <label className="text-xs text-text-muted block">Source image</label>
      <AnimatePresence mode="wait">
        {sourceImage ? (
          <motion.div
            key="preview"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="relative rounded-xl overflow-hidden border border-border group"
          >
            <img
              src={sourceImage.preview}
              alt="Source"
              className="w-full max-h-44 object-cover"
            />
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
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              if (!generating) acceptFile(e.dataTransfer.files?.[0])
            }}
            className={`rounded-xl border-2 border-dashed px-4 py-6 flex flex-col items-center gap-2 text-center transition-all cursor-pointer ${
              dragOver
                ? 'border-accent bg-accent/10'
                : 'border-border hover:border-accent/50 hover:bg-bg-card'
            } ${generating ? 'opacity-50 cursor-default' : ''}`}
          >
            {dragOver ? (
              <Upload size={22} className="text-accent" />
            ) : (
              <ImagePlus size={22} className="text-text-muted" />
            )}
            <p className="text-xs text-text-secondary">
              Drop an image here or <span className="text-accent font-medium">browse</span>
            </p>
            <p className="text-[10px] text-text-muted">PNG or JPG, uploaded to ComfyUI on generate</p>
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
    </div>
  )
}
