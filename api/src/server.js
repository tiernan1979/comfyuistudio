// ComfyUI Studio — LAN REST API (optional service, port 5557).
//
// Serves the same workflows the web app uses (src/lib/workflows.js) over a
// plain HTTP API so MCP clients and scripts can drive image / edit / video /
// music generation without a browser. Browser-only state (DAW sessions,
// saved prompts) is intentionally NOT exposed; shared state lives here
// instead: a durable history store (ComfyUI's own /history is in-memory
// and resets on restart) plus the hidden-ids deletion list.
//
//   GET  /api/health            service + ComfyUI reachability
//   GET  /api/capabilities      modes, aliases, inputs, defaults (discovery)
//   GET  /api/workflows         same discovery payload (alias endpoint)
//   POST /api/generate          run a generation (wait=true default, or wait=false + GET /api/job/:promptId)
//                               modes: image | edit | video | music | sfx | texture | flipbook | material
//                               + pbr (alias for material)
//                               + parts (graphs, wait supported)
//                               + split  (imageBase64 → part PNGs + metadata; returns `parts`[])
//                               + 3d | skin | meshupscale (long-lived flows — always block,
//                                 timeoutSec up to 60min, no promptId/job polling)
//   GET  /api/texture           texture capability/defaults
//   POST /api/texture           shorthand for mode=texture
//   GET  /api/models            model lists + resolved per-mode defaults
//   GET  /api/history           durable shared history (live ComfyUI merged in, hidden-ids filtered)
//   POST /api/history           add entries  { entries: [...] } (browsers share their local entries)
//   DELETE /api/history         reset the durable store
//   GET  /api/queue             ComfyUI queue depth
//   POST /api/cancel            interrupt the running prompt
//   POST /api/generate          run a generation (wait=true default, or wait=false + GET /api/job/:promptId)
//                               modes: image | edit | video | music | sfx | parts (graphs, wait supported)
//                               + split  (imageBase64 → part PNGs + metadata; returns `parts`[])
//                               + 3d | skin | meshupscale (long-lived flows — always block,
//                                 timeoutSec up to 60min, no promptId/job polling)
//   GET  /api/job/:promptId     status/outputs of a queued prompt
//   GET  /api/file              proxy of ComfyUI /view (filename, subfolder, type)
//   GET  /api/hidden-ids        shared deleted-history ids (persisted)
//   POST /api/hidden-ids        merge ids  { ids: [...] }
//   DELETE /api/hidden-ids      reset
//
// Auth: set API_KEY to require `Authorization: Bearer <key>` (or x-api-key).

import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  MODES,
  FLOW_MODES,
  DEFAULT_SETTINGS,
  MODEL_MODE_ALIASES,
  MATERIAL_MAP_KEYS,
  canonicalMode,
  apiCapabilities,
  resolveModels,
  resolveUpscaleModel,
  workflowFor,
  decodeDataUrl,
  outputsOf,
  hasOutputs,
  pickModelOverrides,
  loadRuntimeConfig,
  configModelOverrides,
  IMAGE_INPUT_MODES,
  PROMPT_OPTIONAL_MODES,
  SPLIT_MODE,
} from './lib.mjs'
import {
  getModelLists,
  getServerHistory,
  uploadImage,
  queuePrompt,
  freeLoadedModels,
  extractHistoryError,
  hasAudioTailTrim,
  assertWorkflowNodes,
} from '../../src/lib/comfyui.js'
import { runGenerateMesh, runPaintSkin, runMeshUpscale } from '../../src/lib/threed.js'
import { startIdleUnload } from './idleUnload.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

class HttpError extends Error {
  constructor(status, message, details) {
    super(message)
    this.status = status
    this.details = details
  }
}

// Response metadata that tells a client how to interpret game-asset outputs.
function generationDetails(mode, settings) {
  if (mode === 'texture') {
    return {
      texture: {
        kind: settings.kind || 'texture',
        grid: settings.grid || 2,
        size: settings.size || 1024,
        sheet: (settings.kind || 'texture') !== 'texture',
        transparent: settings.kind === 'icon' && settings.transparent !== false,
      },
    }
  }
  if (mode === 'flipbook') {
    return {
      flipbook: {
        frames: settings.frames || 17,
        fps: settings.fps || 12,
        resolution: settings.resolution || 512,
        transparent: settings.transparent !== false,
      },
    }
  }
  if (mode === 'material') {
    return {
      material: {
        maps: MATERIAL_MAP_KEYS.filter((key) => settings.maps?.[key] !== false),
        tiling: settings.tiling || 'both',
        size: settings.size || '1:1 (1024x1024)',
      },
    }
  }
  return {}
}

