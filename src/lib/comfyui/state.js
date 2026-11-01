// Shared client state for the ComfyUI connection.
// The websocket, queue and preflight helpers all read the same request
// bookkeeping, so it lives in one module instead of being threaded through
// callbacks.
export const state = {
  socket: null,
  progressCallback: null,
  completionCallback: null,
  phaseCallback: null, // (label | null) — friendly name of the running node
  // promptId -> { nodeId: class_type } for prompts this client queued, so
  // WS "executing" messages can be labeled ("Decoding audio", "Sampling"…).
  promptNodes: new Map(),
  latestPromptId: null,
  clientId: generateUUID(),
}

const NODE_PHASE_LABELS = [
  [/^VAEDecodeAudio/, 'Decoding audio'],
  [/^VAEDecode/, 'Decoding output'],
  [/^VAEEncode/, 'Encoding input'],
  [/^SaveAudioMP3/, 'Encoding MP3'],
  [/^SaveAudio/, 'Encoding WAV'],
  [/^SaveImage/, 'Saving image'],
  [/^SaveAnimated|SaveVideo|CreateVideo|^VHS_VideoCombine|VideoCombine/, 'Encoding video'],
  [/KSampler|SamplerCustom|SDEuler|CFGGuider/, 'Sampling'],
  [/TextEncode|CLIPTextEncode/, 'Encoding text'],
  [/Loader|Checkpoint|UNET|Lora/, 'Loading models'],
  [/Upscal|ImageScale/, 'Upscaling'],
]

// Friendly status label for a node class, or null when we'd rather show
// the plain step counter than a noisy node name.
export function friendlyNodeLabel(classType) {
  if (!classType) return null
  for (const [re, label] of NODE_PHASE_LABELS) {
    if (re.test(classType)) return label
  }
  return null
}

// crypto.randomUUID() only exists in secure contexts (localhost/HTTPS).
// Fall back to a Math.random-based UUID when opened via plain HTTP on a LAN IP.
function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function getClientId() {
  return state.clientId
}
