import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Defaults for the AI prompt writer (used by fresh installs and migrations)
const DEFAULT_LLM_CONFIGS = {
  lmstudio: { url: 'http://host.docker.internal:1234', model: '' },
  openai: { key: '', model: 'gpt-4o-mini' },
  anthropic: { key: '', model: 'claude-haiku-4-5' },
  custom: { url: '', key: '', model: '' },
}

// True when this browser has no saved settings yet. Deployment config
// (public/config.json, mounted into the container) only seeds fresh
// installs — saved per-browser settings always win afterwards.
const FRESH_INSTALL = (() => {
  try {
    return !window.localStorage.getItem('comfyui-studio-storage')
  } catch {
    return true
  }
})()

const useStore = create(
  persist(
    (set, get) => ({
      // Connection
      serverUrl: 'http://127.0.0.1:8188',
      // When true, all ComfyUI traffic goes through this app's own origin
      // (nginx reverse proxy) — avoids browser CORS errors entirely.
      useProxy: true,
      connected: false,
      queueRemaining: 0,

      // Mode
      mode: 'image', // 'image' | 'video' | 'edit'

      // Generation state
      generating: false,
      progress: null, // { value: 0-1, step: 0, total: 0 }
      currentPromptId: null,
      elapsedTime: 0,

      // Idle model unloading: last time a generation was started, and
      // whether we've already told ComfyUI to unload since then
      lastGenAt: 0,
      modelsUnloaded: false,
      autoUnload: true,

      // Prompt
      prompt: '',
      negativePrompt: '',
      style: 'photoreal',
      // Web search query picked by the AI rewrite (transient)
      searchQuery: '',

      // AI prompt writer: which provider is active + per-provider config.
      // Keys live only in this browser's localStorage and are sent via
      // the app's own proxy.
      llmProvider: 'lmstudio', // 'lmstudio' | 'openai' | 'anthropic' | 'custom'
      llmConfigs: DEFAULT_LLM_CONFIGS,

      // Web image search via the user's own SearXNG instance
      // (deployment default comes from config.json)
      searchUrl: '',

      // Image settings
      imageSettings: {
        aspectRatio: '1:1',
        turboMode: false,
        seed: -1,
        steps: 20,
        cfg: 4,
      },

      // Video settings
      videoSettings: {
        resolution: '480p',
        frames: 33,
        fps: 16,
        seed: -1,
        steps: 30,
        cfg: 6,
      },

      // Edit settings
      editSettings: {
        seed: -1,
        steps: 20,
        cfg: 2.5,
      },

      // Source image for edit mode (File kept in memory only, never persisted)
      sourceImage: null, // { file, preview, name }

      // Models
      models: {
        image: {
          unet: 'qwen_image_fp8_e4m3fn.safetensors',
          clip: 'qwen_2.5_vl_7b_fp8_scaled.safetensors',
          vae: 'qwen_image_vae.safetensors',
          lora: '',
        },
        video: {
          unet: 'wan2.1_t2v_1.3B_bf16.safetensors',
          clip: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
          vae: 'wan_2.1_vae.safetensors',
        },
        edit: {
          unet: 'qwen_image_edit_fp8_e4m3fn.safetensors',
        },
      },

      // Output
      outputImage: null,
      outputVideo: null,

      // Last error (shown in UI, not persisted)
      error: null,

      // History
      history: [],
      selectedHistoryId: null,

      // Settings modal
      showSettings: false,
      showWebSearch: false,

      // Actions
      // Seed settings from deployment config (config.json). Only applies
      // on a browser with no saved state; `config` is pre-sanitized by
      // src/lib/config.js (whitelisted fields, keys stripped).
      seedFromConfig: (config) => {
        if (!FRESH_INSTALL || !config) return
        set((s) => {
          const patch = {}
          for (const key of ['serverUrl', 'useProxy', 'autoUnload', 'style', 'searchUrl', 'llmProvider']) {
            if (config[key] !== undefined) patch[key] = config[key]
          }
          if (config.llmConfigs) {
            const llmConfigs = {}
            for (const k of new Set([...Object.keys(s.llmConfigs), ...Object.keys(config.llmConfigs)])) {
              llmConfigs[k] = { ...(s.llmConfigs[k] || {}), ...(config.llmConfigs[k] || {}) }
            }
            patch.llmConfigs = llmConfigs
          }
          if (config.models) {
            const models = {}
            for (const k of new Set([...Object.keys(s.models), ...Object.keys(config.models)])) {
              models[k] = { ...(s.models[k] || {}), ...(config.models[k] || {}) }
            }
            patch.models = models
          }
          return patch
        })
      },
      setServerUrl: (url) => set({ serverUrl: url }),
      setUseProxy: (useProxy) => set({ useProxy }),
      setConnected: (connected) => set({ connected }),
      setQueueRemaining: (n) => set({ queueRemaining: n }),
      setMode: (mode) => set({ mode, outputImage: null, outputVideo: null }),
      setGenerating: (generating) => set({ generating }),
      setLastGenAt: (lastGenAt) => set({ lastGenAt }),
      setModelsUnloaded: (modelsUnloaded) => set({ modelsUnloaded }),
      setAutoUnload: (autoUnload) => set({ autoUnload }),
      setProgress: (progress) => set({ progress }),
      setCurrentPromptId: (id) => set({ currentPromptId: id }),
      setElapsedTime: (t) => set({ elapsedTime: t }),
      setPrompt: (prompt) => set({ prompt }),
      setNegativePrompt: (negativePrompt) => set({ negativePrompt }),
      setStyle: (style) => set({ style }),
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      setLlmProvider: (llmProvider) => set({ llmProvider }),
      setLlmConfigs: (llmConfigs) => set((s) => ({
        llmConfigs: { ...s.llmConfigs, ...llmConfigs },
      })),
      setSearchUrl: (searchUrl) => set({ searchUrl }),
      setShowWebSearch: (showWebSearch) => set({ showWebSearch }),
      setImageSettings: (settings) => set((s) => ({ imageSettings: { ...s.imageSettings, ...settings } })),
      setVideoSettings: (settings) => set((s) => ({ videoSettings: { ...s.videoSettings, ...settings } })),
      setEditSettings: (settings) => set((s) => ({ editSettings: { ...s.editSettings, ...settings } })),
      setSourceImage: (sourceImage) => set({ sourceImage }),
      setModels: (mode, models) => set((s) => ({
        models: { ...s.models, [mode]: { ...s.models[mode], ...models } },
      })),
      setOutputImage: (outputImage) => set({ outputImage, outputVideo: null }),
      setOutputVideo: (outputVideo) => set({ outputVideo, outputImage: null }),
      setError: (error) => set({ error }),
      clearError: () => set({ error: null }),
      setShowSettings: (showSettings) => set({ showSettings }),

      addToHistory: (entry) => set((s) => ({
        history: [entry, ...s.history].slice(0, 50),
      })),
      removeFromHistory: (id) => set((s) => {
        const entry = s.history.find((h) => h.id === id)
        const patch = { history: s.history.filter((h) => h.id !== id) }
        if (s.selectedHistoryId === id) patch.selectedHistoryId = null
        if (entry && entry.data === s.outputImage) patch.outputImage = null
        if (entry && entry.data === s.outputVideo) patch.outputVideo = null
        return patch
      }),
      clearHistory: () => set({
        history: [],
        selectedHistoryId: null,
        outputImage: null,
        outputVideo: null,
      }),
      selectHistory: (id) => {
        const entry = get().history.find((h) => h.id === id)
        if (entry) {
          set({
            selectedHistoryId: id,
            outputImage: entry.type === 'image' ? entry.data : null,
            outputVideo: entry.type === 'video' ? entry.data : null,
            prompt: entry.prompt,
            mode: entry.type,
          })
        }
      },
    }),
    {
      name: 'comfyui-studio-storage',
      version: 2,
      // v0/v1 stored a flat llmUrl/llmModel (Ollama era: port 11434 +
      // "name:tag" ids). Fold them into the v2 per-provider config.
      migrate: (persisted) => {
        const s = { ...persisted }
        if (s.llmConfigs) {
          const merged = {}
          for (const k of Object.keys(DEFAULT_LLM_CONFIGS)) {
            merged[k] = { ...DEFAULT_LLM_CONFIGS[k], ...(s.llmConfigs[k] || {}) }
          }
          s.llmConfigs = merged
        } else if (s.llmUrl !== undefined || s.llmModel !== undefined) {
          let url = s.llmUrl
          let model = s.llmModel
          if (url && url.includes(':11434')) {
            // was pointing at Ollama — start fresh on LM Studio defaults
            url = DEFAULT_LLM_CONFIGS.lmstudio.url
            model = ''
          }
          s.llmConfigs = {
            ...DEFAULT_LLM_CONFIGS,
            lmstudio: { url: url || DEFAULT_LLM_CONFIGS.lmstudio.url, model: model || '' },
          }
        } else {
          s.llmConfigs = { ...DEFAULT_LLM_CONFIGS }
        }
        delete s.llmUrl
        delete s.llmModel
        return s
      },
      partialize: (state) => ({
        serverUrl: state.serverUrl,
        useProxy: state.useProxy,
        autoUnload: state.autoUnload,
        style: state.style,
        llmProvider: state.llmProvider,
        llmConfigs: state.llmConfigs,
        searchUrl: state.searchUrl,
        models: state.models,
        imageSettings: state.imageSettings,
        videoSettings: state.videoSettings,
        history: state.history,
      }),
    }
  )
)

export default useStore
