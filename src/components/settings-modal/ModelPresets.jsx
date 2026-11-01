import { useState } from 'react'
import { Plus, Trash2, Pencil } from 'lucide-react'
import clsx from 'clsx'
import useStore, { presetLabel } from '../../store/useStore'

// Multi-model preset editor. Presets sit ABOVE the model fields; clicking a
// preset loads its unet/clip/vae/lora into the fields below for editing.
// Edits go into the draft owned by the parent and are written back to the
// store on Save — so a half-finished edit never silently mutates a preset.
// "Add Preset" snapshots the draft into a new named entry and selects it.
function PresetBadge({ preset }) {
  if (preset.engine === 'ace' || /ace[-_ ]?step/i.test(preset.unet || '')) {
    return <span className="shrink-0 rounded bg-pink-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-pink-300">ACE</span>
  }
  if (preset.engine === 'stable_audio' || /stable[-_ ]?audio/i.test(preset.unet || '')) {
    return <span className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-amber-300">Stable Audio</span>
  }
  if (/minimax/i.test(preset.unet || '')) {
    return <span className="shrink-0 rounded bg-blue-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-blue-300">MiniMax</span>
  }
  return null
}

export default function ModelPresets({ mode, editDraft, setEditDraft }) {
  const presets = useStore((s) => s.presets?.[mode] || [])
  const active = useStore((s) => s.active?.[mode])
  const setActivePreset = useStore((s) => s.setActivePreset)
  const addPreset = useStore((s) => s.addPreset)
  const removePreset = useStore((s) => s.removePreset)
  const updatePreset = useStore((s) => s.updatePreset)
  const [newName, setNewName] = useState('')
  const [editingIdx, setEditingIdx] = useState(-1)
  const [editName, setEditName] = useState('')

  const handleAdd = () => {
    const name = newName.trim() || `Preset ${presets.length + 1}`
    addPreset(mode, { name, ...editDraft })
    setNewName('')
  }

  const loadPreset = (i, preset) => {
    setActivePreset(mode, i)
    setEditDraft({ unet: '', clip: '', vae: '', lora: '', ...preset })
  }

  const startRename = (i, currentName) => {
    setEditingIdx(i)
    setEditName(currentName || '')
  }

  const commitRename = () => {
    if (editingIdx >= 0 && editName.trim()) {
      updatePreset(mode, editingIdx, { name: editName.trim() })
    }
    setEditingIdx(-1)
    setEditName('')
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold text-text-secondary">Presets</h4>
        <span className="text-[10px] text-text-muted">
          {presets.length} saved — click one to load it into the fields below
        </span>
      </div>

      {presets.length === 0 ? (
        <p className="rounded-lg border border-border bg-bg-card px-3 py-2 text-[11px] text-text-muted">
          No presets yet. Set the model fields below, then <strong>Add Preset</strong> to save them under a
          name. Add one per engine (e.g. MiniMax Music 3 and ACE-Step 1.5) and click between them any time.
        </p>
      ) : (
        <div className="space-y-1.5">
          {presets.map((p, i) => (
            <div
              key={i}
              role="button"
              tabIndex={0}
              onClick={() => loadPreset(i, p)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  loadPreset(i, p)
                }
              }}
              className={clsx(
                'flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                active === i
                  ? 'cursor-pointer border-accent bg-accent/10'
                  : 'cursor-pointer border-border bg-bg-card hover:bg-bg-hover',
              )}
            >
              <span
                className={clsx(
                  'h-3 w-3 shrink-0 rounded-full border-2',
                  active === i ? 'border-accent bg-accent' : 'border-border',
                )}
              />
              <div className="min-w-0 flex-1">
                {editingIdx === i ? (
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename()
                      if (e.key === 'Escape') {
                        setEditingIdx(-1)
                        setEditName('')
                      }
                    }}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    aria-label="Preset name"
                    className="w-full rounded border border-accent bg-bg-card px-1.5 py-0.5 text-xs font-medium text-text-primary focus:outline-none"
                  />
                ) : (
                  <p className="truncate text-xs font-medium text-text-primary">{p.name || `Preset ${i + 1}`}</p>
                )}
                <p className="truncate font-mono text-[10px] text-text-muted">{presetLabel(p)}</p>
              </div>
              <PresetBadge preset={p} />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  startRename(i, p.name)
                }}
                className="shrink-0 rounded p-1 text-text-muted transition-colors hover:bg-bg-hover hover:text-accent"
                title="Rename preset"
                aria-label={`Rename ${p.name || `preset ${i + 1}`}`}
              >
                <Pencil size={12} />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  removePreset(mode, i)
                }}
                className="shrink-0 rounded p-1 text-text-muted transition-colors hover:bg-red-500/20 hover:text-red-400"
                title="Remove preset"
                aria-label={`Remove ${p.name || `preset ${i + 1}`}`}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd()
          }}
          placeholder='Preset name (e.g. "MiniMax Music 3", "ACE-Step 1.5")'
          aria-label="New preset name"
          className="flex-1 rounded-lg border border-border bg-bg-card px-3 py-2 text-xs text-text-primary placeholder:text-text-muted transition-colors focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        <button
          type="button"
          onClick={handleAdd}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-accent/20 px-3 py-2 text-xs font-medium text-accent transition-colors hover:bg-accent/30"
        >
          <Plus size={14} />
          Add Preset
        </button>
      </div>
    </div>
  )
}
