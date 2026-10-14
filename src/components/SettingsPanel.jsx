import { motion } from 'framer-motion'
import { useRef } from 'react'
import { Disc3, Clapperboard } from 'lucide-react'
import useStore, { presetLabel } from '../store/useStore'
import { isAceStepModel } from '../lib/workflows'
import clsx from 'clsx'

const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3']
const VIDEO_RESOLUTIONS = ['480p', '720p', '1080p-fast', '1080p']
const RES_LABELS = { '1080p-fast': '1080p fast', '1080p': '1080p native' }

function Toggle({ label, value, onChange, disabled }) {
  return (
    <label className="flex items-center justify-between cursor-pointer group">
      <span className="text-xs text-text-secondary group-hover:text-text-primary transition-colors">{label}</span>
      <button
        onClick={() => onChange(!value)}
        disabled={disabled}
        className={clsx(
          'relative w-9 h-5 rounded-full transition-colors duration-200',
          value ? 'bg-accent' : 'bg-bg-hover',
          disabled && 'opacity-50'
        )}
      >
        <span
          className={clsx(
            'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200',
            value && 'translate-x-4'
          )}
        />
      </button>
    </label>
  )
}

function Slider({ label, value, onChange, min, max, step = 1, disabled, suffix = '', unit = '' }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-secondary">{label}</span>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (!Number.isNaN(v) && v >= min && v <= max) onChange(v)
            }}
            disabled={disabled}
            className="w-16 px-1.5 py-0.5 text-right text-xs font-mono text-accent bg-bg-hover border border-border rounded focus:outline-none focus:border-accent/50 disabled:opacity-50"
          />
          {unit && <span className="text-xs text-text-muted">{unit}</span>}
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className="w-full h-1.5 rounded-full appearance-none bg-bg-hover accent-accent disabled:opacity-50 cursor-pointer"
      />
      {suffix && <p className="text-[10px] text-text-muted/60 leading-snug">{suffix}</p>}
    </div>
  )
}

