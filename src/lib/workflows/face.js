import { buildEditWorkflow } from './image.js'

// ---------------------------------------------------------------------------
// Face-fix (settings toggle threeD.faceFix): face-focused Qwen-Image edit
// passes that run around the 3D pipeline. Faces get ~1-2% of the texels in a
// full-body texture bake, so sharpening the face at source (before mesh gen)
// and on the front paint view (before bake) is where the quality lands.
//
// When ComfyUI/models/detection/ has a MediaPipe face model, a precise
// landmark mask confines the edit to the face oval; otherwise a conservative
// whole-image pass is used and the prompt has to carry the "keep everything
// else identical" constraint.
// ---------------------------------------------------------------------------
export const FACE_ENHANCE_PROMPT =
  'Enhance the face in this image: sharpen the eyes, define the iris, eyelids and eyelashes, ' +
  'add natural fine skin texture, crisp lips and clean facial features. Keep the pose, expression, ' +
  'outfit, colors, lighting, background and composition exactly the same — photorealistic detail only, ' +
  'no style change.'
export const FACE_ENHANCE_NEG =
  'deformed face, warped features, asymmetric eyes, plastic or waxy skin, changed clothes, ' +
  'changed background, blurry, low quality'

export const FACE_PAINT_PROMPT =
  'Refine this rendered character view: remove dark speckles, spots, blotches and rendering ' +
  'artifacts from skin, hands and clothing — restore even natural skin tone everywhere ' +
  'including fingertips, clean matte fabric. Photoreal face detail: crisp eyes with clear ' +
  'dark irises, visible pupils, defined eyelids, eyelashes and subtle catchlights, natural ' +
  'skin pores and fine skin texture, defined lips, realistic stubble or beard hair detail ' +
  'where present. Reduce hair and skin glossiness — matte natural finish, not plastic or ' +
  'shiny. Keep the identity, pose, expression, outfit, colors, lighting, framing and ' +
  'background exactly the same — cleanup and photoreal skin only, not a cartoon, painting ' +
  'or illustration.'
export const FACE_PAINT_NEG =
  'dark spots, speckles, dirt, blotches, discoloration, dark fingertips, stains, ' +
  'deformed face, melted features, warped eyes, blank eyes, empty eyes, no iris, no pupil, ' +
  'plastic or waxy skin, overly shiny hair, glossy hair, cartoon, anime, painting, ' +
  'illustration, doll-like, airbrushed, changed outfit, changed pose, blur'


// Shared face-mask softening: MediaPipeFaceMask is a hard-edged polygon fill,
// which would leave a visible seam where the edit meets the untouched image.
// FeatherMask only softens the image border, so blur the mask instead.
export function addFaceMask(wf, { landmarksNode }) {
  wf['13'] = { class_type: 'MediaPipeFaceMask', inputs: { face_landmarks: [landmarksNode, 0], regions: 'all' } }
  wf['14'] = { class_type: 'MaskToImage', inputs: { mask: ['13', 0] } }
  wf['15'] = { class_type: 'ImageBlur', inputs: { image: ['14', 0], blur_radius: 15, sigma: 2.5 } }
  wf['16'] = { class_type: 'ImageToMask', inputs: { image: ['15', 0], channel: 'red' } }
  return ['16', 0]
}

// First step of the local pipeline: sharpen the face of the source picture
// before the 3D generator ever sees it. Saves under outputName; the caller
// downloads the PNG and re-uploads it for the mesh workflow.
export function buildFaceEnhanceWorkflow({
  imageName,
  outputName = 'facefix',
  models,
  faceModelName = '',
  denoise,
  steps = 20,
  cfg = 2.5,
  seed = -1,
}) {
  const wf = buildEditWorkflow({
    prompt: FACE_ENHANCE_PROMPT,
    negativePrompt: FACE_ENHANCE_NEG,
    imageName,
    seed,
    steps,
    cfg,
    denoise: denoise ?? (faceModelName ? 0.55 : 0.4),
    models,
  })
  wf['60'].inputs.filename_prefix = outputName
  if (faceModelName) {
    wf['41'] = { class_type: 'LoadMediaPipeFaceLandmarker', inputs: { model_name: faceModelName } }
    wf['42'] = {
      class_type: 'MediaPipeFaceLandmarker',
      inputs: {
        face_detection_model: ['41', 0],
        image: ['78', 0],
        detector_variant: 'both',
        num_faces: 1,
        min_confidence: 0.3,
        missing_frame_fallback: 'empty',
      },
    }
    const mask = addFaceMask(wf, { landmarksNode: '42' })
    wf['61'] = {
      class_type: 'ImageCompositeMasked',
      inputs: {
        destination: ['78', 0],
        source: ['8', 0],
        x: 0,
        y: 0,
        resize_source: false,
        mask,
      },
    }
    wf['60'].inputs.images = ['61', 0]
  }
  return wf
}
