// 'Mma_Kick.fbx' → 'Mma Kick' — dropdowns show readable names, not filenames.
export const prettyAnim = (file) =>
  String(file || '')
    .replace(/\.(fbx|npz)$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim()
