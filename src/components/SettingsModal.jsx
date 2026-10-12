import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Server, HardDrive, Save, RefreshCw, FolderSearch, Bot, Globe, Box, KeyRound, Plus, Trash2, Pencil } from 'lucide-react'
import useStore, { presetLabel } from '../store/useStore'
import { getModelLists, resolveApiBase, getNodeComboOptions, checkNodes } from '../lib/comfyui'
import { fetchLlmModels, PROVIDERS, MODEL_SUGGESTIONS } from '../lib/llm'
import { SEARCH_ENGINES, searchEngineInfo } from '../lib/search'
import { configFromState, pushRuntimeConfig, fetchRuntimeConfig, QUALITY_PRESETS } from '../lib/config'
import { requiredThreeDNodes, describeNode } from '../lib/threed'
import Dropdown from './Dropdown'
import clsx from 'clsx'

// Left-hand menu of the settings screen. Each entry switches which
// section renders in the content pane.
const SETTINGS_TABS = [
  { id: 'server', label: 'ComfyUI Server', icon: Server },
  { id: 'models', label: 'Models', icon: HardDrive },
  { id: 'llm', label: 'AI Prompt Writer', icon: Bot },
  { id: 'search', label: 'Web Image Search', icon: Globe },
  { id: 'threed', label: '3D Generation', icon: Box },
]

function InputField({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-text-secondary">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg bg-bg-card border border-border text-text-primary text-xs placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent transition-all"
      />
    </div>
  )
}

// Model picker backed by the server's file list — a real dropdown of
// every file ComfyUI can see. Falls back to free typing when the list
// isn't loaded (or the field may hold a value the server hasn't indexed).
function ModelField({ label, value, onChange, options = [], placeholder }) {
  const inList = !value || options.includes(value)

  if (options.length === 0) {
    return (
      <div className="space-y-1">
        <label className="text-xs text-text-secondary">{label}</label>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full px-3 py-2 rounded-lg bg-bg-card border border-border text-text-primary text-xs placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent transition-all"
        />
        <p className="text-[10px] text-text-muted">Server list not loaded — type the exact filename</p>
      </div>
    )
  }

  const items = options.map((o) => ({ value: o, label: o }))
  if (value === '' || !options.includes(value)) {
    items.unshift({ value: value || '', label: value || '(none)' })
  } else if (label.includes('LoRA') && !items.some((i) => i.value === '')) {
    items.unshift({ value: '', label: '(none)' })
  }

  return (
    <div className="space-y-1">
      <label className="text-xs text-text-secondary">{label}</label>
      <Dropdown
        value={value}
        onChange={onChange}
        options={items}
        ariaLabel={label}
        editable
        className={clsx('text-xs', inList ? 'border-border' : 'border-warning')}
      />
      <p className={clsx('text-[10px]', inList ? 'text-text-muted' : 'text-warning')}>
        {inList
          ? `${options.length} file(s) available on server`
          : `Not found on server — pick one of the ${options.length} available file(s) or fix the name`}
      </p>
    </div>
  )
}

// Multi-model preset editor. Presets sit ABOVE the model fields; clicking a
// preset loads its unet/clip/vae/lora into the fields below for editing.
// Edits go into `editDraft` (owned by the parent) and are written back to the
// store on Save — so a half-finished edit never silently mutates a preset.
// "Add Preset" snapshots the draft into a new named entry and selects it.
function ModelPresets({ mode, editDraft, setEditDraft, modelLists }) {
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
        <p className="text-[11px] text-text-muted rounded-lg bg-bg-card border border-border px-3 py-2">
          No presets yet. Set the model fields below, then <strong>Add Preset</strong> to save them under a
          name. Add one per engine (e.g. MiniMax Music 3 and ACE-Step 1.5) and click between them any time.
        </p>
      ) : (
        <div className="space-y-1.5">
          {presets.map((p, i) => (
            <div
              key={i}
              className={clsx(
                'flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors',
                active === i
                  ? 'border-accent bg-accent/10'
                  : 'border-border bg-bg-card hover:bg-bg-hover'
              )}
              onClick={() => {
                setActivePreset(mode, i)
                setEditDraft({ unet: '', clip: '', vae: '', lora: '', ...p })
              }}
            >
              <div
                className={clsx(
                  'w-3 h-3 rounded-full border-2 shrink-0',
                  active === i ? 'border-accent bg-accent' : 'border-border'
                )}
              />
              <div className="flex-1 min-w-0">
                {editingIdx === i ? (
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename()
                      if (e.key === 'Escape') { setEditingIdx(-1); setEditName('') }
                    }}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    className="w-full text-xs font-medium text-text-primary bg-bg-card border border-accent rounded px-1.5 py-0.5 focus:outline-none"
                  />
                ) : (
                  <p className="text-xs font-medium text-text-primary truncate">{p.name || `Preset ${i + 1}`}</p>
                )}
                <p className="text-[10px] text-text-muted truncate font-mono">{presetLabel(p)}</p>
              </div>
              {p.engine === 'ace' || /ace[-_ ]?step/i.test(p.unet || '') ? (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-pink-500/20 text-pink-300 font-semibold shrink-0">ACE</span>
              ) : /minimax/i.test(p.unet || '') ? (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-semibold shrink-0">MiniMax</span>
              ) : null}
              <button
                onClick={(e) => { e.stopPropagation(); startRename(i, p.name) }}
                className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-accent transition-colors shrink-0"
                title="Rename preset"
              >
                <Pencil size={12} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); removePreset(mode, i) }}
                className="p-1 rounded hover:bg-red-500/20 text-text-muted hover:text-red-400 transition-colors shrink-0"
                title="Remove preset"
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
          placeholder="Preset name (e.g. &quot;MiniMax Music 3&quot;, &quot;ACE-Step 1.5&quot;)"
          className="flex-1 px-3 py-2 rounded-lg bg-bg-card border border-border text-text-primary text-xs placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent transition-all"
        />
        <button
          onClick={handleAdd}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-accent/20 text-accent hover:bg-accent/30 transition-colors shrink-0"
        >
          <Plus size={14} />
          Add Preset
        </button>
      </div>
    </div>
  )
}

// Select whose options come from the ComfyUI server; falls back to
// showing the current value when the list hasn't loaded. Rendered with
// the app's own Dropdown so every pick is readable and scrollable.
function SelectField({ label, value, onChange, options = [], hint, stripPrefix }) {
  let items = options.map((o) => {
    const [val, lab] = Array.isArray(o) ? o : [o, o]
    return {
      value: String(val),
      label: stripPrefix ? String(lab).replace(/^preset:/, '') : String(lab),
    }
  })
  if (value === '' && !items.some((i) => i.value === '')) {
    items = [{ value: '', label: '(none)' }, ...items]
  }
  if (value !== '' && !items.some((i) => i.value === value)) {
    items = [{ value: String(value), label: String(value) }, ...items]
  }
  return (
    <div className="space-y-1">
      <label className="text-xs text-text-secondary">{label}</label>
      <Dropdown value={String(value)} onChange={onChange} options={items} ariaLabel={label} className="text-xs" />
      {hint && <p className="text-[10px] text-text-muted">{hint}</p>}
    </div>
  )
}

// Numeric input with min/max — keeps the stored value a real number
// (the config sanitizer rejects out-of-range values).
function NumberField({ label, value, onChange, min, max, step = 1, hint }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-text-secondary">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)))
        }}
        className="w-full px-3 py-2 rounded-lg bg-bg-card border border-border text-text-primary text-xs focus:outline-none focus:ring-1 focus:ring-accent"
      />
      {hint && <p className="text-[10px] text-text-muted">{hint}</p>}
    </div>
  )
}

