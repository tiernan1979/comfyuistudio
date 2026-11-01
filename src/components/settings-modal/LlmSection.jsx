import { motion } from 'framer-motion'
import { Bot, RefreshCw } from 'lucide-react'
import Dropdown from '../Dropdown'
import { MODEL_SUGGESTIONS, PROVIDERS } from '../../lib/llm'
import { SectionTitle, Note, TextField } from './fields'

// Editable model dropdown plus an optional "Models" button that lists what
// the configured endpoint actually has loaded.
function ModelPicker({ value, onChange, options, showModelsBtn, onModelsClick, placeholder, loading, error }) {
  const items = options.map((o) => ({ value: o, label: o }))
  if (value && !options.includes(value)) items.unshift({ value, label: value })
  if (!value && placeholder) items.unshift({ value: '', label: placeholder })

  return (
    <div className="space-y-1">
      <label className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Model</label>
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <Dropdown value={value} onChange={onChange} options={items} ariaLabel="Model" editable className="text-xs" />
        </div>
        {showModelsBtn && (
          <motion.button
            type="button"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={onModelsClick}
            disabled={loading}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-bg-hover px-2.5 py-1 text-[11px] transition-colors hover:border-accent/40 hover:bg-accent/20 hover:text-accent disabled:opacity-50"
            title="List models from this endpoint"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            {loading ? '...' : 'Models'}
          </motion.button>
        )}
      </div>
      {!options.includes(value) && options.length > 0 && value && (
        <p className="text-[10px] text-text-muted/70">
          {options.length} model(s) listed — the typed name will be used as-is
        </p>
      )}
      {showModelsBtn && error && <p className="text-[11px] text-warning">{error}</p>}
    </div>
  )
}

function providerFields(provider, cfg, handlers) {
  const { setLocalConfig, llmModels, loadLlmModels, loadingLlmModels, llmModelsError } = handlers

  if (provider === 'lmstudio') {
    return (
      <>
        <TextField
          label="LM Studio URL"
          value={cfg.url || ''}
          onChange={(v) => setLocalConfig('lmstudio', { url: v })}
          placeholder="http://host.docker.internal:1234"
        />
        <ModelPicker
          value={cfg.model || ''}
          onChange={(v) => setLocalConfig('lmstudio', { model: v })}
          options={llmModels}
          showModelsBtn
          onModelsClick={() => loadLlmModels(cfg.url)}
          placeholder="pick via Models"
          loading={loadingLlmModels}
          error={llmModelsError}
        />
      </>
    )
  }

  if (provider === 'openai') {
    return (
      <>
        <TextField
          label="API key"
          type="password"
          value={cfg.key || ''}
          onChange={(v) => setLocalConfig('openai', { key: v })}
          placeholder="sk-..."
        />
        <ModelPicker
          value={cfg.model || ''}
          onChange={(v) => setLocalConfig('openai', { model: v })}
          options={MODEL_SUGGESTIONS.openai}
          placeholder="gpt-4o-mini"
        />
      </>
    )
  }

  if (provider === 'anthropic') {
    return (
      <>
        <TextField
          label="API key"
          type="password"
          value={cfg.key || ''}
          onChange={(v) => setLocalConfig('anthropic', { key: v })}
          placeholder="sk-ant-..."
        />
        <ModelPicker
          value={cfg.model || ''}
          onChange={(v) => setLocalConfig('anthropic', { model: v })}
          options={MODEL_SUGGESTIONS.anthropic}
          placeholder="claude-haiku-4-5"
        />
      </>
    )
  }

  // custom / OpenAI-compatible
  return (
    <>
      <TextField
        label="Base URL"
        value={cfg.url || ''}
        onChange={(v) => setLocalConfig('custom', { url: v })}
        placeholder="https://openrouter.ai/api/v1"
      />
      <TextField
        label="API key (optional)"
        type="password"
        value={cfg.key || ''}
        onChange={(v) => setLocalConfig('custom', { key: v })}
        placeholder="sk-or-... (blank for local servers)"
      />
      <ModelPicker
        value={cfg.model || ''}
        onChange={(v) => setLocalConfig('custom', { model: v })}
        options={llmModels}
        showModelsBtn
        onModelsClick={() => loadLlmModels(cfg.url)}
        placeholder="pick via Models"
        loading={loadingLlmModels}
        error={llmModelsError}
      />
    </>
  )
}

export default function LlmSection({
  localProvider,
  onProviderChange,
  localConfigs,
  setLocalConfig,
  llmModels,
  loadLlmModels,
  loadingLlmModels,
  llmModelsError,
}) {
  const cfg = localConfigs[localProvider] || {}

  return (
    <div className="space-y-3">
      <SectionTitle
        icon={Bot}
        title="AI Prompt Writer"
        note={`(optional, via ${PROVIDERS[localProvider]?.short})`}
      />

      <div className="space-y-1">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Provider</label>
        <Dropdown
          value={localProvider}
          onChange={onProviderChange}
          options={Object.entries(PROVIDERS).map(([key, p]) => ({ value: key, label: p.label }))}
          ariaLabel="LLM provider"
          className="text-xs"
        />
      </div>

      {providerFields(localProvider, cfg, {
        setLocalConfig,
        llmModels,
        loadLlmModels,
        loadingLlmModels,
        llmModelsError,
      })}

      <Note>
        {localProvider === 'lmstudio' && (
          <>
            Powers the <span className="font-medium text-accent">AI</span> button: rewrites your words into a full
            prompt, picks a web search query, and (in Image mode) jumps straight to the Web panel with results. In
            LM Studio open the <span className="font-mono">Developer</span> tab, load a model (~4B+ instruction
            model, e.g. Qwen3.5 4B), and flip <span className="font-mono">Start server</span> (default port 1234).
            LM Studio on this machine? Keep the default URL. On another machine, use its IP and enable{' '}
            <span className="font-mono">Serve on Local Network</span>.
          </>
        )}
        {localProvider === 'openai' && (
          <>
            Uses the official OpenAI API — create a key at{' '}
            <span className="font-mono">platform.openai.com → API keys</span>.{' '}
            <span className="font-mono">gpt-4o-mini</span> is fast and cheap for prompt rewrites. The key is stored
            only in this browser and requests are sent through the app's proxy.
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
            Any OpenAI-compatible server: OpenRouter, Groq, Together, Ollama (
            <span className="font-mono">http://host:11434</span>), vLLM, and more. Base URL usually ends in{' '}
            <span className="font-mono">/v1</span> (added automatically for bare addresses). API key optional for
            local servers. Stored in this browser; sent through the app's proxy.
          </>
        )}
      </Note>
    </div>
  )
}
