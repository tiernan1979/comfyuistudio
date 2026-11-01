// MIA auto-rig pipeline (generated, imported or server-side meshes).
import { assertMeshBytes, assertWorkflowNodes, collectOutputFiles, freeLoadedModels, pollHistory, queuePrompt, uploadMeshFile } from '../comfyui.js'
import { buildMiaRigWorkflow } from '../workflows.js'
import { animationsNeedingRestart, fetchOutputBlob, probeAnimationFiles, probeServerFile } from './assets.js'
import { TIMEOUTS, describeNode, nodeLabels, statusLine } from './shared.js'

export async function runRigMesh(base, glbFile, cfg, animationFiles, onStatus) {
  onStatus?.('Downloading generated mesh…')
  const blob = await fetchOutputBlob(base, glbFile)
  return runRigFromBlob(base, blob, glbFile.filename, cfg, animationFiles, onStatus)
}

// Rig a .glb the user already has — skips Generate entirely.
export async function runRigImported(base, file, cfg, animationFiles, onStatus) {
  onStatus?.(`Validating ${file.name || 'mesh'}…`)
  // Force the GLB magic check even if the picked name lacks the extension.
  await assertMeshBytes(file, /\.glb$/i.test(file.name || '') ? file.name : 'mesh.glb')
  if (file.size > 64 * 1024 * 1024) {
    throw new Error(`"${file.name}" is ${(file.size / 1048576).toFixed(0)} MB — keep imported meshes under 64 MB`)
  }
  return runRigFromBlob(base, file, file.name || 'mesh.glb', cfg, animationFiles, onStatus)
}

// Rig a mesh file that already sits on the ComfyUI server — no upload at
// all. serverPath like '3d/hero.glb' (input/3d/) or a bare name in input/.
// Great for re-rigging earlier uploads without moving bytes again.
export async function runRigServerFile(base, serverPath, cfg, animationFiles, onStatus) {
  const clean = String(serverPath || '').trim().replace(/^\/+/, '')
  if (!clean) throw new Error('Type a server file path first, e.g. 3d/hero_character.glb')
  if (!/\.(glb|obj|fbx)$/i.test(clean)) {
    throw new Error(`"${clean}" doesn't look like a mesh — point at a .glb, .obj or .fbx on the server`)
  }
  onStatus?.(`Checking ${clean} on the server…`)
  const probe = await probeServerFile(base, clean)
  if (!probe) {
    throw new Error(
      `"${clean}" isn't on the ComfyUI server (looked in input/ and input/3d/) — ` +
        `upload the .glb with the file picker instead, or fix the path`
    )
  }
  return runRigWorkflow(base, probe.meshPath, cfg, animationFiles, onStatus)
}

// Unique upload name per run — MeshToolsLoad takes a free string path, so
// no fixed indexed name and no ComfyUI restart is ever needed.
function uniqueRigName(original) {
  const safe = String(original || 'mesh.glb')
    .split('/').pop()
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'mesh.glb'
  const withExt = /\.glb$/i.test(safe) ? safe : `${safe}.glb`
  return `rig_${Date.now().toString(36)}_${withExt}`
}

// Shared tail of the upload rig paths: upload under a unique name, run MIA
// (+ optional animations). No dropdown to satisfy — MeshToolsLoad reads any
// path, so this never needs a ComfyUI restart.
async function runRigFromBlob(base, blob, originalName, cfg, animationFiles, onStatus) {
  onStatus?.('Uploading mesh to ComfyUI input/3d…')
  const stored = await uploadMeshFile(base, uniqueRigName(originalName), blob)
  return runRigWorkflow(base, `3d/${stored}`, cfg, animationFiles, onStatus)
}

function normalizeAnimations(animationFiles) {
  return [].concat(animationFiles || []).map((a) => String(a || '').trim()).filter(Boolean)
}

