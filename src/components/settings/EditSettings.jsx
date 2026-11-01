import useStore from '../../store/useStore'
import { Slider } from './controls'

export default function EditSettings() {
  const settings = useStore((s) => s.editSettings)
  const set = useStore((s) => s.setEditSettings)
  const generating = useStore((s) => s.generating)

  return (
    <div className="space-y-4">
      <Slider
        label="Steps"
        value={settings.steps}
        onChange={(v) => set({ steps: v })}
        min={1}
        max={50}
        disabled={generating}
      />

      <Slider
        label="CFG Scale"
        value={settings.cfg}
        onChange={(v) => set({ cfg: v })}
        min={1}
        max={20}
        step={0.5}
        disabled={generating}
      />

      <Slider
        label="Seed"
        value={settings.seed}
        onChange={(v) => set({ seed: v })}
        min={-1}
        max={2 ** 48}
        disabled={generating}
      />

      <div className="space-y-1">
        <Slider
          label="Mask denoise"
          value={settings.denoise ?? 1}
          onChange={(v) => set({ denoise: v })}
          min={0.1}
          max={1}
          step={0.05}
          disabled={generating}
        />
        <p className="text-[10px] leading-snug text-text-muted">
          Only used with a mask: 1 fully repaints the painted area, lower values keep more of the
          original detail inside it.
        </p>
      </div>
    </div>
  )
}
