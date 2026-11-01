import { Sparkles } from 'lucide-react'
import { PART_PRESETS } from './constants'

// MiniMax instrumental "part" generator popover. Instrumental-only: the
// caption built in useMusicActions carries a hard vocal ban.
export default function AiPartMenu({ editor }) {
  const {
    partPrompt,
    setPartPrompt,
    partDuration,
    setPartDuration,
    generatePart,
    busy,
    recentParts,
    addFromUrl,
  } = editor

  return (
    <div
      data-testid="ai-part-panel"
      className="absolute left-0 top-full mt-1 w-80 rounded-xl border border-border bg-bg-card shadow-2xl z-30 p-3 space-y-2.5"
    >
      <p className="text-xs font-medium text-text-primary">Generate a new part</p>
      <div className="flex flex-wrap gap-1.5">
        {PART_PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => setPartPrompt(p.caption)}
            data-testid={`preset-${p.label.toLowerCase()}`}
            className="px-2 py-1 rounded-full text-[10px] bg-bg-hover hover:bg-white/10 text-text-secondary hover:text-accent transition-colors"
            title={p.caption}
          >
            {p.label}
          </button>
        ))}
      </div>
      <textarea
        value={partPrompt}
        onChange={(e) => setPartPrompt(e.target.value)}
        rows={3}
        data-testid="ai-part-prompt"
        placeholder="Describe the part: “isolated acoustic guitar arpeggio, dry, no other instruments”…"
        className="w-full rounded-lg bg-bg-primary border border-border px-2.5 py-2 text-xs text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:border-accent"
      />
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-text-muted">Length</span>
        <select
          value={partDuration}
          onChange={(e) => setPartDuration(Number(e.target.value))}
          className="rounded bg-bg-primary border border-border px-1.5 py-1 text-xs text-text-secondary"
          aria-label="Part duration"
        >
          {[5, 10, 15, 30].map((d) => (
            <option key={d} value={d}>
              {d}s
            </option>
          ))}
        </select>
        <button
          onClick={generatePart}
          disabled={!!busy || !partPrompt.trim()}
          data-testid="ai-part-generate"
          className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent hover:bg-accent-hover text-white disabled:opacity-40 disabled:pointer-events-none transition-colors"
        >
          <Sparkles size={12} /> Generate
        </button>
      </div>
      {recentParts.length > 0 && (
        <div className="pt-1 border-t border-border">
          <p className="text-[10px] text-text-muted mb-1">Recent parts — click to add again</p>
          <div className="flex flex-wrap gap-1.5">
            {recentParts.map((p) => (
              <button
                key={p.id}
                onClick={() => addFromUrl(p.url, p.name)}
                className="px-2 py-1 rounded-full text-[10px] bg-bg-hover hover:bg-white/10 text-text-secondary truncate max-w-[140px] transition-colors"
                title={p.name}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="text-[10px] text-text-muted leading-relaxed">
        Instrumental-only — vocals are always excluded. Models are freed first so the text
        encoder starts on clean VRAM.
      </p>
    </div>
  )
}
