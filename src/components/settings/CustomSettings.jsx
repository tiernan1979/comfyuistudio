import { FileJson2, Settings2 } from 'lucide-react'
import useStore from '../../store/useStore'
import { Slider } from './controls'

export default function CustomSettings() {
  const workflows = useStore((s) => s.customWorkflows)
  const activeId = useStore((s) => s.customWorkflowId)
  const setActiveId = useStore((s) => s.setCustomWorkflowId)
  const settings = useStore((s) => s.customSettings)
  const set = useStore((s) => s.setCustomSettings)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const generating = useStore((s) => s.generating)
  const active = workflows.find((w) => w.id === activeId) || workflows[0]

  if (!active) {
    return (
      <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center">
        <FileJson2 size={22} className="mx-auto mb-2 text-text-muted" />
        <p className="text-xs text-text-secondary">No imported workflows yet.</p>
        <p className="mt-1 text-[10px] leading-snug text-text-muted">
          Import any ComfyUI API-format workflow, map its prompt and seed fields, and run it from
          here.
        </p>
        <button
          type="button"
          onClick={() => setShowSettings(true)}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <Settings2 size={12} /> Open Settings → Workflows
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          Workflow
        </label>
        <select
          value={active.id}
          onChange={(e) => setActiveId(e.target.value)}
          disabled={generating}
          className="w-full rounded-lg border border-border bg-bg-card px-2.5 py-2 text-xs text-text-primary focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-50"
        >
          {workflows.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[10px] text-text-muted">
          {Object.keys(active.graph || {}).length} nodes · {active.mapping?.outputType || 'image'}{' '}
          output
        </p>
      </div>

      <Slider
        label="Seed"
        value={settings.seed ?? -1}
        onChange={(v) => set({ seed: v })}
        min={-1}
        max={2 ** 48}
        disabled={generating}
      />

      <div className="rounded-lg border border-border bg-bg-card/50 px-3 py-2.5 text-[10px] leading-relaxed text-text-muted">
        The imported graph runs as-is apart from the mapped prompt, negative prompt and seed.
        Missing custom nodes or models are reported by ComfyUI on queue.
      </div>

      <button
        type="button"
        onClick={() => setShowSettings(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[11px] text-text-secondary transition-colors hover:bg-bg-card hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <Settings2 size={12} /> Manage workflows
      </button>
    </div>
  )
}
