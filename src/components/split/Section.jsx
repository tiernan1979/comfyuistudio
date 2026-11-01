export function Section({ title, children, right }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          {title}
        </span>
        {right}
      </div>
      {children}
    </div>
  )
}
