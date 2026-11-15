import { useRef } from 'react'
import { Clapperboard, ImagePlus, X } from 'lucide-react'
import useStore from '../../store/useStore'
import {
  isMiniMaxH3,
  H3_MAX_SEGMENTS,
  H3_MIN_WINDOW_SECONDS,
  H3_MAX_WINDOW_SECONDS,
  h3ChainedSeconds,
  h3SegmentsForDuration,
  h3WindowSeconds,
  VIDEO_RESOLUTIONS,
} from '../../lib/workflows'
import { Slider, Field, Hint, TextInput, ChoiceGrid } from './controls'
import PresetPicker from './PresetPicker'

const RESOLUTIONS = Object.keys(VIDEO_RESOLUTIONS)
const RES_LABELS = { '1080p-fast': '1080p fast', '1080p': '1080p native' }

// MiniMax H3 only: optional still that seeds window 0 (image-to-video).
// Later windows still chain from the previous window's last frame.
function H3FirstFrame() {
  const src = useStore((s) => s.videoSourceImage)
  const setSrc = useStore((s) => s.setVideoSourceImage)
  const generating = useStore((s) => s.generating)
  const inputRef = useRef(null)
  const ownedUrl = useRef('')
  const shown = src?.preview || src?.url || ''

  // Revoke the object URL created for a local file when it is replaced or
  // cleared. History-sourced stills use a ComfyUI URL and are left alone.
  const dropPreview = () => {
    if (ownedUrl.current) {
      URL.revokeObjectURL(ownedUrl.current)
      ownedUrl.current = ''
    }
  }

  const pick = (file) => {
    if (!file) return
    dropPreview()
    const preview = URL.createObjectURL(file)
    ownedUrl.current = preview
    setSrc({ file, preview, name: file.name })
  }

  return (
    <Field
      label="First frame"
      hint="optional — animates this still (image-to-video)"
    >
      {shown ? (
        <div className="flex items-start gap-3">
          <img
            src={shown}
            alt="First frame"
            className="h-28 w-auto max-w-[45%] rounded-lg border border-border object-cover"
          />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="truncate text-xs text-text-secondary" title={src?.name}>
              {src?.name || 'First frame'}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={generating}
                className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-text-secondary hover:bg-bg-card hover:text-text-primary disabled:opacity-50"
              >
                Replace
              </button>
              <button
                type="button"
                onClick={() => {
                  dropPreview()
                  setSrc(null)
                }}
                disabled={generating}
                className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-text-secondary hover:bg-bg-card hover:text-text-primary disabled:opacity-50"
              >
                <X size={12} /> Clear
              </button>
            </div>
            <p className="text-[10px] leading-snug text-text-muted">
              Used as H3&apos;s first frame. Without one, the first window starts from the prompt.
            </p>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={generating}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-bg-card/50 px-3 py-4 text-xs text-text-secondary transition-colors hover:border-accent/50 hover:text-text-primary disabled:opacity-50"
        >
          <ImagePlus size={14} /> Use a still as the first frame
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          pick(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </Field>
  )
}

// MiniMax H3 only: pick a target length; the builder chains enough windows
// (last-frame continuation) to reach it. Duration drives the window count,
// so Frames/FPS set the per-window size and this sets how many.
function H3DurationControls() {
  const settings = useStore((s) => s.videoSettings)
  const set = useStore((s) => s.setVideoSettings)
  const generating = useStore((s) => s.generating)

  const frames = settings.frames || 33
  const fps = settings.fps || 16
  const windowSeconds = Math.min(
    H3_MAX_WINDOW_SECONDS,
    Math.max(H3_MIN_WINDOW_SECONDS, settings.windowSeconds ?? 5.2),
  )
  const oneWindow = h3WindowSeconds(frames, fps, windowSeconds)
  // Old saves stored duration 2 (below one trained window) — show the real
  // minimum instead of a slider value the builder cannot honour.
  const duration = Math.max(oneWindow, settings.duration ?? oneWindow)
  const crossfade = settings.crossfadeSeconds ?? 0
  const maxDuration = Math.ceil(
    h3ChainedSeconds(H3_MAX_SEGMENTS, frames, fps, windowSeconds, crossfade),
  )
  const windows = h3SegmentsForDuration(duration, frames, fps, windowSeconds, crossfade)
  const achieved = h3ChainedSeconds(windows, frames, fps, windowSeconds, crossfade)

  return (
    <>
      <Slider
        label="Window length"
        value={windowSeconds}
        onChange={(v) => set({ windowSeconds: v })}
        min={H3_MIN_WINDOW_SECONDS}
        max={H3_MAX_WINDOW_SECONDS}
        step={0.1}
        unit="sec"
        disabled={generating}
        suffix="H3 was trained on 124–362 frames per window (≈5.2–15.1s). Shorter windows drift and lose the subject — this replaces the generic Frames/FPS controls."
      />
      <Slider
        label="Length"
        value={duration}
        onChange={(v) => set({ duration: v })}
        min={Math.ceil(oneWindow)}
        max={maxDuration}
        step={1}
        unit="sec"
        disabled={generating}
        suffix={
          windows > 1
            ? `${windows} chained windows → ≈ ${achieved.toFixed(1)}s actual. Every decoded frame stays in RAM until the save, so long chains get heavy (and render time is roughly linear).`
            : `Single window (≈ ${achieved.toFixed(1)}s). Raise Length to chain windows into a longer video (max ${maxDuration}s in one job).`
        }
      />
      {windows > 1 && (
        <Slider
          label="Audio crossfade"
          value={settings.crossfadeSeconds ?? 0.5}
          onChange={(v) => set({ crossfadeSeconds: v })}
          min={0}
          max={2}
          step={0.1}
          unit="sec"
          disabled={generating}
          suffix="Blends the soundtrack across window joins. Needs the AudioCrossfade custom node (comfy_nodes/AudioCrossfade.py) — ignored, with a hard cut, if it isn't installed."
        />
      )}
    </>
  )
}

export default function VideoSettings() {
  const settings = useStore((s) => s.videoSettings)
  const set = useStore((s) => s.setVideoSettings)
  const title = useStore((s) => s.titles?.video || '')
  const setTitle = useStore((s) => s.setTitle)
  const presets = useStore((s) => s.presets?.video || [])
  const active = useStore((s) => s.active?.video)
  const setActivePreset = useStore((s) => s.setActivePreset)
  const flat = useStore((s) => s.models?.video || {})
  const generating = useStore((s) => s.generating)

  const preset = active != null ? presets[active] : null
  const unet = (preset?.unet ?? flat.unet) || ''
  const h3 = isMiniMaxH3(unet)

  return (
    <div className="space-y-4">
      <PresetPicker
        label="Video model"
        presets={presets}
        active={active}
        onSelect={(i) => setActivePreset('video', i)}
        disabled={generating}
        icon={Clapperboard}
      />

      <Field label="Title" hint="used for the saved filename — AI fills this in, you can edit it">
        <TextInput
          value={title}
          onChange={(v) => setTitle('video', v)}
          disabled={generating}
          placeholder="Video title"
        />
      </Field>

      <Field label="Resolution">
        <ChoiceGrid
          options={RESOLUTIONS.map((res) => ({ value: res, label: RES_LABELS[res] || res }))}
          value={settings.resolution}
          onChange={(res) => set({ resolution: res })}
          disabled={generating}
          mono
        />
        {settings.resolution === '1080p' && (
          <Hint>
            Native 1080p — ~20+ min per 2-3s clip on 16GB RAM. Keep clips short (longer ones can
            take hours or fail); much faster after a RAM upgrade. Prefer{' '}
            <span className="text-text-secondary">1080p fast</span> until then.
          </Hint>
        )}
        {settings.resolution === '1080p-fast' && (
          <Hint>
            Samples at 960×544 (the official H3 fast size) and upscales to 1080p with 4x-UltraSharp
            — far less RAM/VRAM pressure than native 1080p; slightly softer than a native render.
          </Hint>
        )}
      </Field>

      {h3 && (
        <>
          <H3FirstFrame />
          <H3DurationControls />
        </>
      )}

      {!h3 && (
        <Slider
          label="Frames"
          value={settings.frames}
          onChange={(v) => set({ frames: v })}
          min={9}
          max={81}
          step={4}
          disabled={generating}
        />
      )}

      {!h3 && (
        <Slider
          label="FPS"
          value={settings.fps}
          onChange={(v) => set({ fps: v })}
          min={8}
          max={32}
          disabled={generating}
        />
      )}

      <Slider
        label="Steps"
        value={settings.steps}
        onChange={(v) => set({ steps: v })}
        min={1}
        max={50}
        disabled={generating}
      />

      {!h3 && (
        <Slider
          label="CFG Scale"
          value={settings.cfg}
          onChange={(v) => set({ cfg: v })}
          min={1}
          max={20}
          step={0.5}
          disabled={generating}
        />
      )}

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
