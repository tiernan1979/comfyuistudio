import { Disc3 } from 'lucide-react'
import useStore from '../../store/useStore'
import { isAceStepModel, isStableAudioModel, STABLE_AUDIO_MAX_SECONDS } from '../../lib/workflows'
import { Slider, Field, TextInput } from './controls'
import PresetPicker from './PresetPicker'
import QualityPicker from './QualityPicker'

const LYRICS_PLACEHOLDER = `[Intro]

[Verse]

[Pre-Chorus]

[Chorus]

[Post-Chorus]

[Bridge]

[Instrumental]

[Solo]

[Outro]

or your words:
Verse 1:
…
Chorus:
…`

const engineName = (p) => {
  const unet = p.unet || ''
  if (p.engine === 'ace' || isAceStepModel(unet)) return 'ACE-Step 1.5'
  if (p.engine === 'stable_audio' || isStableAudioModel(unet)) return 'Stable Audio 3'
  if (/minimax/i.test(unet)) return 'MiniMax Music 3'
  return unet
}

export default function MusicSettings() {
  const settings = useStore((s) => s.musicSettings)
  const set = useStore((s) => s.setMusicSettings)
  const lyrics = useStore((s) => s.lyrics)
  const setLyrics = useStore((s) => s.setLyrics)
  const title = useStore((s) => s.titles?.music || '')
  const setTitle = useStore((s) => s.setTitle)
  const presets = useStore((s) => s.presets?.music || [])
  const active = useStore((s) => s.active?.music)
  const setActivePreset = useStore((s) => s.setActivePreset)
  const flat = useStore((s) => s.models?.music || {})
  const generating = useStore((s) => s.generating)

  // The active preset wins over the flat model block, matching how the
  // workflow builders resolve models at run time.
  const preset = active != null ? presets[active] : null
  const unet = (preset?.unet ?? flat.unet) || ''
  const isStable = isStableAudioModel(unet) || preset?.engine === 'stable_audio'
  const isAce = isAceStepModel(unet)
  const maxDuration = isStable ? STABLE_AUDIO_MAX_SECONDS : isAce ? 2000 : 360
  const duration = isStable ? Math.min(settings.duration, STABLE_AUDIO_MAX_SECONDS) : settings.duration

  const durationHint = isStable
    ? 'Stable Audio 3 renders short SFX — capped at 47s.'
    : isAce
      ? 'ACE fills the full duration; silence tail is culled after generation.'
      : 'MiniMax planner hard-caps at 360s.'

  return (
    <div className="space-y-4">
      {/* Engine / preset switcher — flip between MiniMax Music 3 and ACE-Step
          1.5 (or any other saved preset) in one click. */}
      <PresetPicker
        label="Music engine"
        presets={presets}
        active={active}
        onSelect={(i) => setActivePreset('music', i)}
        disabled={generating}
        icon={Disc3}
        renderMeta={(p) => engineName(p)}
        hint="Add more presets in Settings → Models → Music."
      />

      <Field
        label="Lyrics"
        hint="tags = structure, no sung words = instrumental — leave the tags for a full-length track"
      >
        <textarea
          value={lyrics}
          onChange={(e) => setLyrics(e.target.value)}
          disabled={generating}
          rows={4}
          placeholder={LYRICS_PLACEHOLDER}
          className="min-h-20 w-full resize-y rounded-lg border border-border bg-bg-card px-3 py-2 text-xs leading-relaxed text-text-primary placeholder:text-text-muted focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-50"
        />
      </Field>

      <Field label="Title" hint="used for the saved filename — AI fills this in, you can edit it">
        <TextInput
          value={title}
          onChange={(v) => setTitle('music', v)}
          disabled={generating}
          placeholder="Song title (e.g. Sunrise Overdrive)"
        />
      </Field>

      {/* ACE-Step reference audio picker removed: ReferenceTimbreAudio
          consistently degraded generation quality in practice — the model
          latched onto the reference's structure instead of just its timbre,
          producing garbled output. A detailed caption alone does more. */}

      <Slider
        label="Max length"
        value={duration}
        onChange={(v) => set({ duration: v })}
        min={10}
        max={maxDuration}
        disabled={generating}
        unit="sec"
        suffix={durationHint}
      />

      <Slider
        label="Steps"
        value={settings.steps}
        onChange={(v) => set({ steps: v })}
        min={4}
        max={40}
        disabled={generating}
      />

      <Slider
        label="Guidance (cfg)"
        value={settings.cfgScale}
        onChange={(v) => set({ cfgScale: v })}
        min={0}
        max={4}
        step={0.1}
        disabled={generating}
      />

      <QualityPicker
        value={settings.quality}
        onChange={(v) => set({ quality: v })}
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
    </div>
  )
}
