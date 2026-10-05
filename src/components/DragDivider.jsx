import { useRef } from 'react'

// Vertical drag handle between two panels. `direction` controls how the
// measured delta maps onto the value: 1 = panel is to the LEFT of the
// handle (dragging right grows it — the normal layout), -1 = panel is to
// the RIGHT of the handle (dragging left grows it).
export default function DragDivider({
  label,
  value,
  min,
  max,
  defaultValue,
  onChange,
  direction = 1,
}) {
  const dragRef = useRef(null)

  const onPointerDown = (e) => {
    if (e.button !== 0) return
    dragRef.current = { x: e.clientX, v: value }
    e.currentTarget.setPointerCapture(e.pointerId)
    document.body.style.userSelect = 'none'
  }
  const onPointerMove = (e) => {
    const d = dragRef.current
    if (!d) return
    const next = d.v + (e.clientX - d.x) * direction
    if (next >= min && next <= max) onChange(next)
  }
  const onPointerUp = () => {
    if (!dragRef.current) return
    dragRef.current = null
    document.body.style.userSelect = ''
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title="Drag to resize · double-click to reset"
      className="w-1.5 shrink-0 cursor-col-resize bg-border hover:bg-accent/60 active:bg-accent transition-colors select-none touch-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => onChange(defaultValue)}
    />
  )
}
