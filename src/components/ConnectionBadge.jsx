import { motion } from 'framer-motion'
import { Unplug, Wifi, WifiOff } from 'lucide-react'
import useStore from '../store/useStore'
import { useUnloadModels } from '../hooks/useUnloadModels'

export default function ConnectionBadge() {
  const connected = useStore((s) => s.connected)
  const modelsUnloaded = useStore((s) => s.modelsUnloaded)
  const lastGenAt = useStore((s) => s.lastGenAt)
  const generating = useStore((s) => s.generating)
  const queueRemaining = useStore((s) => s.queueRemaining)
  const { unload, busy } = useUnloadModels()

  // Only show the chip while weights are resident. Once ComfyUI frees them
  // (idle timer, API watchdog, another browser) it disappears instead of
  // lingering until a reload.
  const modelsLoaded = !modelsUnloaded && lastGenAt > 0
  const canUnload =
    connected && modelsLoaded && !generating && queueRemaining === 0

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex w-fit items-center gap-2 whitespace-nowrap rounded-full glass px-3 py-1.5 text-xs"
    >
      {connected ? (
        <>
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75 animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
          </span>
          <Wifi size={12} className="shrink-0 text-green-400" />
          <span className="font-medium text-green-400">Connected</span>
          {modelsLoaded && (
            <span
              className="shrink-0 rounded bg-bg-hover px-1.5 py-0.5 text-[10px] font-medium text-text-secondary"
              title="Models are loaded in VRAM"
            >
              models loaded
            </span>
          )}
          <button
            type="button"
            onClick={unload}
            disabled={!canUnload || busy}
            className="shrink-0 rounded p-1 text-text-muted transition-colors hover:bg-warning/15 hover:text-warning disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning/60"
            title={
              !connected
                ? 'Not connected to ComfyUI'
                : modelsUnloaded
                  ? 'Models are already unloaded'
                  : !modelsLoaded
                    ? 'No models loaded yet'
                    : generating || queueRemaining > 0
                      ? 'Cannot unload while a render is running or queued'
                      : 'Unload models from VRAM now'
            }
            aria-label="Unload models from VRAM"
          >
            <Unplug size={12} className={busy ? 'animate-pulse' : ''} />
          </button>
        </>
      ) : (
        <>
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
          </span>
          <WifiOff size={12} className="shrink-0 text-red-400" />
          <span className="font-medium text-red-400">Disconnected</span>
        </>
      )}
    </motion.div>
  )
}
