// Prompt-builder copy and the UI-selection context handed to the AI writer.
// Kept out of PromptInput so the component stays under the repo's 500-line cap.
import { STYLES } from '../../lib/enhance'

export const EXAMPLES = [
  'A majestic dragon flying over a medieval castle at sunset, dramatic lighting, highly detailed',
  'Cyberpunk city street at night with neon reflections in puddles, cinematic',
  'A cozy coffee shop interior with warm lighting, plants, and rain outside the window',
  'Portrait of a futuristic astronaut floating in space with nebula reflections on the helmet',
]

// The image examples above are nonsense as sound effects ("dramatic
// lighting" is not a sound) — SFX gets its own.
export const SFX_EXAMPLES = [
  'a close lightning crack followed by a deep rolling thunder rumble',
  'heavy steel door slamming shut, hard impact, concrete room echo',
  'glass shattering on a tile floor, close and bright',
  'catapult firing — rope whip, wooden clack, distant stone impact',
  'a leather book dropping onto a thick rug, soft muffled thud',
  'crowd cheering swelling then fading, stadium reverb',
]

export const TEXTURE_EXAMPLES = [
  'mossy stone castle wall, weathered blocks, green moss in the cracks',
  'warm oak planks, visible grain, hand-cut boards',
  'wet volcanic rock, dark basalt, fine cracks and ash',
  'sci-fi hull plating, brushed metal, panel seams and rivets',
  'sandy beach ground, scattered pebbles and shells',
  'toxic swamp water, oily rainbow sheen, bubbles and algae',
]

export const FLIPBOOK_EXAMPLES = [
  'a looping orange explosion with smoke and sparks',
  'blue magic portal opening and pulsing with runes',
  'a small campfire flame flickering in the wind',
  'electric lightning arc crackling between two points',
  'green poison cloud bubbling and spreading',
  'a golden level-up burst with rising sparkles',
]

export const MATERIAL_EXAMPLES = [
  'weathered red brick, rough mortar, chipped edges',
  'polished dark marble with thin gold veins',
  'rusted industrial steel, flaking paint and scratches',
  'hand-cut oak planks with visible grain and knots',
  'rough grey concrete with hairline cracks',
  'blue dragon scales, glossy with a hard edge',
]

export const PLACEHOLDERS = {
  image: 'Describe what you want to create...',
  edit: "Describe the change... e.g. 'change the background to a beach at sunset, keep the person the same'",
  video: 'Describe the video... e.g. a fox running through snowy woods at sunset',
  music:
    'Describe the song in plain words — the AI button turns it into a full package\n' +
    '(metadata + arrangement + tagged lyrics + length). For example:\n' +
    '4 min progressive trance, Avicii-style, 25% of the song for lyrics, euphoric\n' +
    'or just: a sad piano ballad about a rainy train station, instrumental',
  sfx:
    'Describe a single sound effect — what is heard, not music. For example:\n' +
    'a close lightning crack followed by a deep rolling thunder rumble\n' +
    'heavy steel door slamming shut, hard impact\n' +
    'glass shattering on a tile floor, close and bright',
  sprite:
    'Describe one character or subject for the sprite sheet — full body, no scene.\n' +
    'For example: a knight in blue plate armour with a red plume and a round shield\n' +
    'a small green slime creature with big eyes\n' +
    'a sci-fi soldier in white armour holding a rifle',
  texture:
    'Describe a surface, icon set or terrain tile — no scene.\n' +
    'For example: mossy stone castle wall, weathered blocks, green moss in the cracks\n' +
    'a set of fantasy RPG inventory icons: potion, sword, shield, coin, key, gem\n' +
    'grass-to-dirt terrain transitions with ragged edges and scattered pebbles',
  flipbook:
    'Describe one visual effect that loops — no scene or camera.\n' +
    'For example: a looping orange explosion with smoke and sparks\n' +
    'blue magic portal opening and pulsing with runes\n' +
    'a small campfire flame flickering in the wind',
  material:
    'Describe a physical material for a PBR texture — no lighting or scene.\n' +
    'For example: weathered red brick, rough mortar, chipped edges\n' +
    'polished dark marble with thin gold veins\n' +
    'rusted industrial steel, flaking paint and scratches',
}

