import { AudioWaveform } from 'lucide-react'
import useStore from '../../store/useStore'
import { STABLE_AUDIO_MAX_SECONDS } from '../../lib/workflows'
import { Slider, Field, TextInput } from './controls'
import PresetPicker from './PresetPicker'
import QualityPicker from './QualityPicker'

// SFX always renders through Stable Audio 3, so the engine label is fixed.
const engineName = () => 'Stable Audio 3'

export default function SfxSettings() {
  const settings = useStore((s) => s.sfxSettings)
  const set = useStore((s) => s.setSfxSettings)
  const title = useStore((s) => s.titles?.sfx || '')
  const setTitle = useStore((s) => s.setTitle)
  const presets = useStore((s) => s.presets?.sfx || [])
  const active = useStore((s) => s.active?.sfx)
  const setActivePreset = useStore((s) => s.setActivePreset)
  const generating = useStore((s) => s.generating)

  return (
    <div className="space-y-4">
      <PresetPicker
        label="SFX engine"
        presets={presets}
        active={active}
        onSelect={(i) => setActivePreset('sfx', i)}
        disabled={generating}
        icon={AudioWaveform}
        renderMeta={engineName}
        hint="Add more presets in Settings → Models → SFX."
      />

      <Field label="Title" hint="used for the saved filename">
        <TextInput
          value={title}
          onChange={(v) => setTitle('sfx', v)}
          disabled={generating}
          placeholder="Sound effect name (e.g. Metal Door Slam)"
        />
      </Field>

      <Slider
        label="Duration"
        value={settings.duration}
        onChange={(v) => set({ duration: v })}
        min={1}
        max={STABLE_AUDIO_MAX_SECONDS}
        disabled={generating}
        unit="sec"
        suffix="Stable Audio 3 renders short sound effects (capped at 47s)."
      />

      <Slider
        label="Seed"
        value={settings.seed}
        onChange={(v) => set({ seed: v })}
        min={-1}
        max={2 ** 48}
        disabled={generating}
      />

      <QualityPicker
        value={settings.quality}
        onChange={(v) => set({ quality: v })}
        disabled={generating}
      />
    </div>
  )
}
