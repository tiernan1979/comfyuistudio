import { useRef, useState } from 'react'
import { Trash2, Music } from 'lucide-react'
import { HEADER_W, LANE_H } from './constants'
import { fmt } from '../../lib/music/format'
import Waveform from './Waveform'

function TrackHeader({ track, editor }) {
  const { pushUndoNow, updateTrack, renameTrack, removeTrack, beginGesture, endGesture } = editor
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(track.name)
  const cancelRenameRef = useRef(false)
  const toggle = (key) => {
    pushUndoNow()
    updateTrack(track.id, { [key]: !track[key] })
  }
  const startRename = () => {
    cancelRenameRef.current = false
    setDraft(track.name)
    setEditing(true)
  }
  const commitRename = () => {
    setEditing(false)
    if (cancelRenameRef.current) {
      cancelRenameRef.current = false
      return
    }
    renameTrack(track, draft)
  }

  return (
    <div
      className="sticky left-0 z-10 shrink-0 bg-bg-secondary border-r border-border px-2 py-1.5 flex flex-col justify-between"
      style={{ width: HEADER_W, height: LANE_H }}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: track.color }} />
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') {
                e.preventDefault()
                commitRename()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                cancelRenameRef.current = true
                setDraft(track.name)
                setEditing(false)
              }
            }}
            aria-label="Track name"
            className="min-w-0 flex-1 rounded border border-border bg-bg-primary px-1 py-0.5 text-[11px] text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40"
          />
        ) : (
          <span
            className="text-[11px] text-text-secondary truncate flex-1 cursor-text hover:text-text-primary"
            title={`${track.name}${track.stemInfo ? ` — ${track.stemInfo}` : ''} — double-click to rename`}
            onDoubleClick={startRename}
          >
            {track.name}
          </span>
        )}
        <button
          onClick={() => removeTrack(track.id)}
          className="p-0.5 rounded hover:bg-red-500/20 hover:text-red-300 text-text-muted transition-colors"
          title="Remove track"
          aria-label={`Remove ${track.name}`}
        >
          <Trash2 size={11} />
        </button>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => toggle('mute')}
          aria-pressed={track.mute}
          className={`w-5 h-5 rounded text-[9px] font-bold transition-colors ${track.mute ? 'bg-amber-500 text-black' : 'bg-bg-hover text-text-muted hover:text-text-secondary'}`}
          title="Mute"
        >
          M
        </button>
        <button
          onClick={() => toggle('solo')}
          aria-pressed={track.solo}
          className={`w-5 h-5 rounded text-[9px] font-bold transition-colors ${track.solo ? 'bg-sky-400 text-black' : 'bg-bg-hover text-text-muted hover:text-text-secondary'}`}
          title="Solo"
        >
          S
        </button>
        <input
          type="range"
          min={0}
          max={2}
          step={0.01}
          value={track.gain}
          onPointerDown={beginGesture}
          onPointerUp={endGesture}
          onChange={(e) => updateTrack(track.id, { gain: Number(e.target.value) }, { restart: false })}
          className="flex-1 min-w-0 h-1 accent-accent cursor-pointer"
          title={`Volume ${Math.round(track.gain * 100)}%`}
          aria-label={`${track.name} volume`}
        />
        <input
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={track.pan}
          onPointerDown={beginGesture}
          onPointerUp={endGesture}
          onChange={(e) => updateTrack(track.id, { pan: Number(e.target.value) }, { restart: false })}
          className="w-8 h-1 accent-accent cursor-pointer"
          title={`Pan ${Math.round(track.pan * 100)}`}
          aria-label={`${track.name} pan`}
        />
      </div>
    </div>
  )
}

