import { useEffect, useRef, useState } from 'react'
import { Download, FileJson2, Plus, Trash2, Upload } from 'lucide-react'
import useStore from '../../store/useStore'
import { saveBlobAs } from '../../lib/comfyui'
import {
  defaultMapping,
  inspectWorkflow,
  mappingIsValid,
  parseWorkflowJson,
  serializeWorkflow,
} from '../../lib/customWorkflow'
import { Note, SectionTitle, TextField } from './fields'

const OUTPUT_TYPES = [
  { value: 'image', label: 'Image' },
  { value: 'video', label: 'Video' },
  { value: 'audio', label: 'Audio' },
]

const slug = (name) =>
  String(name || 'workflow')
    .toLowerCase()
    .replace(/[^\w]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'workflow'

const newNodeId = () => `wf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

// Settings → Workflows: import a ComfyUI API-format graph, map the fields the
// Studio controls, and keep a small library. Everything stays in this
// browser (localStorage) — the graph itself is never rewritten.
export default function WorkflowsSection() {
  const workflows = useStore((s) => s.customWorkflows)
  const activeId = useStore((s) => s.customWorkflowId)
  const setActiveId = useStore((s) => s.setCustomWorkflowId)
  const addWorkflow = useStore((s) => s.addCustomWorkflow)
  const updateWorkflow = useStore((s) => s.updateCustomWorkflow)
  const removeWorkflow = useStore((s) => s.removeCustomWorkflow)

  const active = workflows.find((w) => w.id === activeId) || workflows[0] || null
  const fileRef = useRef(null)
  const [showImport, setShowImport] = useState(workflows.length === 0)
  const [text, setText] = useState('')
  const [draft, setDraft] = useState(null) // { graph, info, mapping, name }
  const [error, setError] = useState(null)
  const [nameDraft, setNameDraft] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    setNameDraft(active?.name || '')
    setConfirmDelete(false)
  }, [active?.id, active?.name])

  const inspectDraft = (raw, fallbackName) => {
    setError(null)
    try {
      const parsed = parseWorkflowJson(raw)
      const info = inspectWorkflow(parsed.graph)
      if (!info.textNodes.length) {
        throw new Error(
          'No text/prompt input found — this graph has nothing the Studio can fill in.'
        )
      }
      const mapping = {
        ...defaultMapping(parsed.graph),
        ...(parsed.mapping || {}),
        outputType: parsed.mapping?.outputType || defaultMapping(parsed.graph).outputType,
      }
      if (!mappingIsValid(parsed.graph, mapping)) {
        throw new Error('Could not detect a prompt node — choose one below.')
      }
      setDraft({
        graph: parsed.graph,
        info,
        mapping,
        name: parsed.name || fallbackName || 'Imported workflow',
      })
      setText(raw)
    } catch (err) {
      setDraft(null)
      setError(err.message)
    }
  }

  const readFile = async (file) => {
    if (!file) return
    const raw = await file.text()
    inspectDraft(raw, file.name.replace(/\.json$/i, ''))
  }

  const saveDraft = () => {
    if (!draft) return
    if (!draft.name.trim()) {
      setError('Give the workflow a name.')
      return
    }
    addWorkflow({
      id: newNodeId(),
      name: draft.name.trim(),
      graph: draft.graph,
      mapping: draft.mapping,
      createdAt: Date.now(),
    })
    setDraft(null)
    setText('')
    setShowImport(false)
    setError(null)
  }

  const setMapping = (patch) => {
    if (!active) return
    updateWorkflow(active.id, { mapping: { ...active.mapping, ...patch } })
  }

  const choosePromptNode = (id) => {
    const node = active.info?.textNodes?.find((n) => n.id === id)
    setMapping({
      promptNode: id,
      promptKey: node?.key || 'text',
      ...(active.mapping?.negativeNode === id ? { negativeNode: '' } : {}),
    })
  }

  const chooseNegativeNode = (id) => {
    const node = active.info?.textNodes?.find((n) => n.id === id)
    setMapping({ negativeNode: id, negativeKey: node?.key || 'text' })
  }

  const chooseSeedNode = (id) => {
    const node = active.info?.seedNodes?.find((n) => n.id === id)
    setMapping({ seedNode: id, seedKey: node?.key || 'seed' })
  }

  const download = () => {
    if (!active) return
    const blob = new Blob([serializeWorkflow(active)], { type: 'application/json' })
    saveBlobAs(blob, `${slug(active.name)}.json`)
  }

  const info = active ? active.info || inspectWorkflow(active.graph) : null
  const textNodes = info?.textNodes || []
  const seedNodes = info?.seedNodes || []
  const outputLabel = (t) => OUTPUT_TYPES.find((o) => o.value === t)?.label || t

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <SectionTitle icon={FileJson2} title="Imported workflows" note={`${workflows.length} saved`} />
          <p className="max-w-2xl text-[11px] leading-relaxed text-text-muted">
            Run any workflow you already use in ComfyUI. Export it with{' '}
            <span className="text-text-secondary">Save (API Format)</span>, then import the JSON
            here. The Studio fills in the prompt, negative prompt and seed you map — everything else
            runs exactly as exported.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setShowImport((v) => !v)
            setError(null)
          }}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-text-secondary transition-colors hover:bg-bg-card hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <Plus size={13} /> {showImport ? 'Hide import' : 'Import workflow'}
        </button>
      </div>

      {showImport && (
        <div className="space-y-3 rounded-xl border border-border bg-bg-card/40 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 rounded-lg bg-bg-card px-3 py-1.5 text-[11px] text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <Upload size={12} /> Choose .json
            </button>
            <span className="text-[10px] text-text-muted">or paste the API-format JSON below</span>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                readFile(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </div>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => text.trim() && !draft && inspectDraft(text, '')}
            placeholder='{"1":{"class_type":"KSampler","inputs":{...}},...}'
            spellCheck={false}
            rows={5}
            className="w-full resize-y rounded-lg border border-border bg-bg-secondary px-3 py-2 font-mono text-[10px] leading-relaxed text-text-primary placeholder:text-text-muted focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/30"
          />

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => inspectDraft(text, '')}
              disabled={!text.trim()}
              className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              Inspect
            </button>
            {error && <p className="text-[11px] text-warning">{error}</p>}
          </div>

          {draft && (
            <div className="space-y-3 rounded-lg border border-accent/25 bg-accent/5 p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  label="Name"
                  value={draft.name}
                  onChange={(v) => setDraft({ ...draft, name: v })}
                  placeholder="My workflow"
                />
                <label className="space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                    Output
                  </span>
                  <select
                    value={draft.mapping.outputType}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        mapping: { ...draft.mapping, outputType: e.target.value },
                      })
                    }
                    className="w-full rounded-lg border border-border bg-bg-card px-3 py-2 text-xs text-text-primary focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/30"
                  >
                    {OUTPUT_TYPES.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="text-[10px] text-text-muted">
                {draft.info.nodeCount} nodes · detected {draft.info.textNodes.length} text field(s),{' '}
                {draft.info.seedNodes.length} seed field(s), {draft.info.outputs.length} output
                node(s)
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setDraft(null)
                    setError(null)
                  }}
                  className="rounded-lg px-3 py-1.5 text-[11px] text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveDraft}
                  className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                >
                  Add workflow
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {workflows.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,15rem)_1fr]">
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
              Library
            </p>
            <div className="space-y-1">
              {workflows.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => setActiveId(w.id)}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${
                    active?.id === w.id
                      ? 'border-accent/40 bg-accent/10'
                      : 'border-border bg-bg-card/40 hover:bg-bg-hover/60'
                  }`}
                >
                  <p className="truncate text-xs font-medium text-text-primary">{w.name}</p>
                  <p className="text-[10px] text-text-muted">
                    {Object.keys(w.graph || {}).length} nodes ·{' '}
                    {outputLabel(w.mapping?.outputType || 'image')}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {active && (
            <div className="space-y-3 rounded-xl border border-border bg-bg-card/40 p-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[10rem] flex-1">
                  <TextField
                    label="Name"
                    value={nameDraft}
                    onChange={setNameDraft}
                    placeholder="Workflow name"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const name = nameDraft.trim()
                    if (name && name !== active.name) updateWorkflow(active.id, { name })
                  }}
                  className="rounded-lg border border-border px-3 py-2 text-[11px] text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
                >
                  Rename
                </button>
                <button
                  type="button"
                  onClick={download}
                  className="rounded-lg border border-border p-2 text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
                  title="Export workflow"
                  aria-label="Export workflow"
                >
                  <Download size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirmDelete) removeWorkflow(active.id)
                    else setConfirmDelete(true)
                  }}
                  className={`flex items-center gap-1 rounded-lg border px-2.5 py-2 text-[11px] transition-colors ${
                    confirmDelete
                      ? 'border-danger/50 bg-danger/15 text-danger'
                      : 'border-border text-text-secondary hover:bg-bg-hover hover:text-danger'
                  }`}
                  title={confirmDelete ? 'Click again to delete' : 'Delete workflow'}
                >
                  <Trash2 size={12} /> {confirmDelete ? 'Confirm' : 'Delete'}
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <MappingSelect
                  label="Prompt node"
                  value={active.mapping?.promptNode || ''}
                  onChange={choosePromptNode}
                  options={textNodes}
                  describe={(n) => `${n.id} · ${n.classType} — ${n.preview.slice(0, 48) || '(empty)'}`}
                />
                <MappingSelect
                  label="Negative node"
                  value={active.mapping?.negativeNode || ''}
                  onChange={chooseNegativeNode}
                  options={textNodes}
                  allowNone
                  describe={(n) => `${n.id} · ${n.classType}`}
                />
                <MappingSelect
                  label="Seed node"
                  value={active.mapping?.seedNode || ''}
                  onChange={chooseSeedNode}
                  options={seedNodes}
                  allowNone
                  describe={(n) => `${n.id} · ${n.classType}`}
                />
                <label className="space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                    Output type
                  </span>
                  <select
                    value={active.mapping?.outputType || 'image'}
                    onChange={(e) => setMapping({ outputType: e.target.value })}
                    className="w-full rounded-lg border border-border bg-bg-card px-3 py-2 text-xs text-text-primary focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/30"
                  >
                    {OUTPUT_TYPES.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {!mappingIsValid(active.graph, active.mapping) && (
                <Note warning>Pick the node whose text field should receive your prompt.</Note>
              )}
            </div>
          )}
        </div>
      )}

      <Note>
        Imported workflows are stored in this browser only. If a graph needs custom nodes or models
        that aren't installed, ComfyUI reports the missing node when you press Generate.
      </Note>
    </div>
  )
}

function MappingSelect({ label, value, onChange, options, describe, allowNone = false }) {
  return (
    <label className="space-y-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-border bg-bg-card px-3 py-2 text-xs text-text-primary focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/30"
      >
        {allowNone && <option value="">(none)</option>}
        {!allowNone && value === '' && <option value="">Choose a node…</option>}
        {options.map((n) => (
          <option key={n.id} value={n.id}>
            {describe(n)}
          </option>
        ))}
      </select>
    </label>
  )
}
