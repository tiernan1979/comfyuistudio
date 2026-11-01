// ---------------------------------------------------------------------------
// 2D part splitting (ComfyUI-AutoSplit-Orchestrator + SAM 3).
//
// One flat character image → named, z-ordered part PNGs + parts_metadata.json
// (bbox in full-image space + draw order). Node ids are stable so the panel can
// read the run's folder off the orchestrator's `ui.autosplit` output.
// ---------------------------------------------------------------------------
export const AUTOSPLIT_NODES = [
  'DepthAnythingV2Preprocessor',
  'easy sam3ModelLoader',
  'AutoSplitOrchestratorSAM3',
]

export const AUTOSPLIT_NODE_HINTS = {
  DepthAnythingV2Preprocessor: 'comfyui_controlnet_aux (Depth Anything V2)',
  'easy sam3ModelLoader': 'ComfyUI-Easy-Sam3',
  AutoSplitOrchestratorSAM3: 'ComfyUI-AutoSplit-Orchestrator',
}

// SAM 3 segments what it can SEE, so prompt visible things: on a clothed body
// "torso"/"chest" find nothing (the shirt covers them) — use the garment name
// (or an underwear base). "shin"/"calf"/"pelvis"/"waist" never resolve.
// Limbs split at the elbow/knee so every PNG is one rig segment: the upper
// label owns the joint, the lower label starts below it. `coarse` keeps
// whole-limb labels for a fast blockout.
export const AUTOSPLIT_LABEL_PRESETS = {
  anatomy: [
    'head', 'hair', 'face', 'neck', 'torso',
    'upper arm', 'lower arm', 'hand',
    'underwear', 'upper leg', 'lower leg', 'foot',
  ],
  armour: [
    'helmet', 'breastplate', 'left pauldron', 'right pauldron',
    'left gauntlet', 'right gauntlet', 'left greave', 'right greave',
    'left boot', 'right boot', 'belt',
  ],
  coarse: ['head', 'hair', 'torso', 'arm', 'hand', 'leg', 'foot'],
}

// Labels auto-split into _left/_right by connected components. Matches the
// preset above (each limb segment is found on both sides at once).
export const AUTOSPLIT_LR_LABELS = ['upper arm', 'lower arm', 'hand', 'upper leg', 'lower leg', 'foot']

export function buildAutoSplitWorkflow({
  imageName,
  labels = AUTOSPLIT_LABEL_PRESETS.anatomy,
  characterName = 'character',
  outputDirectory = 'split_parts_sam3',
  runId = '',
  padding = 8,
  confidence = 0.3,
  retryConfidence = 0.2,
  autoLrLabels = AUTOSPLIT_LR_LABELS,
  sam3Model = 'sam3.pt',
  depthModel = 'depth_anything_v2_vitl.pth',
}) {
  return {
    img: { class_type: 'LoadImage', inputs: { image: imageName } },
    depth: {
      class_type: 'DepthAnythingV2Preprocessor',
      inputs: { image: ['img', 0], ckpt_name: depthModel, resolution: 1024 },
    },
    sam3: {
      class_type: 'easy sam3ModelLoader',
      inputs: { model: sam3Model, segmentor: 'image', device: 'cuda', precision: 'fp32' },
    },
    split: {
      class_type: 'AutoSplitOrchestratorSAM3',
      inputs: {
        image: ['img', 0],
        depth_map: ['depth', 0],
        sam3_model: ['sam3', 0],
        part_labels: (Array.isArray(labels) ? labels : String(labels).split('\n'))
          .map((s) => String(s).trim())
          .filter(Boolean)
          .join('\n'),
        character_name: characterName,
        output_directory: outputDirectory,
        run_id: runId,
        padding,
        confidence_threshold: confidence,
        occlusion_threshold: 0.15,
        mask_expand_pixels: 15,
        mask_blur: 0,
        enable_inpainting: false,
        output_mode: 'alpha_mask',
        background_color: '#FFFFFF',
        mask_output_mode: 'none',
        auto_lr_split_parts: (Array.isArray(autoLrLabels) ? autoLrLabels : [])
          .map((s) => String(s).trim())
          .filter(Boolean)
          .join('\n'),
        lr_convention: 'anatomical',
        cluster_hair_front_back: false,
        passthrough_parts: '',
        write_metadata_sidecar: true,
        depth_near: 'bright',
        character_facing: 'front',
        order_method: 'evidence',
        retry_confidence: retryConfidence,
      },
    },
  }
}
