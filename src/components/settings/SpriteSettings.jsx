import useStore from '../../store/useStore'
import {
  SPRITE_ANIMATIONS,
  SPRITE_ANIMATION_FRAMES,
} from '../../lib/workflows'
import { layoutRows, videoFramesOf, WAN_FRAME_COUNTS } from '../../lib/character'
import { Slider, Field, Hint, ChoiceGrid, choiceClass } from './controls'
import {
  ExpressionRowChips,
  ExpressionSelect,
  FrameExpressionEditor,
} from './sprite/ExpressionControls'

const ENGINE_OPTIONS = [
  { value: 'pose', label: 'Pose edits' },
  { value: 'video', label: 'Video (WAN 2.2)' },
]

const DIRECTION_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'lr', label: 'Left / Right' },
  { value: '4way', label: '4-way' },
]

const BACKGROUND_OPTIONS = [
  { value: 'transparent', label: 'Transparent' },
  { value: 'black', label: 'Black' },
  { value: 'magenta', label: 'Magenta' },
]

const parseAnimFrames = (raw) => {
  const map = {}
  for (const part of String(raw || '').split(',')) {
    const [k, v] = part.split(':')
    const key = (k || '').trim()
    const n = parseInt(v, 10)
    if (key && Number.isFinite(n)) map[key] = n
  }
  return map
}

