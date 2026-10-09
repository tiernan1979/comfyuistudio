// Server-side AI stem separation for the music editor.
//
// Chain (validated end-to-end against the live server on a 3:33 track,
// ~90 s total):  LoadAudio → htdemucs 6-source split →
//   vocals → UVR Karaoke   → lead + backing
//   other  → FoxJoy Reverb → dry + reverb tail
// plus the demucs drums/bass/guitar/piano branches, saved as MP3 320k.
//
// The DSP split in stems.js remains the fallback when these node packs
// aren't installed — MusicEditor probes aiStemsAvailable() and shows the
// install hint on failure.

import {
  checkNodes,
  getNodeComboOptions,
  freeLoadedModels,
  queuePrompt,
  pollHistory,
  collectOutputFiles,
  getViewUrl,
  downloadFile,
} from './comfyui.js'

export const AI_STEM_NODES = [
  'LoadAudio',
  'AudioSeparateDemucs',
  'AudioSeparateVocals',
  'AudioSeparateVarious',
  'SaveAudioMP3',
]

// node/idx = which separation output feeds this stem (workflow node ids are
// fixed in composeAiWorkflow).  Other/Reverb come from the Reverb-HQ model:
// Main (0) carries the dry sustained content (crest 8.2, 2nd/1st half 0.80),
// Complement (1) the decaying tail (crest 7.2, 2nd/1st half 0.36).
export const AI_STEM_DEFS = [
  { key: 'drums', name: 'Drums', color: '#fb923c', node: '2', idx: 1 },
  { key: 'bass', name: 'Bass', color: '#f472b6', node: '2', idx: 2 },
  { key: 'guitar', name: 'Guitar', color: '#a78bfa', node: '2', idx: 4 },
  { key: 'piano', name: 'Piano', color: '#facc15', node: '2', idx: 5 },
  { key: 'other', name: 'Other', color: '#94a3b8', node: '4', idx: 1 },
  { key: 'reverb', name: 'Reverb', color: '#22d3ee', node: '4', idx: 0 },
  { key: 'lead', name: 'Lead', color: '#34d399', node: '3', idx: 0 },
  { key: 'backing', name: 'Backing', color: '#86efac', node: '3', idx: 1 },
]

export async function aiStemsAvailable(base) {
  const { missing, unreachable } = await checkNodes(base, AI_STEM_NODES)
  return { ok: !unreachable && missing.length === 0, missing, unreachable }
}

// Pure builder — composes the full graph once the three model combo values
// are resolved.  Save nodes land at 20+i; filename_prefix per stem lets the
// downloader map history files back to keys via "<key>_00001.mp3".
export function composeAiWorkflow(uploadedName, models, tag) {
  const { demucs, karaoke, reverb } = models
  const wf = {
    1: { class_type: 'LoadAudio', inputs: { audio: uploadedName } },
    2: {
      class_type: 'AudioSeparateDemucs',
      inputs: {
        input_sound: ['1', 0],
        model: demucs,
        shifts: 0,
        overlap: 0.25,
        custom_segment: false,
        segment: 44,
        target_device: 'cuda',
      },
    },
    3: {
      class_type: 'AudioSeparateVocals',
      inputs: { input_sound: ['2', 0], model: karaoke, segments: 1, target_device: 'cuda' },
    },
    4: {
      class_type: 'AudioSeparateVarious',
      inputs: { input_sound: ['2', 3], model: reverb, segments: 1, target_device: 'cuda' },
    },
  }
  AI_STEM_DEFS.forEach((def, i) => {
    wf[String(20 + i)] = {
      class_type: 'SaveAudioMP3',
      inputs: {
        audio: [def.node, def.idx],
        filename_prefix: `aistems/${tag}/${def.key}`,
        quality: '320k',
      },
    }
  })
  return wf
}

// Model combos list every remote model with a ⬇️ marker AND a 💾 copy once
// it's on disk — always prefer the 💾 entry so a run never triggers a
// re-download (or, worse, fails while the ⬇️ twin is mid-download).
export function pickModelFromOptions(opts, re) {
  const hits = opts.filter((m) => re.test(m))
  return hits.find((m) => m.includes('💾')) || hits[0] || null
}

async function pickModel(base, classType, field, re) {
  const opts = await getNodeComboOptions(base, classType, field)
  const pick = pickModelFromOptions(opts, re)
  if (!pick) {
    throw new Error(
      `no matching model for ${classType} on the server (looked for ${re}) — is set-soft/AudioSeparation installed?`
    )
  }
  return pick
}

async function resolveModels(base) {
  const [demucs, karaoke, reverb] = await Promise.all([
    pickModel(base, 'AudioSeparateDemucs', 'model', /6\s*sources/i),
    pickModel(base, 'AudioSeparateVocals', 'model', /karaoke/i),
    pickModel(base, 'AudioSeparateVarious', 'model', /reverb/i),
  ])
  return { demucs, karaoke, reverb }
}

// Upload into input/ with type=input so LoadAudio's combo accepts the name
// (uploadImage() in comfyui.js omits the type field and prefixes names with
// "edit-", which is aimed at image loaders).
async function uploadAudio(base, blob, name) {
  const form = new FormData()
  form.append('image', blob, name)
  form.append('type', 'input')
  form.append('overwrite', 'true')
  let res
  try {
    res = await fetch(`${base}/upload/image`, { method: 'POST', body: form })
  } catch (err) {
    throw new Error(`could not upload audio (${err.message})`)
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 160)
    throw new Error(`audio upload failed (HTTP ${res.status})${detail ? `: ${detail}` : ''}`)
  }
  const data = await res.json()
  if (!data.name) throw new Error('ComfyUI did not accept the audio upload')
  return data.name
}

