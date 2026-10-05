import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import clsx from 'clsx'

// A bigger, readable replacement for the native <select>: the control sits
// at text-sm height and options open in a styled, scrollable popup where
// every row is legible — the OS's default menu was too small to read.
//
//   options: [{ value, label }]
//   editable: the trigger is a text input (combobox) — pick from the list
//             or type a value the server hasn't indexed yet. Typing filters
//             the open list; blur commits the typed text.
export default function Dropdown({
  value,
  onChange,
  options = [],
  disabled,
  className,
  ariaLabel,
  editable = false,
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const wrapRef = useRef(null)

  const selectedIdx = options.findIndex((o) => o.value === value)
  const selected = options[selectedIdx]

  const text = selected ? selected.label : String(value ?? '')
  const [inputValue, setInputValue] = useState(text)
  // Keep the input in sync when the value changes from outside
  // (another select, a seeded config, "load saved prompt", …).
  useEffect(() => {
    setInputValue(selected ? selected.label : String(value ?? ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, selected?.label])

  // Close when clicking outside
  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  // Typed text only filters once it differs from the current selection —
  // otherwise opening the menu would immediately filter down to one row.
  const filter = editable && inputValue !== text ? inputValue.trim().toLowerCase() : ''
  const visible = filter
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(filter) || String(o.value).toLowerCase().includes(filter)
      )
    : options

  const openMenu = () => {
    setActive(selectedIdx >= 0 ? selectedIdx : 0)
    setOpen(true)
  }

  const select = (v) => {
    onChange(v)
    setOpen(false)
  }

  const commitTyped = () => {
    const t = inputValue.trim()
    if (t !== text) onChange(t)
  }

  const onKeyDown = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || (e.key === ' ' && !editable)) {
        e.preventDefault()
        openMenu()
      } else if (editable && e.key === 'Enter') {
        commitTyped()
      }
      return
    }
    if (e.key === 'Escape') {
      e.stopPropagation()
      setOpen(false)
      setInputValue(text)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(visible.length - 1, (a < 0 ? 0 : a + 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a < 0 ? 0 : a - 1))
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (active >= 0 && active < visible.length) select(visible[active].value)
    }
  }

  const triggerCls = clsx(
    'flex w-full items-center justify-between gap-2 px-3 py-2 rounded-lg bg-bg-card border border-border',
    'text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent cursor-pointer',
    'disabled:opacity-50 transition-colors hover:border-accent/50',
    className
  )
  const chevron = (
    <ChevronDown
      size={15}
      className={clsx('shrink-0 text-text-muted transition-transform duration-150', open && 'rotate-180 text-accent')}
    />
  )

  return (
    <div ref={wrapRef} className="relative">
      {editable ? (
        <div className="relative">
          <input
            role="combobox"
            aria-expanded={open}
            aria-label={ariaLabel}
            disabled={disabled}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onFocus={() => !disabled && openMenu()}
            onBlur={() => open && commitTyped()}
            onKeyDown={onKeyDown}
            className={clsx(triggerCls, 'pr-8 cursor-text')}
          />
          <button
            type="button"
            tabIndex={-1}
            aria-label={ariaLabel ? `${ariaLabel} options` : 'Show options'}
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => (open ? setOpen(false) : openMenu())}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-bg-hover"
          >
            {chevron}
          </button>
        </div>
      ) : (
        <button
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          onClick={() => (open ? setOpen(false) : openMenu())}
          onKeyDown={onKeyDown}
          className={triggerCls}
        >
          <span className="truncate">{text}</span>
          {chevron}
        </button>
      )}

      {open && (
        <ul
          role="listbox"
          className="absolute z-40 mt-1 w-full min-w-44 max-h-60 overflow-y-auto rounded-lg bg-bg-card border border-border shadow-xl shadow-black/50 py-1"
        >
          {visible.map((o, i) => (
            <li
              key={o.value === '' ? '__none__' : o.value}
              role="option"
              aria-selected={o.value === value}
              data-active={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                // Keep focus in the input so onBlur doesn't commit typed
                // text over the click.
                e.preventDefault()
              }}
              onClick={() => select(o.value)}
              className={clsx(
                'flex items-center justify-between gap-2 px-3 py-2 text-sm cursor-pointer transition-colors',
                i === active ? 'bg-accent/20 text-text-primary' : 'text-text-secondary hover:bg-bg-hover'
              )}
            >
              <span className="truncate">{o.label}</span>
              {o.value === value && <Check size={14} className="shrink-0 text-accent" />}
            </li>
          ))}
          {visible.length === 0 && <li className="px-3 py-2 text-sm text-text-muted">No matching options</li>}
        </ul>
      )}
    </div>
  )
}
