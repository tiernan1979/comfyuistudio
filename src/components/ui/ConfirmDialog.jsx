import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'
import { useFocusTrap } from '../../hooks/useFocusTrap'

// In-app replacement for window.confirm(). Portalled to <body> so it still
// covers the mobile sidebar drawer (a transformed ancestor would otherwise
// trap a fixed-position child inside the drawer).
export default function ConfirmDialog({
  open,
  title,
  message,
  note,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}) {
  const ref = useRef(null)
  useFocusTrap(ref, open)

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={onCancel}
        >
          <motion.div
            ref={ref}
            role="alertdialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            className="w-full max-w-sm rounded-2xl border border-border bg-bg-secondary p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-danger/15">
                <AlertTriangle size={17} className="text-danger" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
                {message && <p className="mt-1 text-xs leading-relaxed text-text-secondary">{message}</p>}
              </div>
            </div>
            {note && (
              <p className="mb-4 rounded-lg border border-border bg-bg-card px-3 py-2 text-[11px] leading-relaxed text-text-muted">
                {note}
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className="rounded-lg bg-danger px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-danger/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-secondary"
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