// ComfyUI's default request-body cap is 100 MB (413 beyond it) — keep a
// safety margin below it for multipart framing.
const MAX_UPLOAD = 90 * 1024 * 1024
const mb = (n) => Math.round(n / (1024 * 1024))

// Resolve the workflow's input audio from exactly one source:
//   inputName — file already in ComfyUI's input/ → LoadAudio reads it
//               directly, zero upload;
//   originUrl — a /view URL of a file on the server: input/ files should
//               use inputName instead; output/ files are copied into
//               input/ by re-uploading their original bytes (ComfyUI has
//               no server-side copy endpoint and LoadAudio only lists
//               input/), which is far smaller than a WAV re-encode;
//   wavBlob   — stereo PCM WAV for clips added from local disk.
async function resolveInput(base, { wavBlob, inputName, originUrl }, tag, onPhase) {
  if (inputName) {
    onPhase?.(`AI split: using server file ${inputName}…`)
    return inputName
  }
  if (originUrl) {
    onPhase?.('AI split: reusing the original file from the server…')
    let res
    try {
      res = await fetch(originUrl)
    } catch (err) {
      throw new Error(`could not fetch the original audio (${err.message})`)
    }
    if (!res.ok) throw new Error(`could not fetch the original audio (HTTP ${res.status})`)
    const blob = await res.blob()
    if (blob.size > MAX_UPLOAD) {
      throw new Error(
        `the original file is ${mb(blob.size)} MB — over ComfyUI's 100 MB limit; trim or split the clip, or regenerate the track as MP3`
      )
    }
    let fn = 'audio'
    const m = /[?&]filename=([^&]+)/.exec(originUrl)
    if (m) {
      try {
        fn = decodeURIComponent(m[1])
      } catch {
        fn = m[1]
      }
    }
    fn = fn.split('/').pop().replace(/[^\w.-]+/g, '_')
    if (!/\.[a-z0-9]+$/i.test(fn)) fn += '.mp3'
    return uploadAudio(base, blob, `aistems-${tag}-${fn}`)
  }
  if (wavBlob) {
    if (wavBlob.size > MAX_UPLOAD) {
      throw new Error(
        `the clip's WAV is ${mb(wavBlob.size)} MB — over ComfyUI's 100 MB upload limit; trim or split the clip first, or open the audio from ComfyUI history so its original file can be reused`
      )
    }
    onPhase?.('AI split: uploading audio…')
    return uploadAudio(base, wavBlob, `aistems-${tag}.wav`)
  }
  throw new Error('separateBufferAI needs one of inputName, originUrl or wavBlob')
}

// Run the full chain for one clip — see resolveInput() for the three audio
// sources.  wavBlob must be stereo (AudioSeparateDemucs' demixer crashes on
// mono input with "'DemixerDemucs' object has no attribute 'ch'" — verified
// against the live server; MusicEditor upmixes via toStereoWav before
// calling).  onPhase: progress callback (drives the editor's busy string);
// returns Map<key, Blob> of the MP3 stems.  Best-effort history cleanup
// afterwards.
export async function separateBufferAI({ base, wavBlob, inputName, originUrl, tag, onPhase }) {
  const uploaded = await resolveInput(base, { wavBlob, inputName, originUrl }, tag, onPhase)
  const models = await resolveModels(base)
  const wf = composeAiWorkflow(uploaded, models, tag)
  // Music jobs always start from an empty VRAM budget — leftovers from an
  // image/video run are the classic OOM cause.
  await freeLoadedModels(base)
  onPhase?.('AI split: queued…')
  const pid = await queuePrompt(base, wf)
  const entry = await pollHistory(base, pid, {
    label: 'AI stem split',
    timeoutMs: 600000,
    intervalMs: 2500,
    onTick: (secs, info) => {
      const what =
        info.phase === 'queued'
          ? `queued${info.queuePos ? ` (#${info.queuePos})` : ''}`
          : info.nodeLabel || 'separating'
      onPhase?.(`AI split: ${what} · ${secs}s`)
    },
  })
  onPhase?.('AI split: downloading stems…')
  const files = collectOutputFiles(entry)
  // Keep /history clean — every split would otherwise pile 8 saves on it.
  // /view reads the files from disk, so the entry can go before downloading.
  fetch(`${base}/history`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ delete: [pid] }),
  }).catch(() => {})
  const byKey = new Map()
  for (const f of files) {
    if (f.type !== 'output') continue
    const key = f.filename.replace(/_\d+\.(mp3|flac|wav)$/i, '')
    if (!AI_STEM_DEFS.some((d) => d.key === key)) continue
    const url = await getViewUrl(base, f.filename, f.subfolder, f.type)
    byKey.set(key, await downloadFile(url))
  }
  const missing = AI_STEM_DEFS.filter((d) => !byKey.has(d.key)).map((d) => d.key)
  if (missing.length) {
    throw new Error(`server returned no audio for: ${missing.join(', ')}`)
  }
  return byKey
}
