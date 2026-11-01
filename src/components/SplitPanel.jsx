import { motion, AnimatePresence } from 'framer-motion'
import { Scissors, Loader2, AlertTriangle } from 'lucide-react'
import clsx from 'clsx'
import useStore from '../store/useStore'
import DragDivider from './DragDivider'
import { resolveApiBase } from '../lib/comfyui'
import { AUTOSPLIT_LABEL_PRESETS } from '../lib/workflows'
import useAutosplit from '../hooks/useAutosplit'
import { Section } from './split/Section'
import SplitSource from './split/SplitSource'
import PartsGrid from './split/PartsGrid'

const FIELD =
  'w-full rounded-lg border border-border bg-bg-card px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-50'

export default function SplitPanel() {
  const serverUrl = useStore((s) => s.serverUrl)
  const useProxy = useStore((s) => s.useProxy)
  const settings = useStore((s) => s.splitSettings)
  const setSettings = useStore((s) => s.setSplitSettings)
  const splitSource = useStore((s) => s.splitSource)
  const setSplitSource = useStore((s) => s.setSplitSource)
  const controlsWidth = useStore((s) => s.controlsWidth)
  const setControlsWidth = useStore((s) => s.setControlsWidth)

  const base = resolveApiBase(serverUrl, useProxy)

  const getSourceFile = async () => {
    if (splitSource?.file) return splitSource.file
    if (splitSource?.url) {
      const res = await fetch(splitSource.url)
      if (!res.ok) throw new Error(`Could not load the source image (HTTP ${res.status})`)
      const blob = await res.blob()
      return new File([blob], splitSource.name || 'source.png', {
        type: blob.type || 'image/png',
      })
    }
    return null
  }

  const split = useAutosplit({ base, settings, getSourceFile })

  const labels = String(settings.labels || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

  const acceptFile = (file) => {
    if (splitSource?.preview) URL.revokeObjectURL(splitSource.preview)
    setSplitSource({ file, preview: URL.createObjectURL(file), name: file.name })
    split.reset()
  }

  const clearSource = () => {
    if (splitSource?.preview) URL.revokeObjectURL(splitSource.preview)
    setSplitSource(null)
    split.reset()
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
      <div
        style={{ '--controls-w': `${controlsWidth}px` }}
        className="flex w-full flex-col border-b border-border bg-bg-secondary/30 md:w-[var(--controls-w)] md:shrink-0 md:overflow-y-auto md:border-b-0 md:border-r"
      >
        <div className="flex-1 space-y-4 p-3 sm:p-4">
          <SplitSource
            source={splitSource}
            busy={split.busy}
            onPick={acceptFile}
            onClear={clearSource}
            onError={split.setError}
          />

          <Section title="Part labels">
            <div className="mb-1.5 grid grid-cols-3 gap-1.5">
              {Object.keys(AUTOSPLIT_LABEL_PRESETS).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() =>
                    setSettings({ labelPreset: k, labels: AUTOSPLIT_LABEL_PRESETS[k].join('\n') })
                  }
                  disabled={split.busy}
                  className={clsx(
                    'rounded-lg px-2 py-1.5 text-xs capitalize transition-colors',
                    settings.labelPreset === k
                      ? 'bg-accent text-white shadow-sm shadow-accent/30'
                      : 'border border-border bg-bg-card text-text-secondary hover:bg-bg-hover',
                    split.busy && 'opacity-50',
                  )}
                >
                  {k}
                </button>
              ))}
            </div>
            <textarea
              value={settings.labels}
              onChange={(e) => setSettings({ labels: e.target.value, labelPreset: 'custom' })}
              disabled={split.busy}
              rows={7}
              placeholder={
                'one label per line\nhead\nhair\ntorso\nupper arm\nlower arm\nhand\nupper leg\nlower leg\nfoot'
              }
              className={clsx(FIELD, 'font-mono leading-relaxed')}
            />
            <p className="text-[10px] text-text-muted/70">
              SAM 3 segments what it can <span className="text-text-secondary">see</span>: prompt
              visible things. On clothed bodies use garment names (shirt, trousers) —
              “torso/chest/shin” find nothing. Limbs split at the elbow/knee (upper arm/leg keep the
              joint). Paired<span className="font-mono"> left x / right x </span> labels are
              resolved by position.
            </p>
          </Section>

          <Section title="Output name">
            <input
              type="text"
              value={settings.characterName}
              onChange={(e) => setSettings({ characterName: e.target.value })}
              disabled={split.busy}
              className={FIELD}
            />
          </Section>

          <details className="text-xs">
            <summary className="cursor-pointer text-text-muted transition-colors hover:text-text-primary">
              Advanced
            </summary>
            <div className="mt-2 space-y-3">
              <label className="block">
                <span className="text-text-muted">
                  Confidence {settings.confidence.toFixed(2)}
                </span>
                <input
                  type="range"
                  min={0.05}
                  max={0.9}
                  step={0.05}
                  value={settings.confidence}
                  onChange={(e) => setSettings({ confidence: Number(e.target.value) })}
                  disabled={split.busy}
                  className="mt-1 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-bg-hover accent-accent"
                />
              </label>
              <label className="block">
                <span className="text-text-muted">
                  Retry confidence {settings.retryConfidence.toFixed(2)}
                </span>
                <input
                  type="range"
                  min={0}
                  max={0.5}
                  step={0.01}
                  value={settings.retryConfidence}
                  onChange={(e) => setSettings({ retryConfidence: Number(e.target.value) })}
                  disabled={split.busy}
                  className="mt-1 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-bg-hover accent-accent"
                />
              </label>
              <label className="block">
                <span className="text-text-muted">SAM 3 model</span>
                <input
                  type="text"
                  value={settings.sam3Model}
                  onChange={(e) => setSettings({ sam3Model: e.target.value })}
                  disabled={split.busy}
                  className={clsx(FIELD, 'mt-1 py-1 font-mono text-[11px]')}
                />
              </label>
              <label className="block">
                <span className="text-text-muted">Output folder</span>
                <input
                  type="text"
                  value={settings.outputDirectory}
                  onChange={(e) => setSettings({ outputDirectory: e.target.value })}
                  disabled={split.busy}
                  className={clsx(FIELD, 'mt-1 py-1 font-mono text-[11px]')}
                />
              </label>
            </div>
          </details>
        </div>

        <div className="space-y-3 border-t border-border p-3 sm:p-4">
          {split.stage && (
            <div className="flex items-center gap-2 text-xs text-text-secondary">
              <Loader2 size={14} className="shrink-0 animate-spin text-accent" />
              <span className="truncate">{split.stage}</span>
            </div>
          )}
          {split.error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span className="break-words">{split.error}</span>
            </div>
          )}
          <div className="flex gap-2">
            <motion.button
              whileHover={split.busy || !splitSource ? undefined : { scale: 1.02 }}
              whileTap={split.busy || !splitSource ? undefined : { scale: 0.98 }}
              onClick={() => split.run(labels)}
              disabled={split.busy || !splitSource}
              className={clsx(
                'flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors',
                split.busy || !splitSource
                  ? 'cursor-not-allowed bg-bg-hover text-text-muted'
                  : 'bg-accent text-white shadow-sm shadow-accent/30 hover:bg-accent-hover',
              )}
            >
              {split.busy ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Scissors size={16} />
              )}
              {split.busy ? 'Splitting…' : 'Split into parts'}
            </motion.button>
            {split.busy && (
              <motion.button
                whileTap={{ scale: 0.96 }}
                onClick={split.stop}
                className="rounded-xl border border-border bg-bg-card px-3 py-2.5 text-sm text-text-secondary transition-colors hover:bg-bg-hover"
              >
                Stop
              </motion.button>
            )}
          </div>
          <p className="text-[10px] text-text-muted/70">
            {labels.length} labels · runs Depth Anything V2 + SAM 3 on your ComfyUI box (~1–3 min).
          </p>
        </div>
      </div>

      <DragDivider
        className="hidden md:block"
        label="Resize controls panel"
        value={controlsWidth}
        min={260}
        max={560}
        defaultValue={320}
        onChange={setControlsWidth}
        direction={1}
      />

      <div className="flex min-h-[50vh] flex-1 flex-col gap-3 p-3 sm:p-4 md:min-h-0 md:overflow-hidden">
        <AnimatePresence mode="wait">
          {!split.result ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-1 flex-col items-center justify-center gap-3 text-center"
            >
              {split.busy ? (
                <>
                  <Loader2 size={28} className="animate-spin text-accent" />
                  <p className="text-sm text-text-secondary">
                    SAM 3 is cutting your character into parts…
                  </p>
                </>
              ) : (
                <>
                  <Scissors size={28} className="text-text-muted" />
                  <p className="text-sm text-text-secondary">
                    Split a character into riggable part PNGs
                  </p>
                  <p className="max-w-md text-xs text-text-muted">
                    Drop a flat character (an underwear T-pose works best), pick labels, and hit
                    Split. You get one PNG per part plus a parts.json with each part's position and
                    draw order for Godot.
                  </p>
                </>
              )}
            </motion.div>
          ) : (
            <PartsGrid
              result={split.result}
              onZip={split.downloadZip}
              onManifest={split.downloadManifest}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
