#!/usr/bin/env node
// ComfyUI Studio — MCP stdio server.
//
// Drives generation through the Studio REST API (api/ service, default
// http://localhost:5557). Configure with:
//
//   STUDIO_API_URL       API base URL   (default http://localhost:5557)
//   STUDIO_API_KEY       Bearer key     (default: none)
//
// stdout is reserved for the MCP protocol — diagnostics go to stderr.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const API_URL = (process.env.STUDIO_API_URL || process.env.COMFYUI_STUDIO_API || 'http://localhost:5557').replace(
  /\/+$/,
  '',
)
const API_KEY = process.env.STUDIO_API_KEY || process.env.COMFYUI_STUDIO_API_KEY || ''

const GENERATE_TIMEOUT_MS = 16 * 60 * 1000 // just over the API's 15min default
const FLOW_TIMEOUT_MS = 50 * 60 * 1000 // 3D flows: mesh 30min / paint 25min / ultrashape 45min
const SHORT_TIMEOUT_MS = 30 * 1000

async function api(pathname, { method = 'GET', body, timeoutMs = SHORT_TIMEOUT_MS } = {}) {
  const headers = {}
  if (body) headers['content-type'] = 'application/json'
  if (API_KEY) headers.authorization = `Bearer ${API_KEY}`
  let res
  try {
    res = await fetch(`${API_URL}${pathname}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error(`Studio API timed out after ${Math.round(timeoutMs / 1000)}s (${API_URL}${pathname})`)
    }
    throw new Error(`Cannot reach the Studio API at ${API_URL} (${err.message}) — is \`studio-api\` running?`)
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Studio API HTTP ${res.status} on ${method} ${pathname}`)
  return data
}

function reply(data, isError = false) {
  return {
    content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
    ...(isError ? { isError: true } : {}),
  }
}

const server = new McpServer({ name: 'comfyui-studio', version: '1.0.0' })

function tool(name, description, shape, handler) {
  server.tool(name, description, shape, async (args) => {
    try {
      return reply(await handler(args || {}))
    } catch (err) {
      return reply(`Error: ${err.message}`, true)
    }
  })
}

const waitSchema = z
  .boolean()
  .optional()
  .describe('true (default) = block until the generation finishes; false = return the promptId immediately')

// Fields the API reads from the request ROOT; everything else is a per-mode
// generation setting (steps, cfg, resolution, duration, upscale, 3D knobs…)
// and must travel under body.settings — root-level extras are ignored.
const ROOT_KEYS = new Set([
  'prompt',
  'negativePrompt',
  'lyrics',
  'imageBase64',
  'mesh',
  'meshBase64',
  'wait',
  'timeoutSec',
])

async function generate(mode, args, timeoutMs) {
  const { video_lora, ...rest } = args
  const body = { mode }
  const settings = {}
  for (const [k, v] of Object.entries(rest)) {
    if (v === undefined) continue
    if (ROOT_KEYS.has(k)) body[k] = v
    else settings[k] = v
  }
  if (Object.keys(settings).length) body.settings = settings
  // Optional H3 turbo LoRA → model override (file must be in models/loras).
  if (video_lora) body.models = { video: { lora: video_lora } }
  const out = await api('/api/generate', {
    method: 'POST',
    body,
    timeoutMs: timeoutMs || (args.wait === false ? SHORT_TIMEOUT_MS : GENERATE_TIMEOUT_MS),
  })
  if (args.wait === false) return out
  const files = (out.outputs || []).map((o) => ({
    kind: o.kind,
    filename: o.filename,
    url: `${API_URL}${o.url}`,
    comfyuiUrl: o.comfyuiUrl,
  }))
  return {
    ok: out.ok,
    promptId: out.promptId,
    mode: out.mode,
    elapsedMs: out.elapsedMs,
    files,
    models: out.models,
    ...(out.error ? { warning: out.error } : {}),
  }
}

tool(
  'generate_image',
  'Generate an image with the Studio image model (Qwen-Image on the ComfyUI server). Blocks until finished and returns the file URL.',
  {
    prompt: z.string().describe('Text description of the image to generate'),
    negativePrompt: z.string().optional().describe('What to avoid'),
    aspectRatio: z
      .enum(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'])
      .optional()
      .describe('Output aspect ratio (default 1:1)'),
    steps: z.number().int().min(1).max(60).optional(),
    cfg: z.number().min(0).max(20).optional(),
    seed: z.number().int().optional().describe('-1 (default) = random'),
    turboMode: z.boolean().optional().describe('Faster/fewer-step sampling when supported'),
    upscale: z
      .string()
      .optional()
      .describe(
        "Detail upscale after generation: 'auto' (picks 4x-UltraSharp if installed) or an exact model filename from the server's models/upscale_models/, e.g. '4x-UltraSharp.pth'",
      ),
    wait: waitSchema,
  },
  (args) => generate('image', args),
)

tool(
  'edit_image',
  'Edit an existing image (Qwen-Image-Edit). Requires the input image as base64 (data URL or raw base64). Blocks until finished.',
  {
    prompt: z.string().describe('What to change in the image'),
    imageBase64: z
      .string()
      .describe('Input image as a data URL (data:image/png;base64,...) or raw base64 — sent to the server, not stored'),
    negativePrompt: z.string().optional(),
    steps: z.number().int().min(1).max(60).optional(),
    cfg: z.number().min(0).max(20).optional(),
    seed: z.number().int().optional().describe('-1 (default) = random'),
    wait: waitSchema,
  },
  (args) => generate('edit', args),
)

tool(
  'generate_video',
  'Generate a short video (Wan2.1 t2v on the ComfyUI server). Slow (minutes). Blocks until finished.',
  {
    prompt: z.string().describe('Text description of the video'),
    negativePrompt: z.string().optional(),
    resolution: z.enum(['480p', '720p', '1080p-fast', '1080p']).optional().describe('Default 480p (faster). 1080p-fast samples at 960×544 and upscales to 1080p (fast, slightly softer). Native 1080p is very slow on 16GB RAM — keep clips short'),
    frames: z.number().int().min(9).max(121).optional().describe('Frame count (default 33 ≈ 2s at 16fps)'),
    fps: z.number().int().min(4).max(30).optional(),
    steps: z.number().int().min(1).max(60).optional(),
    video_lora: z.string().optional().describe('Optional H3 turbo LoRA filename from the server models/loras folder (e.g. a LightX2V/comfy-org 4-step turbo .safetensors). When set, use steps 4–8 for best quality/speed.'),
    cfg: z.number().min(0).max(20).optional(),
    seed: z.number().int().optional().describe('-1 (default) = random'),
    wait: waitSchema,
  },
  (args) => generate('video', args),
)

tool(
  'generate_music',
  'Generate music (MiniMax Music 3 or ACE-Step 1.5 on the ComfyUI server — the server picks per the selected model). Instrumental unless lyrics are given — vocals are always excluded when lyrics is empty. Blocks until finished.',
  {
    prompt: z
      .string()
      .describe('Style / instrumentation description (the main caption), e.g. "warm lo-fi hip hop beat, mellow electric piano"'),
    lyrics: z
      .string()
      .optional()
      .describe('Sung lyrics; omit or empty for purely instrumental music'),
    duration: z
      .number()
      .int()
      .min(10)
      .max(360)
      .optional()
      .describe('Seconds — track-length cap (planner may end the song earlier when the music does). Default 300'),
    steps: z.number().int().min(1).max(60).optional(),
    cfgScale: z.number().min(0).max(10).optional().describe('Guidance (default 1.5)'),
    quality: z.enum(['wav', '320k', 'V0', '128k']).optional().describe('MP3 quality / wav lossless (default 320k)'),
    seed: z.number().int().optional().describe('-1 (default) = random'),
    wait: waitSchema,
  },
  (args) => generate('music', args),
)

const meshRefSchema = z
  .object({
    filename: z.string().describe('GLB filename, e.g. outputs[0].filename from a prior generate_3d run'),
    subfolder: z.string().optional().describe('Output subfolder (e.g. "3d")'),
    type: z.enum(['output', 'input']).optional().describe('default output'),
  })
  .optional()
  .describe('A GLB already on the ComfyUI server (preferred for big meshes)')

const meshBytesSchema = z
  .string()
  .optional()
  .describe('Raw GLB bytes as data URL / base64 — keep ≤45MB (larger: use mesh.filename instead)')

tool(
  'generate_3d',
  'Generate a 3D mesh (GLB) from a picture with the local Pixal3D/TRELLIS.2 pipeline on the ComfyUI server. Blocks until the mesh is ready (5–30 min). Returns the GLB URL.',
  {
    imageBase64: z.string().describe('Source picture as data URL (data:image/png;base64,…) or raw base64'),
    meshMode: z.enum(['pixal3d', 'trellis2']).optional().describe('default pixal3d'),
    pixalSteps: z.number().int().min(1).max(100).optional().describe('shape sampler steps (default 20)'),
    pixalGuidance: z.number().min(0).max(20).optional().describe('shape guidance (default 7.5)'),
    pixalTextureSize: z.number().int().min(512).max(8192).optional().describe('UV atlas px (default 4096)'),
    pixalDecimation: z
      .number()
      .int()
      .min(5000)
      .max(5000000)
      .optional()
      .describe('triangle budget (default 300000)'),
    faceFix: z.boolean().optional().describe('face-focused enhance of the source picture first (default true)'),
  },
  (args) => generate('3d', args, FLOW_TIMEOUT_MS),
)

tool(
  'skin_mesh',
  'Skin an existing 3D mesh (GLB) from a picture with Hunyuan3D-Paint (PBR baseColor + metallic/roughness). Standalone — mesh comes from a prior generate_3d run or meshBase64. Blocks until the painted mesh is ready (2–10 min).',
  {
    imageBase64: z.string().describe('Source picture the texture is painted from (data URL or raw base64)'),
    mesh: meshRefSchema,
    meshBase64: meshBytesSchema,
    hunyuanViewSize: z
      .number()
      .int()
      .min(512)
      .max(1024)
      .optional()
      .describe('per-view render px: 512 standard / 768 high / 1024 ultra (default 768)'),
    hunyuanTextureSize: z.number().int().min(512).max(8192).optional().describe('paint atlas px (default 4096)'),
    hunyuanPaintSteps: z.number().int().min(1).max(100).optional().describe('paint diffusion steps (default 12)'),
    hunyuanGuidance: z.number().min(0).max(20).optional().describe('photo adherence (default 3)'),
  },
  (args) => generate('skin', args, FLOW_TIMEOUT_MS),
)

tool(
  'upscale_mesh',
  'Refine/upscale an existing 3D mesh (GLB) with UltraShape 1.0 — guided by the source picture (local, free). Blocks until the refined mesh is ready (5–45 min).',
  {
    imageBase64: z.string().describe('The original source picture (data URL or raw base64)'),
    mesh: meshRefSchema,
    meshBase64: meshBytesSchema,
    ultrashapeSteps: z.number().int().min(10).max(200).optional().describe('diffusion steps (default 20)'),
    ultrashapeGuidance: z.number().min(1).max(15).optional().describe('image conditioning strength (default 5)'),
    ultrashapeOctree: z
      .number()
      .int()
      .min(256)
      .max(2048)
      .optional()
      .describe('detail resolution — 384 ≈ 8GB VRAM, 512 ≈ 16GB (default 384)'),
  },
  (args) => generate('meshupscale', args, FLOW_TIMEOUT_MS),
)

tool(
  'get_models',
  'List the model files available on the ComfyUI server (unet / clip / vae / lora per mode) plus the defaults the API would use.',
  {},
  () => api('/api/models'),
)

tool(
  'get_history',
  'Read generation history from ComfyUI (newest first). Ids hidden via the shared hidden-ids list are excluded.',
  {
    limit: z.number().int().min(1).max(300).optional().describe('Max entries (default 60)'),
  },
  ({ limit }) => api(limit ? `/api/history?limit=${limit}` : '/api/history'),
)

tool(
  'get_queue',
  'Show how many prompts are running / pending on the ComfyUI server.',
  {},
  () => api('/api/queue'),
)

tool(
  'get_job',
  'Check (or wait for) one generation by promptId. wait=true blocks until it finishes (use after generate_* with wait=false).',
  {
    promptId: z.string().describe('The promptId returned by generate_* with wait=false'),
    wait: z.boolean().optional().describe('Poll until finished (default false = single check)'),
    timeoutSec: z.number().int().min(5).max(3600).optional().describe('Max wait when wait=true (default 900)'),
  },
  async ({ promptId, wait, timeoutSec }) => {
    const deadline = Date.now() + (timeoutSec || 900) * 1000
    for (;;) {
      const state = await api(`/api/job/${encodeURIComponent(promptId)}`, {
        timeoutMs: Math.min(SHORT_TIMEOUT_MS, Math.max(5000, deadline - Date.now())),
      })
      if (!wait || state.status === 'complete' || state.status === 'error') return state
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for prompt ${promptId} — check again with get_job`)
      }
      await new Promise((r) => setTimeout(r, 3000))
    }
  },
)

tool(
  'cancel',
  'Interrupt the currently running generation on the ComfyUI server.',
  {},
  () => api('/api/cancel', { method: 'POST' }),
)

tool(
  'get_status',
  'Health of the Studio API + the ComfyUI server it proxies (use first to verify connectivity).',
  {},
  async () => {
    const [health, queue] = await Promise.all([api('/api/health'), api('/api/queue')])
    return { ...health, queue }
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)
console.error(`comfyui-studio MCP ready → ${API_URL}`)
