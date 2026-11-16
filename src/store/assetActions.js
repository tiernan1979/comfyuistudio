// Setters for the game-asset modes, kept out of useStore (which sits near the
// repo's 500-line component/store cap).
export function createAssetActions(set) {
  return {
    setTextureSettings: (settings) =>
      set((s) => ({ textureSettings: { ...s.textureSettings, ...settings } })),
    setFlipbookSettings: (settings) =>
      set((s) => ({ flipbookSettings: { ...s.flipbookSettings, ...settings } })),
    setMaterialSettings: (settings) =>
      set((s) => ({ materialSettings: { ...s.materialSettings, ...settings } })),
  }
}
