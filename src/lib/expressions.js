// ---------------------------------------------------------------------------
// Facial expressions for sprite sheets.
//
// The expression is TEXT, not a separate graph input: every frame prompt gets
// the phrase appended right after the subject so the face is prioritised, and
// the matching `negative` is appended to the row's negative conditioning so
// the base pose does not drift into a different expression between rows.
//
// Because expressions are baked into the base pose as well as the frames, the
// graph groups bases by direction + expression (see buildSpriteWorkflow) —
// one shared base per expression keeps identity consistent without
// regenerating the body for every row.
// ---------------------------------------------------------------------------

export const SPRITE_EXPRESSIONS = {
  neutral: {
    label: 'Neutral',
    phrase: 'a relaxed neutral facial expression',
    negative: 'exaggerated expression, distorted face',
  },
  happy: {
    label: 'Happy',
    phrase: 'a happy cheerful facial expression, smiling with bright eyes',
    negative: 'frowning, sad, angry, blank expression',
  },
  angry: {
    label: 'Angry',
    phrase: 'an angry furious facial expression, furrowed brows, clenched jaw',
    negative: 'smiling, laughing, happy, blank expression',
  },
  sad: {
    label: 'Sad',
    phrase: 'a sad sorrowful facial expression, downcast eyes, slight frown',
    negative: 'smiling, laughing, happy, blank expression',
  },
  surprised: {
    label: 'Surprised',
    phrase: 'a surprised shocked facial expression, wide eyes, raised brows, open mouth',
    negative: 'blank expression, closed eyes, smiling',
  },
  determined: {
    label: 'Determined',
    phrase: 'a determined focused facial expression, narrowed eyes, set jaw',
    negative: 'blank expression, smiling, sleepy',
  },
  pained: {
    label: 'Pained',
    phrase: 'a pained grimacing facial expression, gritted teeth, squeezed eyes',
    negative: 'smiling, laughing, relaxed expression',
  },
  scared: {
    label: 'Scared',
    phrase: 'a scared fearful facial expression, wide eyes, tense brows',
    negative: 'smiling, laughing, calm expression',
  },
}

export const EXPRESSION_KEYS = Object.keys(SPRITE_EXPRESSIONS)

// Unknown / empty values fall back to neutral rather than leaking into a
// prompt: sprite settings are persisted and users may have stale keys from an
// older build (or hand-edited CSV in expressionRows).
export function normalizeExpression(key) {
  const k = String(key || '').trim().toLowerCase()
  return Object.prototype.hasOwnProperty.call(SPRITE_EXPRESSIONS, k) ? k : 'neutral'
}

export function expressionPhrase(key) {
  return SPRITE_EXPRESSIONS[normalizeExpression(key)].phrase
}

export function expressionNegative(key) {
  return SPRITE_EXPRESSIONS[normalizeExpression(key)].negative
}
