import { motion } from 'framer-motion'
import { useRef } from 'react'
import { Disc3, Clapperboard, AudioWaveform } from 'lucide-react'
import useStore, { presetLabel } from '../store/useStore'
import { isAceStepModel, isStableAudioModel, isMiniMaxH3, H3_MAX_SEGMENTS, h3ChainedSeconds, h3SegmentsForDuration, h3WindowSeconds, STABLE_AUDIO_MAX_SECONDS, SPRITE_ANIMATIONS, SPRITE_ANIMATION_FRAMES } from '../lib/workflows'
import { layoutRows, videoFramesOf, WAN_FRAME_COUNTS } from '../lib/character'
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
  const musicIsStable = isStableAudioModel(musicUnet) || musicPreset?.engine === 'stable_audio'
  const videoPresets = useStore((s) => s.presets?.video || [])
  const videoActive = useStore((s) => s.active?.video)
  const flatVideo = useStore((s) => s.models?.video || {})
  const videoPreset = videoActive != null ? videoPresets[videoActive] : null
  const videoUnet = (videoPreset?.unet ?? flatVideo.unet) || ''
  const sfxSettings = useStore((s) => s.sfxSettings)
  const setSfxSettings = useStore((s) => s.setSfxSettings)
  const sfxPresets = useStore((s) => s.presets?.sfx || [])
  const sfxActive = useStore((s) => s.active?.sfx)
  const flatSfx = useStore((s) => s.models?.sfx || {})
  const sfxPreset = sfxActive != null ? sfxPresets[sfxActive] : null
  const sfxUnet = (sfxPreset?.unet ?? flatSfx.unet) || ''
  const spriteSettings = useStore((s) => s.spriteSettings)
  const setSpriteSettings = useStore((s) => s.setSpriteSettings)

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
                const isStable = p.engine === 'stable_audio' || isStableAudioModel(p.unet || '')
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
                        {isAce ? 'ACE-Step 1.5' : isStable ? 'Stable Audio 3' : /minimax/i.test(p.unet || '') ? 'MiniMax Music 3' : p.unet}
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
          value={musicIsStable ? Math.min(musicSettings.duration, STABLE_AUDIO_MAX_SECONDS) : musicSettings.duration}
          onChange={(v) => setMusicSettings({ duration: v })}
          min={10}
          max={musicIsStable ? STABLE_AUDIO_MAX_SECONDS : isAceStepModel(musicUnet) ? 2000 : 360}
          disabled={generating}
          unit="sec"
          suffix={musicIsStable
            ? 'Stable Audio 3 renders short SFX — capped at 47s.'
            : isAceStepModel(musicUnet)
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
          <p className="text-[10px] text-text-muted/60 mt-1">
            ComfyUI stores lossless renders as .flac — the player converts them to a real .wav on
            download (a .flac original stays available too).
          </p>
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

  if (mode === 'sfx') {
    return (
      <div className="space-y-4">
        {sfxPresets.length > 0 && (
          <div>
            <label className="text-xs text-text-muted mb-1.5 block">SFX Engine</label>
            <div className="grid grid-cols-2 gap-1.5">
              {sfxPresets.map((p, i) => (
                <motion.button
                  key={i}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setActivePreset('sfx', i)}
                  disabled={generating}
                  className={clsx(
                    'flex items-center gap-2 px-3 py-2 rounded-xl text-xs transition-all text-left',
                    sfxActive === i
                      ? 'bg-accent text-white shadow-lg shadow-accent/25'
                      : 'bg-bg-card text-text-secondary hover:bg-bg-hover border border-border',
                    generating && 'opacity-50'
                  )}
                  title={presetLabel(p)}
                >
                  <AudioWaveform size={14} className="shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium truncate">{p.name || `Preset ${i + 1}`}</p>
                    <p className={clsx('text-[10px] truncate', sfxActive === i ? 'text-white/70' : 'text-text-muted')}>
                      Stable Audio 3
                    </p>
                  </div>
                </motion.button>
              ))}
            </div>
            <p className="text-[10px] text-text-muted/60 mt-1">
              Add more presets in Settings → Models → SFX.
            </p>
          </div>
        )}

        <div>
          <label className="text-xs text-text-muted mb-1.5 block">
            Title <span className="text-text-muted/60">(used for the saved filename)</span>
          </label>
          <input
            type="text"
            value={titles?.sfx || ''}
            onChange={(e) => setTitle('sfx', e.target.value)}
            disabled={generating}
            placeholder="Sound effect name (e.g. Metal Door Slam)"
            className="w-full px-3 py-2 rounded-xl bg-bg-card border border-border text-text-primary placeholder:text-text-muted text-xs focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
          />
        </div>

        <Slider
          label="Duration"
          value={sfxSettings.duration}
          onChange={(v) => setSfxSettings({ duration: v })}
          min={1}
          max={STABLE_AUDIO_MAX_SECONDS}
          disabled={generating}
          unit="sec"
          suffix="Stable Audio 3 renders short sound effects (capped at 47s)."
        />

        <Slider
          label="Seed"
          value={sfxSettings.seed}
          onChange={(v) => setSfxSettings({ seed: v })}
          min={-1}
          max={2 ** 48}
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
                onClick={() => setSfxSettings({ quality: q.v })}
                disabled={generating}
                className={clsx(
                  'px-2 py-1.5 rounded-lg text-xs transition-all',
                  sfxSettings.quality === q.v
                    ? 'bg-accent text-white shadow-lg shadow-accent/25'
                    : 'bg-bg-card text-text-secondary hover:bg-bg-hover',
                  generating && 'opacity-50'
                )}
              >
                {q.t}
              </motion.button>
            ))}
          </div>
          <p className="text-[10px] text-text-muted/60 mt-1">
            ComfyUI stores lossless renders as .flac — the player converts them to a real .wav on
            download (a .flac original stays available too).
          </p>
        </div>
      </div>
    )
  }

  if (mode === 'sprite') {
    const isVideo = (spriteSettings.engine || 'pose') === 'video'
    const videoFrames = videoFramesOf(spriteSettings)
    const layout = layoutRows(spriteSettings)
    const rowCount = layout.length
    const columns = layout.reduce((m, r) => Math.max(m, r.frames), 1)
    const total = layout.reduce((n, r) => n + r.frames, 0)
    const selected = String(spriteSettings.animations || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const animFrameMap = {}
    for (const part of String(spriteSettings.animFrames || '').split(',')) {
      const [k, v] = part.split(':')
      const key = (k || '').trim()
      const n = parseInt(v, 10)
      if (key && Number.isFinite(n)) animFrameMap[key] = n
    }
    const countOf = (k) => animFrameMap[k] ?? SPRITE_ANIMATION_FRAMES[k] ?? 6
    const setAnimCount = (k, n) => {
      const m = { ...animFrameMap, [k]: Math.max(1, Math.min(12, n)) }
      setSpriteSettings({ animFrames: Object.entries(m).map(([kk, vv]) => `${kk}:${vv}`).join(',') })
    }
    const toggleAnim = (k) => {
      const set = new Set(selected)
      if (set.has(k)) set.delete(k)
      else set.add(k)
      setSpriteSettings({ animations: [...set].join(',') })
    }
    const btn = (active) =>
      clsx(
        'px-2 py-1.5 rounded-lg text-xs transition-all truncate',
        active ? 'bg-accent text-white shadow-lg shadow-accent/25' : 'bg-bg-card text-text-secondary hover:bg-bg-hover',
        generating && 'opacity-50'
      )
    return (
      <div className="space-y-4">
        <div>
          <label className="text-xs text-text-muted mb-1.5 block">Engine</label>
          <div className="grid grid-cols-2 gap-1.5">
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => setSpriteSettings({ engine: 'pose' })}
              disabled={generating}
              className={btn(!isVideo)}
            >
              Pose edits
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => setSpriteSettings({ engine: 'video' })}
              disabled={generating}
              className={btn(isVideo)}
            >
              Video (WAN 2.2)
            </motion.button>
          </div>
          <p className="text-[10px] text-text-muted/60 mt-1">
            {isVideo
              ? 'Each row is rendered as a short WAN 2.2 image-to-video animation from a generated keyframe — smoother, natural motion; minutes per row on a 16 GB card.'
              : 'One AI pose edit per frame — fast, crisp, classic sheet. No video models needed.'}
          </p>
        </div>

        {isVideo && (
          <div>
            <label className="text-xs text-text-muted mb-1.5 block">Frames per animation (WAN needs 4n+1)</label>
            <div className="grid grid-cols-4 gap-1.5">
              {WAN_FRAME_COUNTS.map((f) => (
                <motion.button
                  key={f}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setSpriteSettings({ videoFrames: f })}
                  disabled={generating}
                  className={btn(videoFrames === f)}
                >
                  {f}
                </motion.button>
              ))}
            </div>
            <p className="text-[10px] text-text-muted/60 mt-1">
              Every row renders {videoFrames} frames ({(videoFrames / 16).toFixed(1)}s at 16 fps). Longer loops look
              smoother but each row costs a full WAN pass.
            </p>
          </div>
        )}

        {isVideo && (
          <div>
            <label className="text-xs text-text-muted mb-1.5 block">Render size</label>
            <div className="grid grid-cols-3 gap-1.5">
              {[384, 512, 640].map((res) => (
                <motion.button
                  key={res}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setSpriteSettings({ videoRes: res })}
                  disabled={generating}
                  className={btn((spriteSettings.videoRes || 512) === res)}
                >
                  {res}²
                </motion.button>
              ))}
            </div>
            <p className="text-[10px] text-text-muted/60 mt-1">
              WAN samples at this size, then frames scale down to the cell size. 512² is the reference default.
            </p>
          </div>
        )}

        <div>
          <label className="text-xs text-text-muted mb-1.5 block">Sheet type</label>
          <div className="grid grid-cols-2 gap-1.5">
            <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={() => setSpriteSettings({ sheetMode: 'single' })} disabled={generating} className={btn(spriteSettings.sheetMode !== 'multi')}>
              Single animation
            </motion.button>
            <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={() => setSpriteSettings({ sheetMode: 'multi' })} disabled={generating} className={btn(spriteSettings.sheetMode === 'multi')}>
              Multiple animations
            </motion.button>
          </div>
        </div>

        {spriteSettings.sheetMode === 'multi' ? (
          <div>
            <label className="text-xs text-text-muted mb-1.5 block">Animations &amp; frame counts</label>
            <div className="space-y-1.5">
              {Object.entries(SPRITE_ANIMATIONS).map(([k, a]) => {
                const on = selected.includes(k)
                return (
                  <div key={k} className="flex items-center gap-2">
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      onClick={() => toggleAnim(k)}
                      disabled={generating}
                      className={clsx(
                        'flex-1 text-left px-2 py-1.5 rounded-lg text-xs transition-all truncate',
                        on ? 'bg-accent text-white shadow-lg shadow-accent/25' : 'bg-bg-card text-text-secondary hover:bg-bg-hover',
                        generating && 'opacity-50'
                      )}
                    >
                      {a.label}
                    </motion.button>
                    {on && !isVideo && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => setAnimCount(k, countOf(k) - 1)} disabled={generating} className="w-6 h-6 rounded bg-bg-hover text-text-secondary hover:bg-white/10 text-sm leading-none disabled:opacity-50">
                          −
                        </button>
                        <span className="w-5 text-center text-xs font-mono text-text-primary">{countOf(k)}</span>
                        <button onClick={() => setAnimCount(k, countOf(k) + 1)} disabled={generating} className="w-6 h-6 rounded bg-bg-hover text-text-secondary hover:bg-white/10 text-sm leading-none disabled:opacity-50">
                          +
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            {isVideo && (
              <p className="text-[10px] text-text-muted/60 mt-1.5">
                Every row renders the {videoFrames}-frame video length chosen above (per-animation counts apply to the
                pose engine only).
              </p>
            )}
          </div>
        ) : (
          <>
            <div>
              <label className="text-xs text-text-muted mb-1.5 block">Animation</label>
              <select
                value={spriteSettings.animation}
                onChange={(e) => setSpriteSettings({ animation: e.target.value })}
                disabled={generating}
                className="w-full px-3 py-2 rounded-xl bg-bg-card border border-border text-text-primary text-xs focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
              >
                {Object.entries(SPRITE_ANIMATIONS).map(([k, a]) => (
                  <option key={k} value={k}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
            {!isVideo && (
              <Slider label="Frames" value={spriteSettings.frames} onChange={(v) => setSpriteSettings({ frames: v })} min={1} max={12} disabled={generating} />
            )}
          </>
        )}

        <div>
          <label className="text-xs text-text-muted mb-1.5 block">Directions</label>
          <div className="grid grid-cols-3 gap-1.5">
            {[
              { v: 'none', t: 'None' },
              { v: 'lr', t: 'Left / Right' },
              { v: '4way', t: '4-way' },
            ].map((o) => (
              <motion.button key={o.v} whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={() => setSpriteSettings({ directions: o.v })} disabled={generating} className={btn((spriteSettings.directions || 'none') === o.v)}>
                {o.t}
              </motion.button>
            ))}
          </div>
          <p className="text-[10px] text-text-muted/60 mt-1">Adds a row per direction for idle / walk / run.</p>
        </div>

        <div>
          <label className="text-xs text-text-muted mb-1.5 block">Cell size (px)</label>
          <div className="grid grid-cols-4 gap-1.5">
            {[64, 128, 256, 512].map((c) => (
              <motion.button key={c} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={() => setSpriteSettings({ cellSize: c })} disabled={generating} className={btn((spriteSettings.cellSize || 256) === c)}>
                {c}
              </motion.button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs text-text-muted mb-1.5 block">Background</label>
          <div className="grid grid-cols-3 gap-1.5">
            {[
              { v: 'transparent', t: 'Transparent' },
              { v: 'black', t: 'Black' },
              { v: 'magenta', t: 'Magenta' },
            ].map((o) => (
              <motion.button key={o.v} whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={() => setSpriteSettings({ background: o.v })} disabled={generating} className={btn((spriteSettings.background || 'transparent') === o.v)}>
                {o.t}
              </motion.button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Slider label="FPS" value={spriteSettings.fps} onChange={(v) => setSpriteSettings({ fps: v })} min={1} max={30} disabled={generating} />
          <Slider label="Seed" value={spriteSettings.seed} onChange={(v) => setSpriteSettings({ seed: v })} min={-1} max={2 ** 48} disabled={generating} />
        </div>

        <p className="text-[10px] text-text-muted/70 leading-snug">
          Sheet: {columns} columns × {rowCount} row{rowCount > 1 ? 's' : ''} = {total} frames
          {isVideo
            ? total > 96
              ? ' — over the 96-frame cap, reduce rows or frames per animation'
              : ''
            : total > 48
              ? ' — over the 48-frame cap, reduce counts'
              : ''}
          . Rows are left-aligned and may differ in length (like a classic character sheet). PNG + Godot
          SpriteFrames .tres (one animation per row);{' '}
          {isVideo ? 'keyframe from the Image models, rows from the WAN 2.2 GGUF experts.' : 'uses the Image models.'}
        </p>
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

      {/* MiniMax H3 only: pick a target length; the builder chains enough
          windows (last-frame continuation) to reach it. Duration drives the
          window count, so Frames/FPS set the per-window size and this sets
          how many. */}
      {isMiniMaxH3(videoUnet) && (() => {
        const vFrames = videoSettings.frames || 33
        const vFps = videoSettings.fps || 16
        const oneWindow = h3WindowSeconds(vFrames, vFps)
        const duration = videoSettings.duration ?? oneWindow
        const maxDuration = Math.ceil(h3ChainedSeconds(H3_MAX_SEGMENTS, vFrames, vFps))
        const windows = h3SegmentsForDuration(duration, vFrames, vFps)
        const achieved = h3ChainedSeconds(windows, vFrames, vFps)
        return (
          <>
            <Slider
              label="Length"
              value={duration}
              onChange={(v) => setVideoSettings({ duration: v })}
              min={1}
              max={maxDuration}
              step={1}
              unit="sec"
              disabled={generating}
              suffix={
                windows > 1
                  ? `${windows} chained windows → ≈ ${achieved.toFixed(1)}s actual. Each window is a full re-sample (~3 min each here).`
                  : `Single clip (≈ ${achieved.toFixed(1)}s). Raise Length to chain more windows into a longer video.`
              }
            />
            {windows > 1 && (
              <Slider
                label="Audio crossfade"
                value={videoSettings.crossfadeSeconds ?? 0.5}
                onChange={(v) => setVideoSettings({ crossfadeSeconds: v })}
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
      })()}
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
