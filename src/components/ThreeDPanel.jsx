import { AlertTriangle, Loader2 } from 'lucide-react'
import useStore from '../store/useStore'
import DragDivider from './DragDivider'
import { resolveApiBase } from '../lib/comfyui'
import useThreeDRun from '../hooks/useThreeDRun'
import ThreeDControls from './threed/ThreeDControls'
import ThreeDViewer from './threed/ThreeDViewer'

function RunStatus({ run, idleNote }) {
  return (
    <div className="space-y-3 border-t border-border p-4">
      {run.stage === 'working' && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-accent">
            <Loader2 size={14} className="shrink-0 animate-spin" />
            <span>{run.status || 'Working…'}</span>
            {run.pct != null && (
              <span className="ml-auto tabular-nums text-text-secondary">{run.pct}%</span>
            )}
          </div>
          {run.pct != null && (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-card">
              <div
                className="h-full rounded-full bg-gradient-to-r from-accent to-purple-500 transition-all duration-700 ease-out"
                style={{ width: `${run.pct}%` }}
              />
            </div>
          )}
        </div>
      )}
      {idleNote && run.stage !== 'working' && (
        <div className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2.5 text-xs text-accent">
          {idleNote}
        </div>
      )}
      {run.error && (
        <div className="flex gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs text-red-300">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span className="leading-relaxed">{run.error}</span>
        </div>
      )}
    </div>
  )
}

export default function ThreeDPanel() {
  const serverUrl = useStore((s) => s.serverUrl)
  const useProxy = useStore((s) => s.useProxy)
  const threeD = useStore((s) => s.threeD)
  const models = useStore((s) => s.models)
  const run = useStore((s) => s.threeDRun)
  const setRun = useStore((s) => s.setThreeDRun)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const controlsWidth = useStore((s) => s.controlsWidth)
  const setControlsWidth = useStore((s) => s.setControlsWidth)
  const addToHistory = useStore((s) => s.addToHistory)
  const sourceImage = useStore((s) => s.sourceImage)

  const base = resolveApiBase(serverUrl, useProxy)
  const t = useThreeDRun({ base, threeD, models, run, setRun, addToHistory, sourceImage })

  return (
    <div className="flex flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
      {/* Controls panel — same layout as the other tabs: stacked on phones,
          a resizable column on md+. */}
      <div
        data-testid="controls-panel"
        className="flex w-full flex-col border-b border-border bg-bg-secondary/30 md:w-[var(--controls-w)] md:shrink-0 md:overflow-y-auto md:border-b-0 md:border-r"
        style={{ '--controls-w': `${controlsWidth}px` }}
      >
        <ThreeDControls t={t} threeD={threeD} run={run} setShowSettings={setShowSettings} />
        <RunStatus run={run} idleNote={t.idleNote} />
      </div>

      <DragDivider
        className="hidden md:block"
        label="Resize controls panel"
        value={controlsWidth}
        min={240}
        max={560}
        defaultValue={320}
        onChange={setControlsWidth}
        direction={1}
      />

      <ThreeDViewer t={t} run={run} />
    </div>
  )
}
