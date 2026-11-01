import { Server } from 'lucide-react'
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
        title="Auto-unload models (5 min idle)"
        description={
          <>
            Frees ComfyUI memory when idle — next generate reloads the model
            {modelsUnloaded && <span className="font-medium text-warning"> · currently unloaded</span>}
          </>
        }
        value={autoUnload}
        onChange={setAutoUnload}
      />
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
