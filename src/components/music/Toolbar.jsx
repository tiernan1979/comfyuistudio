import {
  X, Play, Pause, Square, Repeat, Scissors, Copy, Trash2,
  FileAudio, ListMusic, Download, Layers, Volume2, Undo2, Redo2,
  Sparkles, MoveHorizontal,
} from 'lucide-react'
import { fmt1, filenameFromViewUrl } from '../../lib/music/format'
import AiPartMenu from './AiPartMenu'

const BTN =
  'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none'
const GHOST = `${BTN} bg-bg-hover/70 text-text-secondary hover:bg-bg-hover hover:text-text-primary`
const ICON = 'p-2 rounded-lg bg-bg-hover/70 text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors disabled:opacity-40'

export default function Toolbar({ editor }) {
  const e = editor
  const {
    playing, pause, play, dur, position, loop, setLoop,
    zoom, setZoom, fitZoom, canUndo, canRedo, undo, redo,
    rangeTool, setRangeTool, selected, splitSelected, duplicateClip, removeClip,
    splitIntoStems, splitIntoStemsAI, busy, aiSplit, fileInputRef, onFilePicked,
    showHistory, setShowHistory, historyEntries, addFromUrl,
    showPart, setShowPart, masterVol, setMasterVol, exportMix, setOpen, lastPosRef,
  } = e

  return (
    <div className="shrink-0 border-b border-border bg-bg-secondary/70 px-4 py-2.5 flex items-center gap-2 flex-wrap select-none">
      <button
        onClick={() => (playing ? pause() : dur > 0 && play(lastPosRef.current >= dur ? 0 : lastPosRef.current))}
        disabled={dur <= 0}
        className="p-2 rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-40 transition-colors shadow-sm shadow-accent/25"
        title="Play / pause (Space)"
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <button
        onClick={() => {
          pause()
          e.updatePos(0)
        }}
        disabled={dur <= 0}
        className={ICON}
        title="Stop"
        aria-label="Stop"
      >
        <Square size={14} />
      </button>
      <button
        onClick={() => setLoop(!loop)}
        aria-pressed={loop}
        className={`p-2 rounded-lg transition-colors ${loop ? 'bg-accent text-white' : 'bg-bg-hover/70 hover:bg-bg-hover text-text-secondary'}`}
        title="Loop"
      >
        <Repeat size={14} />
      </button>

      <span className="ml-1 font-mono text-xs text-text-secondary tabular-nums">
        {fmt1(Math.min(position, dur))} <span className="text-text-muted">/ {fmt1(dur)}</span>
      </span>

      <span className="w-px h-6 bg-border mx-1" />

      {/* zoom */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setZoom((z) => Math.max(16, Math.round(z / 1.5)))}
          className="p-1.5 rounded bg-bg-hover/70 hover:bg-bg-hover text-text-secondary text-xs transition-colors"
          title="Zoom out"
        >
          −
        </button>
        <input
          type="range"
          min={16}
          max={400}
          value={zoom}
          onChange={(ev) => setZoom(Number(ev.target.value))}
          className="w-24 h-1 accent-accent cursor-pointer"
          aria-label="Zoom"
        />
        <button
          onClick={() => setZoom((z) => Math.min(400, Math.round(z * 1.5)))}
          className="p-1.5 rounded bg-bg-hover/70 hover:bg-bg-hover text-text-secondary text-xs transition-colors"
          title="Zoom in"
        >
          +
        </button>
        <button
          onClick={fitZoom}
          className="px-1.5 py-1 rounded bg-bg-hover/70 hover:bg-bg-hover text-text-secondary text-xs transition-colors"
          title="Fit project to the visible width"
        >
          Fit
        </button>
      </div>

      <span className="w-px h-6 bg-border mx-1" />

      <button onClick={undo} disabled={!canUndo} aria-label="Undo" className={ICON} title="Undo (Ctrl+Z)">
        <Undo2 size={14} />
      </button>
      <button onClick={redo} disabled={!canRedo} aria-label="Redo" className={ICON} title="Redo (Ctrl+Shift+Z)">
        <Redo2 size={14} />
      </button>

      <span className="w-px h-6 bg-border mx-1" />

      <button
        onClick={() => setRangeTool(!rangeTool)}
        data-testid="range-tool"
        aria-pressed={rangeTool}
        className={`${BTN} ${rangeTool ? 'bg-accent text-white shadow-lg shadow-accent/25' : 'bg-bg-hover/70 text-text-secondary hover:bg-bg-hover hover:text-text-primary'}`}
        title="Range tool — drag on a clip to select a time range, then Cut or Mute it (Esc clears)"
      >
        <MoveHorizontal size={13} /> Range
      </button>
      <button
        onClick={splitSelected}
        disabled={!selected}
        className={GHOST}
        title="Split selected clip at playhead (S)"
      >
        <Scissors size={13} /> Split
      </button>
      <button onClick={duplicateClip} disabled={!selected} className={GHOST} title="Duplicate selected clip">
        <Copy size={13} /> Copy
      </button>
      <button
        onClick={removeClip}
        disabled={!selected}
        className={`${BTN} bg-bg-hover/70 text-text-secondary hover:bg-red-500/20 hover:text-red-300`}
        title="Delete selected clip (Del)"
      >
        <Trash2 size={13} /> Delete
      </button>
      <button
        onClick={splitIntoStems}
        disabled={!selected || !!busy}
        data-testid="stems-button"
        className={`${BTN} bg-purple-500/15 text-purple-300 hover:bg-purple-500/25`}
        title="Fast DSP split (HPSS + center-aware bands): drums / bass / vocals / synth — instant, no models needed"
      >
        <Layers size={13} /> Stems
      </button>
      <button
        onClick={splitIntoStemsAI}
        disabled={!selected || !!busy}
        data-testid="ai-stems-button"
        className={`${BTN} bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25`}
        title={
          aiSplit && !aiSplit.ok
            ? 'AI separation is not available: the set-soft/AudioSeparation node pack is not installed on the ComfyUI server — the fast DSP Stems button still works'
            : 'Server AI split (htdemucs 6-source): drums / bass / guitar / piano / other / reverb + lead / backing — accurate, ~1–2 min per clip'
        }
      >
        <Sparkles size={13} /> AI Stems
      </button>

      <span className="w-px h-6 bg-border mx-1" />

      <button onClick={() => fileInputRef.current?.click()} className={GHOST}>
        <FileAudio size={13} /> Add file
      </button>
      <div className="relative">
        <button
          onClick={() => setShowHistory(!showHistory)}
          aria-expanded={showHistory}
          className={GHOST}
        >
          <ListMusic size={13} /> From history
        </button>
        {showHistory && (
          <div className="absolute left-0 top-full mt-1 w-72 max-h-64 overflow-y-auto rounded-xl border border-border bg-bg-card shadow-2xl z-20 p-1.5">
            {historyEntries.length === 0 ? (
              <p className="text-xs text-text-muted p-2">No generated music yet</p>
            ) : (
              historyEntries.map((h) => (
                <button
                  key={h.id}
                  onClick={() => {
                    setShowHistory(false)
                    addFromUrl(h.data, h.prompt || filenameFromViewUrl(h.data))
                  }}
                  className="w-full text-left px-2.5 py-2 rounded-lg text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors truncate"
                >
                  {h.prompt || filenameFromViewUrl(h.data)}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <div className="relative">
        <button
          onClick={() => setShowPart(!showPart)}
          disabled={!!busy}
          aria-expanded={showPart}
          data-testid="ai-part-button"
          className={`${BTN} bg-accent/15 text-accent hover:bg-accent/25`}
        >
          <Sparkles size={13} /> AI part
        </button>
        {showPart && <AiPartMenu editor={e} />}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        multiple
        onChange={onFilePicked}
        className="hidden"
      />

      <span className="w-px h-6 bg-border mx-1" />

      <div className="flex items-center gap-1.5" title="Master volume">
        <Volume2 size={14} className="text-text-muted" />
        <input
          type="range"
          min={0}
          max={1.5}
          step={0.01}
          value={masterVol}
          onChange={(ev) => setMasterVol(Number(ev.target.value))}
          className="w-20 h-1 accent-accent cursor-pointer"
          aria-label="Master volume"
        />
      </div>

      <button
        onClick={exportMix}
        disabled={dur <= 0 || !!busy}
        className={`${BTN} ml-auto bg-accent text-white hover:bg-accent-hover shadow-sm shadow-accent/25`}
      >
        <Download size={13} /> Export WAV
      </button>
      <button
        onClick={() => setOpen(false)}
        aria-label="Close studio"
        className="p-2 rounded-lg bg-bg-hover/70 hover:bg-red-500/20 hover:text-red-300 text-text-secondary transition-colors"
      >
        <X size={16} />
      </button>
    </div>
  )
}
