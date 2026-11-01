import { Scissors, VolumeX, X, Music } from 'lucide-react'
import { fmt1 } from '../../lib/music/format'

// Context bar under the toolbar: range actions while a range is selected,
// otherwise fade controls for the selected clip.
export default function ClipInspector({ editor }) {
  const {
    rangeSel, setRangeSel, cutSelection, muteSelection,
    selClip, selTrack, updateClip, beginGesture, endGesture, restartAtCurrent,
  } = editor

  if (rangeSel) {
    return (
      <div
        data-testid="range-bar"
        className="shrink-0 border-b border-border bg-amber-500/10 px-4 py-2 flex items-center gap-4 flex-wrap text-xs select-none"
      >
        <span className="text-amber-300 font-medium">
          <Scissors size={12} className="inline mr-1.5" />
          Range {fmt1(rangeSel.from)} → {fmt1(rangeSel.to)}
          <span className="text-amber-200/70 font-mono"> ({(rangeSel.to - rangeSel.from).toFixed(2)}s)</span>
        </span>
        <button
          onClick={cutSelection}
          data-testid="range-cut"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-red-500/20 text-red-300 hover:bg-red-500/30 transition-colors"
          title="Remove the selected range from the clip (Del)"
        >
          <Scissors size={13} /> Cut
        </button>
        <button
          onClick={muteSelection}
          data-testid="range-mute"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-colors"
          title="Silence the selected range in place (M)"
        >
          <VolumeX size={13} /> Mute
        </button>
        <button
          onClick={() => setRangeSel(null)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-bg-hover/70 hover:bg-bg-hover text-text-secondary transition-colors"
          title="Clear selection (Esc)"
        >
          <X size={13} /> Clear
        </button>
        <span className="text-text-muted">
          Cut removes it · Mute turns it off for this time only (turn M back on to edit)
        </span>
      </div>
    )
  }

  if (!selClip) return null

  const len = selClip.clipEnd - selClip.clipStart
  const fadeMax = Math.max(0.1, len / 2)
  const commitFade = () => {
    restartAtCurrent()
    endGesture()
  }

  return (
    <div className="shrink-0 border-b border-border bg-bg-card/60 px-4 py-2 flex items-center gap-5 flex-wrap text-xs select-none">
      <span className="text-text-secondary font-medium">
        <Music size={12} className="inline mr-1.5 text-accent" />
        {selTrack?.name}
      </span>
      <span className="text-text-muted font-mono">
        start {selClip.offset.toFixed(2)}s · len {len.toFixed(2)}s
      </span>
      <label className="flex items-center gap-2 text-text-muted">
        Fade in
        <input
          type="range"
          min={0}
          max={fadeMax}
          step={0.05}
          value={selClip.fadeIn}
          onPointerDown={beginGesture}
          onChange={(e) =>
            updateClip(selTrack.id, selClip.id, { fadeIn: Number(e.target.value) }, { restart: false })
          }
          onPointerUp={commitFade}
          className="w-24 accent-accent cursor-pointer"
        />
        <span className="font-mono w-9">{selClip.fadeIn.toFixed(2)}s</span>
      </label>
      <label className="flex items-center gap-2 text-text-muted">
        Fade out
        <input
          type="range"
          min={0}
          max={fadeMax}
          step={0.05}
          value={selClip.fadeOut}
          onPointerDown={beginGesture}
          onChange={(e) =>
            updateClip(selTrack.id, selClip.id, { fadeOut: Number(e.target.value) }, { restart: false })
          }
          onPointerUp={commitFade}
          className="w-24 accent-accent cursor-pointer"
        />
        <span className="font-mono w-9">{selClip.fadeOut.toFixed(2)}s</span>
      </label>
    </div>
  )
}
