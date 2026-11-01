// Episode planner state: the transient H3 first frame plus the persisted shot
// list. Kept out of useStore.js so the store stays under the 500-line cap.
import { uid } from './helpers.js'

export function createEpisodeActions(set) {
  return {
    setVideoSourceImage: (videoSourceImage) => set({ videoSourceImage }),

    setEpisodeShots: (episodeShots) => set({ episodeShots }),
    addEpisodeShot: (shot = {}) =>
      set((s) => ({
        episodeShots: [
          ...s.episodeShots,
          { status: 'draft', createdAt: Date.now(), ...shot, id: shot.id || uid() },
        ],
      })),
    updateEpisodeShot: (id, patch) =>
      set((s) => ({
        episodeShots: s.episodeShots.map((shot) =>
          shot.id === id ? { ...shot, ...patch, updatedAt: Date.now() } : shot,
        ),
      })),
    removeEpisodeShot: (id) =>
      set((s) => ({ episodeShots: s.episodeShots.filter((shot) => shot.id !== id) })),
    clearEpisodeShots: () => set({ episodeShots: [] }),
  }
}
