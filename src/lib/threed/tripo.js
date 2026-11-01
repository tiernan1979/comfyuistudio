// Tripo cloud pipeline: image → model → rig → retargeted preset animation.
import { assertWorkflowNodes, collectOutputFiles, pollHistory, queuePrompt, uploadImage } from '../comfyui.js'
import { buildTripoWorkflow } from '../workflows.js'
import { TIMEOUTS, describeNode, nodeLabels, statusLine } from './shared.js'

export async function runTripo(base, file, cfg, preset, onStatus) {
  onStatus?.('Uploading image…')
  const up = await uploadImage(base, file)
  const wf = buildTripoWorkflow({
    imageName: up.name,
    modelVersion: cfg.tripoModelVersion,
    rigVersion: cfg.tripoRigVersion,
    rigType: cfg.tripoRigType,
    spec: cfg.tripoSpec,
    outFormat: cfg.tripoOutFormat,
    preset,
    textureQuality: cfg.tripoTextureQuality || 'standard',
    geometryQuality: cfg.tripoGeometryQuality || 'standard',
    textureAlignment: cfg.tripoTextureAlignment || 'original_image',
    pbr: cfg.tripoPbr !== false,
  })
  await assertWorkflowNodes(base, wf, { label: 'Tripo 3D pipeline', describe: describeNode })
  onStatus?.('Queued — Tripo generates, rigs and animates in the cloud (needs ComfyUI signed in to comfy.org)…')
  const id = await queuePrompt(base, wf)
  const entry = await pollHistory(base, id, {
    timeoutMs: TIMEOUTS.tripo,
    label: 'Tripo pipeline',
    nodes: nodeLabels(wf),
    onTick: (s, info) => onStatus?.(statusLine('Tripo: generate → rig → animate', s, info)),
  })

  const files = collectOutputFiles(entry).filter((f) => /\.(glb|fbx)$/i.test(f.filename))
  if (files.length === 0) {
    throw new Error(
      'Tripo job succeeded but no model file appeared in ComfyUI output. ' +
        'If this repeats, check that ComfyUI is signed in to comfy.org (Settings → API keys) and inspect the ComfyUI console.'
    )
  }
  return files
}
