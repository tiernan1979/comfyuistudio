import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import {
  DEFAULT_LLM_CONFIGS,
  DEFAULT_MODELS,
  DEFAULT_SPRITE_SETTINGS,
  DEFAULT_IMAGE_SETTINGS,
  DEFAULT_PIXEL_SETTINGS,
  DEFAULT_SPLIT_SETTINGS,
  DEFAULT_PARTS_SETTINGS,
  DEFAULT_PRESETS,
  DEFAULT_ACTIVE,
  DEFAULT_LYRICS,
} from './defaults.js'
import { STORAGE_KEY, STORAGE_VERSION, migrate, partialize, safeStorage } from './persist.js'
import { applyServerConfig } from './configSync.js'
import { createHistoryActions } from './historyActions.js'
import { createPromptActions } from './promptActions.js'
import { createEpisodeActions } from './episodeActions.js'

// Backwards-compatible named exports — several components import these
// straight from the store module.
export {
  presetLabel,
  resolveActiveModels,
  resolvePresetModels,
  pushHistoryEntries,
} from './helpers.js'

const clamp = (v, min, max) => Math.max(min, Math.min(max, Math.round(v)))

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
      mode: 'image', // 'image' | 'video' | 'edit' | 'music' | 'sfx' | 'sprite' | '3d'

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

      // VRAM guard ("keep the GPU free for generation"). When on, a
      // generation first checks LM Studio for any model that is NOT the
      // configured prompt-writer (a big LLM sharing the card). If one is
      // loaded AND ComfyUI's queue is empty (so nothing we're running needs
      // it), ComfyUI's models are dropped from VRAM before the run — the
      // other model reloads itself on its next use. If ComfyUI is busy, the
      // run is blocked with a message instead of racing it into an OOM.
      vramGuard: false,

      // Prompt — `prompt`/`negativePrompt` mirror the ACTIVE mode; the
      // ByMode maps remember each tab's own text so Image / Video /
      // Edit / Music / 3D all keep separate prompts. Session-only
      // (like `prompt`, not persisted).
      prompt: '',
      negativePrompt: '',
      promptByMode: {
        image: '',
        pixel: '',
        video: '',
        edit: '',
        music: '',
        sfx: '',
        sprite: '',
        custom: '',
        '3d': '',
      },
      negativeByMode: {
        image: '',
        pixel: '',
        video: '',
        edit: '',
        music: '',
        sfx: '',
        sprite: '',
        custom: '',
        '3d': '',
      },
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

      // Image settings (see DEFAULT_IMAGE_SETTINGS).
      imageSettings: { ...DEFAULT_IMAGE_SETTINGS },
      // Pixel-art settings (SDXL + Pixel Art XL; see DEFAULT_PIXEL_SETTINGS).
      pixelSettings: { ...DEFAULT_PIXEL_SETTINGS },

      // 2D sprite splitting + character-parts library
      splitSettings: { ...DEFAULT_SPLIT_SETTINGS },
      partsSettings: { ...DEFAULT_PARTS_SETTINGS },
      // Generated parts-library variants (session only — object URLs).
      partsGallery: [],
      // Image queued for the splitter by the parts library (session only).
      splitSource: null,

      // Video settings
      videoSettings: {
        resolution: '480p',
        frames: 33,
        fps: 16,
        // MiniMax H3 chaining. `duration` (seconds) is the primary control —
        // the builder picks enough chained windows to reach it. `segments` is
        // the explicit window count used only when duration is 0.
        // `windowSeconds` is the per-window H3 length; the model only works
        // well on its trained 124–362 frame range (≈5.2–15.1s at 24fps).
        duration: 5,
        segments: 1,
        windowSeconds: 5.2,
        // Crossfade the per-window soundtracks (needs the AudioCrossfade
        // custom node; ignored/falls back to a hard cut without it).
        crossfadeSeconds: 0.5,
        seed: -1,
        steps: 20, // was 30 — sampler dominates on 16GB RAM; raise in Settings if needed
        cfg: 6,
      },

      // Edit settings
      editSettings: {
        seed: -1,
        steps: 20,
        cfg: 2.5,
        // Masked edits only: 1 = fully repaint the masked region. Lower
        // values keep more of the source inside the mask too.
        denoise: 1,
      },

      // Music settings (MiniMax Music 3 / ACE-Step). quality: 'wav'
      // (lossless via SaveAudio) or an MP3 bitrate for SaveAudioMP3.
      // duration: cap on track length (10–600s) — the structure planner
      // sizes the song itself and the tail trim cuts any silent pad; this
      // is the ceiling, not an exact length.
      musicSettings: {
        seed: -1,
        steps: 30, // official template default
        cfgScale: 1.7, // AR-planner CFG inside MiniMaxMusic3TextEncode
        quality: '320k', // 'wav' | '320k' | 'V0' | '128k'
        duration: 300, // 5-minute default cap
      },

      // SFX settings (Stable Audio 3). Short effects, lossless by default.
      // duration is clamped to STABLE_AUDIO_MAX_SECONDS (47s) by the builder.
      sfxSettings: {
        seed: -1,
        quality: 'wav', // 'wav' | '320k' | 'V0' | '128k'
        duration: 6,
      },

      // Sprite-sheet settings — see DEFAULT_SPRITE_SETTINGS for the fields
      // and what each engine (pose | video) reads from them.
      spriteSettings: { ...DEFAULT_SPRITE_SETTINGS },

      // Sung lyrics for music mode. Default = the section-tag map (also the
      // visible example in the box); tag-only = instrumental at generate
      // time. Not persisted across reloads, so the default always resurfaces.
      lyrics: DEFAULT_LYRICS,

      // AI-generated titles keyed by mode ('music' | 'video'). Set by the
      // AI rewrite; consumed by the download filename + player. Session-only.
      titles: {},

      // Named model presets per mode (multi-model picker). `presets[mode]`
      // is a list of { name, unet, clip, vae, lora?, engine? }; `active[mode]`
      // is the index of the preset generation uses, or null for the flat
      // group above (single-model, backward compatible).
      presets: JSON.parse(JSON.stringify(DEFAULT_PRESETS)),
      active: { ...DEFAULT_ACTIVE },

      // Imported ComfyUI API workflows (Settings → Workflows). Stored as
      // { id, name, graph, mapping, createdAt }; the graph is posted as-is
      // except for the mapped prompt/negative/seed fields.
      customWorkflows: [],
      customWorkflowId: null,
      customSettings: { seed: -1 },

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

      // First frame for H3 image-to-video (File/object URL kept in memory)
      videoSourceImage: null, // { file?, url?, preview, name }

      // Episode shot list (persisted; fields: id, prompt, seconds, still,
      // status, outputUrl, error, timestamps — see EpisodePanel)
      episodeShots: [],

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
      // Extra images from a batched image render (contact-sheet view)
      batchImages: [],

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

      // Saved prompts — see createPromptActions.
      savedPrompts: [],

      // Settings modal
      showSettings: false,
      showWebSearch: false,
      // Mobile-only: the sidebar/history drawer. Ignored on desktop, where the
      // sidebar is always docked.
      sidebarOpen: false,

      // Actions
      applyServerConfig: (config, opts) => applyServerConfig(set, config, opts),
      setServerUrl: (serverUrl) => set({ serverUrl }),
      setUseProxy: (useProxy) => set({ useProxy }),
      setConnected: (connected) => set({ connected }),
      setQueueRemaining: (queueRemaining) => set({ queueRemaining }),

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
          batchImages: [],
        })),

      setGenerating: (generating) => set({ generating }),
      setLastGenAt: (lastGenAt) => set({ lastGenAt }),
      setModelsUnloaded: (modelsUnloaded) => set({ modelsUnloaded }),
      setAutoUnload: (autoUnload) => set({ autoUnload }),
      setVramGuard: (vramGuard) => set({ vramGuard }),
      setProgress: (progress) => set({ progress }),
      setProgressLabel: (progressLabel) => set({ progressLabel }),
      setCurrentPromptId: (currentPromptId) => set({ currentPromptId }),
      setElapsedTime: (elapsedTime) => set({ elapsedTime }),

      setPrompt: (prompt) =>
        set((s) => ({ prompt, promptByMode: { ...s.promptByMode, [s.mode]: prompt } })),
      setNegativePrompt: (negativePrompt) =>
        set((s) => ({
          negativePrompt,
          negativeByMode: { ...s.negativeByMode, [s.mode]: negativePrompt },
        })),
      setStyle: (style) => set({ style }),
      setSearchQuery: (searchQuery) => set({ searchQuery }),

      setLlmProvider: (llmProvider) => set({ llmProvider }),
      setLlmConfigs: (llmConfigs) => set((s) => ({ llmConfigs: { ...s.llmConfigs, ...llmConfigs } })),

      setSearchUrl: (searchUrl) => set({ searchUrl }),
      setSearchEngine: (searchEngine) => set({ searchEngine }),
      setSearchApiKey: (searchApiKey) => set({ searchApiKey }),
      setSearchCseId: (searchCseId) => set({ searchCseId }),
      setShowWebSearch: (showWebSearch) => set({ showWebSearch }),

      setImageSettings: (settings) =>
        set((s) => ({ imageSettings: { ...s.imageSettings, ...settings } })),
      setPixelSettings: (settings) =>
        set((s) => ({ pixelSettings: { ...s.pixelSettings, ...settings } })),
      setVideoSettings: (settings) =>
        set((s) => ({ videoSettings: { ...s.videoSettings, ...settings } })),
      setEditSettings: (settings) =>
        set((s) => ({ editSettings: { ...s.editSettings, ...settings } })),
      setMusicSettings: (settings) =>
        set((s) => ({ musicSettings: { ...s.musicSettings, ...settings } })),
      setSfxSettings: (settings) =>
        set((s) => ({ sfxSettings: { ...s.sfxSettings, ...settings } })),
      setSpriteSettings: (settings) =>
        set((s) => ({ spriteSettings: { ...s.spriteSettings, ...settings } })),
      setCustomSettings: (settings) =>
        set((s) => ({ customSettings: { ...s.customSettings, ...settings } })),
      setSplitSettings: (settings) =>
        set((s) => ({ splitSettings: { ...s.splitSettings, ...settings } })),
      setPartsSettings: (settings) =>
        set((s) => ({ partsSettings: { ...s.partsSettings, ...settings } })),

      addPartsGallery: (items) =>
        set((s) => ({ partsGallery: [...items, ...s.partsGallery].slice(0, 120) })),
      removePartsGallery: (id) =>
        set((s) => ({ partsGallery: s.partsGallery.filter((g) => g.id !== id) })),
      clearPartsGallery: () => set({ partsGallery: [] }),
      setSplitSource: (splitSource) => set({ splitSource }),

      setLyrics: (lyrics) => set({ lyrics }),
      setTitle: (mode, title) => set((s) => ({ titles: { ...s.titles, [mode]: title } })),
      setShowMusicEditor: (showMusicEditor) => set({ showMusicEditor }),

      setSidebarWidth: (w) => set({ sidebarWidth: clamp(w, 200, 480) }),
      setControlsWidth: (w) => set({ controlsWidth: clamp(w, 240, 560) }),

      setThreeD: (patch) => set((s) => ({ threeD: { ...s.threeD, ...patch } })),
      setThreeDRun: (patch) => set((s) => ({ threeDRun: { ...s.threeDRun, ...patch } })),
      setSourceImage: (sourceImage) => set({ sourceImage }),
      setReferenceAudio: (referenceAudio) => set({ referenceAudio }),
      setViewing3d: (viewing3d) => set({ viewing3d }),

      setModels: (mode, models) =>
        set((s) => ({ models: { ...s.models, [mode]: { ...s.models[mode], ...models } } })),
      setPresets: (mode, presets) => set((s) => ({ presets: { ...s.presets, [mode]: presets } })),
      setActivePreset: (mode, index) => set((s) => ({ active: { ...s.active, [mode]: index } })),

      // Imported workflows. Adding/removing keeps a valid selection so the
      // Custom tab never points at a deleted record.
      addCustomWorkflow: (record) =>
        set((s) => ({
          customWorkflows: [...s.customWorkflows, record],
          customWorkflowId: record.id,
        })),
      updateCustomWorkflow: (id, patch) =>
        set((s) => ({
          customWorkflows: s.customWorkflows.map((w) => (w.id === id ? { ...w, ...patch } : w)),
        })),
      removeCustomWorkflow: (id) =>
        set((s) => {
          const list = s.customWorkflows.filter((w) => w.id !== id)
          return {
            customWorkflows: list,
            customWorkflowId:
              s.customWorkflowId === id ? list[0]?.id || null : s.customWorkflowId,
          }
        }),
      setCustomWorkflowId: (customWorkflowId) => set({ customWorkflowId }),

      addPreset: (mode, preset) =>
        set((s) => {
          const list = [...(s.presets?.[mode] || []), preset]
          return {
            presets: { ...s.presets, [mode]: list },
            // Select the new preset immediately.
            active: { ...s.active, [mode]: list.length - 1 },
          }
        }),

      updatePreset: (mode, index, patch) =>
        set((s) => {
          const list = [...(s.presets?.[mode] || [])]
          if (!list[index]) return {}
          list[index] = { ...list[index], ...patch }
          return { presets: { ...s.presets, [mode]: list } }
        }),

      removePreset: (mode, index) =>
        set((s) => {
          const list = (s.presets?.[mode] || []).filter((_, i) => i !== index)
          const cur = s.active?.[mode]
          let next = cur
          if (cur === index) next = list.length > 0 ? 0 : null
          else if (cur !== null && cur !== undefined && cur > index) next = cur - 1
          return {
            presets: { ...s.presets, [mode]: list },
            active: { ...s.active, [mode]: next },
          }
        }),

      setOutputImage: (outputImage) =>
        set({ outputImage, outputVideo: null, outputAudio: null }),
      setOutputVideo: (outputVideo) =>
        set({ outputVideo, outputImage: null, outputAudio: null, batchImages: [] }),
      setOutputAudio: (outputAudio) =>
        set({ outputAudio, outputImage: null, outputVideo: null, batchImages: [] }),
      setBatchImages: (batchImages) => set({ batchImages }),

      setError: (error) => set({ error }),
      clearError: () => set({ error: null }),
      setShowSettings: (showSettings) => set({ showSettings }),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),

      ...createEpisodeActions(set),
      ...createHistoryActions(set, get),
      ...createPromptActions(set, get),
    }),
    {
      name: STORAGE_KEY,
      version: STORAGE_VERSION,
      migrate,
      partialize,
      // Quota-safe wrapper: trims history/thumbnails instead of throwing.
      storage: createJSONStorage(() => safeStorage),
    }
  )
)

export default useStore
