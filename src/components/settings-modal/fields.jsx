import { useEffect, useState } from 'react'
import clsx from 'clsx'
import Dropdown from '../Dropdown'

// Field chrome for the settings modal. Spacing, label casing and focus rings
// deliberately mirror components/settings/controls.jsx so the settings screen
// and the right-hand mode panels read as one system.

export function SectionTitle({ icon: Icon, title, note, tone = 'text-accent' }) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
      {Icon && <Icon size={14} className={tone} />}
      {title}
      {note && <span className="text-[10px] font-normal text-text-muted">{note}</span>}
    </h3>
  )
}

export function Note({ children, warning = false }) {
  return (
    <p
      className={clsx(
        'rounded-lg border px-3 py-2 text-[11px] leading-relaxed',
        warning
          ? 'border-warning/30 bg-warning/10 text-warning'
          : 'border-border bg-bg-card text-text-muted',
      )}
    >
      {children}
    </p>
  )
}

const inputClass = (invalid) =>
  clsx(
    'w-full rounded-lg border bg-bg-card px-3 py-2 text-xs text-text-primary',
    'placeholder:text-text-muted transition-colors',
    'focus:outline-none focus:ring-2',
    invalid
      ? 'border-warning focus:border-warning focus:ring-warning/30'
      : 'border-border focus:border-accent/60 focus:ring-accent/30',
  )

export function TextField({ label, value, onChange, placeholder, type = 'text', hint, invalid }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={inputClass(invalid)}
      />
      {hint && <p className="text-[10px] leading-snug text-text-muted/70">{hint}</p>}
    </div>
  )
}

// Model picker backed by the server's file list — a real dropdown of
// every file ComfyUI can see, optionally narrowed to one pipeline. Falls
// back to free typing when the list isn't loaded (or the field may hold a
// value the server hasn't indexed).
export function ModelField({ label, value, onChange, options = [], placeholder, filtered = false }) {
  const inList = !value || options.includes(value)

  if (options.length === 0) {
    return (
      <TextField
        label={label}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        hint={
          filtered
            ? 'No compatible files on this server — type the exact filename'
            : 'Server list not loaded — type the exact filename'
        }
      />
    )
  }

  const items = options.map((o) => ({ value: o, label: o }))
  if (value === '' || !options.includes(value)) {
    items.unshift({ value: value || '', label: value || '(none)' })
  } else if (label.includes('LoRA') && !items.some((i) => i.value === '')) {
    items.unshift({ value: '', label: '(none)' })
  }

  return (
    <div className="space-y-1">
      <label className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
        {label}
      </label>
      <Dropdown
        value={value}
        onChange={onChange}
        options={items}
        ariaLabel={label}
        editable
        className={clsx('text-xs', inList ? 'border-border' : 'border-warning')}
      />
      <p className={clsx('text-[10px]', inList ? 'text-text-muted/70' : 'text-warning')}>
        {inList
          ? `${options.length} ${filtered ? 'compatible ' : ''}file(s) available on server`
          : filtered
            ? `Not compatible with this pipeline — pick one of the ${options.length} compatible file(s) or type another name`
            : `Not found on server — pick one of the ${options.length} available file(s) or fix the name`}
      </p>
    </div>
  )
}

// Select whose options come from the ComfyUI server; falls back to
// showing the current value when the list hasn't loaded. Rendered with
// the app's own Dropdown so every pick is readable and scrollable.
export function SelectField({ label, value, onChange, options = [], hint, stripPrefix }) {
  let items = options.map((o) => {
    const [val, lab] = Array.isArray(o) ? o : [o, o]
    return {
      value: String(val),
      label: stripPrefix ? String(lab).replace(/^preset:/, '') : String(lab),
    }
  })
  if (value === '' && !items.some((i) => i.value === '')) {
    items = [{ value: '', label: '(none)' }, ...items]
  }
  if (value !== '' && !items.some((i) => i.value === value)) {
    items = [{ value: String(value), label: String(value) }, ...items]
  }
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
        {label}
      </label>
      <Dropdown value={String(value)} onChange={onChange} options={items} ariaLabel={label} className="text-xs" />
      {hint && <p className="text-[10px] leading-snug text-text-muted/70">{hint}</p>}
    </div>
  )
}

// Numeric input that keeps a free-typing draft and only clamps on blur/Enter.
// Clamping on every keystroke made it impossible to type e.g. "50000" into a
// field with min=5000 (the first "5" snapped to the minimum).
export function NumberField({ label, value, onChange, min, max, step = 1, hint }) {
  const [draft, setDraft] = useState(() => String(value ?? ''))
  useEffect(() => setDraft(String(value ?? '')), [value])

  const commit = () => {
    const n = Number(draft)
    if (draft.trim() === '' || !Number.isFinite(n)) {
      setDraft(String(value ?? ''))
      return
    }
    const next = Math.min(max, Math.max(min, n))
    setDraft(String(next))
    if (next !== value) onChange(next)
  }

  return (
    <div className="space-y-1">
      <label className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
        {label}
      </label>
      <input
        type="number"
        value={draft}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
        className={clsx(inputClass(false), 'font-mono')}
      />
      {hint && <p className="text-[10px] leading-snug text-text-muted/70">{hint}</p>}
    </div>
  )
}

// Full-width switch row: title + description on the left, toggle on the right.
export function ToggleRow({ title, description, value, onChange, disabled }) {
  return (
    <label
      className={clsx(
        'flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-card px-3 py-2.5 transition-colors',
        disabled ? 'opacity-60' : 'cursor-pointer hover:border-border hover:bg-bg-hover/50',
      )}
    >
      <span className="text-xs">
        <span className="block font-medium text-text-primary">{title}</span>
        {description && <span className="mt-0.5 block leading-snug text-text-muted">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        disabled={disabled}
        className={clsx(
          'relative ml-1 h-5 w-9 shrink-0 rounded-full transition-colors duration-200',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-secondary',
          value ? 'bg-accent' : 'bg-bg-hover',
          disabled && 'cursor-not-allowed',
        )}
      >
        <span
          className={clsx(
            'absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200',
            value && 'translate-x-4',
          )}
        />
      </button>
    </label>
  )
}
