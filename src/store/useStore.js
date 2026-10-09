import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { STRUCTURE_TAGS } from '../lib/workflows.js'
import { viewFromUrl } from '../lib/comfyui.js'

// Defaults for the AI prompt writer (used by fresh installs and migrations)
const DEFAULT_LLM_CONFIGS = {
  lmstudio: { url: 'http://host.docker.internal:1234', model: '' },
  openai: { key: '', model: 'gpt-4o-mini' },
  anthropic: { key: '', model: 'claude-haiku-4-5' },
  custom: { url: '', key: '', model: '' },
}

// Default model files per mode. Persisted stores are merged against this
// (persist v3 migration) so newly added groups — like `music` — appear in
// browsers saved before the group existed.
const DEFAULT_MODELS = {
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
    lora: '', // optional H3 turbo LoRA (Settings → Models → Video)
  },
  edit: {
    unet: 'qwen_image_edit_fp8_e4m3fn.safetensors',
  },
  music: {
    unet: 'minimax_music3_dit_int8_convrot.safetensors',
    clip: 'minimax_music3_text_encoder_pruned_int8_convrot.safetensors',
    vae: 'minimax_music3_dav.safetensors',
  },
}

// True when this browser has no saved settings yet.
const FRESH_INSTALL = (() => {
  try {
    return !window.localStorage.getItem('comfyui-studio-storage')
  } catch {
    return true
  }
})()

