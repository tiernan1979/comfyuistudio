// Character-part slots shared by the PartsPanel UI and the REST API, so a
// generation through either path produces the same prompt.

// Orientation is independent of the slot: the same armour slot can be
// generated front, side, 3/4 or back for a paper-doll / rig sheet.
export const PART_DIRECTIONS = [
  { key: 'front', label: 'Front', phrase: 'front view, facing the camera' },
  {
    key: 'side',
    label: 'Side',
    phrase: 'strict 90-degree side profile view, seen directly from the side, facing right',
  },
  {
    key: 'threeQuarter',
    label: '3/4',
    phrase: 'three-quarter view, body angled about 45 degrees toward the camera',
  },
  { key: 'back', label: 'Back', phrase: 'rear view, seen from behind' },
]

const DIRECTION_BY_KEY = Object.fromEntries(PART_DIRECTIONS.map((d) => [d.key, d]))
const DEFAULT_DIRECTION = 'front'

export function normalizePartDirection(key) {
  return DIRECTION_BY_KEY[key] ? key : DEFAULT_DIRECTION
}

export function partDirectionPhrase(key) {
  return DIRECTION_BY_KEY[normalizePartDirection(key)].phrase
}

export const PARTS_SLOTS = {
  body: { label: 'Body', w: 512, h: 768, dir: 'front', phrase: 'full body character in plain simple underwear, strict T-pose, bare torso, bare arms, bare legs' },
  armour: { label: 'Full armour', w: 512, h: 768, dir: 'front', phrase: 'full body character wearing a complete suit of armour, strict T-pose' },
  head: { label: 'Head', w: 512, h: 512, dir: 'front', phrase: 'character head only, neutral expression, no body' },
  hair: { label: 'Hair', w: 512, h: 512, dir: 'front', phrase: 'a hairstyle only, no face, no head, isolated' },
  face: { label: 'Face', w: 512, h: 512, dir: 'front', phrase: 'character face close-up, neutral expression' },
  helmet: { label: 'Helmet', w: 512, h: 512, dir: 'front', phrase: 'a single helmet, empty, isolated on plain background' },
  chest: { label: 'Chest armour', w: 512, h: 512, dir: 'front', phrase: 'a single chestplate/breastplate armour piece, isolated' },
  // Limbs split at the elbow/knee: the upper piece owns the joint so each PNG
  // is a single rig segment rather than a half-arm that ends mid-bone.
  upperArm: { label: 'Upper arm', w: 512, h: 512, dir: 'front', phrase: 'a single upper arm including the elbow, isolated on plain background' },
  lowerArm: { label: 'Lower arm', w: 512, h: 512, dir: 'front', phrase: 'a single lower arm (forearm), isolated on plain background' },
  gloves: { label: 'Gloves', w: 512, h: 512, dir: 'front', phrase: 'a pair of gauntlets, isolated on plain background' },
  upperLeg: { label: 'Upper leg', w: 512, h: 640, dir: 'front', phrase: 'a single upper leg including the knee, isolated on plain background' },
  lowerLeg: { label: 'Lower leg', w: 512, h: 640, dir: 'front', phrase: 'a single lower leg (calf), isolated on plain background' },
  boots: { label: 'Boots', w: 512, h: 512, dir: 'front', phrase: 'a pair of boots, isolated on plain background' },
  // Full-body rig reference for autorig_slicer.py — the exact orthographic
  // spread-eagle T-pose the limb slicer parses. Keep arms horizontal and legs
  // spread so the slicer's connected-component classifier can isolate head /
  // torso / arm_left / arm_right / leg_left / leg_right cleanly.
  rig: {
    label: 'Rig (T-pose)',
    w: 512,
    h: 768,
    dir: 'front',
    phrase:
      'full body character, strict orthographic front view, spread-eagle T-pose, ' +
      'arms stretched straight out horizontally at shoulder height, legs spread apart and straight, ' +
      'feet flat, palms facing the camera, symmetric, centred',
  },
  // Side-view (profile) rig — gameplay-facing art for a side-scrolling world.
  rig_side: {
    label: 'Rig (side)',
    w: 512,
    h: 768,
    dir: 'front',
    phrase:
      'full body character, strict orthographic SIDE view profile facing right, standing upright, ' +
      'arms hanging relaxed close to the body, legs in a natural stance, feet flat on the ground, ' +
      'entire figure visible, symmetric profile, centred',
  },
  // Quadruped/beast rig — four-legged creatures, never a humanoid T-pose.
  rig_beast: {
    label: 'Rig (beast)',
    w: 640,
    h: 512,
    dir: 'front',
    phrase:
      'full creature, strict orthographic SIDE view, natural four-legged standing stance with all ' +
      'legs or limbs resting on the ground, head up, entire creature visible from nose to tail, centred',
  },
  // Flyers / floaters / blobs — just a clean, symmetric full silhouette.
  rig_float: {
    label: 'Rig (float)',
    w: 512,
    h: 768,
    dir: 'front',
    phrase:
      'full creature, front view, entire silhouette visible, symmetric, centred, ' +
      'wings fully spread if it has wings, nothing cropped',
  },
  cape: { label: 'Cape', w: 512, h: 640, dir: 'front', phrase: 'a cape or cloak, isolated on plain background' },
  // Weapons read best from the side unless the user picks another view.
  weapon: { label: 'Weapon', w: 640, h: 512, dir: 'side', phrase: 'a single medieval weapon, isolated on plain background' },
  shield: { label: 'Shield', w: 512, h: 512, dir: 'front', phrase: 'a single shield, isolated on plain background' },
}

export const PARTS_NEG =
  'multiple subjects, duplicate, text, watermark, signature, shadow, scenery, busy background, ' +
  'gradient background, cropped, out of frame, extra limbs'

// Negative prompt tailored for the T-pose rig slot: bans every failure mode
// that breaks the slicer's connected-component analysis (limbs crossing the
// torso, foreshortening, limbs hidden behind the body, non-orthographic angles).
export const TPOSE_NEG =
  PARTS_NEG +
  ', crossed arms, crossed legs, arms at sides, arms hanging down, foreshortening, ' +
  'perspective, three-quarter view, side view, leaning, twisted torso, hands on hips, ' +
  'limbs overlapping the torso, arm covering torso, limb hidden behind body'

// slot + user style + orientation → the full prompt the image model sees.
// `direction` falls back to the slot's natural view (weapons side-on).
export function buildPartPrompt(slotKey, base = '', extra = '', direction = '') {
  const s = PARTS_SLOTS[slotKey] || PARTS_SLOTS.armour
  const dir = normalizePartDirection(direction || s.dir)
  const bits = [base, s.phrase, partDirectionPhrase(dir), extra].filter(Boolean).join(', ')
  return `${bits}, plain pure white background, centred, game asset`
}
