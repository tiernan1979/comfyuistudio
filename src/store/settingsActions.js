// Settings groups are plain shallow merges. Kept out of useStore so the
// store module stays under the 500-line ceiling as modes are added.
export function createSettingsActions(set) {
  return {
    setImageSettings: (settings) =>
      set((s) => ({ imageSettings: { ...s.imageSettings, ...settings } })),
    setH3ImageSettings: (settings) =>
      set((s) => ({ h3imageSettings: { ...s.h3imageSettings, ...settings } })),
    setPixelSettings: (settings) =>
      set((s) => ({ pixelSettings: { ...s.pixelSettings, ...settings } })),
    setVideoSettings: (settings) =>
      set((s) => ({ videoSettings: { ...s.videoSettings, ...settings } })),
    setEditSettings: (settings) =>
      set((s) => ({ editSettings: { ...s.editSettings, ...settings } })),
    setMusicSettings: (settings) =>
      set((s) => ({ musicSettings: { ...s.musicSettings, ...settings } })),
    setSfxSettings: (settings) =>
      set((s) => ({ sfxSettings: { ...s.sfxSettings, ...settings } })),
    setSpriteSettings: (settings) =>
      set((s) => ({ spriteSettings: { ...s.spriteSettings, ...settings } })),
    setCustomSettings: (settings) =>
      set((s) => ({ customSettings: { ...s.customSettings, ...settings } })),
    setSplitSettings: (settings) =>
      set((s) => ({ splitSettings: { ...s.splitSettings, ...settings } })),
    setPartsSettings: (settings) =>
      set((s) => ({ partsSettings: { ...s.partsSettings, ...settings } })),
  }
}
