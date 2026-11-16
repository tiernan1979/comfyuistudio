import useStore from '../../store/useStore'
import { Image as ImageIcon } from 'lucide-react'
import PresetPicker from './PresetPicker'
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
  const prompt = useStore((s) => s.prompt)
  const presets = useStore((s) => s.presets?.image || [])
  const active = useStore((s) => s.active?.image)
  const setActivePreset = useStore((s) => s.setActivePreset)
  const seedMax = 2 ** 48
  const isSheet = settings.kind !== 'texture'
  const sheetIntent =
    settings.kind === 'texture' &&
    /\b(tile\s*sheet|tileset|sprite\s*sheet|contact\s*sheet|variants?|multiple tiles)\b/i.test(prompt)

  return (
    <div className="space-y-4">
      <PresetPicker
        label="Image model"
        presets={presets}
        active={active}
        onSelect={(i) => setActivePreset('image', i)}
        disabled={generating}
        icon={ImageIcon}
        hint="Textures use the shared image stack; edit presets in Settings → Models."
      />

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
                : 'One continuous material. Use “Tileset sheet” when you want several variants.'}
        </Hint>
        {sheetIntent && (
          <p className="mt-1 text-[10px] leading-snug text-amber-400/90">
            Your prompt mentions a sheet or variants. Switch Asset type to “Tileset sheet” for
            multiple tiles — Seamless texture renders one surface and strips sheet wording.
          </p>
        )}
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
        <>
          <Toggle
            label="Seamless prompt"
            value={settings.seamless}
            onChange={(seamless) => set({ seamless })}
            disabled={generating}
            hint="Adds explicit tileable wording. Off is useful for decals and one-off surfaces."
          />
          <Toggle
            label="Auto-fix seams"
            value={settings.fixSeams !== false}
            onChange={(fixSeams) => set({ fixSeams })}
            disabled={generating}
            hint="Crops the outer border, offsets the image, and clones a clean band over the centre seam so a 2×2 repeat lines up."
          />
        </>
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
