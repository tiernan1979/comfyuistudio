import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Brush, Eraser, RotateCcw, Trash2, Undo2, X, Check, FlipHorizontal2 } from 'lucide-react'
import clsx from 'clsx'
import { useFocusTrap } from '../hooks/useFocusTrap'

// Mask editor for Edit mode. Paints a transparent white mask over the source
// image; on Apply it exports a black-background, feathered PNG (white = the
// region Qwen-Image-Edit should repaint). Feathering happens at export so the
// inpainting boundary doesn't show a hard seam.
const MAX_EDGE = 1280
const MAX_UNDO = 12

export default function MaskEditor({ open, image, initialMask, onClose, onApply }) {
  const dialogRef = useRef(null)
  const canvasRef = useRef(null)
  const maskRef = useRef(null)
  const imgRef = useRef(null)
  const tintRef = useRef(null)
  const strokeRef = useRef(null)
  const undoRef = useRef([])
  const scaleRef = useRef(1)
  const [size, setSize] = useState(6)
  const [tool, setTool] = useState('brush')
  const [ready, setReady] = useState(false)
  const [cursor, setCursor] = useState(null)
  const [canUndo, setCanUndo] = useState(false)

  useFocusTrap(dialogRef, open)

  const render = useCallback(() => {
    const canvas = canvasRef.current
    const mask = maskRef.current
    const img = imgRef.current
    if (!canvas || !mask || !img) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

    // Tint the painted (alpha) region so it reads clearly on any photo.
    if (!tintRef.current) tintRef.current = document.createElement('canvas')
    const tint = tintRef.current
    if (tint.width !== canvas.width || tint.height !== canvas.height) {
      tint.width = canvas.width
      tint.height = canvas.height
    }
    const tctx = tint.getContext('2d')
    tctx.clearRect(0, 0, tint.width, tint.height)
    tctx.drawImage(mask, 0, 0)
    tctx.globalCompositeOperation = 'source-in'
    tctx.fillStyle = 'rgba(244, 63, 94, 0.55)'
    tctx.fillRect(0, 0, tint.width, tint.height)
    tctx.globalCompositeOperation = 'source-over'
    ctx.drawImage(tint, 0, 0)
  }, [])

  // Load the source image and restore an existing mask, scaled to the same
  // working resolution so editing is lossless enough for inpainting.
  useEffect(() => {
    if (!open || !image) return
    let dead = false
    setReady(false)
    setCanUndo(false)
    undoRef.current = []
    const img = new Image()
    img.onload = () => {
      if (dead) return
      const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
      const w = Math.max(8, Math.round(img.naturalWidth * scale))
      const h = Math.max(8, Math.round(img.naturalHeight * scale))
      scaleRef.current = scale
      const canvas = canvasRef.current
      canvas.width = w
      canvas.height = h
      imgRef.current = img

      const mask = document.createElement('canvas')
      mask.width = w
      mask.height = h
      maskRef.current = mask

      const finish = () => {
        render()
        setReady(true)
      }
      if (initialMask) {
        const m = new Image()
        m.onload = () => {
          if (dead) return
          const mctx = mask.getContext('2d')
          mctx.drawImage(m, 0, 0, w, h)
          // Existing exports have an opaque black background — convert to
          // alpha so tinting and erasing behave like a fresh mask.
          const data = mctx.getImageData(0, 0, w, h)
          for (let i = 0; i < data.data.length; i += 4) {
            data.data[i + 3] = data.data[i]
            data.data[i] = 255
            data.data[i + 1] = 255
            data.data[i + 2] = 255
          }
          mctx.putImageData(data, 0, 0)
          finish()
        }
        m.onerror = finish
        m.src = initialMask
      } else {
        finish()
      }
    }
    img.onerror = () => {
      if (!dead) setReady(false)
    }
    img.src = image
    return () => {
      dead = true
    }
  }, [open, image, initialMask, render])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const snapshot = () => {
    const mask = maskRef.current
    if (!mask) return
    undoRef.current = [...undoRef.current, mask.getContext('2d').getImageData(0, 0, mask.width, mask.height)]
    if (undoRef.current.length > MAX_UNDO) undoRef.current.shift()
    setCanUndo(true)
  }

  const undo = () => {
    const mask = maskRef.current
    const prev = undoRef.current.pop()
    if (!mask || !prev) return
    mask.getContext('2d').putImageData(prev, 0, 0)
    setCanUndo(undoRef.current.length > 0)
    render()
  }

  const point = (e) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
      css: { x: e.clientX - rect.left, y: e.clientY - rect.top },
    }
  }

  const paint = (p, from) => {
    const mask = maskRef.current
    if (!mask) return
    const ctx = mask.getContext('2d')
    const radius = (size / 100) * mask.width
    ctx.globalCompositeOperation = tool === 'erase' ? 'destination-out' : 'source-over'
    ctx.strokeStyle = '#fff'
    ctx.fillStyle = '#fff'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = radius * 2
    if (from) {
      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      ctx.lineTo(p.x, p.y)
      ctx.stroke()
    } else {
      ctx.beginPath()
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2)
      ctx.fill()
    }
    render()
  }

  const onPointerDown = (e) => {
    if (!ready) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    snapshot()
    const p = point(e)
    strokeRef.current = { last: p }
    paint(p, null)
  }

  const onPointerMove = (e) => {
    const p = point(e)
    setCursor({ x: p.css.x, y: p.css.y })
    if (!strokeRef.current) return
    paint(p, strokeRef.current.last)
    strokeRef.current.last = p
  }

  const endStroke = () => {
    strokeRef.current = null
  }

  const invert = () => {
    const mask = maskRef.current
    if (!mask) return
    snapshot()
    const ctx = mask.getContext('2d')
    const data = ctx.getImageData(0, 0, mask.width, mask.height)
    for (let i = 0; i < data.data.length; i += 4) {
      data.data[i + 3] = 255 - data.data[i]
      data.data[i] = 255
      data.data[i + 1] = 255
      data.data[i + 2] = 255
    }
    ctx.putImageData(data, 0, 0)
    render()
  }

  const clear = () => {
    const mask = maskRef.current
    if (!mask) return
    snapshot()
    mask.getContext('2d').clearRect(0, 0, mask.width, mask.height)
    render()
  }

  const apply = () => {
    const mask = maskRef.current
    if (!mask) return
    // Any painted pixel? Skip exporting an empty mask (plain edit instead).
    const px = mask.getContext('2d').getImageData(0, 0, mask.width, mask.height).data
    let painted = false
    for (let i = 3; i < px.length; i += 4) {
      if (px[i] > 8) {
        painted = true
        break
      }
    }
    if (!painted) {
      onApply('')
      return
    }
    const out = document.createElement('canvas')
    out.width = mask.width
    out.height = mask.height
    const ctx = out.getContext('2d')
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, out.width, out.height)
    // Blur in working pixels, scaled so the feather looks the same at any
    // resolution (≈10 px on a 1024-wide image).
    ctx.filter = `blur(${Math.max(2, Math.round(out.width / 100))}px)`
    ctx.drawImage(mask, 0, 0)
    onApply(out.toDataURL('image/png'))
  }

  const cursorSize = useMemo(() => {
    const canvas = canvasRef.current
    const rect = canvas?.getBoundingClientRect()
    return rect ? (size / 100) * rect.width : 0
  }, [size, ready, cursor])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-6">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Mask editor"
        className="relative flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-bg-secondary shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Paint the area to change</h2>
            <p className="text-[11px] text-text-muted">
              Everything outside the painted region stays untouched.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close mask editor"
            className="rounded-lg p-2 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
          <div className="flex rounded-lg border border-border bg-bg-card p-0.5">
            <ToolButton active={tool === 'brush'} onClick={() => setTool('brush')} label="Brush">
              <Brush size={14} /> Brush
            </ToolButton>
            <ToolButton active={tool === 'erase'} onClick={() => setTool('erase')} label="Eraser">
              <Eraser size={14} /> Erase
            </ToolButton>
          </div>

          <label className="flex items-center gap-2 text-[11px] text-text-secondary">
            <span className="whitespace-nowrap">Brush size</span>
            <input
              type="range"
              min={1}
              max={20}
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
              className="w-24 accent-accent"
              aria-label="Brush size"
            />
            <span className="w-7 font-mono text-[10px] text-text-muted">{size}%</span>
          </label>

          <div className="ml-auto flex items-center gap-1">
            <IconButton onClick={undo} disabled={!canUndo} label="Undo stroke">
              <Undo2 size={14} />
            </IconButton>
            <IconButton onClick={invert} label="Invert mask">
              <FlipHorizontal2 size={14} />
            </IconButton>
            <IconButton onClick={clear} label="Clear mask">
              <Trash2 size={14} />
            </IconButton>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[#0b0b10] p-3 sm:p-5">
          <div
            className="relative inline-block max-w-full"
            onPointerLeave={() => setCursor(null)}
          >
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endStroke}
              onPointerCancel={endStroke}
              className={clsx(
                'block max-h-[62vh] max-w-full touch-none select-none rounded-lg border border-border/70',
                ready ? 'cursor-none' : 'opacity-60'
              )}
            />
            {cursor && ready && (
              <span
                className="pointer-events-none absolute rounded-full border-2 border-white/90 mix-blend-difference"
                style={{
                  width: cursorSize,
                  height: cursorSize,
                  left: cursor.x,
                  top: cursor.y,
                  transform: 'translate(-50%, -50%)',
                }}
              />
            )}
            {!ready && (
              <span className="absolute inset-0 flex items-center justify-center text-xs text-text-muted">
                Loading image…
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
          <p className="text-[10px] text-text-muted">
            Use a soft edge — very large masks can change more than you expect.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-3.5 py-2 text-xs text-text-secondary transition-colors hover:bg-bg-card hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={apply}
              disabled={!ready}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-secondary"
            >
              <Check size={14} /> Use mask
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

function ToolButton({ active, onClick, children, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      className={clsx(
        'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70',
        active ? 'bg-accent text-white' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
      )}
    >
      {children}
    </button>
  )
}

function IconButton({ onClick, disabled, label, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
    >
      {children}
    </button>
  )
}
