import clsx from 'clsx'
import { Image as ImageIcon } from 'lucide-react'
import useStore from '../../store/useStore'
import { ASPECT_RATIOS, isH3ImageModel } from '../../lib/workflows'
import PresetPicker from './PresetPicker'
import { Slider, Toggle, NumberField, Field, ChoiceGrid, Hint, choiceClass } from './controls'

const RATIOS = Object.keys(ASPECT_RATIOS)
const SIZE_PRESETS = [
  [100, 100],
  [128, 128],
  [256, 256],
  [512, 512],
]

export default function ImageSettings() {
  const settings = useStore((s) => s.imageSettings)
  const set = useStore((s) => s.setImageSettings)
  const generating = useStore((s) => s.generating)
  const presets = useStore((s) => s.presets?.image || [])
  const active = useStore((s) => s.active?.image)
  const setActivePreset = useStore((s) => s.setActivePreset)
  const activePreset = presets[active]
  // The preset picker now mixes Qwen-Image and MiniMax H3 Image. H3 runs a
  // fixed distilled schedule and its own conditioning graph, so the Qwen-only
  // sliders/turbo/batch controls are hidden while it is selected.
  const h3 = isH3ImageModel(activePreset?.unet)

  const custom = settings.sizeMode === 'custom'
  const seedMax = 2 ** 48

  return (
    <div className="space-y-4">
      <PresetPicker
        label="Image model"
        presets={presets}
        active={active}
        onSelect={(i) => setActivePreset('image', i)}
        disabled={generating}
        icon={ImageIcon}
        hint={
          h3
            ? 'MiniMax H3 Image preset: fixed 6 steps, CFG 1, no negative prompt. Size uses a 32px grid; batch is 1 per run.'
            : 'Shared by Image, Textures and PBR. Add or edit presets in Settings → Models.'
        }
      />

      <Field label="Size">
        <div className="mb-2 grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => set({ sizeMode: 'ratio' })}
            disabled={generating}
            className={choiceClass(!custom, generating)}
          >
            Aspect ratio
          </button>
          <button
            type="button"
            onClick={() => set({ sizeMode: 'custom' })}
            disabled={generating}
            className={choiceClass(custom, generating)}
          >
            Custom size
          </button>
        </div>

        {!custom ? (
          <ChoiceGrid
            options={RATIOS.map((ar) => ({ value: ar, label: ar }))}
            value={settings.aspectRatio}
            onChange={(ar) => set({ aspectRatio: ar })}
            disabled={generating}
            cols={4}
            mono
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="Width (px)"
                value={settings.width}
                onChange={(v) => set({ width: v })}
                disabled={generating}
              />
              <NumberField
                label="Height (px)"
                value={settings.height}
                onChange={(v) => set({ height: v })}
                disabled={generating}
              />
            </div>
            <div className="mt-2 grid grid-cols-4 gap-1.5">
              {SIZE_PRESETS.map(([w, h]) => (
                <button
                  key={`${w}x${h}`}
                  type="button"
                  onClick={() => set({ width: w, height: h })}
                  disabled={generating}
                  className={clsx(
                    'rounded-lg px-1 py-1 font-mono text-[10px] transition-colors',
                    settings.width === w && settings.height === h
                      ? 'bg-accent text-white'
                      : 'bg-bg-card text-text-secondary hover:bg-bg-hover',
                    generating && 'opacity-50',
                  )}
                >
                  {w}×{h}
                </button>
              ))}
            </div>
            <Hint>
              Snapped to the nearest multiple of 8 (100 → 104). Small sizes suit sprites/icons; big
              scenes want the aspect ratios.
            </Hint>
          </>
        )}
      </Field>

      <Slider
        label="Steps"
        value={settings.steps}
        onChange={(v) => set({ steps: v })}
        min={1}
        max={50}
        disabled={generating || h3}
      />

      <Slider
        label="CFG Scale"
        value={settings.cfg}
        onChange={(v) => set({ cfg: v })}
        min={1}
        max={20}
        step={0.5}
        disabled={generating || h3}
      />

      <Slider
        label="Seed"
        value={settings.seed}
        onChange={(v) => set({ seed: v })}
        min={-1}
        max={seedMax}
        disabled={generating}
      />

      <Toggle
        label="Turbo Mode (8 steps, LoRA)"
        value={settings.turboMode}
        onChange={(v) => set({ turboMode: v })}
        disabled={generating || h3}
      />

      <Field label="Batch">
        <div className="grid grid-cols-4 gap-1.5">
          {[1, 2, 4, 8].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => set({ batchCount: n })}
              disabled={generating || h3}
              className={choiceClass((settings.batchCount || 1) === n, generating || h3)}
            >
              {n}
            </button>
          ))}
        </div>
        <Hint>
          {h3
            ? 'MiniMax H3 Image renders one image per run — batch is disabled for this preset.'
            : 'Renders every image in one job and shows them as a contact sheet. Each result lands in history separately.'}
        </Hint>
      </Field>
    </div>
  )
}
