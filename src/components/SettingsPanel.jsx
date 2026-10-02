import { motion } from 'framer-motion'
import useStore from '../store/useStore'
import clsx from 'clsx'

const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3']
const VIDEO_RESOLUTIONS = ['480p', '720p']

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

function Slider({ label, value, onChange, min, max, step = 1, disabled, suffix = '' }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-secondary">{label}</span>
        <span className="text-xs text-accent font-mono">{value}{suffix}</span>
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
    </div>
  )
}

export default function SettingsPanel() {
  const mode = useStore((s) => s.mode)
  const imageSettings = useStore((s) => s.imageSettings)
  const videoSettings = useStore((s) => s.videoSettings)
  const editSettings = useStore((s) => s.editSettings)
  const setImageSettings = useStore((s) => s.setImageSettings)
  const setVideoSettings = useStore((s) => s.setVideoSettings)
  const setEditSettings = useStore((s) => s.setEditSettings)
  const generating = useStore((s) => s.generating)

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
          suffix={editSettings.seed === -1 ? ' (random)' : ''}
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
          suffix={imageSettings.seed === -1 ? ' (random)' : ''}
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
              {res}
            </motion.button>
          ))}
        </div>
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
        suffix={videoSettings.seed === -1 ? ' (random)' : ''}
      />
    </div>
  )
}