export default function SettingsPanel() {
  const mode = useStore((s) => s.mode)
  const imageSettings = useStore((s) => s.imageSettings)
  const videoSettings = useStore((s) => s.videoSettings)
  const editSettings = useStore((s) => s.editSettings)
  const musicSettings = useStore((s) => s.musicSettings)
  const setImageSettings = useStore((s) => s.setImageSettings)
  const setVideoSettings = useStore((s) => s.setVideoSettings)
  const setEditSettings = useStore((s) => s.setEditSettings)
  const setMusicSettings = useStore((s) => s.setMusicSettings)
  const lyrics = useStore((s) => s.lyrics)
  const setLyrics = useStore((s) => s.setLyrics)
  const generating = useStore((s) => s.generating)
  const musicPresets = useStore((s) => s.presets?.music || [])
  const musicActive = useStore((s) => s.active?.music)
  const setActivePreset = useStore((s) => s.setActivePreset)
  const titles = useStore((s) => s.titles)
  const setTitle = useStore((s) => s.setTitle)
  const flatMusic = useStore((s) => s.models?.music || {})
  const musicPreset = musicActive != null ? musicPresets[musicActive] : null
  const musicUnet = (musicPreset?.unet ?? flatMusic.unet) || ''
  const videoPresets = useStore((s) => s.presets?.video || [])
  const videoActive = useStore((s) => s.active?.video)

  if (mode === 'edit') {
    return (
      <div className="space-y-4">
        <Slider
          label="Steps"
          value={editSettings.steps}
          onChange={(v) => setEditSettings({ steps: v })}
          min={1}
          max={50}
          disabled={generating}
        />

        <Slider
          label="CFG Scale"
          value={editSettings.cfg}
          onChange={(v) => setEditSettings({ cfg: v })}
          min={1}
          max={20}
          step={0.5}
          disabled={generating}
        />

        <Slider
          label="Seed"
          value={editSettings.seed}
          onChange={(v) => setEditSettings({ seed: v })}
          min={-1}
          max={2 ** 48}
          disabled={generating}
         
        />
      </div>
    )
  }

  if (mode === 'music') {
    return (
      <div className="space-y-4">
        {/* Engine / preset switcher — flip between MiniMax Music 3 and
            ACE-Step 1.5 (or any other saved preset) in one click. */}
        {musicPresets.length > 0 && (
          <div>
            <label className="text-xs text-text-muted mb-1.5 block">Music Engine</label>
            <div className="grid grid-cols-2 gap-1.5">
              {musicPresets.map((p, i) => {
                const isAce = p.engine === 'ace' || isAceStepModel(p.unet || '')
                return (
                  <motion.button
                    key={i}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setActivePreset('music', i)}
                    disabled={generating}
                    className={clsx(
                      'flex items-center gap-2 px-3 py-2 rounded-xl text-xs transition-all text-left',
                      musicActive === i
                        ? 'bg-accent text-white shadow-lg shadow-accent/25'
                        : 'bg-bg-card text-text-secondary hover:bg-bg-hover border border-border',
                      generating && 'opacity-50'
                    )}
                    title={presetLabel(p)}
                  >
                    <Disc3 size={14} className="shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium truncate">{p.name || `Preset ${i + 1}`}</p>
                      <p className={clsx('text-[10px] truncate', musicActive === i ? 'text-white/70' : 'text-text-muted')}>
                        {isAce ? 'ACE-Step 1.5' : /minimax/i.test(p.unet || '') ? 'MiniMax Music 3' : p.unet}
                      </p>
                    </div>
                  </motion.button>
                )
              })}
            </div>
            <p className="text-[10px] text-text-muted/60 mt-1">
              Add more presets in Settings → Models → Music.
            </p>
          </div>
        )}

        <div>
          <label className="text-xs text-text-muted mb-1.5 block">
            Lyrics <span className="text-text-muted/60">(tags = structure, no sung words = instrumental — leave the tags for a full-length track)</span>
          </label>
          <textarea
            value={lyrics}
            onChange={(e) => setLyrics(e.target.value)}
            disabled={generating}
            rows={4}
            placeholder={'[Intro]\n\n[Verse]\n\n[Pre-Chorus]\n\n[Chorus]\n\n[Post-Chorus]\n\n[Bridge]\n\n[Instrumental]\n\n[Solo]\n\n[Outro]\n\nor your words:\nVerse 1:\n…\nChorus:\n…'}
            className="w-full px-3 py-2 rounded-xl bg-bg-card border border-border text-text-primary placeholder:text-text-muted resize-y min-h-20 text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
          />
        </div>

        <div>
          <label className="text-xs text-text-muted mb-1.5 block">
            Title <span className="text-text-muted/60">(used for the saved filename — AI fills this in, you can edit it)</span>
          </label>
          <input
            type="text"
            value={titles?.music || ''}
            onChange={(e) => setTitle('music', e.target.value)}
            disabled={generating}
            placeholder="Song title (e.g. Sunrise Overdrive)"
            className="w-full px-3 py-2 rounded-xl bg-bg-card border border-border text-text-primary placeholder:text-text-muted text-xs focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
          />
        </div>

        {/* ACE-Step reference audio picker removed: ReferenceTimbreAudio
            consistently degraded generation quality in practice — the model
            latched onto the reference's structure instead of just its timbre,
            producing garbled output. A detailed caption alone does more. */}

        <Slider
          label="Max length"
          value={musicSettings.duration}
          onChange={(v) => setMusicSettings({ duration: v })}
          min={10}
          max={isAceStepModel(musicUnet) ? 2000 : 360}
          disabled={generating}
          unit="sec"
          suffix={isAceStepModel(musicUnet)
            ? 'ACE fills the full duration; silence tail is culled after generation.'
            : 'MiniMax planner hard-caps at 360s.'}
        />

        <Slider
          label="Steps"
          value={musicSettings.steps}
          onChange={(v) => setMusicSettings({ steps: v })}
          min={4}
          max={40}
          disabled={generating}
        />

        <Slider
          label="Guidance (cfg)"
          value={musicSettings.cfgScale}
          onChange={(v) => setMusicSettings({ cfgScale: v })}
          min={0}
          max={4}
          step={0.1}
          disabled={generating}
        />

        <div>
          <label className="text-xs text-text-muted mb-1.5 block">Output Quality</label>
          <div className="grid grid-cols-2 gap-1.5">
            {[
              { v: 'wav', t: 'WAV (lossless)' },
              { v: '320k', t: 'MP3 320k' },
              { v: 'V0', t: 'MP3 V0' },
              { v: '128k', t: 'MP3 128k' },
            ].map((q) => (
              <motion.button
                key={q.v}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setMusicSettings({ quality: q.v })}
                disabled={generating}
                className={clsx(
                  'px-2 py-1.5 rounded-lg text-xs transition-all',
                  musicSettings.quality === q.v
                    ? 'bg-accent text-white shadow-lg shadow-accent/25'
                    : 'bg-bg-card text-text-secondary hover:bg-bg-hover',
                  generating && 'opacity-50'
                )}
              >
                {q.t}
              </motion.button>
            ))}
          </div>
        </div>

        <Slider
          label="Seed"
          value={musicSettings.seed}
          onChange={(v) => setMusicSettings({ seed: v })}
          min={-1}
          max={2 ** 48}
          disabled={generating}
         
        />
      </div>
    )
  }

  if (mode === 'image') {
    return (
      <div className="space-y-4">
        <div>
          <label className="text-xs text-text-muted mb-1.5 block">Aspect Ratio</label>
          <div className="grid grid-cols-4 gap-1.5">
            {ASPECT_RATIOS.map((ar) => (
              <motion.button
                key={ar}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setImageSettings({ aspectRatio: ar })}
                disabled={generating}
                className={clsx(
                  'px-2 py-1.5 rounded-lg text-xs font-mono transition-all',
                  imageSettings.aspectRatio === ar
                    ? 'bg-accent text-white shadow-lg shadow-accent/25'
                    : 'bg-bg-card text-text-secondary hover:bg-bg-hover',
                  generating && 'opacity-50'
                )}
              >
                {ar}
              </motion.button>
            ))}
          </div>
        </div>

        <Slider
          label="Steps"
          value={imageSettings.steps}
          onChange={(v) => setImageSettings({ steps: v })}
          min={1}
          max={50}
          disabled={generating}
        />

        <Slider
          label="CFG Scale"
          value={imageSettings.cfg}
          onChange={(v) => setImageSettings({ cfg: v })}
          min={1}
          max={20}
          step={0.5}
          disabled={generating}
        />

        <Slider
          label="Seed"
          value={imageSettings.seed}
          onChange={(v) => setImageSettings({ seed: v })}
          min={-1}
          max={2 ** 48}
          disabled={generating}
         
        />

        <Toggle
          label="Turbo Mode (8 steps, LoRA)"
          value={imageSettings.turboMode}
          onChange={(v) => setImageSettings({ turboMode: v })}
          disabled={generating}
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {videoPresets.length > 0 && (
        <div>
          <label className="text-xs text-text-muted mb-1.5 block">Video Model</label>
          <div className="grid grid-cols-2 gap-1.5">
            {videoPresets.map((p, i) => (
              <motion.button
                key={i}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setActivePreset('video', i)}
                disabled={generating}
                className={clsx(
                  'flex items-center gap-2 px-3 py-2 rounded-xl text-xs transition-all text-left',
                  videoActive === i
                    ? 'bg-accent text-white shadow-lg shadow-accent/25'
                    : 'bg-bg-card text-text-secondary hover:bg-bg-hover border border-border',
                  generating && 'opacity-50'
                )}
                title={presetLabel(p)}
              >
                <Clapperboard size={14} className="shrink-0" />
                <div className="min-w-0">
                  <p className="font-medium truncate">{p.name || `Preset ${i + 1}`}</p>
                  <p className={clsx('text-[10px] truncate font-mono', videoActive === i ? 'text-white/70' : 'text-text-muted')}>
                    {p.unet}
                  </p>
                </div>
              </motion.button>
            ))}
          </div>
        </div>
      )}
      <div>
        <label className="text-xs text-text-muted mb-1.5 block">
          Title <span className="text-text-muted/60">(used for the saved filename — AI fills this in, you can edit it)</span>
        </label>
        <input
          type="text"
          value={titles?.video || ''}
          onChange={(e) => setTitle('video', e.target.value)}
          disabled={generating}
          placeholder="Video title"
          className="w-full px-3 py-2 rounded-xl bg-bg-card border border-border text-text-primary placeholder:text-text-muted text-xs focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
        />
      </div>
      <div>
        <label className="text-xs text-text-muted mb-1.5 block">Resolution</label>
        <div className="grid grid-cols-2 gap-1.5">
          {VIDEO_RESOLUTIONS.map((res) => (
            <motion.button
              key={res}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setVideoSettings({ resolution: res })}
              disabled={generating}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-xs font-mono transition-all',
                videoSettings.resolution === res
                  ? 'bg-accent text-white shadow-lg shadow-accent/25'
                  : 'bg-bg-card text-text-secondary hover:bg-bg-hover',
                generating && 'opacity-50'
              )}
            >
              {RES_LABELS[res] || res}
            </motion.button>
          ))}
        </div>
        {videoSettings.resolution === '1080p' && (
          <p className="text-[11px] text-text-muted mt-1.5 leading-snug">
            Native 1080p — ~20+ min per 2-3s clip on 16GB RAM. Keep clips short (longer ones can
            take hours or fail); much faster after a RAM upgrade. Prefer{' '}
            <span className="text-text-secondary">1080p fast</span> until then.
          </p>
        )}
        {videoSettings.resolution === '1080p-fast' && (
          <p className="text-[11px] text-text-muted mt-1.5 leading-snug">
            Samples at 960×544 (the official H3 fast size) and upscales to 1080p with
            4x-UltraSharp — far less RAM/VRAM pressure than native 1080p; slightly softer than a
            native render.
          </p>
        )}
      </div>

      <Slider
        label="Frames"
        value={videoSettings.frames}
        onChange={(v) => setVideoSettings({ frames: v })}
        min={9}
        max={81}
        step={4}
        disabled={generating}
      />

      <Slider
        label="FPS"
        value={videoSettings.fps}
        onChange={(v) => setVideoSettings({ fps: v })}
        min={8}
        max={32}
        disabled={generating}
      />

      <Slider
        label="Steps"
        value={videoSettings.steps}
        onChange={(v) => setVideoSettings({ steps: v })}
        min={1}
        max={50}
        disabled={generating}
      />

      <Slider
        label="CFG Scale"
        value={videoSettings.cfg}
        onChange={(v) => setVideoSettings({ cfg: v })}
        min={1}
        max={20}
        step={0.5}
        disabled={generating}
      />

      <Slider
        label="Seed"
        value={videoSettings.seed}
        onChange={(v) => setVideoSettings({ seed: v })}
        min={-1}
        max={2 ** 48}
        disabled={generating}
       
      />
    </div>
  )
}
