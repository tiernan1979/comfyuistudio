export async function downloadFile(url) {
  const res = await fetch(url)
  return await res.blob()
}

// Upload an image to ComfyUI's input folder so LoadImage can use it.
// Returns { name, subfolder, type }. Timestamped to avoid collisions.
export async function uploadImage(serverUrl, file) {
  const form = new FormData()
  const uniqueName = `edit-${Date.now()}-${file.name}`
  form.append('image', file, uniqueName)
  form.append('overwrite', 'true')
  let res
  try {
    res = await fetch(`${serverUrl}/upload/image`, {
      method: 'POST',
      body: form,
    })
  } catch (err) {
    throw new Error(`Could not upload image (${err.message})`)
  }
  if (!res.ok) {
    throw new Error(`Image upload failed (HTTP ${res.status})`)
  }
  const data = await res.json()
  if (!data.name) {
    throw new Error('ComfyUI did not accept the image upload.')
  }
  return data
}

// Upload an audio file into input/ so LoadAudio's combo accepts the name
// (uploadImage prefixes with "edit-" and omits type=input, which is aimed
// at image loaders). Returns the filename for the LoadAudio `audio` socket.
//
// Long-reference sampling is handled server-side by the ReferenceAudioPrep
// custom node (comfy_nodes/ReferenceAudioPrep.py) when installed — it
// replicates ACE-Step's backend behaviour of sampling three 10 s windows
// into a 30 s clip. Without the node the full file is uploaded and the
// native path truncates to the generation length.
export async function uploadAudioFile(serverUrl, file) {
  const form = new FormData()
  const safe = String(file.name || 'ref.wav').replace(/[^\w.\-]+/g, '_')
  const uniqueName = `ref-${Date.now()}-${safe}`
  form.append('image', file, uniqueName)
  form.append('type', 'input')
  form.append('overwrite', 'true')
  let res
  try {
    res = await fetch(`${serverUrl}/upload/image`, { method: 'POST', body: form })
  } catch (err) {
    throw new Error(`Could not upload reference audio (${err.message})`)
  }
  if (!res.ok) {
    const hint = res.status === 413 ? ' — file too large for the server limit' : ''
    throw new Error(`Reference audio upload failed (HTTP ${res.status})${hint}`)
  }
  const data = await res.json()
  if (!data.name) throw new Error('ComfyUI did not accept the audio upload.')
  return data.name
}

// Fetch the actual model files present on the ComfyUI server.
// /object_info/<LoaderClass> includes the valid combo values, e.g.
// UNETLoader.input.required.unet_name[0] === ["model_a.safetensors", ...]
//
// Cached for a few minutes: every Generate runs assertModelsAvailable() and

// Refuse to treat an HTML error page (e.g. an SPA fallback) as a mesh —
// that would silently upload garbage that only fails much later.
export async function assertMeshBytes(blob, filename) {
  if (/\.glb$/i.test(filename)) {
    const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer())
    const magic = String.fromCharCode(head[0], head[1], head[2], head[3])
    if (magic !== 'glTF') {
      throw new Error(
        `"${filename}" isn't a GLB file (got ${blob.size} bytes starting with ${JSON.stringify(magic)}) — ` +
          `the download probably returned an error page instead of the mesh`
      )
    }
  } else if (/\.fbx$/i.test(filename)) {
    const head = new Uint8Array(await blob.slice(0, 20).arrayBuffer())
    let magic = ''
    for (const b of head) magic += String.fromCharCode(b)
    if (!magic.startsWith('Kaydara')) {
      throw new Error(`"${filename}" isn't an FBX file (got ${blob.size} bytes) — refusing to upload it`)
    }
  }
}

// Upload a mesh file into ComfyUI's input/3d/ so UniRigLoadMesh can load it.
// Returns the stored filename (name returned by the server).
export async function uploadMeshFile(base, filename, blob) {
  await assertMeshBytes(blob, filename)
  const form = new FormData()
  form.append('image', blob, filename)
  form.append('subfolder', '3d')
  form.append('type', 'input')
  form.append('overwrite', 'true')
  let res
  try {
    res = await fetch(`${base}/upload/image`, { method: 'POST', body: form })
  } catch (err) {
    throw new Error(`could not upload mesh (${err.message})`)
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 160)
    const hint =
      res.status === 413
        ? ' — file exceeds ComfyUI\'s request-body limit; raise it by restarting ComfyUI with --max-upload-size 400, or lower the triangle budget/texture size'
        : ''
    throw new Error(`mesh upload failed (HTTP ${res.status}${hint})${detail ? `: ${detail}` : ''}`)
  }
  const data = await res.json()
  if (!data.name) throw new Error('ComfyUI did not accept the mesh upload')
  return data.name
}

// Drop every model ComfyUI holds on the GPU (weights → CPU, cache evicted).
// Callers use this so the NEXT queued run starts with an empty VRAM budget:
// leftover models from another pipeline (e.g. WanVAE after an image run
// still resident when a 300s music job starts) are a common OOM cause.
// Best effort — VRAM state must never fail a run. Resolves true when the
// server accepted the free request.
export async function freeLoadedModels(serverUrl) {
  try {
    const res = await fetch(`${serverUrl}/free`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
      signal: AbortSignal.timeout(8000),
    })
    return res.ok
  } catch {
    /* best effort */
    return false
  }
}

// Save a Blob as a browser download.
export function saveBlobAs(blob, saveName) {
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = saveName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 30000)
}

// Trigger a browser download of a ComfyUI output/input file.
export async function downloadFileAs(url, saveName) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`)
  saveBlobAs(await res.blob(), saveName)
}
