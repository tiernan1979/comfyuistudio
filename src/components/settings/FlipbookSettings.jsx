import useStore from '../../store/useStore'
import { FLIPBOOK_FRAMES } from '../../lib/workflows'
import { ChoiceGrid, Field, Hint, Slider, Toggle } from './controls'

const FPS = [8, 12, 16, 24]

export default function FlipbookSettings() {
  const settings = useStore((s) => s.flipbookSettings)
  const set = useStore((s) => s.setFlipbookSettings)
  const generating = useStore((s) => s.generating)
  const seedMax = 2 ** 48

  return (
    <div className="space-y-4">
      <Field label="Frames">
        <ChoiceGrid
          options={FLIPBOOK_FRAMES.map((n) => ({ value: n, label: String(n) }))}
          value={settings.frames}
          onChange={(frames) => set({ frames })}
          disabled={generating}
          cols={4}
          mono
        />
        <Hint>More frames make a smoother loop but cost proportionally more render time.</Hint>
      </Field>

      <Field label="Playback FPS">
        <ChoiceGrid
          options={FPS.map((n) => ({ value: n, label: `${n}` }))}
          value={settings.fps}
          onChange={(fps) => set({ fps })}
          disabled={generating}
          cols={4}
          mono
        />
      </Field>

      <Field label="Render size">
        <ChoiceGrid
          options={[512, 768].map((n) => ({ value: n, label: `${n}²` }))}
          value={settings.resolution}
          onChange={(resolution) => set({ resolution })}
          disabled={generating}
          cols={2}
          mono
        />
      </Field>

      <Toggle
        label="Transparent background"
        value={settings.transparent}
        onChange={(transparent) => set({ transparent })}
        disabled={generating}
        hint="Runs BiRefNet on every frame. Turn off for full-frame effects that already fill the image."
      />

      <Slider
        label="Steps"
        value={settings.steps}
        onChange={(steps) => set({ steps })}
        min={10}
        max={40}
        disabled={generating}
      />
      <Slider
        label="CFG Scale"
        value={settings.cfg}
        onChange={(cfg) => set({ cfg })}
        min={1}
        max={15}
        step={0.5}
        disabled={generating}
      />
      <Slider
        label="Seed"
        value={settings.seed}
        onChange={(seed) => set({ seed })}
        min={-1}
        max={seedMax}
        disabled={generating}
        suffix="-1 randomises each run."
      />

      <Hint>
        Uses the Video model stack (WAN 2.x). The effect is rendered as one short loop, then packed into
        a horizontal sheet with a JSON atlas and Godot resource.
      </Hint>
    </div>
  )
}