function ClipBlock({ track, clip, editor, isSel }) {
  const { zoom, rangeSel, rangeTool, startDrag, onDragMove, endDrag } = editor
  const w = Math.max(2, (clip.clipEnd - clip.clipStart) * zoom)
  const onRange = rangeSel?.clipId === clip.id
  const handlers = (mode) => ({
    onPointerDown: (e) => startDrag(e, track, clip, mode),
    onPointerMove: onDragMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  })

  return (
    <div
      data-testid="clip"
      {...handlers('move')}
      className={`absolute top-1 rounded-md overflow-hidden border transition-shadow ${
        rangeTool ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'
      } ${isSel ? 'border-accent shadow-lg shadow-accent/30 z-[1]' : 'border-white/10 hover:border-white/30'} ${
        clip.muted ? 'opacity-45' : ''
      }`}
      style={{
        left: clip.offset * zoom,
        width: w,
        height: LANE_H - 8,
        background: `${track.color}22`,
      }}
      title={
        clip.muted
          ? `${track.name} — muted range (Range tool / Shift-drag to select, Del cuts)`
          : `${track.name} — drag to move, edges to trim, Range tool or Shift-drag to select`
      }
    >
      <div className="absolute inset-0 flex items-center pointer-events-none">
        <Waveform
          buffer={clip.buffer}
          start={clip.clipStart}
          end={clip.clipEnd}
          width={w}
          height={LANE_H - 8}
          color={track.color}
        />
      </div>
      {clip.muted && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="px-1.5 py-0.5 rounded text-[8px] font-bold tracking-wider bg-amber-500/90 text-black">
            MUTED
          </span>
        </div>
      )}
      {onRange && (
        <div
          data-testid="range-selection"
          className="absolute top-0 bottom-0 bg-amber-400/20 border-x-2 border-amber-300 pointer-events-none z-[3]"
          style={{
            left: Math.max(0, (rangeSel.from - clip.offset) * zoom),
            width: Math.max(2, (rangeSel.to - rangeSel.from) * zoom),
          }}
        />
      )}
      <div
        {...handlers('trim-l')}
        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/40 z-[2]"
        title="Trim start"
      />
      <div
        {...handlers('trim-r')}
        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/40 z-[2]"
        title="Trim end"
      />
      {(clip.fadeIn > 0 || clip.fadeOut > 0) && (
        <div className="absolute top-0.5 right-1 text-[8px] font-mono text-white/70 pointer-events-none">
          {clip.fadeIn > 0 && `↓${clip.fadeIn.toFixed(1)} `}
          {clip.fadeOut > 0 && `↑${clip.fadeOut.toFixed(1)}`}
        </div>
      )}
    </div>
  )
}

// Ruler + track lanes + playhead. Scroll container is owned here so the
// transport can auto-follow the playhead via editor.scrollRef.
export default function Timeline({ editor }) {
  const {
    tracks, selected, zoom, contentW, ticks, position, dur,
    scrollRef, onRulerDown, onLaneDown,
  } = editor

  return (
    <div className="relative flex-1 min-h-0">
      <div ref={scrollRef} className="absolute inset-0 overflow-auto select-none">
        <div className="relative" style={{ width: HEADER_W + contentW }}>
          {/* Ruler */}
          <div className="sticky top-0 z-20 flex h-7">
            <div
              className="sticky left-0 z-30 shrink-0 h-7 bg-bg-secondary border-b border-r border-border flex items-center px-2.5 text-[10px] text-text-muted"
              style={{ width: HEADER_W }}
            >
              Tracks · {tracks.length}
            </div>
            <div
              className="relative h-7 bg-bg-secondary border-b border-border cursor-pointer"
              style={{ width: contentW }}
              onPointerDown={onRulerDown}
            >
              {ticks.map((t) => (
                <div key={t} className="absolute top-0 h-full flex items-end" style={{ left: t * zoom }}>
                  <span className="absolute top-0.5 left-1 text-[9px] font-mono text-text-muted pointer-events-none">
                    {fmt(t)}
                  </span>
                  <span className="w-px h-2.5 bg-border/80" />
                </div>
              ))}
            </div>
          </div>

          {/* Rows */}
          {tracks.map((track) => (
            <div key={track.id} className="flex border-b border-border/60" style={{ height: LANE_H }}>
              <TrackHeader track={track} editor={editor} />
              <div
                className="relative bg-bg-primary/40 border-l border-transparent"
                style={{ width: contentW, height: LANE_H }}
                onPointerDown={onLaneDown}
              >
                {track.clips.map((clip) => (
                  <ClipBlock
                    key={clip.id}
                    track={track}
                    clip={clip}
                    editor={editor}
                    isSel={selected?.clipId === clip.id}
                  />
                ))}
              </div>
            </div>
          ))}

          {/* Empty state */}
          {tracks.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <div className="w-14 h-14 rounded-2xl bg-bg-hover flex items-center justify-center">
                <Music size={26} className="text-text-muted" />
              </div>
              <p className="text-sm text-text-secondary">The studio is empty</p>
              <p className="text-xs text-text-muted max-w-sm leading-relaxed">
                Generate a track in the Music tab and open it here, add audio from history,
                drop in your own files, or use <b>AI part</b> to generate a new instrument
                part from a prompt. Turn on the <b>Range</b> tool (or Shift-drag) on a clip
                to select a section, then <b>Cut</b> or <b> Mute</b> it. Select a clip and press <b>Stems</b> to split it into
                drums / bass / vocals / synth (approximate DSP split).
              </p>
            </div>
          )}

          {/* Playhead */}
          {dur > 0 && (
            <div
              className="absolute top-0 bottom-0 w-px bg-red-400 pointer-events-none z-[5]"
              style={{ left: HEADER_W + position * zoom }}
            >
              <span className="absolute -top-0 -left-1 w-2 h-2 rotate-45 bg-red-400" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
