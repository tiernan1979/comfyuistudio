import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Shirt,
  Download,
  Loader2,
  AlertTriangle,
  Scissors,
  Trash2,
  Sparkles,
} from 'lucide-react'
import clsx from 'clsx'
import useStore from '../store/useStore'
import DragDivider from './DragDivider'
import {
  resolveApiBase,
  queuePrompt,
  pollHistory,
  stopGeneration,
  freeLoadedModels,
  downloadFileAs,
  collectOutputFiles,
  assertModelsAvailable,
} from '../lib/comfyui'
import { buildImageWorkflow, snap8 } from '../lib/workflows'
import { PARTS_SLOTS, PARTS_NEG, PART_DIRECTIONS, buildPartPrompt, partDirectionPhrase } from '../lib/parts'
import { rewritePrompt, resolveLlmConfig, pickDefaultModel, PROVIDERS } from '../lib/llm'

const viewUrl = (base, filename, subfolder) =>
  `${base}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(
    subfolder || '',
  )}&type=output`

const SLOTS = PARTS_SLOTS

function Num({ label, value, onChange, min = 32, max = 4096, step = 8, disabled }) {
  return (
    <label className="block">
      <span className="text-xs text-text-muted">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (!Number.isNaN(v)) onChange(Math.max(min, Math.min(max, Math.round(v))))
        }}
        className="w-full mt-1 px-2 py-1 text-xs font-mono text-accent bg-bg-card border border-border rounded focus:outline-none focus:border-accent/50 disabled:opacity-50"
      />
    </label>
  )
}

