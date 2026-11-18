import useStore from '../../store/useStore'
import { H3_IMAGE_SIZES } from '../../lib/workflows'
import { ChoiceGrid, Field, Hint, Slider } from './controls'

const stem = (name) => String(name || '—').replace(/\.safetensors$/i, '')

export default function H3ImageSettings() {
  const settings = useStore((s) => s.h3imageSettings)
  const set = useStore((s) => s.setH3ImageSettings)
  const models = useStore((s) => s.models.h3image)
  const generating = useStore((s) => s.generating)
  const seedMax = 2 ** 48

  return (
    <div className="space-y-4">
      <Field label="H3 model stack">
        <div className="space-y-1 rounded-lg border border-border bg-bg-card px-2.5 py-2 font-mono text-[10px] text-text-secondary">
          <p className="truncate">UNET: {stem(models?.unet)}</p>
          <p className="truncate">Encoder: {stem(models?.clip)}</p>
          <p className="truncate">VAE: {stem(models?.vae)}</p>
        </div>
        <Hint>
          These are the MiniMax H3 image files generation loads. Swap them in
          Settings → Models → MiniMax H3 Image Models.
        </Hint>
      </Field>

      <Field label="Image size">
        <ChoiceGrid
          options={H3_IMAGE_SIZES.map((n) => ({ value: n, label: `${n}²` }))}
          value={settings.size}
          onChange={(size) => set({ size })}
          disabled={generating}
          cols={4}
          mono
        />
        <Hint>
          MiniMax H3 Image is a 16MP model — 4096² is native, 2048² is the sweet spot on 16–24GB
          cards. Every side is generated on a 32px grid.
        </Hint>
      </Field>

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
        Fixed by the distilled checkpoint: 6 steps, CFG 1, euler/simple, no negative prompt.
        Write everything you want (including things to avoid) into the positive prompt. Needs the
        <span className="font-mono">MiniMaxH3ImageConditioning</span> node (ComfyUI 0.45+). Model
        files live in Settings → Models → H3 Image.
      </Hint>
    </div>
  )
}
