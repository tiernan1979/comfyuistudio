import useStore from '../../store/useStore'
import { ChoiceGrid, Field, Hint, Slider, Toggle } from './controls'

const SIZES = [512, 768, 1024]

const KINDS = [
  { value: 'texture', label: 'Seamless texture' },
  { value: 'tileset', label: 'Tileset sheet' },
  { value: 'icon', label: 'Icon / UI pack' },
  { value: 'terrain', label: 'Terrain auto-tiles' },
]

export default function TextureSettings() {
  const settings = useStore((s) => s.textureSettings)
  const set = useStore((s) => s.setTextureSettings)
  const generating = useStore((s) => s.generating)
  const seedMax = 2 ** 48
  const isSheet = settings.kind !== 'texture'

  return (
    <div className="space-y-4">
      <Field label="Asset type">
        <ChoiceGrid
          options={KINDS}
          value={settings.kind}
          onChange={(kind) => set({ kind })}
          disabled={generating}
          cols={2}
        />
        <Hint>
          {settings.kind === 'tileset'
            ? 'A single sheet of equal tiles; the viewer slices it into individual cells.'
            : settings.kind === 'icon'
              ? 'A grid of icons on a flat background; transparency cuts the background locally.'
              : settings.kind === 'terrain'
                ? 'A grid of edge/corner transition tiles for autotiling.'
                : 'One edge-to-edge material; the viewer previews it repeated 2×2 / 3×3.'}
        </Hint>
      </Field>

      {isSheet ? (
        <Field label="Grid">
          <ChoiceGrid
            options={[2, 3, 4].map((n) => ({ value: n, label: `${n}×${n}` }))}
            value={settings.grid}
            onChange={(grid) => set({ grid })}
            disabled={generating}
            cols={3}
            mono
          />
        </Field>
      ) : (
        <Toggle
          label="Seamless prompt"
          value={settings.seamless}
          onChange={(seamless) => set({ seamless })}
          disabled={generating}
          hint="Adds explicit tileable wording. Off is useful for decals and one-off surfaces."
        />
      )}

      {settings.kind === 'icon' && (
        <Toggle
          label="Transparent background"
          value={settings.transparent !== false}
          onChange={(transparent) => set({ transparent })}
          disabled={generating}
          hint="Uses BiRefNet to cut the flat background from the sheet."
        />
      )}

      <Field label="Render size">
        <ChoiceGrid
          options={SIZES.map((n) => ({ value: n, label: `${n}²` }))}
          value={settings.size}
          onChange={(size) => set({ size })}
          disabled={generating}
          cols={3}
          mono
        />
      </Field>

      <Field label="Batch">
        <ChoiceGrid
          options={[1, 2, 4].map((n) => ({ value: n, label: String(n) }))}
          value={settings.batchCount}
          onChange={(batchCount) => set({ batchCount })}
          disabled={generating}
          cols={3}
          mono
        />
        <Hint>One job, several variants to pick from. Each lands in history.</Hint>
      </Field>

      <Slider
        label="Steps"
        value={settings.steps}
        onChange={(steps) => set({ steps })}
        min={10}
        max={50}
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
    </div>
  )
}
