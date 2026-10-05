// ComfyUI Studio — LAN REST API (optional service, port 5557).
//
// Serves the same workflows the web app uses (src/lib/workflows.js) over a
// plain HTTP API so MCP clients and scripts can drive image / edit / video /
// music generation without a browser. Browser-only state (DAW sessions,
// saved prompts, per-device history view) is intentionally NOT exposed;
// cross-device history deletes are shared through hidden-ids instead.
//
//   GET  /api/health            service + ComfyUI reachability
//   GET  /api/models            model lists + resolved per-mode defaults
//   GET  /api/history           ComfyUI history (hidden-ids filtered out)
//   GET  /api/queue             ComfyUI queue depth
//   POST /api/cancel            interrupt the running prompt
//   POST /api/generate          run a generation (wait=true default, or wait=false + GET /api/job/:promptId)
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
  DEFAULT_SETTINGS,
  resolveModels,
  workflowFor,
  decodeDataUrl,
  outputsOf,
  hasOutputs,
} from './lib.mjs'
import {
  getModelLists,
  getServerHistory,
  uploadImage,
  queuePrompt,
  freeLoadedModels,
  extractHistoryError,
} from '../../src/lib/comfyui.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

class HttpError extends Error {
  constructor(status, message, details) {
    super(message)
    this.status = status
    this.details = details
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function createApp(opts = {}) {
  const cfg = {
    comfyuiUrl: (opts.comfyuiUrl || process.env.COMFYUI_URL || 'http://10.1.1.102:8188').replace(/\/+$/, ''),
    apiKey: opts.apiKey !== undefined ? opts.apiKey : process.env.API_KEY || '',
    dataDir: opts.dataDir || process.env.DATA_DIR || path.join(__dirname, '..', 'data'),
    timeoutMs: opts.timeoutMs || Number(process.env.GENERATE_TIMEOUT_MS || 15 * 60 * 1000),
    pollMs: opts.pollMs || 2000,
  }
  const hiddenFile = path.join(cfg.dataDir, 'hidden-ids.json')

  // In-memory map of prompts this service queued (promptId also works for
  // jobs from other clients via /history/:promptId after a restart).
  const jobs = new Map()

  const app = express()
  app.use(express.json({ limit: '64mb' }))
  app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*')
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Api-Key')
    res.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    if (req.method === 'OPTIONS') return res.sendStatus(204)
    next()
  })
  app.use('/api', (req, res, next) => {
    if (!cfg.apiKey) return next()
    const got =
      (req.get('authorization') || '').replace(/^Bearer\s+/i, '') || req.get('x-api-key') || ''
    if (got !== cfg.apiKey) return res.status(401).json({ error: 'invalid or missing API key' })
    next()
  })

  function readHidden() {
    try {
      const data = JSON.parse(fs.readFileSync(hiddenFile, 'utf8'))
      return Array.isArray(data.ids) ? data.ids : []
    } catch {
      return []
    }
  }

  function writeHidden(ids) {
    fs.mkdirSync(cfg.dataDir, { recursive: true })
    fs.writeFileSync(hiddenFile, JSON.stringify({ ids }, null, 2))
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

  async function runGeneration(body) {
    const mode = String(body?.mode || 'image').toLowerCase()
    if (!MODES.includes(mode)) {
      throw new HttpError(400, `mode must be one of: ${MODES.join(', ')}`)
    }
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
    if (!prompt) throw new HttpError(400, 'prompt is required')
    const negativePrompt = typeof body.negativePrompt === 'string' ? body.negativePrompt : ''
    const lyrics = typeof body.lyrics === 'string' ? body.lyrics : ''
    const settings = body.settings && typeof body.settings === 'object' ? body.settings : {}
    const modelOverrides = body.models && typeof body.models === 'object' ? body.models : {}
    const wait = body.wait !== false
    const timeoutMs = Math.min(
      Number(body.timeoutSec) > 0 ? Number(body.timeoutSec) * 1000 : cfg.timeoutMs,
      60 * 60 * 1000,
    )

    let lists
    try {
      lists = await getModelLists(cfg.comfyuiUrl, { force: true })
    } catch (err) {
      throw new HttpError(502, `Could not reach ComfyUI at ${cfg.comfyuiUrl} (${err.message})`)
    }
    let models
    try {
      models = resolveModels(lists, mode, modelOverrides)
    } catch (err) {
      throw new HttpError(502, err.message)
    }

    let imageName
    if (mode === 'edit') {
      if (!body.imageBase64) {
        throw new HttpError(400, 'imageBase64 is required for edit mode (data URL or raw base64)')
      }
      const { buf, mime } = decodeDataUrl(body.imageBase64)
      try {
        const up = await uploadImage(
          cfg.comfyuiUrl,
          new File([buf], 'edit-input.png', { type: mime }),
        )
        imageName = up.name
      } catch (err) {
        throw new HttpError(502, err.message)
      }
    }

    // Parity with the app: always free VRAM before MiniMax Music 3 — its AV
    // pass OOMs behind other loaded models (tiled decode handles the rest).
    if (mode === 'music') await freeLoadedModels(cfg.comfyuiUrl)

    const workflow = workflowFor(mode, { prompt, negativePrompt, lyrics, settings, models, imageName })
    let promptId
    try {
      promptId = await queuePrompt(cfg.comfyuiUrl, workflow)
    } catch (err) {
      throw new HttpError(502, err.message)
    }
    jobs.set(promptId, { mode, prompt, startedAt: Date.now() })

    if (!wait) return { ok: true, promptId, mode, status: 'queued' }

    const started = Date.now()
    const item = await waitForPrompt(promptId, timeoutMs)
    jobs.set(promptId, { ...(jobs.get(promptId) || { startedAt: started }), finishedAt: Date.now() })
    return {
      ok: true,
      promptId,
      mode,
      elapsedMs: Date.now() - started,
      outputs: outputsOf(item, '/api/file', cfg.comfyuiUrl),
      settings: { ...DEFAULT_SETTINGS[mode], ...settings },
      models,
      error: extractHistoryError(item) || null,
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
      const entries = await getServerHistory(cfg.comfyuiUrl, limit)
      const hidden = new Set(readHidden().map(String))
      res.json({ entries: entries.filter((e) => !hidden.has(String(e.id))) })
    } catch (err) {
      next(new HttpError(502, `Could not read ComfyUI history (${err.message})`))
    }
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
          const r = await fetch(`${cfg.comfyuiUrl}/prompt`, { signal: AbortSignal.timeout(5000) })
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
      const outputs = outputsOf(item, '/api/file', cfg.comfyuiUrl)
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
      const merged = [...new Set([...readHidden(), ...incoming.map(String)])]
      writeHidden(merged)
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
  const app = createApp()
  app.listen(port, () => {
    console.log(`Studio API listening on :${port} → ComfyUI ${(process.env.COMFYUI_URL || 'http://10.1.1.102:8188')}`)
  })
}
