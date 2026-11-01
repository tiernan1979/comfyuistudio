// History: local list, server merge, cross-browser delete sync, playback.

import { pushHiddenIds, pushHistoryEntries } from './helpers.js'

export function createHistoryActions(set, get) {
  return {
    addToHistory: (entry) => {
      set((s) => ({
        // Same promptId can arrive twice (local add + server sync) — keep one.
        history: [entry, ...s.history.filter((h) => h.id !== entry.id)].slice(0, 100),
      }))
      // Share the new entry with every other browser/origin.
      pushHistoryEntries([entry])
    },

    removeFromHistory: (id) => {
      set((s) => {
        const entry = s.history.find((h) => h.id === id)
        const patch = {
          history: s.history.filter((h) => h.id !== id),
          // Remember the deletion so the next server sync doesn't
          // resurrect it from ComfyUI's /history.
          hiddenHistoryIds: s.hiddenHistoryIds.includes(id)
            ? s.hiddenHistoryIds
            : [...s.hiddenHistoryIds, id].slice(-200),
        }
        if (s.selectedHistoryId === id) patch.selectedHistoryId = null
        if (entry && entry.data === s.outputImage) patch.outputImage = null
        if (entry && entry.data === s.outputVideo) patch.outputVideo = null
        if (entry && entry.data === s.outputAudio) patch.outputAudio = null
        if (entry?.data && typeof entry.data === 'string') {
          patch.deletedUrls = [entry.data, ...s.deletedUrls.filter((u) => u !== entry.data)].slice(
            0,
            100
          )
        }
        return patch
      })
      // Share the delete with every other logged-in browser.
      pushHiddenIds([id])
    },

    // Fold ids learned from other browsers/servers into the local hidden
    // set: drop matching history entries (and remember their urls so an
    // open studio drops those tracks too).
    mergeHiddenIds: (ids) =>
      set((s) => {
        const incoming = (Array.isArray(ids) ? ids : []).map(String).filter(Boolean)
        if (incoming.length === 0) return {}
        const hidden = new Set([...s.hiddenHistoryIds.map(String), ...incoming])
        const removed = s.history.filter((h) => hidden.has(String(h.id)))
        const removedUrls = removed.map((h) => h.data).filter((u) => typeof u === 'string' && u)
        return {
          hiddenHistoryIds: [...hidden].slice(-500),
          history: s.history.filter((h) => !hidden.has(String(h.id))),
          ...(removedUrls.length
            ? {
                deletedUrls: [
                  ...removedUrls,
                  ...s.deletedUrls.filter((u) => !removedUrls.includes(u)),
                ].slice(0, 100),
              }
            : {}),
        }
      }),

    clearHistory: () => {
      const ids = get().history.map((h) => h.id)
      set((s) => ({
        history: [],
        selectedHistoryId: null,
        outputImage: null,
        outputVideo: null,
        outputAudio: null,
        hiddenHistoryIds: [
          ...new Set([...s.hiddenHistoryIds, ...s.history.map((h) => h.id)]),
        ].slice(-200),
        deletedUrls: [
          ...s.history.map((h) => h.data).filter((d) => typeof d === 'string' && d),
          ...s.deletedUrls,
        ].slice(0, 100),
      }))
      // Share the wipe with every other logged-in browser.
      pushHiddenIds(ids)
    },

    // Merge entries fetched from the ComfyUI server's /history. Local
    // entries win (they hold extra settings), deletions stick, and the
    // list is sorted newest-first.
    mergeServerHistory: (entries) =>
      set((s) => {
        if (!entries?.length) return {}
        const have = new Set(s.history.map((h) => h.id))
        const hidden = new Set(s.hiddenHistoryIds)
        const fresh = entries.filter((e) => e?.id && !have.has(e.id) && !hidden.has(e.id))
        if (fresh.length === 0) return {}
        const merged = [...fresh, ...s.history]
          .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
          .slice(0, 100)
        return { history: merged }
      }),

    selectHistory: (id) => {
      const entry = get().history.find((h) => h.id === id)
      if (!entry) return
      // 3D entries open the GLB viewer modal — they don't map to any
      // of the image/video/music output slots.
      if (entry.type === '3d') {
        set({
          selectedHistoryId: id,
          viewing3d: { url: entry.data, name: entry.prompt || '3D model' },
        })
        return
      }
      const isVideo = entry.type === 'video'
      const isMusic = entry.type === 'music'
      const isSfx = entry.type === 'sfx'
      const isSprite = entry.type === 'sprite'
      const isAudio = isMusic || isSfx
      const mode = isVideo
        ? 'video'
        : isMusic
          ? 'music'
          : isSfx
            ? 'sfx'
            : isSprite
              ? 'sprite'
              : entry.type === 'edit'
                ? 'edit'
                : 'image'
      const text = entry.prompt ?? ''
      set((st) => ({
        selectedHistoryId: id,
        // Only video entries are videos and only music/SFX entries are
        // audio — 'edit' entries are still images.
        outputImage: isVideo || isAudio ? null : entry.data,
        outputVideo: isVideo ? entry.data : null,
        outputAudio: isAudio ? entry.data : null,
        batchImages: [],
        prompt: text,
        // also remember it as that tab's own prompt
        promptByMode: { ...st.promptByMode, [mode]: text },
        lyrics: isMusic && typeof entry.lyrics === 'string' ? entry.lyrics : st.lyrics,
        // Restore the AI title snapshotted onto the job so the download
        // name matches THIS song, not whatever was rewritten since.
        titles: entry.title
          ? { ...st.titles, [isVideo ? 'video' : isSfx ? 'sfx' : 'music']: entry.title }
          : st.titles,
        mode,
      }))
    },
  }
}
