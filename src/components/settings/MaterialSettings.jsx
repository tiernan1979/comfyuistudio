import useStore from '../../store/useStore'
import { Image as ImageIcon } from 'lucide-react'
import { MATERIAL_MAP_KEYS, MATERIAL_SIZE_OPTIONS } from '../../lib/workflows'
import PresetPicker from './PresetPicker'
import { ChoiceGrid, Field, Hint, Slider } from './controls'

const MAP_LABELS = {
  basecolor: 'Base colour',
  normal: 'Normal',
  roughness: 'Roughness',
  metalness: 'Metalness',
  height: 'Height',
}

export default function MaterialSettings() {
  const settings = useStore((s) => s.materialSettings)
  const set = useStore((s) => s.setMaterialSettings)
  const generating = useStore((s) => s.generating)
  const presets = useStore((s) => s.presets?.image || [])
  const active = useStore((s) => s.active?.image)
  const setActivePreset = useStore((s) => s.setActivePreset)
  const toggleMap = (key) => set({ maps: { ...settings.maps, [key]: !settings.maps[key] } })

  return (
    <div className="space-y-4">
      <PresetPicker
        label="Image model"
        presets={presets}
        active={active}
        onSelect={(i) => setActivePreset('image', i)}
        disabled={generating}
        icon={ImageIcon}
        hint="The base colour uses the shared image stack; edit presets in Settings → Models."
      />

      <Field label="Texture size">
        <ChoiceGrid
          options={MATERIAL_SIZE_OPTIONS}
          value={settings.size}
          onChange={(size) => set({ size })}
          disabled={generating}
          cols={3}
          mono
        />
      </Field>

      <Field label="Maps">
        <div className="grid grid-cols-2 gap-1.5">
          {MATERIAL_MAP_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => toggleMap(key)}
              disabled={generating}
              aria-pressed={settings.maps[key] !== false}
              className={
                'rounded-lg border px-2 py-2 text-xs font-medium transition-colors ' +
                (settings.maps[key] !== false
                  ? 'border-accent/50 bg-accent/15 text-accent'
                  : 'border-border bg-bg-card text-text-secondary hover:bg-bg-hover')
              }
            >
              {MAP_LABELS[key]}
            </button>
          ))}
        </div>
        <Hint>Base colour, normal, height, roughness and metalness — all local.</Hint>
      </Field>

      <Field label="Tiling">
        <ChoiceGrid
          options={[
            { value: 'both', label: 'Both' },
            { value: 'horizontal', label: 'Horizontal' },
            { value: 'vertical', label: 'Vertical' },
          ]}
          value={settings.tiling}
          onChange={(tiling) => set({ tiling })}
          disabled={generating}
          cols={3}
        />
        <Hint>The prompt asks for seamless edges in the selected directions; derived maps inherit them.</Hint>
      </Field>

      <Slider
        label="Inference steps"
        value={settings.steps}
        onChange={(steps) => set({ steps })}
        min={4}
        max={40}
        disabled={generating}
        suffix="Base-colour render quality. 20 is a good default."
      />

      <Slider
        label="CFG"
        value={settings.cfg}
        onChange={(cfg) => set({ cfg })}
        min={0}
        max={20}
        step={0.5}
        disabled={generating}
      />

      <Slider
        label="Roughness bias"
        value={settings.roughness ?? 50}
        onChange={(roughness) => set({ roughness })}
        min={0}
        max={100}
        disabled={generating}
        suffix="Brightens or darkens the luminance-derived roughness map."
      />

      <Slider
        label="Metalness"
        value={settings.metallic ?? 0}
        onChange={(metallic) => set({ metallic })}
        min={0}
        max={100}
        disabled={generating}
        suffix="Uniform metal mask. 0 for stone, wood, brick and most dielectrics."
      />

      <Slider
        label="Seed"
        value={settings.seed}
        onChange={(seed) => set({ seed })}
        min={0}
        max={2147483646}
        disabled={generating}
      />

      <Hint>
        Local pipeline: Qwen renders the base colour, DSINE derives the normal map and MiDaS derives
        height; roughness and metalness are generated from the colour and a uniform metal mask. No
        cloud call, no credits and no extra model downloads beyond the depth/normal preprocessors.
      </Hint>
    </div>
  )
}