// Describe the user's current UI selections so the AI prompt writer can
// tailor its output to them (not just paraphrase the text box).
export function buildSelectionContext(s) {
  const lines = []
  const styleLabel = STYLES[s.style]?.label || s.style || ''
  const customWorkflows = s.customWorkflows || []
  const activeCustom =
    s.mode === 'custom'
      ? customWorkflows.find((w) => w.id === s.customWorkflowId) || customWorkflows[0]
      : null
  const customType = activeCustom?.mapping?.outputType || 'image'
  // Style presets are only exposed for image/video/edit (and visual custom
  // graphs) — do not leak visual style words into music or SFX prompts.
  const visualMode =
    s.mode === 'image' ||
    s.mode === 'video' ||
    s.mode === 'edit' ||
    s.mode === 'texture' ||
    s.mode === 'flipbook' ||
    s.mode === 'material' ||
    (s.mode === 'custom' && customType !== 'audio')
  if (styleLabel && visualMode) {
    lines.push(`Style preset: ${styleLabel}`)
  }
  if (s.mode === 'custom') {
    if (activeCustom) {
      lines.push(`Imported workflow: ${activeCustom.name || 'untitled'}`)
      lines.push(`Workflow output type: ${customType}`)
      const nodes = activeCustom.graph ? Object.keys(activeCustom.graph).length : 0
      if (nodes) lines.push(`Workflow graph: ${nodes} nodes`)
    } else {
      lines.push('No imported workflow is selected')
    }
  } else if (s.mode === 'image') {
    const im = s.imageSettings || {}
    lines.push(
      im.sizeMode === 'custom'
        ? `Output size: exactly ${im.width}x${im.height} pixels`
        : `Aspect ratio: ${im.aspectRatio}`,
    )
    if (im.turboMode) lines.push('Turbo mode: 8 steps, low CFG (clean fast render)')
  } else if (s.mode === 'video') {
    const v = s.videoSettings || {}
    lines.push(`Video: ${v.resolution}, ${v.frames} frames @ ${v.fps} fps, ~${v.duration}s`)
  } else if (s.mode === 'sprite') {
    const sp = s.spriteSettings || {}
    lines.push(`Sprite cell size: ${sp.cellSize}px`)
    lines.push(
      sp.sheetMode === 'multi'
        ? `Animations: ${sp.animations}`
        : `Animation: ${sp.animation}`,
    )
    if (sp.directions && sp.directions !== 'none') lines.push(`Directions: ${sp.directions}`)
    lines.push(`Background: ${sp.background} (subject is cut out)`)
  } else if (s.mode === 'edit') {
    lines.push(
      s.sourceImage?.name
        ? `Editing the uploaded image "${s.sourceImage.name}" — describe only the change`
        : 'No source image uploaded yet',
    )
  } else if (s.mode === 'texture') {
    const t = s.textureSettings || {}
    if (t.kind === 'icon') {
      lines.push(`Icon / UI pack: ${t.grid}×${t.grid} icons on a flat background`)
      lines.push(`Background: ${t.transparent !== false ? 'cut to transparency (BiRefNet)' : 'left flat'}`)
    } else if (t.kind === 'terrain') {
      lines.push(`Terrain auto-tile sheet: ${t.grid}×${t.grid} edge/corner transition tiles`)
    } else if (t.kind === 'tileset') {
      lines.push(`Tileset sheet: ${t.grid}×${t.grid} equal cells`)
    } else {
      lines.push(
        `Seamless texture: ${t.seamless !== false ? 'tileable edges' : 'one-off surface'}`,
      )
    }
    lines.push(`Render size: ${t.size}px square`)
  } else if (s.mode === 'flipbook') {
    const f = s.flipbookSettings || {}
    lines.push(`Flipbook: ${f.frames} frames at ${f.fps} fps, ${f.resolution}px square`)
    lines.push(`Background: ${f.transparent !== false ? 'transparent (BiRefNet)' : 'full frame'}`)
  } else if (s.mode === 'material') {
    const m = s.materialSettings || {}
    const maps = Object.entries(m.maps || {})
      .filter(([, on]) => on !== false)
      .map(([k]) => k)
      .join(', ')
    lines.push(`PBR maps: ${maps || 'none selected'}`)
    lines.push(`Texture size: ${m.size}, tiling: ${m.tiling}`)
  }
  return lines.join('\n')
}