async function runRigWorkflow(base, meshPath, cfg, animationFiles, onStatus) {
  const anims = normalizeAnimations(animationFiles)
  const animationType = cfg.animationType || 'mixamo'
  if (anims.length > 0) {
    // The animation picker is startup-cached, so it can list files that
    // were wiped from disk since — verify before queueing a doomed run.
    onStatus?.('Checking animation files on the server…')
    const { missing, available } = await probeAnimationFiles(base, anims, animationType)
    if (missing.length > 0) {
      throw new Error(
        `${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} selected but missing on disk ` +
          `(input/animation_templates/${animationType}/) — upload again via "Add animations…" or untick ` +
          `${missing.length > 1 ? 'them' : 'it'}.` +
          (available.length > 0 ? ` Available right now: ${available.join(', ')}.` : ' No animation files are on the server right now.')
      )
    }
    // Files uploaded since ComfyUI last started are on disk but not yet in the
    // node's animation dropdown, so the server would reject them at queue time.
    onStatus?.('Checking the animation list ComfyUI started with…')
    const needsRestart = await animationsNeedingRestart(base, anims, animationType)
    if (needsRestart.length > 0) {
      throw new Error(
        `${needsRestart.join(', ')} ${needsRestart.length > 1 ? 'were' : 'was'} uploaded but ComfyUI ` +
          `hasn't been restarted since, so the animation node doesn't offer ${needsRestart.length > 1 ? 'them' : 'it'} yet. ` +
          `Restart ComfyUI once, then re-run — the files are already in place.`
      )
    }
  }
  // torch_cluster's farthest-point-sampling kernel has no bf16/fp16 support
  // ("_ not implemented for 'BFloat16'"), and 'auto' resolves to bf16 on this
  // GPU — fp32 is the only precision the MIA coarse stage survives.
  const precision = 'fp32'
  if (cfg.miaPrecision && cfg.miaPrecision !== 'fp32') {
    onStatus?.(`Using fp32 precision — ${cfg.miaPrecision} crashes the rig's FPS kernel (saved setting overridden)…`)
  }
  const wf = buildMiaRigWorkflow({
    meshPath,
    precision,
    animationFiles: anims,
    animationType,
  })
  await assertWorkflowNodes(base, wf, { label: 'MIA auto-rig', describe: describeNode })
  onStatus?.('Unloading previous models…')
  await freeLoadedModels(base)
  onStatus?.(
    anims.length > 0
      ? `Queued — MIA auto-rig + ${anims.length} animation${anims.length > 1 ? 's' : ''} (takes a few minutes)…`
      : 'Queued — MIA auto-rig takes a few minutes…'
  )
  const id = await queuePrompt(base, wf)
  const entry = await pollHistory(base, id, {
    timeoutMs: TIMEOUTS.mia,
    label: 'MIA rig',
    nodes: nodeLabels(wf),
    onTick: (s, info) => onStatus?.(statusLine(anims.length > 0 ? 'rigging + animating' : 'rigging', s, info)),
  })

  const files = collectOutputFiles(entry).filter((f) => /\.(fbx|glb)$/i.test(f.filename))

  // ComfyUI v0.37 doesn't record string outputs in history, and MIA's
  // Preview node writes the FBX to output/ without a file entry — fall
  // back to the names the nodes construct (same as homeclaw does).
  const meshBase = meshPath.split('/').pop().replace(/\.[^.]+$/, '')
  const candidates = anims.length > 0
    ? anims.map((a) => `${meshBase}_${String(a).replace(/\.[^.]+$/, '')}.fbx`)
    : [`mia_${meshBase}_mia.fbx`, `mia_${meshBase}.fbx`, `${meshBase}.fbx`]
  for (const name of candidates) {
    if (!files.some((f) => f.filename === name)) {
      files.push({ filename: name, subfolder: '', type: 'output', key: 'constructed' })
    }
  }

  // Probe candidates (history files are trusted as-is) so the UI only ever
  // lists files that actually download; keep the first blob to avoid
  // re-fetching it when the user clicks Download.
  const verified = []
  for (const f of files) {
    if (f.key !== 'constructed') {
      verified.push(f)
      continue
    }
    try {
      const b = await fetchOutputBlob(base, f)
      verified.push({ ...f, blob: b })
    } catch {
      // constructed name didn't exist — skip it
    }
  }
  const real = verified.filter((f) => f.key !== 'constructed' || f.blob)
  if (real.length === 0) {
    throw new Error(
      'Rig finished but no FBX/GLB was found in ComfyUI output — check the ComfyUI console'
    )
  }
  return real
}

// Does this GLB actually carry a skin? (embedded images + UVs). Used to
// decide whether to run the texture-bake leg of the Upscale workflow —
// UltraShape itself outputs POSITION-only geometry with no materials.