// Add game-asset semantics to each output: which PBR map a file is, the frame
// index in a flipbook, or the batch variant of a texture sheet.
function enrichOutputs(mode, outputs) {
  if (mode === 'material') {
    return outputs.map((o) => ({ ...o, map: String(o.nodeId || '').replace(/^save_/, '') }))
  }
  if (mode === 'flipbook') {
    return outputs.map((o, frame) => ({ ...o, frame }))
  }
  if (mode === 'texture') {
    return outputs.map((o, variant) => ({ ...o, variant }))
  }
  return outputs
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function createApp(opts = {}) {
  const cfg = {
    comfyuiUrl: (opts.comfyuiUrl || process.env.COMFYUI_URL || 'http://10.1.1.102:8188').replace(/\/+$/, ''),
    apiKey: opts.apiKey !== undefined ? opts.apiKey : process.env.API_KEY || '',
    dataDir: opts.dataDir || process.env.DATA_DIR || path.join(__dirname, '..', 'data'),
    // Shared config.json (the studio-config volume, read-only). Lets API
    // generations follow the same models/settings the browser is using.
    configPath: opts.configPath || process.env.CONFIG_PATH || '/configdir/config.json',
    timeoutMs: opts.timeoutMs || Number(process.env.GENERATE_TIMEOUT_MS || 15 * 60 * 1000),
    pollMs: opts.pollMs || 2000,
  }
  const hiddenFile = path.join(cfg.dataDir, 'hidden-ids.json')
  const historyFile = path.join(cfg.dataDir, 'history.json')
  const HISTORY_CAP = 200
  // Request-body settings are clamped to the same ranges the app writes to
  // config.json. Without this an authenticated caller can queue a 99999px
  // image and OOM the ComfyUI host.
  const SETTING_BOUNDS = {
    width: [64, 4096],
    height: [64, 4096],
    steps: [1, 100],
    cfg: [0, 30],
    frames: [1, 300],
    fps: [1, 60],
    batchCount: [1, 16],
    grid: [2, 4],
    metallic: [0, 100],
    roughness: [0, 100],
    duration: [1, 600],
    segments: [1, 12],
    windowSeconds: [4, 16],
    crossfadeSeconds: [0, 5],
  }

  // In-memory map of prompts this service queued (promptId also works for
  // jobs from other clients via /history/:promptId after a restart).
  const jobs = new Map()

  // Keep the map bounded when long-lived clients use wait=false.
  function pruneJobs(now = Date.now()) {
    for (const [id, job] of jobs) {
      if (now - (job.finishedAt || job.startedAt || 0) > 2 * 60 * 60 * 1000) jobs.delete(id)
    }
  }

  // outputDirectory/runId are forwarded into ComfyUI's save paths — reject
  // traversal and separators instead of trusting the request body.
  function sanitizeGenerationSettings(raw) {
    const out = { ...(raw || {}) }
    for (const [key, [min, max]] of Object.entries(SETTING_BOUNDS)) {
      if (out[key] === undefined) continue
      const n = Number(out[key])
      if (!Number.isFinite(n)) throw new HttpError(400, `${key} must be a number`)
      out[key] = Math.min(max, Math.max(min, n))
    }
    if (out.maps !== undefined) {
      if (!out.maps || typeof out.maps !== 'object' || Array.isArray(out.maps)) {
        throw new HttpError(400, 'maps must be an object of map-name → boolean')
      }
      const maps = {}
      for (const key of MATERIAL_MAP_KEYS) {
        if (out.maps[key] !== undefined) maps[key] = out.maps[key] !== false
      }
      if (!Object.keys(maps).length) {
        throw new HttpError(400, `maps must include at least one of: ${MATERIAL_MAP_KEYS.join(', ')}`)
      }
      out.maps = maps
    }
    if (out.kind !== undefined && !['texture', 'tileset', 'icon', 'terrain'].includes(out.kind)) {
      throw new HttpError(400, 'kind must be one of: texture, tileset, icon, terrain')
    }
    if (out.tiling !== undefined && !['both', 'horizontal', 'vertical'].includes(out.tiling)) {
      throw new HttpError(400, 'tiling must be one of: both, horizontal, vertical')
    }
    if (out.transparent !== undefined) out.transparent = out.transparent !== false
    for (const key of ['outputDirectory', 'runId']) {
      if (out[key] === undefined) continue
      const value = String(out[key])
      if (value === '.' || value === '..' || !/^[A-Za-z0-9._-]{1,64}$/.test(value)) {
        throw new HttpError(400, `${key} may contain only letters, numbers, dot, dash and underscore`)
      }
      out[key] = value
    }
    return out
  }

  const app = express()
  // CORS is intentionally opt-in: the Studio UI is same-origin through
  // nginx, and a blanket `*` lets any website a LAN user visits read the
  // shared history or queue generations. Set STUDIO_CORS_ORIGINS to a
  // comma-separated allowlist when a separate origin must call the API.
  const corsOrigins = (process.env.STUDIO_CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  app.use((req, res, next) => {
    const origin = req.get('origin')
    if (origin && (corsOrigins.includes('*') || corsOrigins.includes(origin))) {
      res.set('Access-Control-Allow-Origin', origin)
      res.set('Vary', 'Origin')
    }
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Api-Key')
    res.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    if (req.method === 'OPTIONS') return res.sendStatus(204)
    next()
  })
  // Authenticate before parsing a body: an unauthenticated caller should
  // not be able to make the process buffer 64 MB before receiving a 401.
  app.use('/api', (req, res, next) => {
    if (!cfg.apiKey) return next()
    const bearer = (req.get('authorization') || '').replace(/^Bearer\s+/i, '')
    const key = req.get('x-api-key') || ''
    if (bearer !== cfg.apiKey && key !== cfg.apiKey) {
      return res.status(401).json({ error: 'invalid or missing API key' })
    }
    next()
  })
  app.use(express.json({ limit: '64mb' }))

  function readHidden() {
    try {
      const data = JSON.parse(fs.readFileSync(hiddenFile, 'utf8'))
      return Array.isArray(data.ids) ? data.ids : []
    } catch {
      return []
    }
  }

  // Write JSON via a temp file + rename so a crash mid-write can't leave a
  // truncated file (readHidden/readHist would silently fall back to []).
  function writeJsonAtomic(file, value) {
    fs.mkdirSync(cfg.dataDir, { recursive: true })
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2))
    fs.renameSync(tmp, file)
  }

  function writeHidden(ids) {
    // Hidden ids are a suppression list, not content — cap it so a client
    // can't grow the file without bound. Keep the NEWEST ids: once the list
    // is full, appending a delete and keeping the head silently dropped every
    // new deletion, so entries kept reappearing after a sync.
    const next = [...new Set(ids.map(String))].slice(-500)
    writeJsonAtomic(hiddenFile, { ids: next })
    return next
  }

  // Durable shared history. ComfyUI's own /history is in-memory (restarts
  // and cleanups wipe it) and browsers only share localStorage within their
  // own origin — so entries converge here instead: GET folds live ComfyUI
  // entries into this store, POST lets each browser upload entries only it
  // has (its pre-shared localStorage). Entries are id-keyed, newest-first,
  // capped at HISTORY_CAP. Deletions stay in hidden-ids and are filtered
  // from reads, so resetting hidden-ids restores them from here too.
  function readHist() {
    try {
      const data = JSON.parse(fs.readFileSync(historyFile, 'utf8'))
      return Array.isArray(data.entries) ? data.entries.filter((e) => e && e.id) : []
    } catch {
      return []
    }
  }

  function writeHist(entries) {
    writeJsonAtomic(historyFile, { entries: entries.slice(0, HISTORY_CAP) })
  }

  const HISTORY_FIELDS = ['type', 'prompt', 'lyrics', 'title', 'data', 'thumbnail', 'timestamp', 'settings', 'view', 'fromServer']

  function normalizeEntry(e) {
    if (!e || typeof e !== 'object') return null
    if (typeof e.id !== 'string' && typeof e.id !== 'number') return null
    const out = { id: String(e.id) }
    for (const k of HISTORY_FIELDS) {
      if (e[k] !== undefined && e[k] !== null) out[k] = e[k]
    }
    // Base64 payloads (images/video/audio) are large; 8 MB keeps the
    // history file bounded while still fitting normal PNG/webp previews.
    if (typeof out.data !== 'string' || out.data.length > 8 * 1024 * 1024) delete out.data
    // AI-generated song/video title — short plain string.
    if (typeof out.title === 'string') out.title = out.title.trim().slice(0, 120)
    else delete out.title
    // Thumbnails are PNG data URLs — cap at 500 KB to keep the history file lean.
    if (typeof out.thumbnail !== 'string' || !out.thumbnail.startsWith('data:image/') || out.thumbnail.length > 500 * 1024) delete out.thumbnail
    if (typeof out.timestamp !== 'number' || !Number.isFinite(out.timestamp)) delete out.timestamp
    if (!out.settings || typeof out.settings !== 'object' || Array.isArray(out.settings)) delete out.settings
    if (!out.view || typeof out.view !== 'object' || typeof out.view.filename !== 'string') delete out.view
    return out
  }

  // Merge incoming entries into the store (id-keyed, newest-first). The
  // entry with content wins: a non-empty `settings` is preferred (client
  // entries carry the mode's settings; ComfyUI-derived ones are {}), and
  // lyrics/view params are filled in from whichever side has them.
  function mergeHist(incoming) {
    const before = readHist()
    const byId = new Map()
    for (const raw of [...before, ...(incoming || [])]) {
      const e = normalizeEntry(raw)
      if (!e) continue
      const prev = byId.get(e.id)
      if (!prev) {
        byId.set(e.id, e)
        continue
      }
      const prevRich = !!(prev.settings && Object.keys(prev.settings).length)
      const nextRich = !!(e.settings && Object.keys(e.settings).length)
      const keep = nextRich && !prevRich ? e : prev
      const other = keep === prev ? e : prev
      const merged = { ...other, ...keep }
      const settings = keep.settings || other.settings
      const lyrics = keep.lyrics || other.lyrics
      // Same non-empty preference as lyrics: an early live merge can capture
      // an entry before its caption is extractable (e.g. ACE graphs before
      // `tags` support) — a later merge with a real prompt must win over ''.
      const prompt = keep.prompt || other.prompt
      const view = keep.view || other.view
      if (settings) merged.settings = settings
      else delete merged.settings
      if (prompt !== undefined) merged.prompt = prompt
      if (lyrics) merged.lyrics = lyrics
      else delete merged.lyrics
      // Title: same non-empty preference — an early live merge can miss it.
      const title = keep.title || other.title
      if (title) merged.title = title
      else delete merged.title
      if (view) merged.view = view
      else delete merged.view
      merged.timestamp = Math.max(Number(prev.timestamp) || 0, Number(e.timestamp) || 0)
      byId.set(e.id, merged)
    }
    const merged = [...byId.values()].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    if (JSON.stringify(merged.slice(0, HISTORY_CAP)) !== JSON.stringify(before)) writeHist(merged)
    return merged
  }

  async function rawHistoryItem(promptId) {
    try {
      const res = await fetch(`${cfg.comfyuiUrl}/history/${encodeURIComponent(promptId)}`, {
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) return null
      const data = await res.json()
      return data?.[promptId] || Object.values(data || {})[0] || null
    } catch {
      return null
    }
  }

  async function waitForPrompt(promptId, timeoutMs) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const item = await rawHistoryItem(promptId)
      if (item) {
        const st = item.status || {}
        if (st.status_str === 'error') {
          throw new HttpError(502, extractHistoryError(item) || 'ComfyUI reported an error', {
            promptId,
          })
        }
        if (hasOutputs(item) || st.completed === true) return item
      }
      await sleep(cfg.pollMs)
    }
    throw new HttpError(
      504,
      `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for prompt ${promptId}`,
      { promptId },
    )
  }

  // A split run leaves named part PNGs + parts_metadata.json in
  // output/<output_directory>/<run_id>/ — find that folder from the
  // orchestrator's ui.autosplit output and read the metadata over /view.
  async function resolveSplitParts(item) {
    let ui = null
    for (const nodeOut of Object.values(item?.outputs || {})) {
      if (Array.isArray(nodeOut?.autosplit) && nodeOut.autosplit[0]) {
        ui = nodeOut.autosplit[0]
        break
      }
    }
    if (!ui) return null
    const rel = String(ui.folder || '').replace(/\\/g, '/')
    const marker = '/output/'
    const subfolder =
      rel.includes(marker) && rel.slice(rel.lastIndexOf(marker) + marker.length)
        ? rel.slice(rel.lastIndexOf(marker) + marker.length)
        : ui.run_id
          ? `split_parts_sam3/${ui.run_id}`
          : ''
    const metaQ = new URLSearchParams({
      filename: 'parts_metadata.json',
      subfolder,
      type: 'output',
    })
    let meta
    try {
      const res = await fetch(`${cfg.comfyuiUrl}/view?${metaQ}`, {
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) return null
      meta = await res.json()
    } catch {
      return null
    }
    const parts = (meta?.parts || []).map((p) => {
      const [x0, y0, x1, y1] = p.xyxy_full || p.xyxy || [0, 0, 0, 0]
      const params = new URLSearchParams({ filename: p.file, subfolder, type: 'output' })
      return {
        name: p.tag,
        filename: p.file,
        subfolder,
        type: 'output',
        offset: [Math.round(x0), Math.round(y0)],
        size: [Math.round(x1 - x0), Math.round(y1 - y0)],
        z: p.draw_index ?? 0,
        score: p.score ?? null,
        url: `/api/file?${params.toString()}`,
      }
    })
    return {
      subfolder,
      canvas: meta?.image_size || [0, 0],
      missing: meta?.missing || [],
      parts,
    }
  }

  async function runGeneration(body) {
    const mode = canonicalMode(body?.mode || 'image')
    if (!MODES.includes(mode)) {
      throw new HttpError(
        400,
        `mode must be one of: ${MODES.join(', ')} (pbr is accepted as an alias for material)`,
      )
    }
    const modelMode = MODEL_MODE_ALIASES[mode] || mode
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
    // Flow modes (3d/skin/meshupscale) are picture-driven pipelines — no
    // prompt. Split is image-driven; parts has a slot-based default prompt.
    if (!FLOW_MODES.includes(mode) && !PROMPT_OPTIONAL_MODES.has(mode) && !prompt) {
      throw new HttpError(400, 'prompt is required')
    }
    const negativePrompt = typeof body.negativePrompt === 'string' ? body.negativePrompt : ''
    const lyrics = typeof body.lyrics === 'string' ? body.lyrics : ''
    const settings = sanitizeGenerationSettings(
      body.settings && typeof body.settings === 'object' ? body.settings : {},
    )
    const wait = body.wait !== false
    const timeoutMs = Math.min(
      Number(body.timeoutSec) > 0 ? Number(body.timeoutSec) * 1000 : cfg.timeoutMs,
      60 * 60 * 1000,
    )

    // Baseline from shared config.json: the browser's saved models and
    // per-mode settings. Explicit request-body `models` / `settings`
    // still win over the config.
    const runtimeConfig = await loadRuntimeConfig(cfg.configPath)
    const cfgModels = configModelOverrides(runtimeConfig, mode)
    const baseOverrides = pickModelOverrides(modelMode, body.models)
    const modeOverrides = modelMode === mode ? {} : pickModelOverrides(mode, body.models)
    const modelOverrides = { ...cfgModels, ...baseOverrides, ...modeOverrides }
    const cfgSettings = runtimeConfig.settings?.[mode] || {}
    const effSettings = { ...DEFAULT_SETTINGS[mode], ...cfgSettings, ...settings }
    // material maps are nested — a shallow spread above would replace the whole
    // object when a caller enables only one map.
    if (mode === 'material') {
      effSettings.maps = {
        ...DEFAULT_SETTINGS.material.maps,
        ...(cfgSettings.maps || {}),
        ...(settings.maps || {}),
      }
    }

    let lists
    try {
      lists = await getModelLists(cfg.comfyuiUrl, { force: true })
    } catch (err) {
      throw new HttpError(502, `Could not reach ComfyUI at ${cfg.comfyuiUrl} (${err.message})`)
    }

    if (FLOW_MODES.includes(mode)) return runFlow(mode, body, effSettings, lists)

    let models
    try {
      models = resolveModels(lists, mode, modelOverrides)
    } catch (err) {
      throw new HttpError(502, err.message)
    }
    if (mode === 'image') {
      try {
        models = { ...models, upscale: resolveUpscaleModel(lists, effSettings.upscale) }
      } catch (err) {
        throw new HttpError(502, err.message)
      }
    }
    if (mode === 'music' || mode === 'sfx') {
      // Trim dead-air tails when the AudioTailTrim custom node is installed
      // (comfy_nodes/AudioTailTrim.py); graphs stay stock without it.
      models.trimAudio = await hasAudioTailTrim(cfg.comfyuiUrl)
    }

    let imageName
    if (IMAGE_INPUT_MODES.has(mode)) {
      if (!body.imageBase64) {
        throw new HttpError(400, `imageBase64 is required for ${mode} mode (data URL or raw base64)`)
      }
      const { buf, mime } = decodeDataUrl(body.imageBase64)
      try {
        const up = await uploadImage(
          cfg.comfyuiUrl,
          new File([buf], mode === 'split' ? 'split-source.png' : 'edit-input.png', { type: mime }),
        )
        imageName = up.name
      } catch (err) {
        throw new HttpError(502, err.message)
      }
    }

    // Parity with the app: always free VRAM before MiniMax Music 3 — its AV
    // pass OOMs behind other loaded models (tiled decode handles the rest).
    if (mode === 'music' || mode === 'sfx') await freeLoadedModels(cfg.comfyuiUrl)

    const workflow = workflowFor(mode, { prompt, negativePrompt, lyrics, settings: effSettings, models, imageName })
    // Preflight the optional node packs so a missing BiRefNet/controlnet
    // preprocessor fails with an install hint instead of a dead prompt.
    if (
      mode === 'material' ||
      (mode === 'texture' && effSettings.kind === 'icon' && effSettings.transparent !== false) ||
      (mode === 'flipbook' && effSettings.transparent !== false)
    ) {
      const label =
        mode === 'material'
          ? 'Local PBR'
          : mode === 'texture'
            ? 'Icon transparency'
            : 'Flipbook transparency'
      try {
        await assertWorkflowNodes(cfg.comfyuiUrl, workflow, { label })
      } catch (err) {
        throw new HttpError(502, err.message)
      }
    }
    const details = generationDetails(mode, effSettings)
    let promptId
    try {
      promptId = await queuePrompt(cfg.comfyuiUrl, workflow)
    } catch (err) {
      throw new HttpError(502, err.message)
    }
    pruneJobs()
    jobs.set(promptId, { mode, prompt, startedAt: Date.now() })

    if (!wait) return { ok: true, promptId, mode, status: 'queued', ...details }

    const started = Date.now()
    const item = await waitForPrompt(promptId, timeoutMs)
    jobs.set(promptId, { ...(jobs.get(promptId) || { startedAt: started }), finishedAt: Date.now() })
    const err = extractHistoryError(item) || null

    // Split mode: the orchestrator writes part PNGs + parts_metadata.json to
    // disk (not a normal ComfyUI image output), so read the run folder off its
    // ui output and hand back the parts list with per-part download URLs.
    if (mode === SPLIT_MODE) {
      const split = err ? null : await resolveSplitParts(item)
      return {
        ok: true,
        promptId,
        mode,
        elapsedMs: Date.now() - started,
        outputs: [],
        canvas: split?.canvas || [0, 0],
        missing: split?.missing || [],
        folder: split?.subfolder || '',
        parts: split?.parts || [],
        error: err,
      }
    }

    return {
      ok: true,
      promptId,
      mode,
      elapsedMs: Date.now() - started,
      outputs: enrichOutputs(mode, outputsOf(item, '/api/file', cfg.comfyuiUrl, mode)),
      settings: effSettings,
      models,
      error: err,
      ...details,
    }
  }

  // Flow modes: multi-prompt pipelines from threed.js (image → mesh, skin,
  // UltraShape refine). Each polls its own prompts and blocks until done
  // (their internal timeouts: mesh 30min / paint 25min / ultrashape 45min —
  // pass timeoutSec only as a client-side cushion). GLB outputs live on
  // ComfyUI's output dir, so results are ordinary /api/file URLs.
  async function runFlow(mode, body, settings, lists) {
    if (!body.imageBase64) {
      throw new HttpError(400, `imageBase64 is required for ${mode} mode (data URL or raw base64)`)
    }
    const { buf, mime } = decodeDataUrl(body.imageBase64)
    const imageFile = new File([buf], mode === '3d' ? 'mesh3d-source.png' : 'skin-source.png', { type: mime })

    let meshEntry = null
    let meshFile = null
    let meshName = 'mesh.glb'
    if (mode !== '3d') {
      if (body.meshBase64) {
        const m = decodeDataUrl(body.meshBase64)
        meshFile = new File([m.buf], 'mesh-input.glb', { type: 'model/gltf-binary' })
        meshName = 'mesh-input.glb'
      } else if (body.mesh && typeof body.mesh === 'object' && typeof body.mesh.filename === 'string') {
        const { filename, subfolder = '', type } = body.mesh
        if (!filename || filename.includes('..') || String(subfolder).includes('..')) {
          throw new HttpError(400, 'mesh.filename is required (no path traversal)')
        }
        meshEntry = { filename, subfolder: String(subfolder), type: type === 'input' ? 'input' : 'output' }
        meshName = filename
      } else {
        throw new HttpError(
          400,
          `${mode} mode needs a mesh — pass mesh: { filename, subfolder?, type? } (a GLB from a prior ` +
            '3d run, e.g. outputs[0].filename) or meshBase64 (raw GLB bytes)',
        )
      }
    }

    // Face passes use the same Qwen edit stack edit mode resolves; a server
    // without edit models simply skips them (the pipelines degrade gracefully).
    let editModels = null
    try {
      editModels = resolveModels(lists, 'edit')
    } catch {
      editModels = null
    }

    const base = cfg.comfyuiUrl
    const started = Date.now()
    const onStatus = (s) => console.log(`[flow:${mode}] ${s}`)
    try {
      if (mode === '3d') {
        const t = { ...DEFAULT_SETTINGS['3d'], ...settings }
        const glb = await runGenerateMesh(base, imageFile, t, onStatus, editModels)
        return { ok: true, mode, elapsedMs: Date.now() - started, outputs: [flowFileOut(glb)], settings: t }
      }
      if (mode === 'skin') {
        const t = { ...DEFAULT_SETTINGS.skin, ...settings }
        const res = await runPaintSkin(
          base,
          { cfg: t, imageFile, meshEntry, meshFile, meshName, editModels },
          onStatus,
        )
        return { ok: true, mode, elapsedMs: Date.now() - started, outputs: [flowFileOut(res.entry)], settings: t }
      }
      const t = { ...DEFAULT_SETTINGS.meshupscale, ...settings }
      const res = await runMeshUpscale(base, { cfg: t, imageFile, meshEntry, meshFile, meshName }, onStatus)
      return { ok: true, mode, elapsedMs: Date.now() - started, outputs: [flowFileOut(res.entry)], settings: t }
    } catch (err) {
      throw new HttpError(502, err.message || String(err))
    }
  }

  function flowFileOut(f) {
    const params = new URLSearchParams({
      filename: f.filename,
      subfolder: f.subfolder || '',
      type: f.type || 'output',
    })
    return {
      kind: '3d',
      filename: f.filename,
      subfolder: f.subfolder || '',
      type: f.type || 'output',
      url: `/api/file?${params.toString()}`,
      comfyuiUrl: `${cfg.comfyuiUrl}/view?${params.toString()}`,
    }
  }

  app.get('/api/health', async (req, res) => {
    let comfyui = false
    let version = null
    try {
      const r = await fetch(`${cfg.comfyuiUrl}/system_stats`, { signal: AbortSignal.timeout(5000) })
      if (r.ok) {
        const data = await r.json()
        comfyui = true
        version = data?.system?.comfyui_version || null
      }
    } catch {
      /* unreachable */
    }
    res.json({ ok: true, comfyuiUrl: cfg.comfyuiUrl, comfyui, version })
  })

  app.get('/api/capabilities', (req, res) => {
    res.json(apiCapabilities())
  })

  app.get('/api/workflows', (req, res) => {
    res.json(apiCapabilities())
  })

  app.get('/api/texture', (req, res) => {
    res.json({
      ok: true,
      mode: 'texture',
      kinds: ['texture', 'tileset', 'icon', 'terrain'],
      grids: [2, 3, 4],
      sizes: [512, 768, 1024],
      defaults: DEFAULT_SETTINGS.texture,
    })
  })

  app.post('/api/texture', async (req, res, next) => {
    try {
      res.json(await runGeneration({ ...(req.body || {}), mode: 'texture' }))
    } catch (err) {
      next(err)
    }
  })

  app.get('/api/models', async (req, res, next) => {
    try {
      const lists = await getModelLists(cfg.comfyuiUrl, { force: req.query.force === '1' })
      const defaults = {}
      for (const mode of MODES) {
        try {
          defaults[mode] = resolveModels(lists, mode)
        } catch {
          defaults[mode] = null
        }
      }
      res.json({ comfyuiUrl: cfg.comfyuiUrl, lists, defaults })
    } catch (err) {
      next(new HttpError(502, `Could not reach ComfyUI at ${cfg.comfyuiUrl} (${err.message})`))
    }
  })

  app.get('/api/history', async (req, res, next) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 60, 300)
      let live = null
      let liveErr = null
      try {
        live = await getServerHistory(cfg.comfyuiUrl, limit)
      } catch (err) {
        liveErr = err
      }
      let store = readHist()
      if (live) store = mergeHist(live)
      // ComfyUI unreachable but the durable store has entries — serve
      // those (degraded) instead of failing the whole read.
      if (!live && store.length === 0) {
        return next(new HttpError(502, `Could not read ComfyUI history (${liveErr.message})`))
      }
      const hidden = new Set(readHidden().map(String))
      const entries = store.filter((e) => !hidden.has(String(e.id))).slice(0, limit)
      res.json({ entries, ...(live ? {} : { source: 'store' }) })
    } catch (err) {
      next(err)
    }
  })

  // Browsers upload entries only they have (e.g. localStorage from before
  // history became shared) so every origin converges on the same list.
  // Idempotent — merging an entry twice is a no-op.
  app.post('/api/history', (req, res, next) => {
    try {
      const incoming = req.body?.entries
      if (!Array.isArray(incoming)) throw new HttpError(400, 'entries must be an array')
      const valid = incoming.map(normalizeEntry).filter(Boolean).slice(0, HISTORY_CAP)
      const merged = mergeHist(valid)
      res.json({ ok: true, accepted: valid.length, total: Math.min(merged.length, HISTORY_CAP) })
    } catch (err) {
      next(err)
    }
  })

  app.delete('/api/history', (req, res) => {
    writeHist([])
    res.json({ entries: [] })
  })

  app.get('/api/queue', async (req, res) => {
    try {
      const r = await fetch(`${cfg.comfyuiUrl}/queue`, { signal: AbortSignal.timeout(5000) })
      const data = await r.json()
      res.json({
        running: Array.isArray(data.queue_running) ? data.queue_running.length : 0,
        pending: Array.isArray(data.queue_pending) ? data.queue_pending.length : 0,
      })
    } catch {
      res.json({ running: 0, pending: 0, unreachable: true })
    }
  })

  app.post('/api/cancel', async (req, res, next) => {
    try {
      const promptId = typeof req.body?.promptId === 'string' ? req.body.promptId : ''
      if (promptId) {
        // /interrupt stops whatever is running, not a specific prompt. Only
        // interrupt when the caller's prompt is the one actually running;
        // otherwise leave another client's job alone.
        const q = await fetch(`${cfg.comfyuiUrl}/queue`, { signal: AbortSignal.timeout(5000) })
        const data = await q.json()
        const running = (data.queue_running || []).some((row) => row?.[1] === promptId)
        if (!running) return res.json({ ok: false, ignored: true })
      }
      const r = await fetch(`${cfg.comfyuiUrl}/interrupt`, { method: 'POST' })
      res.json({ ok: r.ok })
    } catch (err) {
      next(new HttpError(502, `Could not interrupt (${err.message})`))
    }
  })

  app.post('/api/generate', async (req, res, next) => {
    try {
      res.json(await runGeneration(req.body || {}))
    } catch (err) {
      next(err)
    }
  })

  app.get('/api/job/:promptId', async (req, res, next) => {
    try {
      const promptId = req.params.promptId
      const known = jobs.get(promptId)
      const item = await rawHistoryItem(promptId)
      if (!item) {
        let inQueue = false
        try {
          // /queue (not /prompt) is what exposes queue_running/queue_pending.
          const r = await fetch(`${cfg.comfyuiUrl}/queue`, { signal: AbortSignal.timeout(5000) })
          const q = await r.json()
          inQueue = [...(q.queue_running || []), ...(q.queue_pending || [])].some(
            (p) => p?.[0] === promptId,
          )
        } catch {
          /* fall through to known/404 */
        }
        if (inQueue || (known && !known.finishedAt)) {
          return res.json({
            promptId,
            status: known ? 'running' : 'queued',
            elapsedMs: known ? Date.now() - known.startedAt : 0,
          })
        }
        return res.status(404).json({
          promptId,
          status: 'unknown',
          error: 'promptId not found — it may have finished after the history was cleared',
        })
      }
      const error = extractHistoryError(item)
      const outputs = enrichOutputs(
        known?.mode || '',
        outputsOf(item, '/api/file', cfg.comfyuiUrl, known?.mode || ''),
      )
      const elapsedMs = known ? (known.finishedAt || Date.now()) - known.startedAt : 0
      if (error) {
        return res.json({ promptId, status: 'error', error, outputs, elapsedMs })
      }
      if (!hasOutputs(item) && (item.status || {}).completed !== true) {
        return res.json({ promptId, status: 'running', elapsedMs })
      }
      res.json({ promptId, status: 'complete', outputs, elapsedMs })
    } catch (err) {
      next(err)
    }
  })

  app.get('/api/file', async (req, res, next) => {
    try {
      const filename = String(req.query.filename || '')
      const subfolder = String(req.query.subfolder || '')
      const type = String(req.query.type || 'output')
      if (!filename || filename.includes('..') || subfolder.includes('..')) {
        throw new HttpError(400, 'filename is required (no path traversal)')
      }
      const u = new URL(`${cfg.comfyuiUrl}/view`)
      u.searchParams.set('filename', filename)
      u.searchParams.set('subfolder', subfolder)
      u.searchParams.set('type', type)
      const r = await fetch(u, { signal: AbortSignal.timeout(60000) })
      res.status(r.status)
      const ct = r.headers.get('content-type')
      if (ct) res.set('content-type', ct)
      const cl = r.headers.get('content-length')
      if (cl) res.set('content-length', cl)
      res.send(Buffer.from(await r.arrayBuffer()))
    } catch (err) {
      next(err)
    }
  })

  app.get('/api/hidden-ids', (req, res) => {
    res.json({ ids: readHidden() })
  })

  app.post('/api/hidden-ids', (req, res, next) => {
    try {
      const incoming = req.body?.ids
      if (!Array.isArray(incoming)) throw new HttpError(400, 'ids must be an array')
      const merged = writeHidden([...readHidden(), ...incoming.map(String)])
      res.json({ ids: merged })
    } catch (err) {
      next(err)
    }
  })

  app.delete('/api/hidden-ids', (req, res) => {
    writeHidden([])
    res.json({ ids: [] })
  })

  // error handler (must be last)
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || (err.type === 'entity.too.large' ? 413 : 500)
    res.status(status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) })
  })

  return app
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const port = Number(process.env.PORT || 5557)
  // Local runs bind to loopback by default; the Docker service sets
  // HOST=0.0.0.0 so nginx (and LAN clients) can reach it. Exposing the API
  // without API_KEY gives anyone on the network generation + history access.
  const host = process.env.HOST || '127.0.0.1'
  const app = createApp()
  app.listen(port, host, () => {
    console.log(`Studio API listening on ${host}:${port} → ComfyUI ${(process.env.COMFYUI_URL || 'http://10.1.1.102:8188')}`)
    // Idle unloading must keep working when no Studio tab is open. The
    // browser timer handles the same policy when it is awake; this one is
    // the backstop for a closed/backgrounded tab or a machine that slept.
    startIdleUnload({
      comfyuiUrl: process.env.COMFYUI_URL || 'http://10.1.1.102:8188',
      configPath: process.env.CONFIG_PATH || '/configdir/config.json',
    })
    if (!process.env.API_KEY) {
      console.warn(
        `[api] API_KEY is not set — every /api route is unauthenticated. ` +
          (host === '0.0.0.0' ? 'This process is reachable from the network.' : 'Loopback only by default; set HOST=0.0.0.0 to expose it.'),
      )
    }
  })
}
