import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'

// Number input that lets the user type freely (e.g. 50000) and only clamps on
// blur/Enter. Committing on every keystroke made multi-digit values
// impossible: typing "5" after "120" snapped to the minimum first.
function NumberInput({ value, min, max, step, onCommit, disabled, className, round = false }) {
  const [draft, setDraft] = useState(String(value))
  const [editing, setEditing] = useState(false)
  const canceledRef = useRef(false)

  useEffect(() => {
    if (!editing) setDraft(String(value))
  }, [value, editing])

  const commit = () => {
    setEditing(false)
    if (canceledRef.current) {
      canceledRef.current = false
      setDraft(String(value))
      return
    }
    const n = Number(draft)
    if (draft.trim() === '' || Number.isNaN(n)) {
      setDraft(String(value))
      return
    }
    const clamped = Math.min(max, Math.max(min, round ? Math.round(n) : n))
    onCommit(clamped)
    setDraft(String(clamped))
  }

  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft}
      disabled={disabled}
      onFocus={() => setEditing(true)}
      onChange={(e) => {
        setEditing(true)
        setDraft(e.target.value)
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          canceledRef.current = true
          e.currentTarget.blur()
        }
      }}
      className={className}
    />
  )
}

// Shared controls for the mode settings panels. These were previously
// copy-pasted per mode; keeping them here keeps spacing, focus rings and
// disabled states identical everywhere.

export const choiceClass = (active, disabled) =>
  clsx(
    'px-2.5 py-2 rounded-lg text-xs font-medium transition-colors duration-150',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70',
    active
      ? 'bg-accent text-white shadow-sm shadow-accent/30'
      : 'bg-bg-card text-text-secondary border border-border hover:bg-bg-hover hover:text-text-primary',
    disabled && 'opacity-50 cursor-not-allowed',
  )

export function FieldLabel({ children, hint }) {
  return (
    <label className="mb-1.5 flex flex-wrap items-baseline gap-x-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
        {children}
      </span>
      {hint && <span className="text-[10px] font-normal text-text-muted/70">{hint}</span>}
    </label>
  )
}

export function Field({ label, hint, children }) {
  return (
    <div>
      <FieldLabel hint={hint}>{label}</FieldLabel>
      {children}
    </div>
  )
}

export function Hint({ children }) {
  return <p className="mt-1 text-[10px] leading-snug text-text-muted/70">{children}</p>
}

export function TextInput({ value, onChange, disabled, placeholder, mono = false }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      placeholder={placeholder}
      className={clsx(
        'w-full rounded-lg border border-border bg-bg-card px-3 py-2 text-xs text-text-primary',
        'placeholder:text-text-muted focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/40',
        'disabled:cursor-not-allowed disabled:opacity-50',
        mono && 'font-mono',
      )}
    />
  )
}

export function Toggle({ label, value, onChange, disabled, hint }) {
  return (
    <div>
      <label className="group flex cursor-pointer items-center justify-between gap-3">
        <span className="text-xs text-text-secondary transition-colors group-hover:text-text-primary">
          {label}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={value}
          onClick={() => onChange(!value)}
          disabled={disabled}
          className={clsx(
            'relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-secondary',
            value ? 'bg-accent' : 'bg-bg-hover',
            disabled && 'cursor-not-allowed opacity-50',
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
      {hint && <Hint>{hint}</Hint>}
    </div>
  )
}

export function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
  suffix = '',
  unit = '',
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-text-secondary">{label}</span>
        <div className="flex items-center gap-1.5">
          <NumberInput
            value={value}
            min={min}
            max={max}
            step={step}
            onCommit={onChange}
            disabled={disabled}
            className={clsx(
              'w-16 rounded-md border border-border bg-bg-hover px-1.5 py-0.5 text-right font-mono text-xs text-accent',
              'focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/40 disabled:opacity-50',
            )}
          />
          {unit && <span className="text-[10px] text-text-muted">{unit}</span>}
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
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-bg-hover accent-accent disabled:cursor-not-allowed disabled:opacity-50"
      />
      {suffix && <Hint>{suffix}</Hint>}
    </div>
  )
}

export function NumberField({ label, value, onChange, min = 32, max = 4096, step = 8, disabled }) {
  return (
    <div className="space-y-1">
      <span className="text-[11px] font-medium text-text-secondary">{label}</span>
      <NumberInput
        value={value}
        min={min}
        max={max}
        step={step}
        round
        onCommit={onChange}
        disabled={disabled}
        className="w-full rounded-md border border-border bg-bg-hover px-2 py-1 text-right font-mono text-xs text-accent focus:border-accent/60 focus:outline-none focus:ring-1 focus:ring-accent/40 disabled:opacity-50"
      />
    </div>
  )
}

// Grid of single-choice buttons: `options` is [{ value, label, icon? }].
export function ChoiceGrid({
  options,
  value,
  onChange,
  disabled,
  cols = 2,
  mono = false,
}) {
  const colClass = { 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4' }[cols] || 'grid-cols-2'
  return (
    <div className={clsx('grid gap-1.5', colClass)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          disabled={disabled}
          className={clsx(choiceClass(value === o.value, disabled), mono && 'font-mono')}
        >
          {o.label ?? o.value}
        </button>
      ))}
    </div>
  )
}
