import { useState, useEffect, useId } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Server, HardDrive, Save, RefreshCw, FolderSearch, Bot, Globe } from 'lucide-react'
import useStore from '../store/useStore'
import { getModelLists, resolveApiBase } from '../lib/comfyui'
import { fetchLlmModels, PROVIDERS, MODEL_SUGGESTIONS } from '../lib/llm'
import clsx from 'clsx'

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

// Text input with autocomplete options fetched from the ComfyUI server.
// Free typing still works (for files the server hasn't indexed yet).
function ModelField({ label, value, onChange, options = [], placeholder }) {
  const listId = useId()
  const inList = value && options.includes(value)
  return (
    <div className="space-y-1">
      <label className="text-xs text-text-secondary">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        list={options.length > 0 ? listId : undefined}
        placeholder={placeholder}
        className={clsx(
          'w-full px-3 py-2 rounded-lg bg-bg-card border text-text-primary text-xs placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent transition-all',
          value && options.length > 0 && !inList ? 'border-warning' : 'border-border'
        )}
      />
      {options.length > 0 && (
        <datalist id={listId}>
          {options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      )}
      {options.length > 0 ? (
        <p className={clsx('text-[10px]', inList || !value ? 'text-text-muted' : 'text-warning')}>
          {value && !inList
            ? `Not found on server — pick from the ${options.length} available file(s) or fix the name`
            : `${options.length} file(s) available on server`}
        </p>
      ) : (
        <p className="text-[10px] text-text-muted">Server list not loaded — type the exact filename</p>
      )}
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
  const [localSearchUrl, setLocalSearchUrl] = useState(searchUrl)

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
    }
  }, [showSettings])

  const handleSave = () => {
    setServerUrl(localUrl)
    setModels('image', localModels.image)
    setModels('video', localModels.video)
    if (localModels.edit) setModels('edit', localModels.edit)
    setLlmProvider(localProvider)
    setLlmConfigs(localConfigs)
    setSearchUrl(localSearchUrl)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
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
          className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl glass p-6 space-y-6"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-accent/20 flex items-center justify-center">
                <Server size={20} className="text-accent" />
              </div>
              <div>
                <h2 className="text-lg font-bold">Settings</h2>
                <p className="text-xs text-text-muted">Configure ComfyUI connection and models</p>
              </div>
            </div>
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => setShowSettings(false)}
              className="p-2 rounded-lg hover:bg-bg-hover transition-colors"
            >
              <X size={18} />
            </motion.button>
          </div>

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

          <hr className="border-border" />

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
              <select
                value={localProvider}
                onChange={(e) => {
                  const p = e.target.value
                  setLocalProvider(p)
                  setLlmModels([])
                  setLlmModelsError(null)
                  if (PROVIDERS[p]?.modelsBtn && localConfigs[p]?.url) {
                    loadLlmModels(localConfigs[p].url)
                  }
                }}
                className="w-full px-3 py-2 rounded-lg bg-bg-card border border-border text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer"
              >
                {Object.entries(PROVIDERS).map(([key, p]) => (
                  <option key={key} value={key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Shared model row: input + optional Models button + datalist */}
            {(() => {
              const modelInput = ({ value, onChange, options, showModelsBtn, onModelsClick, placeholder }) => (
                <div className="space-y-1">
                  <label className="text-xs text-text-secondary">Model</label>
                  <div className="flex gap-2">
                    <input
                      value={value}
                      onChange={onChange}
                      list={options.length > 0 ? 'llm-models' : undefined}
                      placeholder={placeholder}
                      className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-bg-card border border-border text-text-primary text-xs placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent transition-all"
                    />
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
                  {options.length > 0 && (
                    <datalist id="llm-models">
                      {options.map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                  )}
                  {showModelsBtn && llmModelsError && (
                    <p className="text-[11px] text-warning">{llmModelsError}</p>
                  )}
                </div>
              )

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
                      onChange: (e) => setLocalConfig('lmstudio', { model: e.target.value }),
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
                      onChange: (e) => setLocalConfig('openai', { model: e.target.value }),
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
                      onChange: (e) => setLocalConfig('anthropic', { model: e.target.value }),
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
                    onChange: (e) => setLocalConfig('custom', { model: e.target.value }),
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

          <hr className="border-border" />

          {/* Web Image Search (SearXNG) */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Globe size={14} className="text-accent" />
              Web Image Search <span className="text-[10px] font-normal text-text-muted">(your SearXNG)</span>
            </h3>
            <InputField
              label="SearXNG URL"
              value={localSearchUrl}
              onChange={setLocalSearchUrl}
              placeholder="https://searx.example.com"
            />
            <p className="text-[11px] leading-relaxed text-text-muted rounded-lg bg-bg-card border border-border px-3 py-2">
              Powers the <span className="text-sky-300 font-medium">Web</span> button: search the internet for a reference
              image, click one, and it becomes the Edit source for ComfyUI to update.
              Your instance must have <span className="font-mono">json</span> listed under{' '}
              <span className="font-mono">search.formats</span> in settings.yml. Requests go through the app proxy — no CORS
              issues, self-signed certs fine.
            </p>
          </div>

          <hr className="border-border" />

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
              Video Models (Wan 2.1)
            </h3>
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

          {/* Save button */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleSave}
            className={clsx(
              'w-full py-2.5 rounded-xl font-semibold text-sm transition-all',
              saved
                ? 'bg-green-500 text-white'
                : 'bg-accent hover:bg-accent-hover text-white'
            )}
          >
            {saved ? (
              <span className="flex items-center justify-center gap-2">
                <Save size={14} />
                Saved!
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <Save size={14} />
                Save Settings
              </span>
            )}
          </motion.button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
