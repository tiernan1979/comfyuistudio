import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Server, HardDrive, Save, RefreshCw, FolderSearch, Bot, Globe, Box, KeyRound } from 'lucide-react'
import useStore from '../store/useStore'
import { getModelLists, resolveApiBase, getNodeComboOptions, checkNodes } from '../lib/comfyui'
import { fetchLlmModels, PROVIDERS, MODEL_SUGGESTIONS } from '../lib/llm'
import { SEARCH_ENGINES, searchEngineInfo } from '../lib/search'
import { configFromState, pushRuntimeConfig, QUALITY_PRESETS } from '../lib/config'
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
  const models = useStore((s) => s.models)
  const setModels = useStore((s) => s.setModels)
  const useProxy = useStore((s) => s.useProxy)
  const setUseProxy = useStore((s) => s.setUseProxy)
  const autoUnload = useStore((s) => s.autoUnload)
  const setAutoUnload = useStore((s) => s.setAutoUnload)
  const modelsUnloaded = useStore((s) => s.modelsUnloaded)
  const [localUrl, setLocalUrl] = useState(serverUrl)
  const [localModels, setLocalModels] = useState(JSON.parse(JSON.stringify(models)))
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState(null)
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
    pixalNafMode: 'fallback_if_missing',
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
      const { missing, unreachable } = await checkNodes(base, requiredThreeDNodes(pipeline))
      const check =
        missing.length > 0
          ? { ok: false, missing, unreachable }
          : unreachable
            ? { ok: false, missing: [], unreachable: true }
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
  useEffect(() => {
    if (showSettings) {
      setTab('server')
      setSaveError(null)
      setLocalUrl(serverUrl)
      const current = JSON.parse(JSON.stringify(models))
      setLocalModels({
        ...current,
        edit: {
          unet: 'qwen_image_edit_fp8_e4m3fn.safetensors',
          ...(current.edit || {}),
        },
      })
      loadModelLists(serverUrl)
      setLocalProvider(llmProvider)
      const cfgs = JSON.parse(JSON.stringify(llmConfigs))
      setLocalConfigs(cfgs)
      setLlmModels([])
      setLlmModelsError(null)
      if (PROVIDERS[llmProvider]?.modelsBtn && cfgs[llmProvider]?.url) {
        loadLlmModels(cfgs[llmProvider].url)
      }
      setLocalSearchUrl(searchUrl)
      setLocalSearchEngine(searchEngine || 'searxng')
      setLocalSearchApiKey(searchApiKey || '')
      setLocalSearchCseId(searchCseId || '')
      setLocalThreeD({
        qualityPreset: 'standard',
        ...QUALITY_PRESETS.standard,
        ...JSON.parse(JSON.stringify(threeD)),
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
  }, [showSettings])

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
                <p className="font-semibold">Can't enable the 3D tab — node pack(s) missing on the server:</p>
                <ul className="mt-1 space-y-0.5 list-disc list-inside">
                  {threeDCheck.missing.map((n) => (
                    <li key={n}>{describeNode(n)}</li>
                  ))}
                </ul>
                <p className="mt-1.5 text-red-200/80">
                  Install them into <span className="font-mono">custom_nodes/</span> on the ComfyUI machine (pip install
                  -r requirements.txt inside each pack), restart ComfyUI, then try again.
                </p>
              </div>
            )}
            {threeDCheck && !threeDCheck.ok && threeDCheck.unreachable && (
              <p className="text-[11px] text-warning">
                Couldn't verify — ComfyUI isn't reachable at the Server URL above. You can still enable the tab, but it
                will error out when used if the packs aren't installed.
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
                      ? 'Local: Pixal3D + MIA/UniRig run on your own ComfyUI (both node packs installed there).'
                      : 'Tripo cloud: one job does model → rig → animation. Needs ComfyUI signed in to comfy.org.'
                  }
                />

                {localThreeD.pipeline === 'local' ? (
                  <>
                    <InputField
                      label="Pixal3D model repo (HuggingFace)"
                      value={localThreeD.pixalModelRepo}
                      onChange={(v) => setLocalThreeD((t) => ({ ...t, pixalModelRepo: v }))}
                      placeholder="TencentARC/Pixal3D"
                    />
                    <SelectField
                      label="Pixal3D VRAM mode"
                      value={localThreeD.pixalVramMode}
                      onChange={(v) => setLocalThreeD((t) => ({ ...t, pixalVramMode: v }))}
                      options={['dynamic_vram', 'hybrid_low_vram', 'native_low_vram', 'full_gpu']}
                      hint="dynamic_vram adapts as it goes; full_gpu is fastest if you have the VRAM to spare"
                    />
                    <SelectField
                      label="natten (NAF upsampler)"
                      value={localThreeD.pixalNafMode || 'fallback_if_missing'}
                      onChange={(v) => setLocalThreeD((t) => ({ ...t, pixalNafMode: v }))}
                      options={[
                        ['fallback_if_missing', 'Fallback — duplicate_lr if NAF is unavailable'],
                        ['strict', 'Strict — require real NAF (needs natten.HAS_LIBNATTEN)'],
                      ]}
                      hint="Fallback is safe without CUDA NATTEN kernels. Strict errors instead of substituting — only useful once natten reports HAS_LIBNATTEN=true (pip natten wheels without the CUDA extension show HAS_LIBNATTEN=false)"
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
                      hint="Presets stay file-size friendly (~40 MB GLBs): 8k textures triple the file for no visible gain, and past ~30 sampling steps the distilled sampler just burns time. Ultra is the only preset that pushes texture to 8192. Editing any field below switches to Custom."
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
                    <SelectField
                      label="Mesh quality pipeline"
                      value={localThreeD.pixalPipeline}
                      onChange={(v) => setLocalThreeD((t) => ({ ...t, pixalPipeline: v, qualityPreset: 'custom' }))}
                      options={['1536_cascade', '1024_cascade']}
                      hint="1536_cascade = much more detail than 1024 (slower)"
                    />
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
                      label="Camera resolution (px)"
                      value={localThreeD.pixalCameraRes ?? 1024}
                      onChange={(n) => setLocalThreeD((t) => ({ ...t, pixalCameraRes: n, qualityPreset: 'custom' }))}
                      min={256}
                      max={2048}
                      step={64}
                      hint="Camera fitting math only — 1024 is plenty; does not affect texture resolution"
                    />
                    <NumberField
                      label="Sampling steps"
                      value={localThreeD.pixalSteps ?? 20}
                      onChange={(n) => setLocalThreeD((t) => ({ ...t, pixalSteps: n, qualityPreset: 'custom' }))}
                      min={1}
                      max={100}
                      hint="20 (node default 12) — the distilled sampler gains nothing past ~30 and just burns time"
                    />
                    <NumberField
                      label="Structure guidance"
                      value={localThreeD.pixalGuidance ?? 7.5}
                      onChange={(n) => setLocalThreeD((t) => ({ ...t, pixalGuidance: n, qualityPreset: 'custom' }))}
                      min={0}
                      max={20}
                      step={0.1}
                      hint="Locks the shape harder to the image (upstream default 7.5; too high causes artifacts)"
                    />
                    <NumberField
                      label="Texture guidance"
                      value={localThreeD.pixalTextureGuidance ?? 2.0}
                      onChange={(n) =>
                        setLocalThreeD((t) => ({ ...t, pixalTextureGuidance: n, qualityPreset: 'custom' }))
                      }
                      min={0}
                      max={20}
                      step={0.1}
                      hint="How tightly texture follows the image conditioning — the main 'face looks painted-on' lever (upstream default 1.0)"
                    />
                    <NumberField
                      label="Detail token budget"
                      value={localThreeD.pixalMaxTokens ?? 49152}
                      onChange={(n) => setLocalThreeD((t) => ({ ...t, pixalMaxTokens: n, qualityPreset: 'custom' }))}
                      min={4096}
                      max={200000}
                      step={1024}
                      hint="49152 = default; 100000 = more high-res detail tokens (needs VRAM — lower it if a run OOMs)"
                    />
                    <SelectField
                      label="Voxel remesh at export"
                      value={String(localThreeD.pixalRemesh ?? true)}
                      onChange={(v) =>
                        setLocalThreeD((t) => ({ ...t, pixalRemesh: v === 'true', qualityPreset: 'custom' }))
                      }
                      options={[
                        ['true', 'On — cleans topology for rigging (smooths fine detail)'],
                        ['false', 'Off — keeps every bit of geometry detail (Ultra)'],
                      ]}
                      hint="Ultra turns this off: voxel remesh is safe for rigging but softens facial geometry. Switch back to On if rigging ever fails"
                    />
                    <SelectField
                      label="MIA precision"
                      value={localThreeD.miaPrecision}
                      onChange={(v) => setLocalThreeD((t) => ({ ...t, miaPrecision: v }))}
                      options={['auto', 'bf16', 'fp16', 'fp32']}
                      hint="fp32 is the tested default"
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
                      onChange={(n) => setLocalThreeD((t) => ({ ...t, ultrashapeNumLatents: n }))}
                      min={0}
                      max={131072}
                      step={1024}
                      hint="Latent tokens through the diffusion model. 16384 fits 16GB (tested 9.8 s/step); 0 = 32768 full quality, needs ~20–24GB"
                    />
                    <NumberField
                      label="Refine steps"
                      value={localThreeD.ultrashapeSteps ?? 20}
                      onChange={(n) => setLocalThreeD((t) => ({ ...t, ultrashapeSteps: n }))}
                      min={10}
                      max={200}
                      step={5}
                      hint="≈10 s/step at 16k tokens: 10 ≈ 1.5 min, 20 ≈ 3.5 min, 50 (pack default) ≈ 8 min"
                    />
                    <NumberField
                      label="Guidance scale"
                      value={localThreeD.ultrashapeGuidance ?? 5}
                      onChange={(n) => setLocalThreeD((t) => ({ ...t, ultrashapeGuidance: n }))}
                      min={1}
                      max={15}
                      step={0.5}
                      hint="How tightly the refine follows your source image (pack default 5.0)"
                    />
                    <NumberField
                      label="Detail resolution (octree)"
                      value={localThreeD.ultrashapeOctree ?? 384}
                      onChange={(n) => setLocalThreeD((t) => ({ ...t, ultrashapeOctree: n }))}
                      min={256}
                      max={2048}
                      step={64}
                      hint="384 ≈ 8GB VRAM, 512 ≈ 16GB — higher = sharper detail, much more memory"
                    />
                    <NumberField
                      label="Decode chunks"
                      value={localThreeD.ultrashapeNumChunks ?? 8000}
                      onChange={(n) => setLocalThreeD((t) => ({ ...t, ultrashapeNumChunks: n }))}
                      min={1000}
                      max={50000}
                      step={1000}
                      hint="Volume-decode chunk size — lower it to save VRAM (slower)"
                    />
                    <p className="text-[11px] leading-relaxed text-text-muted rounded-lg bg-bg-card border border-border px-3 py-2">
                      Steps: image → mesh (Pixal3D) → mesh uploaded to input/3d → MIA auto-rig → FBX download.
                      UniRig's file list is cached at ComfyUI startup — if a fresh mesh isn't listed yet,
                      restart ComfyUI and rig again.
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
            <ModelField
              label="Diffusion Model (UNET)"
              value={localModels.video.unet}
              onChange={(v) => setLocalModels((m) => ({ ...m, video: { ...m.video, unet: v } }))}
              options={modelLists.unet}
              placeholder="wan2.1_t2v_1.3B_bf16.safetensors"
            />
            <ModelField
              label="Text Encoder (CLIP)"
              value={localModels.video.clip}
              onChange={(v) => setLocalModels((m) => ({ ...m, video: { ...m.video, clip: v } }))}
              options={modelLists.clip}
              placeholder="umt5_xxl_fp8_e4m3fn_scaled.safetensors"
            />
            <ModelField
              label="VAE"
              value={localModels.video.vae}
              onChange={(v) => setLocalModels((m) => ({ ...m, video: { ...m.video, vae: v } }))}
              options={modelLists.vae}
              placeholder="wan_2.1_vae.safetensors"
            />
          </div>

          <hr className="border-border" />

          {/* Music Models */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <HardDrive size={14} className="text-pink-400" />
              Music Models (MiniMax Music 3)
            </h3>
            <p className="text-[11px] leading-relaxed text-text-muted rounded-lg bg-bg-card border border-border px-3 py-2">
              Music mode generates full songs (style + optional sung lyrics) locally on your
              ComfyUI. It needs the three MiniMax Music 3 files: the DiT diffusion model, the
              Music3 text encoder (loaded with CLIP type <span className="font-mono">minimax</span>),
              and the <span className="font-mono">dav</span> audio VAE. YuE-2 works too — pick its
              files here. Generated tracks open in the built-in Studio editor for multi-track
              arrangement (split, trim, fades, layers, WAV export).
            </p>
            <ModelField
              label="Music Diffusion Model (UNET)"
              value={localModels.music?.unet || ''}
              onChange={(v) => setLocalModels((m) => ({ ...m, music: { ...(m.music || {}), unet: v } }))}
              options={modelLists.unet}
              placeholder="minimax_music3_dit_int8_convrot.safetensors"
            />
            <ModelField
              label="Music Text Encoder (CLIP)"
              value={localModels.music?.clip || ''}
              onChange={(v) => setLocalModels((m) => ({ ...m, music: { ...(m.music || {}), clip: v } }))}
              options={modelLists.clip}
              placeholder="minimax_music3_text_encoder_pruned_int8_convrot.safetensors"
            />
            <ModelField
              label="Audio VAE"
              value={localModels.music?.vae || ''}
              onChange={(v) => setLocalModels((m) => ({ ...m, music: { ...(m.music || {}), vae: v } }))}
              options={modelLists.vae}
              placeholder="minimax_music3_dav.safetensors"
            />
          </div>
            </>
          )}

              </div>

              {/* Footer — Save is always reachable, whatever section is open */}
              <div className="shrink-0 border-t border-border px-6 py-3.5 flex items-center gap-4 bg-bg-card/50">
                {saveError && (
                  <p className="text-[11px] text-warning flex-1 min-w-0">Saved in this browser only — {saveError}</p>
                )}
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleSave}
                  className={clsx(
                    'ml-auto flex items-center gap-2 px-6 py-2.5 rounded-xl font-semibold text-sm transition-all',
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