export default function SpriteSettings() {
  const settings = useStore((s) => s.spriteSettings)
  const set = useStore((s) => s.setSpriteSettings)
  const generating = useStore((s) => s.generating)

  const isVideo = (settings.engine || 'pose') === 'video'
  const videoFrames = videoFramesOf(settings)
  const layout = layoutRows(settings)
  const rowCount = layout.length
  const columns = layout.reduce((m, r) => Math.max(m, r.frames), 1)
  const total = layout.reduce((n, r) => n + r.frames, 0)

  // Parse to a Set once: `string.includes(key)` used to match substrings
  // (e.g. "idle" inside "idle_alt"), toggling the wrong animation.
  const selected = new Set(
    String(settings.animations || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  const animFrameMap = parseAnimFrames(settings.animFrames)
  const countOf = (k) => animFrameMap[k] ?? SPRITE_ANIMATION_FRAMES[k] ?? 6

  const setAnimCount = (k, n) => {
    const m = { ...animFrameMap, [k]: Math.max(1, Math.min(12, n)) }
    set({
      animFrames: Object.entries(m)
        .map(([kk, vv]) => `${kk}:${vv}`)
        .join(','),
    })
  }

  const toggleAnim = (k) => {
    const next = new Set(selected)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    set({ animations: [...next].join(',') })
  }

  const setAnimExpression = (k, expr) => {
    const m = { ...(settings.animExpressions || {}) }
    if (expr) m[k] = expr
    else delete m[k]
    set({ animExpressions: m })
  }

  // One entry per animation actually in the sheet (directional rows share an
  // animation, expression-only rows are not editable here).
  const seenAnims = new Map()
  for (const row of layout) {
    if (row.expressionOnly) continue
    const cur = seenAnims.get(row.animation) || {
      key: row.animation,
      label: SPRITE_ANIMATIONS[row.animation]?.label || row.animation,
      frames: 0,
    }
    cur.frames = Math.max(cur.frames, row.frames)
    seenAnims.set(row.animation, cur)
  }
  const expressionAnims = [...seenAnims.values()]

  const frameCap = isVideo ? 96 : 48

  return (
    <div className="space-y-4">
      <Field label="Engine">
        <ChoiceGrid
          options={ENGINE_OPTIONS}
          value={isVideo ? 'video' : 'pose'}
          onChange={(v) => set({ engine: v })}
          disabled={generating}
        />
        <Hint>
          {isVideo
            ? 'Each row is rendered as a short WAN 2.2 image-to-video animation from a generated keyframe — smoother, natural motion; minutes per row on a 16 GB card.'
            : 'One AI pose edit per frame — fast, crisp, classic sheet. No video models needed.'}
        </Hint>
      </Field>

      {isVideo && (
        <Field label="Frames per animation" hint="WAN needs 4n+1">
          <ChoiceGrid
            options={WAN_FRAME_COUNTS.map((f) => ({ value: f, label: f }))}
            value={videoFrames}
            onChange={(f) => set({ videoFrames: f })}
            disabled={generating}
            cols={4}
          />
          <Hint>
            Every row renders {videoFrames} frames ({(videoFrames / 16).toFixed(1)}s at 16 fps).
            Longer loops look smoother but each row costs a full WAN pass.
          </Hint>
        </Field>
      )}

      {isVideo && (
        <Field label="Render size">
          <ChoiceGrid
            options={[384, 512, 640].map((res) => ({ value: res, label: `${res}²` }))}
            value={settings.videoRes || 512}
            onChange={(res) => set({ videoRes: res })}
            disabled={generating}
            cols={3}
          />
          <Hint>
            WAN samples at this size, then frames scale down to the cell size. 512² is the
            reference default.
          </Hint>
        </Field>
      )}

      <Field label="Sheet type">
        <ChoiceGrid
          options={[
            { value: 'single', label: 'Single animation' },
            { value: 'multi', label: 'Multiple animations' },
          ]}
          value={settings.sheetMode === 'multi' ? 'multi' : 'single'}
          onChange={(v) => set({ sheetMode: v })}
          disabled={generating}
        />
      </Field>

      {settings.sheetMode === 'multi' ? (
        <Field label="Animations & frame counts">
          <div className="space-y-1.5">
            {Object.entries(SPRITE_ANIMATIONS).map(([k, a]) => {
              const on = selected.has(k)
              return (
                <div key={k} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleAnim(k)}
                    disabled={generating}
                    className={`flex-1 truncate text-left ${choiceClass(on, generating)}`}
                  >
                    {a.label}
                  </button>
                  {on && !isVideo && (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setAnimCount(k, countOf(k) - 1)}
                        disabled={generating}
                        className="h-6 w-6 rounded bg-bg-hover text-sm leading-none text-text-secondary hover:bg-white/10 disabled:opacity-50"
                      >
                        −
                      </button>
                      <span className="w-5 text-center font-mono text-xs text-text-primary">
                        {countOf(k)}
                      </span>
                      <button
                        type="button"
                        onClick={() => setAnimCount(k, countOf(k) + 1)}
                        disabled={generating}
                        className="h-6 w-6 rounded bg-bg-hover text-sm leading-none text-text-secondary hover:bg-white/10 disabled:opacity-50"
                      >
                        +
                      </button>
                    </div>
                  )}
                  {on && (
                    <ExpressionSelect
                      value={(settings.animExpressions || {})[k] || ''}
                      onChange={(v) => setAnimExpression(k, v)}
                      disabled={generating}
                      includeGlobal
                      globalLabel="Global face"
                      className="w-24 shrink-0 rounded-md border border-border bg-bg-card px-1 py-1 text-[11px] text-text-primary focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-50"
                    />
                  )}
                </div>
              )
            })}
          </div>
          {isVideo && (
            <Hint>
              Every row renders the {videoFrames}-frame video length chosen above (per-animation
              counts apply to the pose engine only).
            </Hint>
          )}
        </Field>
      ) : (
        <>
          <Field label="Animation">
            <select
              value={settings.animation}
              onChange={(e) => set({ animation: e.target.value })}
              disabled={generating}
              className="w-full rounded-lg border border-border bg-bg-card px-3 py-2 text-xs text-text-primary focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-50"
            >
              {Object.entries(SPRITE_ANIMATIONS).map(([k, a]) => (
                <option key={k} value={k}>
                  {a.label}
                </option>
              ))}
            </select>
          </Field>
          {!isVideo && (
            <Slider
              label="Frames"
              value={settings.frames}
              onChange={(v) => set({ frames: v })}
              min={1}
              max={12}
              disabled={generating}
            />
          )}
        </>
      )}

      <Field label="Facial expression" hint="baked into every frame">
        <ExpressionSelect
          value={settings.expression}
          onChange={(v) => set({ expression: v })}
          disabled={generating}
        />
        <Hint>
          {settings.sheetMode === 'multi'
            ? 'Default face for every animation — override one in the list above.'
            : 'The face every frame keeps. Left rows mirror the right expression.'}
        </Hint>
      </Field>

      <Field label="Expression-only rows" hint="portraits & emotes">
        <ExpressionRowChips
          value={settings.expressionRows}
          onChange={(v) => set({ expressionRows: v })}
          disabled={generating}
        />
        <Hint>
          Adds a short idle row per expression (<code>idle-happy</code>, <code>idle-angry</code>…)
          to the same sheet and Godot resource.
        </Hint>
      </Field>

      <FrameExpressionEditor
        animations={expressionAnims}
        value={settings.frameExpressions || {}}
        onChange={(v) => set({ frameExpressions: v })}
        disabled={generating}
      />

      <Field label="Directions">
        <ChoiceGrid
          options={DIRECTION_OPTIONS}
          value={settings.directions || 'none'}
          onChange={(v) => set({ directions: v })}
          disabled={generating}
          cols={3}
        />
        <Hint>Adds a row per direction for idle / walk / run.</Hint>
      </Field>

      <Field label="Cell size (px)">
        <ChoiceGrid
          options={[64, 128, 256, 512].map((c) => ({ value: c, label: c }))}
          value={settings.cellSize || 256}
          onChange={(c) => set({ cellSize: c })}
          disabled={generating}
          cols={4}
        />
      </Field>

      <Field label="Background">
        <ChoiceGrid
          options={BACKGROUND_OPTIONS}
          value={settings.background || 'transparent'}
          onChange={(v) => set({ background: v })}
          disabled={generating}
          cols={3}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Slider
          label="FPS"
          value={settings.fps}
          onChange={(v) => set({ fps: v })}
          min={1}
          max={30}
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

      <Hint>
        Sheet: {columns} columns × {rowCount} row{rowCount > 1 ? 's' : ''} = {total} frames
        {total > frameCap
          ? ` — over the ${frameCap}-frame cap, reduce rows or frames per animation`
          : ''}
        . Rows are left-aligned and may differ in length (like a classic character sheet). PNG +
        Godot SpriteFrames .tres (one animation per row);{' '}
        {isVideo
          ? 'keyframe from the Image models, rows from the WAN 2.2 GGUF experts.'
          : 'uses the Image models.'}
      </Hint>
    </div>
  )
}
