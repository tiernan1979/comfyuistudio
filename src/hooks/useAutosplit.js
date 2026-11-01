import { useState } from 'react'
import {
  queuePrompt,
  pollHistory,
  checkNodes,
  stopGeneration,
  freeLoadedModels,
  saveBlobAs,
  uploadImage,
} from '../lib/comfyui'
import {
  buildAutoSplitWorkflow,
  AUTOSPLIT_NODES,
  AUTOSPLIT_NODE_HINTS,
} from '../lib/workflows'
import { autosplitSubfolder, findAutosplitResult, buildPartsManifest } from '../lib/split'
import { makeZip } from '../lib/zip'

const viewUrl = (base, filename, subfolder) =>
  `${base}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(
    subfolder || '',
  )}&type=output`

const SPLIT_TIMEOUT_MS = 25 * 60 * 1000

// Queue the SAM 3 split, then pull the part metadata + previews back from the
// server. The panel only renders state; every network step lives here so the
// JSX stays presentational.
export default function useAutosplit({ base, settings, getSourceFile }) {
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  const reset = () => {
    setResult(null)
    setError('')
  }

  const run = async (labels) => {
    setError('')
    setResult(null)
    const file = await getSourceFile()
    if (!file) {
      setError('Add an image first.')
      return
    }
    if (!labels.length) {
      setError('Add at least one part label.')
      return
    }
    setBusy(true)
    try {
      setStage('Checking nodes…')
      const { missing, unreachable } = await checkNodes(base, AUTOSPLIT_NODES)
      if (unreachable) throw new Error('Could not reach ComfyUI — check the server URL in Settings.')
      if (missing.length) {
        throw new Error(
          'The splitter needs node pack(s) that are not installed: ' +
            missing.map((c) => AUTOSPLIT_NODE_HINTS[c] || c).join('; ') +
            '. Install them in custom_nodes/ and restart ComfyUI.',
        )
      }

      setStage('Uploading image…')
      const uploaded = await uploadImage(base, file)
      const runId = 'studio-' + Date.now().toString(36)
      const wf = buildAutoSplitWorkflow({
        imageName: uploaded.name,
        labels,
        characterName: settings.characterName || 'character',
        outputDirectory: settings.outputDirectory || 'split_parts_sam3',
        runId,
        padding: settings.padding,
        confidence: settings.confidence,
        retryConfidence: settings.retryConfidence,
        sam3Model: settings.sam3Model || 'sam3.pt',
        depthModel: settings.depthModel || 'depth_anything_v2_vitl.pth',
      })

      setStage('Queued — SAM 3 is segmenting…')
      const pid = await queuePrompt(base, wf)
      const entry = await pollHistory(base, pid, {
        label: 'SAM 3 split',
        timeoutMs: SPLIT_TIMEOUT_MS,
        onTick: (secs, info) => setStage(`SAM 3 splitting… ${secs}s (${info.phase || 'running'})`),
      })

      const ui = findAutosplitResult(entry)
      if (!ui) throw new Error('The orchestrator returned no parts — check the ComfyUI log.')

      const outputDirectory = settings.outputDirectory || 'split_parts_sam3'
      const subfolder = autosplitSubfolder(ui.folder, outputDirectory, runId)

      setStage('Fetching part metadata…')
      const metaRes = await fetch(viewUrl(base, 'parts_metadata.json', subfolder))
      if (!metaRes.ok) throw new Error(`Could not read parts_metadata.json (HTTP ${metaRes.status})`)
      const meta = await metaRes.json()
      const manifest = buildPartsManifest(meta, settings.characterName)
      const byFile = new Map(manifest.parts.map((m) => [m.file, m]))

      setStage('Loading part images…')
      const parts = (meta.parts || [])
        .slice()
        .sort((a, b) => (a.draw_index ?? 0) - (b.draw_index ?? 0))
        .map((p) => {
          const m = byFile.get(p.file)
          return {
            name: p.tag,
            file: p.file,
            z: p.draw_index ?? 0,
            score: p.score ?? null,
            url: viewUrl(base, p.file, subfolder),
            offset: m?.offset || [0, 0],
            size: m?.size || [0, 0],
          }
        })

      setResult({ canvas: manifest.canvas, subfolder, parts, missing: manifest.missing, manifest })
      setStage('')
    } catch (err) {
      console.error('split failed', err)
      setError(err.message || 'Split failed.')
      setStage('')
    } finally {
      // Free the SAM 3 + depth models even when the run failed; they are big
      // and the next mode will want the VRAM back.
      try {
        await freeLoadedModels(base)
      } catch {
        /* ignore */
      }
      setBusy(false)
    }
  }

  const stop = async () => {
    try {
      await stopGeneration(base)
    } catch {
      /* ignore */
    }
  }

  const downloadZip = async () => {
    if (!result) return
    setStage('Zipping parts…')
    try {
      const character = result.manifest.character || 'character'
      const files = []
      for (const p of result.parts) {
        const res = await fetch(viewUrl(base, p.file, result.subfolder))
        if (!res.ok) throw new Error(`${p.file}: HTTP ${res.status}`)
        files.push({ name: `${character}/${p.file}`, data: new Uint8Array(await res.arrayBuffer()) })
      }
      files.push({
        name: `${character}/parts.json`,
        data: new TextEncoder().encode(JSON.stringify(result.manifest, null, 2)),
      })
      saveBlobAs(makeZip(files), `${character}_parts.zip`)
    } catch (err) {
      setError(`Zip failed: ${err.message}`)
    } finally {
      setStage('')
    }
  }

  const downloadManifest = () => {
    if (!result) return
    saveBlobAs(
      new Blob([JSON.stringify(result.manifest, null, 2)], { type: 'application/json' }),
      `${result.manifest.character || 'character'}_parts.json`,
    )
  }

  return {
    busy,
    stage,
    error,
    result,
    reset,
    setError,
    run,
    stop,
    downloadZip,
    downloadManifest,
  }
}