export default function PartsPanel() {
  const serverUrl = useStore((s) => s.serverUrl)
  const useProxy = useStore((s) => s.useProxy)
  const models = useStore((s) => s.models)
  const settings = useStore((s) => s.partsSettings)
  const setSettings = useStore((s) => s.setPartsSettings)
  const gallery = useStore((s) => s.partsGallery)
  const addToGallery = useStore((s) => s.addPartsGallery)
  const removeFromGallery = useStore((s) => s.removePartsGallery)
  const clearGallery = useStore((s) => s.clearPartsGallery)
  const setSplitSource = useStore((s) => s.setSplitSource)
  const setMode = useStore((s) => s.setMode)
  const controlsWidth = useStore((s) => s.controlsWidth)
  const setControlsWidth = useStore((s) => s.setControlsWidth)

  const base = resolveApiBase(serverUrl, useProxy)
  const slot = SLOTS[settings.slot] || SLOTS.armour
  const direction = settings.direction || slot.dir || 'front'
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState('')
  const [error, setError] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const llmProvider = useStore((s) => s.llmProvider)

  const promptFor = (extra = '') => buildPartPrompt(settings.slot, settings.base, extra, direction)

  // AI prompt writer: hand the model the slot + size so it writes a fitting
  // asset description AND a matching negative prompt.
  const aiWrite = async () => {
    if (aiBusy) return
    setError('')
    let cfg = resolveLlmConfig(useStore.getState())
    if (!cfg.model) {
      try {
        const picked = await pickDefaultModel(cfg)
        if (picked) cfg = { ...cfg, model: picked }
      } catch {
        /* fall through */
      }
    }
    if (!cfg.model) {
      setError('No AI model — open Settings → AI Prompt Writer and pick one.')
      return
    }
    setAiBusy(true)
    try {
      const context =
        `Asset slot: ${slot.label} — ${slot.phrase}\n` +
        `View: ${partDirectionPhrase(direction)}\n` +
        `Output size: ${snap8(settings.width)}x${snap8(settings.height)} px (cut out on white)\n` +
        (settings.base ? `Current description: ${settings.base}` : 'No description yet — invent a fitting one.')
      const out = await rewritePrompt(cfg, {
        text: settings.base || `a ${slot.label.toLowerCase()} for a game character`,
        styleLabel: 'stylized clay game asset',
        mode: 'parts',
        context,
      })
      setSettings({ base: out.prompt, negative: out.negative || settings.negative })
    } catch (err) {
      setError(`AI failed: ${err.message}`)
    } finally {
      setAiBusy(false)
    }
  }

  const generate = async () => {
    setError('')
    setBusy(true)
    const w = snap8(settings.width)
    const h = snap8(settings.height)
    try {
      setStage('Checking models…')
      await assertModelsAvailable(base, 'image', models)
      const count = Math.max(1, Math.min(8, settings.count))
      const seedBase =
        settings.seed === -1 || settings.seed == null
          ? Math.floor(Math.random() * 2 ** 32)
          : settings.seed
      for (let i = 0; i < count; i++) {
        setStage(`Generating ${i + 1} / ${count}…`)
        const wf = buildImageWorkflow({
          prompt: promptFor(),
          negativePrompt: (settings.negative || '').trim() || PARTS_NEG,
          width: w,
          height: h,
          seed: seedBase + i,
          steps: settings.steps,
          cfg: settings.cfg,
          models: models.image,
        })
        const pid = await queuePrompt(base, wf)
        const entry = await pollHistory(base, pid, {
          label: `Part ${i + 1}/${count}`,
          timeoutMs: 15 * 60 * 1000,
          onTick: (s, info) => setStage(`Generating ${i + 1} / ${count} — ${s}s (${info.phase || 'running'})`),
        })
        const files = collectOutputFiles(entry).filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f.filename))
        const url = files.length ? viewUrl(base, files[0].filename, files[0].subfolder) : null
        if (url) {
          addToGallery([
            {
              id: `${Date.now()}-${i}`,
              url,
              filename: files[0].filename,
              name: `${slot.label} ${seedBase + i}`,
              slot: settings.slot,
              seed: seedBase + i,
              width: w,
              height: h,
              prompt: promptFor(),
            },
          ])
        }
      }
      setStage('')
    } catch (err) {
      console.error('parts generation failed', err)
      setError(err.message || 'Generation failed.')
      setStage('')
    } finally {
      try {
        await freeLoadedModels(base)
      } catch {
        /* ignore */
      }
      setBusy(false)
    }
  }

  const stop = async () => {
    try {
      await stopGeneration(base)
    } catch {
      /* ignore */
    }
  }

  const splitItem = async (item) => {
    setSplitSource({ url: item.url, name: item.filename })
    setMode('split')
  }

  return (
    <div className="flex-1 flex flex-col md:flex-row md:overflow-hidden overflow-y-auto">
      {/* Controls */}
      <div
        style={{ '--controls-w': `${controlsWidth}px` }}
        className="flex flex-col border-b md:border-b-0 md:border-r border-border bg-bg-secondary/30 w-full md:w-[var(--controls-w)] md:shrink-0 md:overflow-y-auto"
      >
        <div className="p-3 sm:p-4 space-y-4 flex-1">
          <div>
            <label className="text-xs text-text-muted mb-1.5 block">Slot</label>
            <div className="grid grid-cols-3 gap-1.5">
              {Object.entries(SLOTS).map(([k, s]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() =>
                    setSettings({
                      slot: k,
                      width: s.w,
                      height: s.h,
                      // Keep a deliberate view; otherwise use the slot default
                      // (weapons are side-on, everything else front).
                      direction:
                        settings.direction && settings.direction !== 'front'
                          ? settings.direction
                          : s.dir,
                    })
                  }
                  disabled={busy}
                  className={clsx(
                    'px-1.5 py-1.5 rounded-lg text-[11px] transition-all truncate',
                    settings.slot === k
                      ? 'bg-accent text-white shadow-lg shadow-accent/25'
                      : 'bg-bg-card text-text-secondary hover:bg-bg-hover',
                    busy && 'opacity-50',
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-text-muted mb-1.5 block">View</label>
            <div className="grid grid-cols-4 gap-1.5">
              {PART_DIRECTIONS.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => setSettings({ direction: d.key })}
                  disabled={busy}
                  aria-pressed={direction === d.key}
                  className={clsx(
                    'px-1.5 py-1.5 rounded-lg text-[11px] transition-all truncate',
                    direction === d.key
                      ? 'bg-accent text-white shadow-lg shadow-accent/25'
                      : 'bg-bg-card text-text-secondary hover:bg-bg-hover',
                    busy && 'opacity-50',
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[10px] leading-snug text-text-muted">
              Applied to every variant. Weapons default to side-on.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-text-muted">Character / style</label>
              <button
                onClick={aiWrite}
                disabled={busy || aiBusy}
                title={`Write this with ${PROVIDERS[llmProvider]?.short || 'AI'} — uses the selected slot & size. Configure in Settings`}
                className={clsx(
                  'flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-all',
                  busy || aiBusy
                    ? 'bg-bg-hover text-text-muted'
                    : 'bg-accent/15 text-accent hover:bg-accent/25',
                )}
              >
                {aiBusy ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                {aiBusy ? 'Writing…' : 'AI'}
              </button>
            </div>
            <textarea
              value={settings.base}
              onChange={(e) => setSettings({ base: e.target.value })}
              disabled={busy}
              rows={2}
              placeholder="cute stylized soft matte clay 3D game character"
              className="w-full px-3 py-2 rounded-xl bg-bg-card border border-border text-text-primary placeholder:text-text-muted text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
            />
            <p className="text-[10px] text-text-muted/60 mt-1">
              Add colours/materials here (“dark steel plate armour, gold trim”) — the slot adds the rest. The AI
              button writes this <span className="text-text-secondary">and</span> the negative from the selected slot.
            </p>
            <label className="block mt-2">
              <span className="text-[10px] text-text-muted">Negative prompt (optional)</span>
              <textarea
                value={settings.negative}
                onChange={(e) => setSettings({ negative: e.target.value })}
                disabled={busy}
                rows={2}
                placeholder={PARTS_NEG}
                className="w-full mt-1 px-3 py-2 rounded-xl bg-bg-card border border-border text-text-primary placeholder:text-text-muted/60 text-[11px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
              />
            </label>
          </div>

          <div>
            <label className="text-xs text-text-muted mb-1.5 block">How many</label>
            <div className="grid grid-cols-4 gap-1.5">
              {[1, 2, 4, 8].map((n) => (
                <button
                  key={n}
                  onClick={() => setSettings({ count: n })}
                  disabled={busy}
                  className={clsx(
                    'px-2 py-1.5 rounded-lg text-xs transition-all',
                    settings.count === n
                      ? 'bg-accent text-white shadow-lg shadow-accent/25'
                      : 'bg-bg-card text-text-secondary hover:bg-bg-hover',
                    busy && 'opacity-50',
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Num label="Width" value={settings.width} onChange={(v) => setSettings({ width: v })} disabled={busy} />
            <Num label="Height" value={settings.height} onChange={(v) => setSettings({ height: v })} disabled={busy} />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Num label="Steps" value={settings.steps} min={1} max={50} step={1} onChange={(v) => setSettings({ steps: v })} disabled={busy} />
            <Num label="CFG" value={settings.cfg} min={1} max={20} step={0.5} onChange={(v) => setSettings({ cfg: v })} disabled={busy} />
            <Num label="Seed" value={settings.seed} min={-1} max={2 ** 48} step={1} onChange={(v) => setSettings({ seed: v })} disabled={busy} />
          </div>
        </div>

        <div className="p-3 sm:p-4 border-t border-border space-y-3">
          {stage && (
            <div className="flex items-center gap-2 text-xs text-text-secondary">
              <Loader2 size={14} className="animate-spin text-accent shrink-0" />
              <span className="truncate">{stage}</span>
            </div>
          )}
          {error && (
            <div className="flex items-start gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg p-2">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span className="break-words">{error}</span>
            </div>
          )}
          <div className="flex gap-2">
            <motion.button
              whileHover={{ scale: busy ? 1 : 1.02 }}
              whileTap={{ scale: busy ? 1 : 0.98 }}
              onClick={generate}
              disabled={busy}
              className={clsx(
                'flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all',
                busy ? 'bg-bg-hover text-text-muted cursor-not-allowed' : 'bg-accent text-white shadow-lg shadow-accent/25',
              )}
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {busy ? 'Generating…' : `Generate ${settings.count}`}
            </motion.button>
            {busy && (
              <motion.button
                whileTap={{ scale: 0.96 }}
                onClick={stop}
                className="px-3 py-2.5 rounded-xl text-sm bg-bg-card text-text-secondary hover:bg-bg-hover border border-border"
              >
                Stop
              </motion.button>
            )}
          </div>
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

      {/* Gallery */}
      <div className="flex-1 p-3 sm:p-4 flex flex-col gap-3 md:overflow-hidden min-h-[50vh] md:min-h-0">
        <div className="flex items-center gap-3">
          <span className="text-xs text-text-secondary">{gallery.length} generated</span>
          <div className="flex-1" />
          {gallery.length > 0 && (
            <button
              onClick={clearGallery}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-bg-card hover:bg-bg-hover border border-border text-text-secondary"
            >
              <Trash2 size={13} /> Clear
            </button>
          )}
        </div>

        <AnimatePresence mode="wait">
          {gallery.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col items-center justify-center gap-3 text-center"
            >
              {busy ? (
                <>
                  <Loader2 size={28} className="animate-spin text-accent" />
                  <p className="text-sm text-text-secondary">Generating your {slot.label.toLowerCase()} variants…</p>
                </>
              ) : (
                <>
                  <Shirt size={28} className="text-text-muted" />
                  <p className="text-sm text-text-secondary">Generate a wardrobe of parts</p>
                  <p className="text-xs text-text-muted max-w-md">
                    Pick a slot and style, generate a batch, then keep the ones you like. Hit Split on any image to
                    send it straight to the part splitter for Godot rigging.
                  </p>
                </>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="grid"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 overflow-y-auto min-h-0 pb-2"
            >
              {gallery.map((g) => (
                <div key={g.id} className="rounded-xl border border-border bg-bg-card overflow-hidden flex flex-col">
                  <div className="flex-1 flex items-center justify-center p-2 min-h-[130px] bg-white/5">
                    <img src={g.url} alt={g.name} className="max-h-40 max-w-full object-contain" loading="lazy" />
                  </div>
                  <div className="px-2 py-1.5 border-t border-border">
                    <p className="text-[11px] text-text-primary truncate">{g.name}</p>
                    <p className="text-[10px] text-text-muted font-mono">
                      {g.width}×{g.height} · seed {g.seed}
                    </p>
                    <div className="flex items-center gap-1 mt-1.5">
                      <button
                        onClick={() => splitItem(g)}
                        className="flex-1 flex items-center justify-center gap-1 px-1.5 py-1 rounded-md text-[10px] bg-accent/15 text-accent hover:bg-accent/25"
                        title="Split this into parts"
                      >
                        <Scissors size={11} /> Split
                      </button>
                      <button
                        onClick={() => downloadFileAs(g.url, g.filename)}
                        className="p-1.5 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary"
                        title="Download"
                      >
                        <Download size={12} />
                      </button>
                      <button
                        onClick={() => removeFromGallery(g.id)}
                        className="p-1.5 rounded-md hover:bg-red-500/20 text-text-muted hover:text-red-300"
                        title="Remove"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
