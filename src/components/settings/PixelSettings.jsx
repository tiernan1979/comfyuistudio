import useStore from '../../store/useStore'
import { Slider, Field, ChoiceGrid, Hint, choiceClass } from './controls'

// SDXL + Pixel Art XL settings. The checkpoint/LoRA filenames live in
// Settings → Models → Pixel Art; this panel only tunes the render. Square
// sizes are deliberate: SDXL was trained at 1024² and the 32×32 export uses a
// centre crop, so non-square output would either stretch or lose edges.
const SIZES = [512, 768, 1024, 1280]

export default function PixelSettings() {
  const settings = useStore((s) => s.pixelSettings)
  const set = useStore((s) => s.setPixelSettings)
  const generating = useStore((s) => s.generating)
  const seedMax = 2 ** 48

  return (
    <div className="space-y-4">
      <Field label="Size">
        <ChoiceGrid
          options={SIZES.map((n) => ({ value: n, label: `${n}²` }))}
          value={settings.size}
          onChange={(size) => set({ size })}
          disabled={generating}
          cols={4}
          mono
        />
        <Hint>
          SDXL renders at 1024² best. The viewer’s grid button crops and downsamples to a 32×32
          tile for game maps. For terrain, include “top-down tileset, each tile fills its cell
          edge to edge” in the prompt.
        </Hint>
      </Field>

      <Slider
        label="Steps"
        value={settings.steps}
        onChange={(v) => set({ steps: v })}
        min={10}
        max={50}
        disabled={generating}
      />

      <Slider
        label="CFG Scale"
        value={settings.cfg}
        onChange={(v) => set({ cfg: v })}
        min={1}
        max={15}
        step={0.5}
        disabled={generating}
      />

      <Slider
        label="Seed"
        value={settings.seed}
        onChange={(v) => set({ seed: v })}
        min={-1}
        max={seedMax}
        disabled={generating}
      />

      <Slider
        label="Pixel Art XL strength"
        value={settings.loraStrength ?? 1}
        onChange={(v) => set({ loraStrength: v })}
        min={0}
        max={1.5}
        step={0.05}
        disabled={generating}
        suffix="1.0 is the LoRA’s trained strength; lower it to keep more of the checkpoint’s detail."
      />

      <Field label="Batch">
        <div className="grid grid-cols-4 gap-1.5">
          {[1, 2, 4, 8].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => set({ batchCount: n })}
              disabled={generating}
              className={choiceClass((settings.batchCount || 1) === n, generating)}
            >
              {n}
            </button>
          ))}
        </div>
        <Hint>
          One ComfyUI job; each tile appears in the viewer grid and history. Good for picking a
          terrain variant.
        </Hint>
      </Field>

      <Hint>
        Uses models/checkpoints (SDXL) + models/loras (Pixel Art XL). Change them in Settings →
        Models → Pixel Art.
      </Hint>
    </div>
  )
}
