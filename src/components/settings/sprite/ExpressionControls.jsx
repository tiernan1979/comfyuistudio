import {
  EXPRESSION_KEYS,
  SPRITE_EXPRESSIONS,
  normalizeExpression,
} from '../../../lib/expressions'
import { Field, Hint, choiceClass } from '../controls'

const SELECT_CLASS =
  'w-full rounded-lg border border-border bg-bg-card px-2 py-2 text-xs text-text-primary ' +
  'focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/40 ' +
  'disabled:cursor-not-allowed disabled:opacity-50'

// Single expression picker. `includeGlobal` prepends an empty option, used by
// the per-animation selects where "" means "inherit the global expression"
// (the sprite graph resolves the fallback, not the UI).
export function ExpressionSelect({
  value,
  onChange,
  disabled,
  includeGlobal = false,
  globalLabel = 'Global',
  className = '',
}) {
  return (
    <select
      value={includeGlobal ? value || '' : normalizeExpression(value)}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={className || SELECT_CLASS}
    >
      {includeGlobal && <option value="">{globalLabel}</option>}
      {EXPRESSION_KEYS.map((k) => (
        <option key={k} value={k}>
          {SPRITE_EXPRESSIONS[k].label}
        </option>
      ))}
    </select>
  )
}

const parseCsv = (raw) =>
  new Set(
    String(raw || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )

// Chips that write the expressionRows CSV. Each selected expression becomes a
// short idle row (idle-happy, idle-angry…) appended to the sheet, so emotes
// share the packed PNG + Godot resource with the animations.
export function ExpressionRowChips({ value, onChange, disabled }) {
  const selected = parseCsv(value)
  const toggle = (k) => {
    const next = new Set(selected)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    onChange([...next].join(','))
  }
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {EXPRESSION_KEYS.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => toggle(k)}
          disabled={disabled}
          className={choiceClass(selected.has(k), disabled)}
        >
          {SPRITE_EXPRESSIONS[k].label}
        </button>
      ))}
    </div>
  )
}

// Per-frame overrides live behind a disclosure: an 8-frame row is already
// eight dropdowns, and most sheets never touch them.
export function FrameExpressionEditor({ animations = [], value = {}, onChange, disabled }) {
  const map = value && typeof value === 'object' ? value : {}
  const overrideCount = Object.values(map).reduce(
    (n, list) => n + (Array.isArray(list) ? list.filter(Boolean).length : 0),
    0,
  )

  const setFrame = (anim, frames, index, expr) => {
    const cur = Array.from({ length: frames }, (_, i) => String((map[anim] || [])[i] || ''))
    cur[index] = expr
    const next = { ...map }
    if (cur.every((v) => !v)) delete next[anim]
    else next[anim] = cur
    onChange(next)
  }

  return (
    <Field label="Per-frame expressions" hint="optional">
      <details className="rounded-lg border border-border bg-bg-card/40">
        <summary className="cursor-pointer select-none px-3 py-2 text-xs text-text-secondary hover:text-text-primary">
          Frame overrides
          {overrideCount > 0 ? ` (${overrideCount} set)` : ''}
        </summary>
        <div className="space-y-3 px-3 pb-3">
          <Hint>
            Any frame can override its row expression — leave a frame on “Row” to inherit it.
            Expressions are baked into every frame; left rows mirror the right expression.
          </Hint>
          {animations.map((a) => (
            <div key={a.key} className="space-y-1">
              <span className="text-[11px] font-medium text-text-secondary">{a.label}</span>
              <div className="grid grid-cols-2 gap-1.5">
                {Array.from({ length: Math.max(1, a.frames) }, (_, i) => (
                  <label key={i} className="flex items-center gap-1.5">
                    <span className="w-8 shrink-0 font-mono text-[10px] text-text-muted">{i + 1}</span>
                    <ExpressionSelect
                      value={(map[a.key] || [])[i] || ''}
                      includeGlobal
                      globalLabel="Row"
                      onChange={(v) => setFrame(a.key, Math.max(1, a.frames), i, v)}
                      disabled={disabled}
                      className={`${SELECT_CLASS} px-1.5 py-1`}
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
          {!animations.length && <Hint>Pick an animation above to edit its frames.</Hint>}
        </div>
      </details>
    </Field>
  )
}
