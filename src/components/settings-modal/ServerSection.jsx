import { Server, Unplug } from 'lucide-react'
import useStore from '../../store/useStore'
import { useUnloadModels } from '../../hooks/useUnloadModels'
import { SectionTitle, Note, TextField, ToggleRow } from './fields'

export default function ServerSection({
  useProxy,
  setUseProxy,
  autoUnload,
  setAutoUnload,
  vramGuard,
  setVramGuard,
  modelsUnloaded,
  localUrl,
  setLocalUrl,
}) {
  const connected = useStore((s) => s.connected)
  const lastGenAt = useStore((s) => s.lastGenAt)
  const generating = useStore((s) => s.generating)
  const queueRemaining = useStore((s) => s.queueRemaining)
  const { unload, busy } = useUnloadModels()
  const modelsLoaded = !modelsUnloaded && lastGenAt > 0
  const canUnload = connected && modelsLoaded && !generating && queueRemaining === 0

  return (
    <div className="space-y-3">
      <SectionTitle icon={Server} title="ComfyUI Server" />

      <ToggleRow
        title="Route through app proxy"
        description="Recommended — avoids browser CORS errors"
        value={useProxy}
        onChange={setUseProxy}
      />
      <ToggleRow
        title="Auto-unload models (idle / pipeline switch)"
        description={
          <>
            Reuses loaded weights for repeated jobs of the same type. Unloads before a different
            pipeline (image → video/music/SFX) and after 5 minutes without activity; checks free
            VRAM first.
            {modelsUnloaded && <span className="font-medium text-warning"> · currently unloaded</span>}
          </>
        }
        value={autoUnload}
        onChange={setAutoUnload}
      />

      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-card px-3 py-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-text-primary">Models in VRAM</p>
          <p className="text-[10px] text-text-muted">
            {modelsUnloaded
              ? 'Currently unloaded — the next render reloads them.'
              : !modelsLoaded
                ? 'No models loaded yet — the next render loads them.'
                : 'Unload now to free the GPU immediately (the next render reloads them).'}
          </p>
        </div>
        <button
          type="button"
          onClick={unload}
          disabled={!canUnload || busy}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-medium text-text-secondary transition-colors hover:border-warning/40 hover:bg-warning/15 hover:text-warning disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning/60"
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
        >
          <Unplug size={12} className={busy ? 'animate-pulse' : ''} />
          {busy ? 'Unloading…' : 'Unload'}
        </button>
      </div>

      <ToggleRow
        title="VRAM guard (AI Prompt Writer)"
        description="Before generating, checks LM Studio for a big LLM sharing the GPU. If one is loaded and ComfyUI is idle, it frees ComfyUI's models first (they reload next run). If ComfyUI is busy, it blocks instead of OOMing."
        value={vramGuard}
        onChange={setVramGuard}
      />

      <TextField
        label="Server URL"
        value={localUrl}
        onChange={setLocalUrl}
        placeholder="http://192.168.1.50:8188"
      />

      {useProxy ? (
        <Note>
          Proxy is <span className="font-medium text-green-400">ON</span>: requests go through this page to the
          Server URL above — no CORS issues, no ComfyUI flags needed. Just type the IP, Save, and it connects.
        </Note>
      ) : (
        <Note>
          Direct connections require ComfyUI to allow cross-origin requests — start it with the{' '}
          <span className="font-mono text-warning">--enable-cors-header</span> flag, otherwise the browser will
          block it.
        </Note>
      )}
    </div>
  )
}