export default function SettingsModal() {
  const showSettings = useStore((s) => s.showSettings)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const serverUrl = useStore((s) => s.serverUrl)
  const setServerUrl = useStore((s) => s.setServerUrl)
  const applyServerConfig = useStore((s) => s.applyServerConfig)
  const models = useStore((s) => s.models)
  const setModels = useStore((s) => s.setModels)
  const useProxy = useStore((s) => s.useProxy)
  const setUseProxy = useStore((s) => s.setUseProxy)
  const autoUnload = useStore((s) => s.autoUnload)
  const setAutoUnload = useStore((s) => s.setAutoUnload)
  const vramGuard = useStore((s) => s.vramGuard)
  const setVramGuard = useStore((s) => s.setVramGuard)
  const modelsUnloaded = useStore((s) => s.modelsUnloaded)
  const presets = useStore((s) => s.presets)
  const active = useStore((s) => s.active)
  const updatePreset = useStore((s) => s.updatePreset)
  const [localUrl, setLocalUrl] = useState(serverUrl)
  const [localModels, setLocalModels] = useState(JSON.parse(JSON.stringify(models)))
  // Editable copy of the selected preset's model files. Seeded from the
  // active music/video preset; clicking a preset in ModelPresets sets
  // `active`, this effect re-seeds the draft from it. Save writes the draft
  // back into the store so the change is durable.
  const [editDraft, setEditDraft] = useState(() => {
    const src = presets?.music?.[active?.music] || models?.music || {}
    return { unet: '', clip: '', vae: '', lora: '', ...src }
  })
  const [videoDraft, setVideoDraft] = useState(() => {
    const src = presets?.video?.[active?.video] || models?.video || {}
    return { unet: '', clip: '', vae: '', lora: '', ...src }
  })
  useEffect(() => {
    setEditDraft(() => {
      const src = presets?.music?.[active?.music] || models?.music || {}
      return { unet: '', clip: '', vae: '', lora: '', ...src }
    })
    setVideoDraft(() => {
      const src = presets?.video?.[active?.video] || models?.video || {}
      return { unet: '', clip: '', vae: '', lora: '', ...src }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.music, active?.video, presets])
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [pulling, setPulling] = useState(false)
  const [pullNote, setPullNote] = useState(null)
  const [modelLists, setModelLists] = useState({ unet: [], clip: [], vae: [], lora: [] })
  const [loadingLists, setLoadingLists] = useState(false)
  const [listsError, setListsError] = useState(null)
  const llmProvider = useStore((s) => s.llmProvider)
  const llmConfigs = useStore((s) => s.llmConfigs)
  const setLlmProvider = useStore((s) => s.setLlmProvider)
  const setLlmConfigs = useStore((s) => s.setLlmConfigs)
  const [localProvider, setLocalProvider] = useState(llmProvider)
  const [localConfigs, setLocalConfigs] = useState(llmConfigs)
  const [llmModels, setLlmModels] = useState([])
  const [loadingLlmModels, setLoadingLlmModels] = useState(false)
  const [llmModelsError, setLlmModelsError] = useState(null)
  const searchUrl = useStore((s) => s.searchUrl)
  const setSearchUrl = useStore((s) => s.setSearchUrl)
  const searchEngine = useStore((s) => s.searchEngine)
  const setSearchEngine = useStore((s) => s.setSearchEngine)
  const searchApiKey = useStore((s) => s.searchApiKey)
  const setSearchApiKey = useStore((s) => s.setSearchApiKey)
  const searchCseId = useStore((s) => s.searchCseId)
  const setSearchCseId = useStore((s) => s.setSearchCseId)
  const [localSearchUrl, setLocalSearchUrl] = useState(searchUrl)
  const [localSearchEngine, setLocalSearchEngine] = useState(searchEngine)
  const [localSearchApiKey, setLocalSearchApiKey] = useState(searchApiKey)
  const [localSearchCseId, setLocalSearchCseId] = useState(searchCseId)
  const [tab, setTab] = useState('server')
  const threeD = useStore((s) => s.threeD)
  const setThreeD = useStore((s) => s.setThreeD)
  // Seed from the store, filling any quality fields an older saved config
  // predates (localStorage from a previous build may lack them).
  const [localThreeD, setLocalThreeD] = useState({
    qualityPreset: 'standard',
    meshMode: 'pixal3d',
    ...QUALITY_PRESETS.standard,
    ...threeD,
  })
  const [threeDLists, setThreeDLists] = useState({
    modelVersion: [],
    rigVersion: [],
    rigType: [],
    spec: [],
    outFormat: [],
    presets: [],
    localAnims: [],
    upscaleModels: [],
  })
  // Result of the last "does the server have the required 3D nodes?" check:
  // null = not checked, { ok } | { missing, unreachable }
  const [threeDCheck, setThreeDCheck] = useState(null)
  const [threeDChecking, setThreeDChecking] = useState(false)

  const loadModelLists = async (url) => {
    setLoadingLists(true)
    setListsError(null)
    try {
      const base = resolveApiBase(url, useProxy)
      const lists = await getModelLists(base)
      setModelLists(lists)
      if (Object.values(lists).every((l) => l.length === 0)) {
        setListsError('Server responded but reported no model files — are your models downloaded?')
      }
    } catch (err) {
      setListsError(`Could not reach server: ${err.message}`)
    } finally {
      setLoadingLists(false)
    }
  }

  const setLocalConfig = (provider, patch) =>
    setLocalConfigs((c) => ({ ...c, [provider]: { ...c[provider], ...patch } }))

  // "Does the server actually have this pipeline's node packs?" — run when
  // the 3D tab is switched on, when the pipeline changes, and again on Save.
  // Never throws; resolves { ok: true } | { ok: false, missing, unreachable }.
  const verifyThreeD = async (pipeline, url = localUrl) => {
    setThreeDChecking(true)
    try {
      const base = resolveApiBase(url, useProxy)
      const { missing, unreachable, busy: serverBusy } = await checkNodes(base, requiredThreeDNodes(pipeline))
      const check =
        missing.length > 0
          ? { ok: false, missing, unreachable, busy: false }
          : unreachable
            ? { ok: false, missing: [], unreachable: true, busy: false }
            : serverBusy
              ? { ok: false, missing: [], unreachable: false, busy: true }
              : { ok: true, missing: [] }
      setThreeDCheck(check)
      return check
    } catch (err) {
      const check = { ok: false, missing: [], unreachable: true, error: err.message }
      setThreeDCheck(check)
      return check
    } finally {
      setThreeDChecking(false)
    }
  }

  // Enabling requires a verified server: missing packs keep the tab off and
  // surface an install hint. An unreachable server only warns (can't verify).
  const toggleThreeD = async () => {
    if (localThreeD.enabled) {
      setLocalThreeD((t) => ({ ...t, enabled: false }))
      setThreeDCheck(null)
      return
    }
    const check = await verifyThreeD(localThreeD.pipeline)
    if (check.missing.length > 0) return
    setLocalThreeD((t) => ({ ...t, enabled: true }))
  }

  const changePipeline = async (v) => {
    const wasEnabled = localThreeD.enabled
    setLocalThreeD((t) => ({ ...t, pipeline: v }))
    if (!wasEnabled) return
    const check = await verifyThreeD(v)
    if (check.missing.length > 0) setLocalThreeD((t) => ({ ...t, enabled: false }))
  }

  // Combo options for the 3D nodes, straight from the ComfyUI server.
  const loadThreeDLists = async (url) => {
    try {
      const base = resolveApiBase(url, useProxy)
      const [modelVersion, rigVersion, rigType, spec, outFormat, presets, localAnims, upscaleModels, ultrashapeCkpts] =
        await Promise.all([
          getNodeComboOptions(base, 'TripoImageToModelNode', 'model_version', 'optional'),
          getNodeComboOptions(base, 'TripoRigNode', 'model_version', 'optional'),
          getNodeComboOptions(base, 'TripoRigNode', 'rig_type', 'optional'),
          getNodeComboOptions(base, 'TripoRigNode', 'spec', 'optional'),
          getNodeComboOptions(base, 'TripoRigNode', 'out_format', 'optional'),
          getNodeComboOptions(base, 'TripoRetargetNode', 'animation', 'required'),
          getNodeComboOptions(base, 'UniRigApplyAnimation', 'animation_file', 'required'),
          getNodeComboOptions(base, 'UpscaleModelLoader', 'model_name', 'required'),
          getNodeComboOptions(base, 'UltraShapeLoadModel', 'checkpoint', 'required'),
        ])
      setThreeDLists({
        modelVersion,
        rigVersion,
        rigType,
        spec,
        outFormat,
        presets,
        localAnims,
        upscaleModels,
        ultrashapeCkpts: ultrashapeCkpts.filter((c) => c !== '(select file)'),
      })
    } catch {
      // server unreachable — selects fall back to the saved values
    }
  }

  const loadLlmModels = async (url) => {
    setLoadingLlmModels(true)
    setLlmModelsError(null)
    try {
      const names = await fetchLlmModels(url)
      setLlmModels(names)
      if (names.length === 0) {
        setLlmModelsError('Endpoint is reachable but listed no models.')
      }
    } catch (err) {
      setLlmModels([])
      setLlmModelsError(err.message)
    } finally {
      setLoadingLlmModels(false)
    }
  }

  // Refresh local fields + server model lists each time the modal opens.
  // Merges in defaults so settings saved by older versions still work.
  // Reads straight from the store (getState) so it can also re-seed right
  // after a pull from the server, before React re-renders with new props.
  const seedFromStore = () => {
    const st = useStore.getState()
    setLocalUrl(st.serverUrl)
    const current = JSON.parse(JSON.stringify(st.models))
    setLocalModels({
      ...current,
      edit: {
        unet: 'qwen_image_edit_fp8_e4m3fn.safetensors',
        ...(current.edit || {}),
      },
    })
    loadModelLists(st.serverUrl)
    setLocalProvider(st.llmProvider)
    const cfgs = JSON.parse(JSON.stringify(st.llmConfigs))
    setLocalConfigs(cfgs)
    setLlmModels([])
    setLlmModelsError(null)
    if (PROVIDERS[st.llmProvider]?.modelsBtn && cfgs[st.llmProvider]?.url) {
      loadLlmModels(cfgs[st.llmProvider].url)
    }
    setLocalSearchUrl(st.searchUrl)
    setLocalSearchEngine(st.searchEngine || 'searxng')
    setLocalSearchApiKey(st.searchApiKey || '')
    setLocalSearchCseId(st.searchCseId || '')
    setLocalThreeD({
      qualityPreset: 'standard',
      ...QUALITY_PRESETS.standard,
      ...JSON.parse(JSON.stringify(st.threeD)),
    })
    setThreeDCheck(null)
    setThreeDLists({
      modelVersion: [],
      rigVersion: [],
      rigType: [],
      spec: [],
      outFormat: [],
      presets: [],
      localAnims: [],
      upscaleModels: [],
    })
  }

  useEffect(() => {
    if (showSettings) {
      setTab('server')
      setSaveError(null)
      setPullNote(null)
      seedFromStore()
    }
  }, [showSettings])

  // "Update from server" — pull config.json (shared settings saved by any
  // device via Save Settings) and apply it on demand, re-seeding the open
  // modal so the fields show the pulled values immediately.
  const handlePull = async () => {
    if (pulling) return
    setPulling(true)
    setPullNote(null)
    setSaveError(null)
    try {
      const config = await fetchRuntimeConfig()
      if (!config || Object.keys(config).length === 0) {
        setPullNote({ kind: 'warn', text: 'No settings found on the server (or it is unreachable) — nothing to update.' })
        return
      }
      if (config.synced !== true) {
        setPullNote({ kind: 'warn', text: 'Server has no saved settings yet — press Save Settings on a device first.' })
        return
      }
      applyServerConfig(config, { force: true })
      seedFromStore()
      setPullNote({ kind: 'ok', text: 'Settings updated from the server.' })
      setTimeout(() => setPullNote(null), 4000)
    } finally {
      setPulling(false)
    }
  }

  // Esc closes the modal (same as the X button in the header).
  useEffect(() => {
    if (!showSettings) return
    const onKey = (e) => {
      if (e.key === 'Escape') setShowSettings(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showSettings, setShowSettings])

  // Fetch 3D node option lists whenever the section is open and enabled
  // (also runs when the toggle is flipped on mid-edit).
  useEffect(() => {
    if (showSettings && localThreeD.enabled) {
      loadThreeDLists(serverUrl)
    }
  }, [showSettings, localThreeD.enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    // Final gate for the 3D tab: never persist "enabled" on a server that
    // is missing the required node packs.
    if (localThreeD.enabled) {
      const check = await verifyThreeD(localThreeD.pipeline)
      if (check.missing.length > 0) {
        setSaveError('3D tab not enabled — required node pack(s) missing on the server (see 3D Generation above).')
        return
      }
    }
    setServerUrl(localUrl)
    setModels('image', localModels.image)
    setModels('video', localModels.video)
    if (localModels.edit) setModels('edit', localModels.edit)
    if (localModels.music) setModels('music', localModels.music)
    // Write the edited model files back into the selected music preset so
    // the picker and generation both see the change.
    if (active?.music != null && presets?.music?.[active.music]) {
      updatePreset('music', active.music, { ...editDraft })
    }
    if (active?.video != null && presets?.video?.[active.video]) {
      updatePreset('video', active.video, { ...videoDraft })
    }
    setLlmProvider(localProvider)
    setLlmConfigs(localConfigs)
    setSearchUrl(localSearchUrl)
    setSearchEngine(localSearchEngine)
    setSearchApiKey(localSearchApiKey)
    setSearchCseId(localSearchCseId)
    setThreeD(localThreeD)
    // Write through to config.json on disk so every browser shares these
    // settings (keys are excluded — they stay in this browser).
    setSaveError(null)
    try {
      await pushRuntimeConfig(configFromState(useStore.getState()))
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setSaveError(err.message)
    }
  }

  if (!showSettings) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
        onClick={() => setShowSettings(false)}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          className="w-[min(97vw,1180px)] h-[min(92vh,880px)] rounded-2xl glass flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-border shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-accent/20 flex items-center justify-center">
                <Server size={20} className="text-accent" />
              </div>
              <div>
                <h2 className="text-lg font-bold leading-tight">Settings</h2>
                <p className="text-xs text-text-muted">Server, models, AI, search, 3D</p>
              </div>
            </div>
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => setShowSettings(false)}
              aria-label="Close settings"
              title="Close (Esc)"
              className="p-2 rounded-lg hover:bg-bg-hover transition-colors shrink-0"
            >
              <X size={18} />
            </motion.button>
          </div>

          <div className="flex flex-1 min-h-0">
            {/* Section menu */}
            <nav className="w-56 shrink-0 border-r border-border p-3 space-y-1 overflow-y-auto">
              {SETTINGS_TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={clsx(
                    'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-left transition-colors',
                    tab === t.id
                      ? 'bg-accent/15 text-accent font-medium'
                      : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                  )}
                >
                  <t.icon size={16} className="shrink-0" />
                  <span className="truncate">{t.label}</span>
                </button>
              ))}
            </nav>

            {/* Content */}
            <div className="flex-1 min-w-0 flex flex-col">
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
                {tab === 'server' && (
            <>
{/* Server */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Server size={14} className="text-accent" />
              ComfyUI Server
            </h3>
            <label className="flex items-center justify-between cursor-pointer rounded-lg bg-bg-card border border-border px-3 py-2.5">
              <span className="text-xs">
                <span className="block text-text-primary font-medium">Route through app proxy</span>
                <span className="block text-text-muted mt-0.5">Recommended — avoids browser CORS errors</span>
              </span>
              <button
                onClick={() => setUseProxy(!useProxy)}
                className={`relative w-9 h-5 rounded-full transition-colors duration-200 shrink-0 ml-3 ${useProxy ? 'bg-accent' : 'bg-bg-hover'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200 ${useProxy && 'translate-x-4'}`} />
              </button>
            </label>
            <label className="flex items-center justify-between cursor-pointer rounded-lg bg-bg-card border border-border px-3 py-2.5">
              <span className="text-xs">
                <span className="block text-text-primary font-medium">Auto-unload models (5 min idle)</span>
                <span className="block text-text-muted mt-0.5">
                  Frees ComfyUI memory when idle — next generate reloads the model
                  {modelsUnloaded && <span className="text-warning font-medium"> · currently unloaded</span>}
                </span>
              </span>
              <button
                onClick={() => setAutoUnload(!autoUnload)}
                className={`relative w-9 h-5 rounded-full transition-colors duration-200 shrink-0 ml-3 ${autoUnload ? 'bg-accent' : 'bg-bg-hover'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200 ${autoUnload && 'translate-x-4'}`} />
              </button>
            </label>
            <label className="flex items-center justify-between cursor-pointer rounded-lg bg-bg-card border border-border px-3 py-2.5">
              <span className="text-xs">
                <span className="block text-text-primary font-medium">VRAM guard (AI Prompt Writer)</span>
                <span className="block text-text-muted mt-0.5">
                  Before generating, checks LM Studio for a big LLM sharing the GPU. If one is loaded and ComfyUI is idle, it frees ComfyUI's models first (they reload next run). If ComfyUI is busy, it blocks instead of OOMing.
                </span>
              </span>
              <button
                onClick={() => setVramGuard(!vramGuard)}
                className={`relative w-9 h-5 rounded-full transition-colors duration-200 shrink-0 ml-3 ${vramGuard ? 'bg-accent' : 'bg-bg-hover'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200 ${vramGuard && 'translate-x-4'}`} />
              </button>
            </label>
            <InputField
              label="Server URL"
              value={localUrl}
              onChange={setLocalUrl}
              placeholder="http://192.168.1.50:8188"
            />
            {useProxy ? (
              <p className="text-[11px] leading-relaxed text-text-muted rounded-lg bg-bg-card border border-border px-3 py-2">
                Proxy is <span className="text-green-400 font-medium">ON</span>: requests go through this page to the Server URL above — no CORS issues, no ComfyUI flags needed. Just type the IP, Save, and it connects.
              </p>
            ) : (
              <p className="text-[11px] leading-relaxed text-text-muted rounded-lg bg-bg-card border border-border px-3 py-2">
                Direct connections require ComfyUI to allow cross-origin requests — start it with the <span className="font-mono text-warning">--enable-cors-header</span> flag, otherwise the browser will block it.
              </p>
            )}
          </div>
            </>
          )}

          {tab === 'llm' && (
            <>
{/* AI Prompt Writer (multi-provider) */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Bot size={14} className="text-accent" />
              AI Prompt Writer{' '}
              <span className="text-[10px] font-normal text-text-muted">
                (optional, via {PROVIDERS[localProvider]?.short})
              </span>
            </h3>

            {/* Provider selector */}
            <div className="space-y-1">
              <label className="text-xs text-text-secondary">Provider</label>
              <Dropdown
                value={localProvider}
                onChange={(p) => {
                  setLocalProvider(p)
                  setLlmModels([])
                  setLlmModelsError(null)
                  if (PROVIDERS[p]?.modelsBtn && localConfigs[p]?.url) {
                    loadLlmModels(localConfigs[p].url)
                  }
                }}
                options={Object.entries(PROVIDERS).map(([key, p]) => ({ value: key, label: p.label }))}
                ariaLabel="LLM provider"
                className="text-xs"
              />
            </div>

            {/* Shared model row: editable dropdown (+ optional Models button) */}
            {(() => {
              const modelInput = ({ value, onPick, options, showModelsBtn, onModelsClick, placeholder }) => {
                const items = options.map((o) => ({ value: o, label: o }))
                if (value && !options.includes(value)) items.unshift({ value, label: `${value}` })
                if (!value && placeholder) items.unshift({ value: '', label: placeholder })
                return (
                  <div className="space-y-1">
                    <label className="text-xs text-text-secondary">Model</label>
                    <div className="flex gap-2">
                      <div className="flex-1 min-w-0">
                        <Dropdown
                          value={value}
                          onChange={onPick}
                          options={items}
                          ariaLabel="Model"
                          editable
                          className="text-xs"
                        />
                      </div>
                      {showModelsBtn && (
                        <motion.button
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={onModelsClick}
                          disabled={loadingLlmModels}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] bg-bg-hover hover:bg-accent/20 hover:text-accent transition-colors disabled:opacity-50 shrink-0"
                          title="List models from this endpoint"
                        >
                          <RefreshCw size={12} className={loadingLlmModels ? 'animate-spin' : ''} />
                          {loadingLlmModels ? '...' : 'Models'}
                        </motion.button>
                      )}
                    </div>
                    {!options.includes(value) && options.length > 0 && value && (
                      <p className="text-[10px] text-text-muted">
                        {options.length} model(s) listed — the typed name will be used as-is
                      </p>
                    )}
                    {showModelsBtn && llmModelsError && (
                      <p className="text-[11px] text-warning">{llmModelsError}</p>
                    )}
                  </div>
                )
              }

              const cfg = localConfigs[localProvider] || {}

              if (localProvider === 'lmstudio') {
                return (
                  <>
                    <InputField
                      label="LM Studio URL"
                      value={cfg.url || ''}
                      onChange={(v) => setLocalConfig('lmstudio', { url: v })}
                      placeholder="http://host.docker.internal:1234"
                    />
                    {modelInput({
                      value: cfg.model || '',
                      onPick: (v) => setLocalConfig('lmstudio', { model: v }),
                      options: llmModels,
                      showModelsBtn: true,
                      onModelsClick: () => loadLlmModels(cfg.url),
                      placeholder: 'pick via Models',
                    })}
                  </>
                )
              }

              if (localProvider === 'openai') {
                return (
                  <>
                    <InputField
                      label="API key"
                      type="password"
                      value={cfg.key || ''}
                      onChange={(v) => setLocalConfig('openai', { key: v })}
                      placeholder="sk-..."
                    />
                    {modelInput({
                      value: cfg.model || '',
                      onPick: (v) => setLocalConfig('openai', { model: v }),
                      options: MODEL_SUGGESTIONS.openai,
                      showModelsBtn: false,
                      placeholder: 'gpt-4o-mini',
                    })}
                  </>
                )
              }

              if (localProvider === 'anthropic') {
                return (
                  <>
                    <InputField
                      label="API key"
                      type="password"
                      value={cfg.key || ''}
                      onChange={(v) => setLocalConfig('anthropic', { key: v })}
                      placeholder="sk-ant-..."
                    />
                    {modelInput({
                      value: cfg.model || '',
                      onPick: (v) => setLocalConfig('anthropic', { model: v }),
                      options: MODEL_SUGGESTIONS.anthropic,
                      showModelsBtn: false,
                      placeholder: 'claude-haiku-4-5',
                    })}
                  </>
                )
              }

              // custom / OpenAI-compatible
              return (
                <>
                  <InputField
                    label="Base URL"
                    value={cfg.url || ''}
                    onChange={(v) => setLocalConfig('custom', { url: v })}
                    placeholder="https://openrouter.ai/api/v1"
                  />
                  <InputField
                    label="API key (optional)"
                    type="password"
                    value={cfg.key || ''}
                    onChange={(v) => setLocalConfig('custom', { key: v })}
                    placeholder="sk-or-... (blank for local servers)"
                  />
                  {modelInput({
                    value: cfg.model || '',
                    onPick: (v) => setLocalConfig('custom', { model: v }),
                    options: llmModels,
                    showModelsBtn: true,
                    onModelsClick: () => loadLlmModels(cfg.url),
                    placeholder: 'pick via Models',
                  })}
                </>
                )
            })()}

            {/* Provider-specific help */}
            <p className="text-[11px] leading-relaxed text-text-muted rounded-lg bg-bg-card border border-border px-3 py-2">
              {localProvider === 'lmstudio' && (
                <>
                  Powers the <span className="text-accent font-medium">AI</span> button: rewrites your words into a full
                  prompt, picks a web search query, and (in Image mode) jumps straight to the Web panel with results.
                  In LM Studio open the <span className="font-mono">Developer</span> tab, load a model (~4B+ instruction
                  model, e.g. Qwen3.5 4B), and flip <span className="font-mono">Start server</span> (default port 1234).
                  LM Studio on this machine? Keep the default URL. On another machine, use its IP and enable{' '}
                  <span className="font-mono">Serve on Local Network</span>.
                </>
              )}
              {localProvider === 'openai' && (
                <>
                  Uses the official OpenAI API — create a key at{' '}
                  <span className="font-mono">platform.openai.com → API keys</span>. <span className="font-mono">gpt-4o-mini</span>{' '}
                  is fast and cheap for prompt rewrites. The key is stored only in this browser and requests are sent
                  through the app's proxy.
                </>
              )}
              {localProvider === 'anthropic' && (
                <>
                  Uses the official Anthropic API — create a key at{' '}
                  <span className="font-mono">console.anthropic.com → API keys</span>.{' '}
                  <span className="font-mono">claude-haiku-4-5</span> is fast and cheap for rewrites. The key is stored
                  only in this browser and requests are sent through the app's proxy.
                </>
              )}
              {localProvider === 'custom' && (
                <>
                  Any OpenAI-compatible server: OpenRouter, Groq, Together, Ollama (<span className="font-mono">http://host:11434</span>),
                  vLLM, and more. Base URL usually ends in <span className="font-mono">/v1</span> (added automatically for bare
                  addresses). API key optional for local servers. Stored in this browser; sent through the app's proxy.
                </>
              )}
            </p>
          </div>
            </>
          )}

          {tab === 'search' && (
            <>
{/* Web Image Search */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Globe size={14} className="text-accent" />
              Web Image Search
            </h3>
            <SelectField
              label="Search engine"
              value={localSearchEngine}
              onChange={setLocalSearchEngine}
              options={SEARCH_ENGINES.map((e) => [e.value, e.label])}
            />
            <p className="text-[11px] leading-relaxed text-text-muted">
              {searchEngineInfo(localSearchEngine).hint}
              {searchEngineInfo(localSearchEngine).docs && (
                <>
                  {' '}
                  <a
                    href={searchEngineInfo(localSearchEngine).docs}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sky-300 hover:underline"
                  >
                    Get one →
                  </a>
                </>
              )}
            </p>

            {searchEngineInfo(localSearchEngine).needsUrl && (
              <InputField
                label="SearXNG URL"
                value={localSearchUrl}
                onChange={setLocalSearchUrl}
                placeholder="https://searx.example.com"
              />
            )}
            {searchEngineInfo(localSearchEngine).needsKey && (
              <InputField
                label="API key"
                type="password"
                value={localSearchApiKey}
                onChange={setLocalSearchApiKey}
                placeholder="paste your API key"
              />
            )}
            {searchEngineInfo(localSearchEngine).needsCse && (
              <InputField
                label="Search Engine ID (cx)"
                value={localSearchCseId}
                onChange={setLocalSearchCseId}
                placeholder="0123456789abcdef:abcdefghijk"
              />
            )}

            <p className="text-[11px] leading-relaxed text-text-muted rounded-lg bg-bg-card border border-border px-3 py-2">
              Powers the <span className="text-sky-300 font-medium">Web</span> button: search the internet for a reference
              image, click one, and it becomes the Edit source for ComfyUI to update. Requests go through the app proxy —
              no CORS issues, self-signed certs fine.
              {localSearchEngine === 'searxng' && (
                <>
                  {' '}
                  Your instance must have <span className="font-mono">json</span> listed under{' '}
                  <span className="font-mono">search.formats</span> in settings.yml.
                </>
              )}
              {searchEngineInfo(localSearchEngine).needsKey && (
                <>
                  {' '}
                  The key stays in this browser — it is never written to the shared config.
                </>
              )}
            </p>
          </div>
            </>
          )}

          {tab === 'threed' && (
            <>
{/* 3D Generation (optional feature) */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Box size={14} className="text-accent" />
              3D Generation <span className="text-[10px] font-normal text-text-muted">(optional)</span>
            </h3>
            <label className="flex items-center justify-between cursor-pointer rounded-lg bg-bg-card border border-border px-3 py-2.5">
              <span className="text-xs">
                <span className="block text-text-primary font-medium">Enable the 3D tab</span>
                <span className="block text-text-muted mt-0.5">
                  Character image → 3D model → rig → walk / run / jump animation
                </span>
              </span>
              <button
                onClick={toggleThreeD}
                disabled={threeDChecking}
                className={`relative w-9 h-5 rounded-full transition-colors duration-200 shrink-0 ml-3 ${
                  localThreeD.enabled ? 'bg-accent' : 'bg-bg-hover'
                } ${threeDChecking ? 'opacity-60' : ''}`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200 ${
                    localThreeD.enabled && 'translate-x-4'
                  }`}
                />
              </button>
            </label>

            {/* Server verification result (required node packs) */}
            {threeDChecking && (
              <p className="text-[11px] text-text-muted">Checking the ComfyUI server for required 3D nodes…</p>
            )}
            {threeDCheck && !threeDCheck.ok && threeDCheck.missing?.length > 0 && (
              <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2.5 text-[11px] leading-relaxed text-red-300">
                <p className="font-semibold">Can't enable the 3D tab — required node(s) missing on the server:</p>
                <ul className="mt-1 space-y-0.5 list-disc list-inside">
                  {threeDCheck.missing.map((n) => (
                    <li key={n}>{describeNode(n)}</li>
                  ))}
                </ul>
                <p className="mt-1.5 text-red-200/80">
                  Built-in nodes mean your ComfyUI is too old — update ComfyUI to ≥ 0.39 and restart it. MIA/UniRig
                  entries go into <span className="font-mono">custom_nodes/</span> (pip install -r requirements.txt
                  inside each pack), then restart ComfyUI and try again.
                </p>
              </div>
            )}
            {threeDCheck && !threeDCheck.ok && threeDCheck.unreachable && (
              <p className="text-[11px] text-warning">
                Couldn't verify — ComfyUI isn't reachable at the Server URL above. You can still enable the tab, but it
                will error out when used if the packs aren't installed.
              </p>
            )}
            {threeDCheck && !threeDCheck.ok && threeDCheck.busy && (
              <p className="text-[11px] text-warning">
                ComfyUI is busy or stuck and stopped answering, so the nodes couldn't be verified — this isn't a
                missing-pack problem. Finish or interrupt the current run there (Queue → Cancel All), then re-check.
              </p>
            )}
            {threeDCheck?.ok && localThreeD.enabled && (
              <p className="text-[11px] text-green-400">
                Verified — all required nodes for the {localThreeD.pipeline === 'tripo' ? 'Tripo' : 'local'} pipeline are
                installed.
              </p>
            )}

            {localThreeD.enabled && (
              <>
                <SelectField
                  label="Pipeline"
                  value={localThreeD.pipeline}
                  onChange={changePipeline}
                  options={['local', 'tripo']}
                  hint={
                    localThreeD.pipeline === 'local'
                      ? 'Local: native Pixal3D/TRELLIS.2 mesh + MIA/UniRig rigging run on your own ComfyUI (needs ComfyUI ≥ 0.39).'
                      : 'Tripo cloud: one job does model → rig → animation. Needs ComfyUI signed in to comfy.org.'
                  }
                />

                {localThreeD.pipeline === 'local' ? (
                  <>
                    <SelectField
                      label="3D engine"
                      value={localThreeD.meshMode || 'pixal3d'}
                      onChange={(v) => setLocalThreeD((t) => ({ ...t, meshMode: v }))}
                      options={[
                        ['pixal3d', 'Pixal3D — stable, proven (default)'],
                        ['trellis2', 'TRELLIS.2 — newer, sometimes sharper detail'],
                      ]}
                      hint="Both engines ship built into ComfyUI ≥ 0.39 (no custom pack); models are already in models/diffusion/"
                    />
                    <SelectField
                      label="Quality preset"
                      value={localThreeD.qualityPreset || 'standard'}
                      onChange={(v) =>
                        setLocalThreeD((t) =>
                          v === 'custom'
                            ? { ...t, qualityPreset: 'custom' }
                            : { ...t, qualityPreset: v, ...QUALITY_PRESETS[v] }
                        )
                      }
                      options={[
                        ['standard', 'Standard — proven baseline'],
                        ['high', 'High — sharper texture & geometry'],
                        ['ultra', 'Ultra — 8k texture, maximum detail'],
                        ['custom', 'Custom — use the values below as-is'],
                      ]}
                      hint="One pick sets the whole pipeline — mesh generation, Skin (paint) and Upscale (UltraShape) — so every stage stays matched and file-size friendly (~40 MB GLBs): texture 4096 (8192 on Ultra), VRAM-safe upscaler values for 16GB cards. Past ~30 sampling steps the distilled sampler just burns time. Editing any field below switches to Custom."
                    />
                    <SelectField
                      label="Face fix"
                      value={String(localThreeD.faceFix ?? true)}
                      onChange={(v) => setLocalThreeD((t) => ({ ...t, faceFix: v === 'true' }))}
                      options={[
                        ['true', 'On — sharpen the face before mesh gen and during Skin'],
                        ['false', 'Off — use the picture as-is'],
                      ]}
                      hint="Faces get ~1-2% of the texture, so this runs a face-focused Qwen edit on your picture before generation, then refines the face on the front paint view to photoreal quality (views 1024px default, texture 4096). Precise face masking switches on automatically when models/detection/mediapipe_face_fp32.safetensors is installed (restart ComfyUI after adding it); until then a low-strength whole-image face pass is used. Any failure falls back to your original picture."
                    />
                    <SelectField
                      label="Skin face blend"
                      value={String(localThreeD.hunyuanSkinBlend ?? true)}
                      onChange={(v) => setLocalThreeD((t) => ({ ...t, hunyuanSkinBlend: v === 'true' }))}
                      options={[
                        ['true', 'On — paint only the face, keep generated hair/clothes'],
                        ['false', 'Off — use the painted texture as-is'],
                      ]}
                      hint="Hybrid skin: after Skin finishes, the painted face (eyes, lips, skin detail) is blended back into your generated texture, so the paint pass can't blotch the crown hair or orange-tint the neck. Fails safe — on any mismatch it keeps the painted texture unchanged."
                    />
                    <SelectField
                      label="Skin detail views"
                      value={String(localThreeD.hunyuanViewUpscale ?? true)}
                      onChange={(v) => setLocalThreeD((t) => ({ ...t, hunyuanViewUpscale: v === 'true' }))}
                      options={[
                        ['true', 'On — sharpen views before bake (much crisper faces)'],
                        ['false', 'Off — bake from the raw views'],
                      ]}
                      hint="The face only gets ~2.5% of the texture atlas, so Skin detail views upscales the front view with a local 4x detail model (and feeds the bake views at 2× size) to fill the atlas's real face density instead of upsampling a soft view. Adds a few seconds; free and local."
                    />
                    <SelectField
                      label="Source pre-enhance"
                      value={localThreeD.pixalEnhance || 'sharpen'}
                      onChange={(v) => setLocalThreeD((t) => ({ ...t, pixalEnhance: v }))}
                      options={[
                        ['none', 'Off — use the source image as-is'],
                        ['sharpen', 'Sharpen — local unsharp mask (free)'],
                        ['esrgan', 'ESRGAN 4x upscale (local, free — needs a model file)'],
                        ['magnific4x', 'Magnific 4x + detail (PAID — comfy.org credits)'],
                      ]}
                      hint="The mesh bakes texture FROM this image, so a sharper input = sharper face. Mesh generation is always free — only Magnific/Tripo cloud nodes cost credits"
                    />
                    {localThreeD.pixalEnhance === 'esrgan' && (
                      <SelectField
                        label="ESRGAN model file"
                        value={localThreeD.pixalUpscaleModel || ''}
                        onChange={(v) => setLocalThreeD((t) => ({ ...t, pixalUpscaleModel: v }))}
                        options={threeDLists.upscaleModels}
                        hint={
                          threeDLists.upscaleModels.length > 0
                            ? 'Found on your ComfyUI server'
                            : 'No model files found — download a free one (4x-UltraSharp.pth or RealESRGAN_x4plus.pth) into ComfyUI/models/upscale_models/, then restart ComfyUI'
                        }
                      />
                    )}
                    <NumberField
                      label="Texture size (px)"
                      value={localThreeD.pixalTextureSize ?? 4096}
                      onChange={(n) => setLocalThreeD((t) => ({ ...t, pixalTextureSize: n, qualityPreset: 'custom' }))}
                      min={512}
                      max={8192}
                      step={512}
                      hint="4096 = sweet spot (~40 MB GLB). 8192 quadruples texture bytes and pushed one run to 159 MB with no visible detail gain"
                    />
                    <NumberField
                      label="Triangle budget"
                      value={localThreeD.pixalDecimation ?? 300000}
                      onChange={(n) => setLocalThreeD((t) => ({ ...t, pixalDecimation: n, qualityPreset: 'custom' }))}
                      min={5000}
                      max={5000000}
                      step={50000}
                      hint="300k suits most characters; 1M (Pixal's demo default) tripled the file for a smooth model. Oversized meshes are auto-decimated before Upscale anyway"
                    />
                    <NumberField
                      label="Subject crop (px)"
                      value={localThreeD.pixalCameraRes ?? 1024}
                      onChange={(n) => setLocalThreeD((t) => ({ ...t, pixalCameraRes: n, qualityPreset: 'custom' }))}
                      min={256}
                      max={2048}
                      step={64}
                      hint="Square crop box around the subject before the 3D conditioning (1024 is plenty; does not affect texture resolution)"
                    />
                    <NumberField
                      label="Sampling steps"
                      value={localThreeD.pixalSteps ?? 20}
                      onChange={(n) => setLocalThreeD((t) => ({ ...t, pixalSteps: n, qualityPreset: 'custom' }))}
                      min={1}
                      max={100}
                      hint="20 (template default) — shape & upsample samplers; the distilled model gains nothing past ~30 and just burns time"
                    />
                    <NumberField
                      label="Shape guidance"
                      value={localThreeD.pixalGuidance ?? 7.5}
                      onChange={(n) => setLocalThreeD((t) => ({ ...t, pixalGuidance: n, qualityPreset: 'custom' }))}
                      min={0}
                      max={20}
                      step={0.1}
                      hint="Locks the shape harder to the image (template default 7.5; too high causes artifacts)"
                    />
                    <SelectField
                      label="Voxel remesh at export"
                      value={String(localThreeD.pixalRemesh ?? true)}
                      onChange={(v) =>
                        setLocalThreeD((t) => ({ ...t, pixalRemesh: v === 'true', qualityPreset: 'custom' }))
                      }
                      options={[
                        ['true', 'On — cleans topology for rigging (smooths fine detail)'],
                        ['false', 'Off — keeps raw geometry but fragments the UV atlas (distance shimmer)'],
                      ]}
                      hint="On for every preset: without the remesh the unwelded mesh breaks the UV unwrap into ~23k tiny charts, and texture mip-mapping then bleeds across them (measured 29% seam jumps at distance vs 9% with remesh). Off only if you need maximum micro-geometry and can accept the shimmer"
                    />
                    <p className="text-[11px] font-medium text-text-secondary pt-1">
                      Hunyuan3D paint — Skin button (texture refine)
                    </p>
                    <NumberField
                      label="View render size (px)"
                      value={localThreeD.hunyuanViewSize ?? 1024}
                      onChange={(n) => setLocalThreeD((t) => ({ ...t, hunyuanViewSize: n, qualityPreset: 'custom' }))}
                      min={128}
                      max={1024}
                      step={64}
                      hint="Per-view repaint resolution — 512 standard / 1024 high+ultra; higher = sharper face and texture, slower Skin. Node caps at 1024."
                    />
                    <NumberField
                      label="Paint texture (px)"
                      value={localThreeD.hunyuanTextureSize ?? 4096}
                      onChange={(n) => setLocalThreeD((t) => ({ ...t, hunyuanTextureSize: n, qualityPreset: 'custom' }))}
                      min={256}
                      max={8192}
                      step={512}
                      hint="Atlas the Skin pass writes — 4096 recommended (same as generation, keeps the file lean)"
                    />
                    <NumberField
                      label="Paint steps"
                      value={localThreeD.hunyuanPaintSteps ?? 10}
                      onChange={(n) => setLocalThreeD((t) => ({ ...t, hunyuanPaintSteps: n, qualityPreset: 'custom' }))}
                      min={1}
                      max={100}
                      hint="10 default — Skin is a light refinement pass, returns diminish past ~20 and it just burns time"
                    />
                    <NumberField
                      label="Paint guidance"
                      value={localThreeD.hunyuanGuidance ?? 3}
                      onChange={(n) => setLocalThreeD((t) => ({ ...t, hunyuanGuidance: n, qualityPreset: 'custom' }))}
                      min={0}
                      max={20}
                      step={0.1}
                      hint="How hard the repaint follows your photo (3 default; too high copies source-image artifacts into the texture)"
                    />
                    <SelectField
                      label="MIA precision"
                      value={localThreeD.miaPrecision}
                      onChange={(v) => setLocalThreeD((t) => ({ ...t, miaPrecision: v }))}
                      options={['fp32']}
                      hint="fp32 only — bf16/fp16/auto crash the rig: torch_cluster's farthest-point-sampling kernel has no bf16 support ('_' not implemented for 'BFloat16'). If you have an older saved setting, it gets overridden to fp32 at queue time."
                    />
                    <SelectField
                      label="Default animation"
                      value={localThreeD.localAnimationFile}
                      onChange={(v) => setLocalThreeD((t) => ({ ...t, localAnimationFile: v }))}
                      options={threeDLists.localAnims}
                      hint="Blanks = rig only. Add FBX files to ComfyUI's input/animation_templates/mixamo/ then restart ComfyUI"
                    />
                    <p className="text-[11px] font-medium text-text-secondary pt-1">
                      UltraShape 1.0 — Upscale button (mesh refine)
                    </p>
                    <SelectField
                      label="Checkpoint"
                      value={localThreeD.ultrashapeCheckpoint || 'ultrashape_v1.pt'}
                      onChange={(v) => setLocalThreeD((t) => ({ ...t, ultrashapeCheckpoint: v }))}
                      options={threeDLists.ultrashapeCkpts || []}
                      hint={
                        (threeDLists.ultrashapeCkpts || []).length > 0
                          ? 'Found in ComfyUI/models/UltraShape/ — the Upscale button refines the generated or imported mesh with it'
                          : 'Checkpoint not found — put ultrashape_v1.pt in ComfyUI/models/UltraShape/ and run pip install -r requirements.txt inside custom_nodes/ComfyUI-UltraShape1'
                      }
                    />
                    <SelectField
                      label="Precision"
                      value={localThreeD.ultrashapeDtype || 'bfloat16'}
                      onChange={(v) => setLocalThreeD((t) => ({ ...t, ultrashapeDtype: v }))}
                      options={['float16', 'bfloat16', 'float32']}
                      hint="bfloat16 is the pack default; float16 is the safest fallback on older GPUs"
                    />
                    <SelectField
                      label="Low VRAM mode"
                      value={String(localThreeD.ultrashapeLowVram !== false)}
                      onChange={(v) => setLocalThreeD((t) => ({ ...t, ultrashapeLowVram: v === 'true' }))}
                      options={[
                        ['true', 'On — only the active model on the GPU (default)'],
                        ['false', 'Off — everything resident on the GPU'],
                      ]}
                      hint="On is required for ≤16GB GPUs: off the allocator thrashes (~165 s/step, OOM), on runs ~10 s/step"
                    />
                    <NumberField
                      label="Detail tokens (VRAM)"
                      value={localThreeD.ultrashapeNumLatents ?? 16384}
                      onChange={(n) => setLocalThreeD((t) => ({ ...t, ultrashapeNumLatents: n, qualityPreset: 'custom' }))}
                      min={0}
                      max={131072}
                      step={1024}
                      hint="Latent tokens through the diffusion model. 16384 fits 16GB (tested 9.8 s/step); 0 = 32768 full quality, needs ~20–24GB"
                    />
                    <NumberField
                      label="Refine steps"
                      value={localThreeD.ultrashapeSteps ?? 20}
                      onChange={(n) => setLocalThreeD((t) => ({ ...t, ultrashapeSteps: n, qualityPreset: 'custom' }))}
                      min={10}
                      max={200}
                      step={5}
                      hint="≈10 s/step at 16k tokens: 10 ≈ 1.5 min, 20 ≈ 3.5 min, 50 (pack default) ≈ 8 min"
                    />
                    <NumberField
                      label="Guidance scale"
                      value={localThreeD.ultrashapeGuidance ?? 5}
                      onChange={(n) => setLocalThreeD((t) => ({ ...t, ultrashapeGuidance: n, qualityPreset: 'custom' }))}
                      min={1}
                      max={15}
                      step={0.5}
                      hint="How tightly the refine follows your source image (pack default 5.0)"
                    />
                    <NumberField
                      label="Detail resolution (octree)"
                      value={localThreeD.ultrashapeOctree ?? 384}
                      onChange={(n) => setLocalThreeD((t) => ({ ...t, ultrashapeOctree: n, qualityPreset: 'custom' }))}
                      min={256}
                      max={2048}
                      step={64}
                      hint="384 ≈ 8GB VRAM, 512 ≈ 16GB — higher = sharper detail, much more memory"
                    />
                    <NumberField
                      label="Decode chunks"
                      value={localThreeD.ultrashapeNumChunks ?? 8000}
                      onChange={(n) => setLocalThreeD((t) => ({ ...t, ultrashapeNumChunks: n, qualityPreset: 'custom' }))}
                      min={1000}
                      max={50000}
                      step={1000}
                      hint="Volume-decode chunk size — lower it to save VRAM (slower)"
                    />
                    <p className="text-[11px] leading-relaxed text-text-muted rounded-lg bg-bg-card border border-border px-3 py-2">
                      Steps: image → mesh (Pixal3D) → mesh uploaded to input/3d under a unique name → MIA auto-rig → FBX download.
                      Mesh loading uses a free path (no dropdown), so uploads and server files just work — no ComfyUI restarts.
                      New <em>animation</em> FBX files still need one restart (their picker list is cached at startup).
                    </p>
                  </>
                ) : (
                  <>
                    <SelectField
                      label="Image → model version"
                      value={localThreeD.tripoModelVersion}
                      onChange={(v) => setLocalThreeD((t) => ({ ...t, tripoModelVersion: v }))}
                      options={threeDLists.modelVersion}
                    />
                    <SelectField
                      label="Texture quality"
                      value={localThreeD.tripoTextureQuality || 'extreme'}
                      onChange={(v) => setLocalThreeD((t) => ({ ...t, tripoTextureQuality: v }))}
                      options={[
                        ['standard', 'standard'],
                        ['detailed', 'detailed — HD textures'],
                        ['extreme', 'extreme — 8K ultra textures (best face detail)'],
                      ]}
                      hint="extreme = Tripo bakes 8K on their GPUs — the sharpest texture path available"
                    />
                    <SelectField
                      label="Geometry quality"
                      value={localThreeD.tripoGeometryQuality || 'detailed'}
                      onChange={(v) => setLocalThreeD((t) => ({ ...t, tripoGeometryQuality: v }))}
                      options={[
                        ['standard', 'standard (~1.4M faces)'],
                        ['detailed', 'detailed (~2M faces)'],
                      ]}
                    />
                    <SelectField
                      label="Texture alignment"
                      value={localThreeD.tripoTextureAlignment || 'original_image'}
                      onChange={(v) => setLocalThreeD((t) => ({ ...t, tripoTextureAlignment: v }))}
                      options={[
                        ['original_image', 'original_image — faithful to your photo (faces!)'],
                        ['geometry', 'geometry — UV-optimal'],
                      ]}
                    />
                    <SelectField
                      label="PBR material maps"
                      value={String(localThreeD.tripoPbr !== false)}
                      onChange={(v) => setLocalThreeD((t) => ({ ...t, tripoPbr: v === 'true' }))}
                      options={[
                        ['true', 'On — normal/metallic/roughness maps'],
                        ['false', 'Off — base color only (smaller files)'],
                      ]}
                    />
                    <SelectField
                      label="Rig version"
                      value={localThreeD.tripoRigVersion}
                      onChange={(v) => setLocalThreeD((t) => ({ ...t, tripoRigVersion: v }))}
                      options={threeDLists.rigVersion}
                      hint="v1.0 = humanoid biped + 90+ animation presets; v2.5 = creatures (quadruped, bird, …)"
                    />
                    <SelectField
                      label="Skeleton type"
                      value={localThreeD.tripoRigType}
                      onChange={(v) => setLocalThreeD((t) => ({ ...t, tripoRigType: v }))}
                      options={threeDLists.rigType}
                      hint="auto = Tripo checks the model and picks the skeleton"
                    />
                    <SelectField
                      label="Bone naming"
                      value={localThreeD.tripoSpec}
                      onChange={(v) => setLocalThreeD((t) => ({ ...t, tripoSpec: v }))}
                      options={threeDLists.spec}
                      hint="Keep tripo — preset animations can't retarget onto mixamo-spec rigs"
                    />
                    <SelectField
                      label="Output format"
                      value={localThreeD.tripoOutFormat}
                      onChange={(v) => setLocalThreeD((t) => ({ ...t, tripoOutFormat: v }))}
                      options={threeDLists.outFormat}
                    />
                    <SelectField
                      label="Default animation preset"
                      value={localThreeD.tripoPreset}
                      onChange={(v) => setLocalThreeD((t) => ({ ...t, tripoPreset: v }))}
                      options={threeDLists.presets}
                      stripPrefix
                      hint="Panel default — walk / run / jump / … (presets listed by your server)"
                    />
                    <p className="text-[11px] leading-relaxed text-text-muted rounded-lg bg-bg-card border border-border px-3 py-2">
                      Tripo nodes call Tripo's cloud API through ComfyUI — sign in to comfy.org
                      (ComfyUI menu → API keys) or jobs fail with an auth error. Uses your Tripo credits.
                    </p>
                  </>
                )}
              </>
            )}
          </div>
            </>
          )}

          {tab === 'models' && (
            <>
{/* Server model lists */}
          <div className="rounded-lg bg-bg-card border border-border px-3 py-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-secondary flex items-center gap-2">
                <FolderSearch size={14} className="text-accent" />
                Model files on your ComfyUI server
              </span>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => loadModelLists(localUrl)}
                disabled={loadingLists}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] bg-bg-hover hover:bg-accent/20 hover:text-accent transition-colors disabled:opacity-50"
              >
                <RefreshCw size={12} className={loadingLists ? 'animate-spin' : ''} />
                {loadingLists ? 'Loading...' : 'Refresh'}
              </motion.button>
            </div>
            {listsError && (
              <p className="text-[11px] text-warning mt-1.5">{listsError}</p>
            )}
            {!listsError && !loadingLists && (
              <p className="text-[11px] text-text-muted mt-1.5">
                UNET: {modelLists.unet.length} · CLIP: {modelLists.clip.length} · VAE: {modelLists.vae.length} · LoRA: {modelLists.lora.length}
              </p>
            )}
          </div>

          {/* Image Models */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <HardDrive size={14} className="text-accent" />
              Image Models (Qwen-Image)
            </h3>
            <ModelField
              label="Diffusion Model (UNET)"
              value={localModels.image.unet}
              onChange={(v) => setLocalModels((m) => ({ ...m, image: { ...m.image, unet: v } }))}
              options={modelLists.unet}
              placeholder="qwen_image_fp8_e4m3fn.safetensors"
            />
            <ModelField
              label="Text Encoder (CLIP)"
              value={localModels.image.clip}
              onChange={(v) => setLocalModels((m) => ({ ...m, image: { ...m.image, clip: v } }))}
              options={modelLists.clip}
              placeholder="qwen_2.5_vl_7b_fp8_scaled.safetensors"
            />
            <ModelField
              label="VAE"
              value={localModels.image.vae}
              onChange={(v) => setLocalModels((m) => ({ ...m, image: { ...m.image, vae: v } }))}
              options={modelLists.vae}
              placeholder="qwen_image_vae.safetensors"
            />
            <ModelField
              label="LoRA (optional, for turbo mode)"
              value={localModels.image.lora}
              onChange={(v) => setLocalModels((m) => ({ ...m, image: { ...m.image, lora: v } }))}
              options={modelLists.lora}
              placeholder="Qwen-Image-Lightning-8steps-V1.0.safetensors"
            />
          </div>

          <hr className="border-border" />

          {/* Edit Model */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <HardDrive size={14} className="text-green-400" />
              Image Edit Model (Qwen-Image-Edit)
            </h3>
            <p className="text-[11px] text-text-muted">
              Uses the same text encoder + VAE as image mode above.
            </p>
            <ModelField
              label="Edit Diffusion Model (UNET)"
              value={localModels.edit?.unet || ''}
              onChange={(v) => setLocalModels((m) => ({ ...m, edit: { ...(m.edit || {}), unet: v } }))}
              options={modelLists.unet}
              placeholder="qwen_image_edit_fp8_e4m3fn.safetensors"
            />
          </div>

          <hr className="border-border" />

          {/* Video Models */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <HardDrive size={14} className="text-purple-400" />
              Video Models
            </h3>
            <p className="text-[11px] leading-relaxed text-text-muted rounded-lg bg-bg-card border border-border px-3 py-2">
              The dropdowns list what's actually inside ComfyUI's <span className="font-mono">models/unet</span> folder —
              if you only see one file, that's all the server has (your qwen file is an <em>image</em> model, which is why
              video generation refuses to start). Video mode needs a VIDEO model plus its text encoder and VAE.
              Good picks for a 16GB card:{' '}
              <span className="text-text-secondary">Wan 2.1 t2v 1.3B</span> (fast, ~7GB),{' '}
              <span className="text-text-secondary">Wan 2.2 TI2V-5B</span> (best quality/VRAM balance),{' '}
              <span className="text-text-secondary">Wan 2.1/2.2 14B GGUF Q4</span> (highest quality, ~10–12GB), or{' '}
              <span className="text-text-secondary">LTX-Video 13B Q4</span> (very fast). All of them need{' '}
              <span className="font-mono">umt5_xxl</span> as CLIP and <span className="font-mono">wan_2.1_vae</span>.
            </p>
            <ModelPresets mode="video" editDraft={videoDraft} setEditDraft={setVideoDraft} modelLists={modelLists} />
            <ModelField
              label="Diffusion Model (UNET)"
              value={videoDraft.unet || ''}
              onChange={(v) => setVideoDraft((d) => ({ ...d, unet: v }))}
              options={modelLists.unet}
              placeholder="wan2.1_t2v_1.3B_bf16.safetensors"
            />
            <ModelField
              label="Text Encoder (CLIP)"
              value={videoDraft.clip || ''}
              onChange={(v) => setVideoDraft((d) => ({ ...d, clip: v }))}
              options={modelLists.clip}
              placeholder="umt5_xxl_fp8_e4m3fn_scaled.safetensors"
            />
            <ModelField
              label="VAE"
              value={videoDraft.vae || ''}
              onChange={(v) => setVideoDraft((d) => ({ ...d, vae: v }))}
              options={modelLists.vae}
              placeholder="wan_2.1_vae.safetensors"
            />
            <ModelField
              label="Turbo LoRA (optional — MiniMax H3, sample at 4–8 steps)"
              value={videoDraft.lora || ''}
              onChange={(v) => setVideoDraft((d) => ({ ...d, lora: v }))}
              options={modelLists.lora}
              placeholder="minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors"
            />
          </div>

          <hr className="border-border" />

          {/* Music Models */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <HardDrive size={14} className="text-pink-400" />
              Music Models
            </h3>
            <p className="text-[11px] leading-relaxed text-text-muted rounded-lg bg-bg-card border border-border px-3 py-2">
              Music mode generates full songs (style + optional sung lyrics) locally on your
              ComfyUI. Pick a preset below to load its model files into the fields, then tweak and
              Save. ACE-Step 1.5 assets resolve automatically (single AIO checkpoint, or split
              qwen encoders + ACE VAE). Generated tracks open in the built-in Studio editor for
              multi-track arrangement (split, trim, fades, layers, WAV export).
            </p>
            <ModelPresets mode="music" editDraft={editDraft} setEditDraft={setEditDraft} modelLists={modelLists} />
            <ModelField
              label="Music Diffusion Model (UNET)"
              value={editDraft.unet || ''}
              onChange={(v) => setEditDraft((d) => ({ ...d, unet: v }))}
              options={modelLists.unet}
              placeholder="minimax_music3_dit_int8_convrot.safetensors"
            />
            <ModelField
              label="Music Text Encoder (CLIP)"
              value={editDraft.clip || ''}
              onChange={(v) => setEditDraft((d) => ({ ...d, clip: v }))}
              options={modelLists.clip}
              placeholder="minimax_music3_text_encoder_pruned_int8_convrot.safetensors"
            />
            <ModelField
              label="Audio VAE"
              value={editDraft.vae || ''}
              onChange={(v) => setEditDraft((d) => ({ ...d, vae: v }))}
              options={modelLists.vae}
              placeholder="minimax_music3_dav.safetensors"
            />
          </div>
            </>
          )}

              </div>

              {/* Footer — Save is always reachable, whatever section is open */}
              <div className="shrink-0 border-t border-border px-6 py-3.5 flex items-center gap-4 bg-bg-card/50">
                {saveError ? (
                  <p className="text-[11px] text-warning flex-1 min-w-0">Saved in this browser only — {saveError}</p>
                ) : pullNote ? (
                  <p className={clsx('text-[11px] flex-1 min-w-0', pullNote.kind === 'ok' ? 'text-green-400' : 'text-warning')}>
                    {pullNote.text}
                  </p>
                ) : (
                  <p className="text-[11px] text-text-muted flex-1 min-w-0">
                    Shared by every device — API keys stay in this browser
                  </p>
                )}
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handlePull}
                  disabled={pulling}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm border border-border text-text-secondary hover:bg-bg-card hover:text-text-primary transition-all disabled:opacity-60"
                  title="Load the settings saved by any device (Save Settings) from the server"
                >
                  <RefreshCw size={14} className={pulling ? 'animate-spin' : ''} />
                  {pulling ? 'Updating…' : 'Update from server'}
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleSave}
                  className={clsx(
                    'flex items-center gap-2 px-6 py-2.5 rounded-xl font-semibold text-sm transition-all',
                    saved ? 'bg-green-500 text-white' : 'bg-accent hover:bg-accent-hover text-white'
                  )}
                >
                  <Save size={14} />
                  {saved ? 'Saved!' : 'Save Settings'}
                </motion.button>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
