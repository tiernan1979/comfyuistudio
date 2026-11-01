import { Loader2 } from 'lucide-react'
import clsx from 'clsx'

// Suspense fallback for code-split panels/modals. `overlay` covers the
// viewport (modals); otherwise it fills whichever flex parent holds it.
export default function PanelLoader({ label = 'Loading…', overlay = false }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={clsx(
        'flex items-center justify-center gap-2 text-xs text-text-muted',
        overlay ? 'fixed inset-0 z-50 bg-black/50 backdrop-blur-sm' : 'h-full min-h-[180px] w-full',
      )}
    >
      <Loader2 size={16} className="animate-spin text-accent" />
      {label}
    </div>
  )
}