// Browser without crypto.randomUUID (plain-HTTP LAN access)
function uid() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch {
    /* fall through */
  }
  return `sp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

// Cross-browser deletion sync: the app's own API (nginx /api → studio-api)
// keeps a shared, persisted list of deleted history ids. Every browser
// pushes its deletes here and pulls the list on each history sync, so an
// item deleted anywhere disappears everywhere. Best-effort — offline the
// delete still applies locally.
function pushHiddenIds(ids) {
  if (typeof window === 'undefined' || !ids?.length) return
  fetch('/api/hidden-ids', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids: ids.map(String) }),
  }).catch(() => {})
}

// Cross-browser/origin history: the app's own API keeps a durable,
// shared copy of generated entries (ComfyUI's own /history is in-memory
// and resets on restart/cleanup), so every browser — including other
// origins like https://… vs http://host:5555 — converges on the same
// list. Entries carry their `view` file params so each browser can
// rebuild the output URL against its own origin. Best-effort, like
// pushHiddenIds — offline the entry still lands locally and is re-pushed
// by the next successful sync's catch-up.
export function pushHistoryEntries(entries) {
  if (typeof window === 'undefined' || !entries?.length) return
  const list = entries
    .filter((e) => e?.id && e?.data)
    .slice(0, 200)
    .map((e) => {
      const view = e.view || viewFromUrl(e.data)
      return view ? { ...e, view } : e
    })
  if (!list.length) return
  fetch('/api/history', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entries: list }),
  }).catch(() => {})
}

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
      mode: 'image', // 'image' | 'video' | 'edit' | 'music' | '3d'

      // Generation state
      generating: false,
      progress: null, // { value: 0-1, step: 0, total: 0 }
      progressLabel: null, // friendly phase of the running node ("Decoding audio")
      currentPromptId: null,
      elapsedTime: 0,

      // Idle model unloading: last time a generation was started, and
      // whether we've already told ComfyUI to unload since then
      lastGenAt: 0,
      modelsUnloaded: false,
      autoUnload: true,

      // Prompt — `prompt`/`negativePrompt` mirror the ACTIVE mode; the
      // ByMode maps remember each tab's own text so Image / Video /
      // Edit / Music / 3D all keep separate prompts. Session-only
      // (like `prompt`, not persisted).
      prompt: '',
      negativePrompt: '',
      promptByMode: { image: '', video: '', edit: '', music: '', '3d': '' },
      negativeByMode: { image: '', video: '', edit: '', music: '', '3d': '' },
      style: 'photoreal',
      // Web search query picked by the AI rewrite (transient)
      searchQuery: '',

      // AI prompt writer: which provider is active + per-provider config.
      // Keys live only in this browser's localStorage and are sent via
      // the app's own proxy.
      llmProvider: 'lmstudio', // 'lmstudio' | 'openai' | 'anthropic' | 'custom'
      llmConfigs: DEFAULT_LLM_CONFIGS,

      // Web image search. `searchEngine` picks the provider:
      //   searxng    → self-hosted, needs searchUrl (no key)
      //   serper     → Google results via google.serper.dev (API key)
      //   serpapi    → Google images via serpapi.com (API key)
      //   brave      → Brave Search API (API key)
      //   google_cse → Google Custom Search (API key + CSE id)
      // (deployment defaults come from config.json)
      searchUrl: '',
      searchEngine: 'searxng',
      searchApiKey: '',
      searchCseId: '',

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
        steps: 20, // was 30 — sampler dominates on 16GB RAM; raise in Settings if needed
        cfg: 6,
      },

      // Edit settings
      editSettings: {
        seed: -1,
        steps: 20,
        cfg: 2.5,
      },

      // Music settings (MiniMax Music 3 / ACE-Step). quality: 'wav'
      // (lossless via SaveAudio) or an MP3 bitrate for SaveAudioMP3.
      // duration: cap on track length (10–360s) — the structure planner
      // sizes the song itself and the tail trim cuts any silent pad; this
      // is the ceiling, not an exact length.
      musicSettings: {
        seed: -1,
        steps: 30, // official template default
        cfgScale: 1.7, // AR-planner CFG inside MiniMaxMusic3TextEncode
        quality: '320k', // 'wav' | '320k' | 'V0' | '128k'
        duration: 300, // 5-minute default cap
      },

      // Sung lyrics for music mode. Default = the section-tag map (also the
      // visible example in the box); tag-only = instrumental at generate
      // time. Not persisted across reloads, so the default always resurfaces.
      lyrics: STRUCTURE_TAGS,

      // 3D Generation (optional feature — Settings → 3D Generation).
      // local  = native Pixal3D/TRELLIS.2 (image→GLB, ComfyUI ≥ 0.39)
      //          + MIA auto-rig on your own ComfyUI
      // tripo  = Tripo cloud: image→model→rig→animated in one chain
      threeD: {
        enabled: false,
        pipeline: 'local', // 'local' | 'tripo'
        meshMode: 'pixal3d', // 'pixal3d' | 'trellis2' — both built into ComfyUI
        // Quality — higher = sharper face/texture, bigger files, slower runs
        qualityPreset: 'high', // 'standard' | 'high' | 'ultra' | 'custom'
        pixalCameraRes: 1024, // 256–2048 crop box around the subject
        pixalTextureSize: 4096, // 512–8192 UV atlas
        pixalDecimation: 300000, // 5000–5000000 triangle budget
        pixalSteps: 20, // 1–100 shape/upsample sampler steps (template default 20)
        pixalGuidance: 7.5, // 0–20 shape guidance (template default 7.5)
        pixalRemesh: true, // voxel remesh at export (false preserves fine geometry)
        pixalEnhance: 'sharpen', // 'none' | 'sharpen' (local) | 'esrgan' (local, free) | 'magnific4x' (PAID)
        pixalUpscaleModel: '', // models/upscale_models/*.pth used when pixalEnhance === 'esrgan'
        faceFix: true, // face-focused source enhance + front-view paint refine
        // Hunyuan3D paint (Skin button) — quality presets set these too
        hunyuanPaintModel: 'hunyuan3d-paintpbr-v2-1', // paint model file in models/diffusion/
        hunyuanViewSize: 1024, // per-view render px (512 standard / 1024 high / 1536 ultra)
        hunyuanTextureSize: 4096, // paint atlas px
        hunyuanPaintSteps: 12, // 1–100 paint diffusion steps (returns diminish past ~20)
        hunyuanGuidance: 3, // photo adherence during repaint (3 default)
        hunyuanSkinBlend: true, // hybrid skin: paint's face into the generated texture (keeps hair/clothes)
        hunyuanViewUpscale: true, // detail-upscale bake views (4x-UltraSharp on the front view) for sharper faces
        // UltraShape 1.0 mesh upscale (Upscale button — local refine of the mesh)
        ultrashapeCheckpoint: 'ultrashape_v1.pt', // models/UltraShape/*.pt
        ultrashapeDtype: 'bfloat16', // float16 | bfloat16 | float32
        ultrashapeLowVram: true, // CPU offloading — required on ≤16GB GPUs (32768 tokens thrash without it)
        ultrashapeSteps: 20, // 10–200 diffusion steps (≈10 s/step at 16k tokens)
        ultrashapeGuidance: 5.0, // 1–15 image conditioning strength
        ultrashapeOctree: 384, // 256–2048 detail resolution (384 ≈ 8GB VRAM, 512 ≈ 16GB)
        ultrashapeNumChunks: 8000, // 1000–50000 decode chunk size (lower = less VRAM, slower)
        ultrashapeNumLatents: 16384, // latent tokens: 16384 fits 16GB (tested 9.8 s/it); 0 = 32768 full quality, needs ~20–24GB
        miaPrecision: 'fp32',
        localAnimationFile: '', // '' = rig only
        tripoModelVersion: 'v3.1-20260211',
        tripoRigVersion: 'v1.0-20240301',
        tripoRigType: 'auto',
        tripoSpec: 'tripo',
        tripoOutFormat: 'glb',
        tripoPreset: 'preset:walk',
        // Tripo quality — 'extreme' bakes 8K textures on Tripo's cloud GPUs
        tripoTextureQuality: 'extreme', // 'standard' | 'detailed' | 'extreme' (8K)
        tripoGeometryQuality: 'detailed', // 'standard' | 'detailed' (~2M faces)
        tripoTextureAlignment: 'original_image', // 'original_image' | 'geometry'
        tripoPbr: true, // normal/metallic/roughness maps in the GLB
      },

      // Transient 3D run state (never persisted)
      threeDRun: {
        stage: 'idle', // 'idle' | 'working' | 'done' | 'error'
        status: '',
        pct: null, // overall generation percent (0–100) for the progress bar
        error: null,
        mesh: null, // generated GLB ref for the local pipeline's rig step
        results: [], // downloadable output files of the last completed step
      },

      // Source image for edit mode (File kept in memory only, never persisted)
      sourceImage: null, // { file, preview, name }

      // Reference audio for ACE-Step (File kept in memory only, never persisted)
      referenceAudio: null, // { file, name }

      // Open 3D history viewer modal (transient)
      viewing3d: null, // { url, name }

      // Models
      models: DEFAULT_MODELS,

      // Output (one of the three at a time — setters clear the others)
      outputImage: null,
      outputVideo: null,
      outputAudio: null,

      // Music editor overlay (transient, never persisted)
      showMusicEditor: false,

      // Left sidebar width in px — dragged via the divider in App.jsx
      // (clamped 200–480, persisted)
      sidebarWidth: 256,

      // Right controls panel width in px — dragged via the divider in
      // Layout.jsx (clamped 240–560, persisted)
      controlsWidth: 320,

      // Last error (shown in UI, not persisted)
      error: null,

      // History (localStorage + entries merged in from the ComfyUI
      // server's /history so every machine sees the same generations).
      // hiddenHistoryIds keeps locally-deleted entries from reappearing
      // on the next server sync.
      history: [],
      hiddenHistoryIds: [],
      // URLs of history entries deleted this session — the music editor
      // watches these and drops any track loaded from the same file.
      // Session-only (not in partialize): a reload drops the listener anyway.
      deletedUrls: [],
      selectedHistoryId: null,

      // Saved prompts — the user's reusable prompt library (persisted).
      // { id, title, prompt, negativePrompt, style, createdAt }
      savedPrompts: [],

      // Settings modal
      showSettings: false,
      showWebSearch: false,

      // Actions
      // Apply deployment config (config.json) as shared, cross-browser
      // settings. Fresh browsers always take it. Browsers saved before
      // config-sync existed keep their own values until a Settings →
      // Save marks the server config with `synced: true` — that way a
      // stale browser can't clobber the server on upgrade.
      // `config` is pre-sanitized by src/lib/config.js (whitelisted
      // fields, keys stripped). `{ force: true }` (Settings → Update
      // from server) applies a synced config regardless of the gate.
      applyServerConfig: (config, { force = false } = {}) => {
        if (!config || Object.keys(config).length === 0) return
        if (!force && !FRESH_INSTALL && config.synced !== true) return
        set((s) => {
          const patch = {}
          for (const key of ['serverUrl', 'useProxy', 'autoUnload', 'style', 'searchUrl', 'searchEngine', 'searchApiKey', 'searchCseId', 'llmProvider']) {
            if (config[key] !== undefined) patch[key] = config[key]
          }
          if (config.llmConfigs) {
            const llmConfigs = {}
            for (const k of new Set([...Object.keys(s.llmConfigs), ...Object.keys(config.llmConfigs)])) {
              // server wins for url/model; browser keeps its API keys
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
          // Per-mode generation settings — server wins per key.
          for (const k of ['imageSettings', 'videoSettings', 'editSettings', 'musicSettings']) {
            if (config[k]) patch[k] = { ...s[k], ...config[k] }
          }
          if (config.threeD) {
            patch.threeD = { ...s.threeD, ...config.threeD }
          }
          return patch
        })
      },
      setServerUrl: (url) => set({ serverUrl: url }),
      setUseProxy: (useProxy) => set({ useProxy }),
      setConnected: (connected) => set({ connected }),
      setQueueRemaining: (n) => set({ queueRemaining: n }),
      // Switching tabs swaps in that tab's own prompt/negative text
      // (kept in promptByMode / negativeByMode).
      setMode: (mode) =>
        set((s) => ({
          mode,
          prompt: s.promptByMode[mode] ?? '',
          negativePrompt: s.negativeByMode[mode] ?? '',
          outputImage: null,
          outputVideo: null,
          outputAudio: null,
        })),
      setGenerating: (generating) => set({ generating }),
      setLastGenAt: (lastGenAt) => set({ lastGenAt }),
      setModelsUnloaded: (modelsUnloaded) => set({ modelsUnloaded }),
      setAutoUnload: (autoUnload) => set({ autoUnload }),
      setProgress: (progress) => set({ progress }),
      setProgressLabel: (progressLabel) => set({ progressLabel }),
      setCurrentPromptId: (id) => set({ currentPromptId: id }),
      setElapsedTime: (t) => set({ elapsedTime: t }),
      setPrompt: (prompt) =>
        set((s) => ({ prompt, promptByMode: { ...s.promptByMode, [s.mode]: prompt } })),
      setNegativePrompt: (negativePrompt) =>
        set((s) => ({ negativePrompt, negativeByMode: { ...s.negativeByMode, [s.mode]: negativePrompt } })),
      setStyle: (style) => set({ style }),
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      setLlmProvider: (llmProvider) => set({ llmProvider }),
      setLlmConfigs: (llmConfigs) => set((s) => ({
        llmConfigs: { ...s.llmConfigs, ...llmConfigs },
      })),
      setSearchUrl: (searchUrl) => set({ searchUrl }),
      setSearchEngine: (searchEngine) => set({ searchEngine }),
      setSearchApiKey: (searchApiKey) => set({ searchApiKey }),
      setSearchCseId: (searchCseId) => set({ searchCseId }),
      setShowWebSearch: (showWebSearch) => set({ showWebSearch }),
      setImageSettings: (settings) => set((s) => ({ imageSettings: { ...s.imageSettings, ...settings } })),
      setVideoSettings: (settings) => set((s) => ({ videoSettings: { ...s.videoSettings, ...settings } })),
      setEditSettings: (settings) => set((s) => ({ editSettings: { ...s.editSettings, ...settings } })),
      setMusicSettings: (settings) => set((s) => ({ musicSettings: { ...s.musicSettings, ...settings } })),
      setLyrics: (lyrics) => set({ lyrics }),
      setShowMusicEditor: (showMusicEditor) => set({ showMusicEditor }),
      setSidebarWidth: (w) => set({ sidebarWidth: Math.max(200, Math.min(480, Math.round(w))) }),
      setControlsWidth: (w) => set({ controlsWidth: Math.max(240, Math.min(560, Math.round(w))) }),
      setThreeD: (patch) => set((s) => ({ threeD: { ...s.threeD, ...patch } })),
      setThreeDRun: (patch) => set((s) => ({ threeDRun: { ...s.threeDRun, ...patch } })),
      setSourceImage: (sourceImage) => set({ sourceImage }),
      setReferenceAudio: (referenceAudio) => set({ referenceAudio }),
      setViewing3d: (viewing3d) => set({ viewing3d }),
      setModels: (mode, models) => set((s) => ({
        models: { ...s.models, [mode]: { ...s.models[mode], ...models } },
      })),
      setOutputImage: (outputImage) => set({ outputImage, outputVideo: null, outputAudio: null }),
      setOutputVideo: (outputVideo) => set({ outputVideo, outputImage: null, outputAudio: null }),
      setOutputAudio: (outputAudio) => set({ outputAudio, outputImage: null, outputVideo: null }),
      setError: (error) => set({ error }),
      clearError: () => set({ error: null }),
      setShowSettings: (showSettings) => set({ showSettings }),

      addToHistory: (entry) => {
        set((s) => ({
          // Same promptId can arrive twice (local add + server sync) — keep one.
          history: [entry, ...s.history.filter((h) => h.id !== entry.id)].slice(0, 100),
        }))
        // Share the new entry with every other browser/origin.
        pushHistoryEntries([entry])
      },
      removeFromHistory: (id) => {
        set((s) => {
          const entry = s.history.find((h) => h.id === id)
          const patch = {
            history: s.history.filter((h) => h.id !== id),
            // Remember the deletion so the next server sync doesn't
            // resurrect it from ComfyUI's /history.
            hiddenHistoryIds: s.hiddenHistoryIds.includes(id)
              ? s.hiddenHistoryIds
              : [...s.hiddenHistoryIds, id].slice(-200),
          }
          if (s.selectedHistoryId === id) patch.selectedHistoryId = null
          if (entry && entry.data === s.outputImage) patch.outputImage = null
          if (entry && entry.data === s.outputVideo) patch.outputVideo = null
          if (entry && entry.data === s.outputAudio) patch.outputAudio = null
          if (entry?.data && typeof entry.data === 'string') {
            patch.deletedUrls = [entry.data, ...s.deletedUrls.filter((u) => u !== entry.data)].slice(0, 100)
          }
          return patch
        })
        // Share the delete with every other logged-in browser.
        pushHiddenIds([id])
      },
      // Fold ids learned from other browsers/servers into the local
      // hidden set: drop matching history entries (and remember their
      // urls so an open studio drops those tracks too).
      mergeHiddenIds: (ids) => set((s) => {
        const incoming = (Array.isArray(ids) ? ids : []).map(String).filter(Boolean)
        if (incoming.length === 0) return {}
        const hidden = new Set([...s.hiddenHistoryIds.map(String), ...incoming])
        const removed = s.history.filter((h) => hidden.has(String(h.id)))
        const removedUrls = removed
          .map((h) => h.data)
          .filter((u) => typeof u === 'string' && u)
        return {
          hiddenHistoryIds: [...hidden].slice(-500),
          history: s.history.filter((h) => !hidden.has(String(h.id))),
          ...(removedUrls.length
            ? {
                deletedUrls: [
                  ...removedUrls,
                  ...s.deletedUrls.filter((u) => !removedUrls.includes(u)),
                ].slice(0, 100),
              }
            : {}),
        }
      }),
      clearHistory: () => {
        const ids = get().history.map((h) => h.id)
        set((s) => ({
          history: [],
          selectedHistoryId: null,
          outputImage: null,
          outputVideo: null,
          outputAudio: null,
          hiddenHistoryIds: [...new Set([...s.hiddenHistoryIds, ...s.history.map((h) => h.id)])].slice(-200),
          deletedUrls: [
            ...s.history.map((h) => h.data).filter((d) => typeof d === 'string' && d),
            ...s.deletedUrls,
          ].slice(0, 100),
        }))
        // Share the wipe with every other logged-in browser.
        pushHiddenIds(ids)
      },
      // Merge entries fetched from the ComfyUI server's /history. Local
      // entries win (they hold extra settings), deletions stick, and the
      // list is sorted newest-first.
      mergeServerHistory: (entries) => set((s) => {
        if (!entries?.length) return {}
        const have = new Set(s.history.map((h) => h.id))
        const hidden = new Set(s.hiddenHistoryIds)
        const fresh = entries.filter((e) => e?.id && !have.has(e.id) && !hidden.has(e.id))
        if (fresh.length === 0) return {}
        const merged = [...fresh, ...s.history]
          .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
          .slice(0, 100)
        return { history: merged }
      }),
      selectHistory: (id) => {
        const entry = get().history.find((h) => h.id === id)
        if (entry) {
          // 3D entries open the GLB viewer modal — they don't map to any
          // of the image/video/music output slots.
          if (entry.type === '3d') {
            set({ selectedHistoryId: id, viewing3d: { url: entry.data, name: entry.prompt || '3D model' } })
            return
          }
          const isVideo = entry.type === 'video'
          const isMusic = entry.type === 'music'
          const mode = isVideo ? 'video' : isMusic ? 'music' : entry.type === 'edit' ? 'edit' : 'image'
          const text = entry.prompt ?? ''
          set((st) => ({
            selectedHistoryId: id,
            // Only video entries are videos and only music entries are
            // audio — 'edit' entries are still images.
            outputImage: isVideo || isMusic ? null : entry.data,
            outputVideo: isVideo ? entry.data : null,
            outputAudio: isMusic ? entry.data : null,
            prompt: text,
            // also remember it as that tab's own prompt
            promptByMode: { ...st.promptByMode, [mode]: text },
            lyrics: isMusic && typeof entry.lyrics === 'string' ? entry.lyrics : st.lyrics,
            mode,
          }))
        }
      },

      // Saved prompts
      addSavedPrompt: ({ title, prompt, negativePrompt, style } = {}) => {
        const text = String(prompt ?? get().prompt ?? '').trim()
        if (!text) return null
        const firstLine = text.split('\n')[0]
        const entry = {
          id: uid(),
          title: String(title || '').trim() || (firstLine.length > 48 ? `${firstLine.slice(0, 48)}…` : firstLine),
          prompt: text,
          negativePrompt: negativePrompt ?? get().negativePrompt,
          style: style ?? get().style,
          createdAt: Date.now(),
        }
        set((s) => ({ savedPrompts: [entry, ...s.savedPrompts].slice(0, 300) }))
        return entry
      },
      renameSavedPrompt: (id, title) =>
        set((s) => ({
          savedPrompts: s.savedPrompts.map((p) =>
            p.id === id ? { ...p, title: String(title || '').trim() || p.title } : p
          ),
        })),
      removeSavedPrompt: (id) =>
        set((s) => ({ savedPrompts: s.savedPrompts.filter((p) => p.id !== id) })),
      // Merge an exported JSON list — existing ids win, new ones are added.
      importSavedPrompts: (entries) =>
        set((s) => {
          const known = new Set(s.savedPrompts.map((p) => p.id))
          const incoming = (Array.isArray(entries) ? entries : [])
            .filter((e) => e && typeof e.prompt === 'string' && e.prompt.trim())
            .filter((e) => !known.has(e.id))
            .map((e) => ({
              id: typeof e.id === 'string' && e.id ? e.id : uid(),
              title: String(e.title || e.prompt.split('\n')[0]).slice(0, 80),
              prompt: e.prompt,
              negativePrompt: String(e.negativePrompt || ''),
              style: typeof e.style === 'string' ? e.style : 'photoreal',
              createdAt: Number(e.createdAt) || Date.now(),
            }))
          if (incoming.length === 0) return {}
          const all = [...s.savedPrompts, ...incoming].sort((a, b) => b.createdAt - a.createdAt)
          return { savedPrompts: all.slice(0, 300) }
        }),
    }),
    {
      name: 'comfyui-studio-storage',
      version: 3,
      // v0/v1 stored a flat llmUrl/llmModel (Ollama era: port 11434 +
      // "name:tag" ids). Fold them into the v2 per-provider config.
      // v3 merges model groups against DEFAULT_MODELS so browsers saved
      // before a group existed (music) get its defaults.
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
        const modelGroups = {}
        for (const k of new Set([...Object.keys(DEFAULT_MODELS), ...Object.keys(s.models || {})])) {
          modelGroups[k] = { ...DEFAULT_MODELS[k], ...(s.models?.[k] || {}) }
        }
        s.models = modelGroups
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
        searchEngine: state.searchEngine,
        searchApiKey: state.searchApiKey,
        searchCseId: state.searchCseId,
        models: state.models,
        threeD: state.threeD,
        imageSettings: state.imageSettings,
        videoSettings: state.videoSettings,
        musicSettings: state.musicSettings,
        history: state.history,
        hiddenHistoryIds: state.hiddenHistoryIds,
        outputAudio: state.outputAudio,
        // Which tab/mode you were on — a new tab (e.g. the Studio's own
        // window) should come back where you left off.
        mode: state.mode,
        savedPrompts: state.savedPrompts,
        sidebarWidth: state.sidebarWidth,
        controlsWidth: state.controlsWidth,
      }),
    }
  )
)

export default useStore
