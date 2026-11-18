// History: local list, server merge, cross-browser delete sync, playback.

import { pushHiddenIds, pushHistoryEntries } from './helpers.js'

export function createHistoryActions(set, get) {
  return {
    addToHistory: (entry) => {
      // A late completion can arrive after the user deleted that job from
      // history. Do not resurrect it locally or push it back to the shared
      // store — the hidden list is the source of truth for deletions.
      const key = String(entry.id)
      if (get().hiddenHistoryIds.some((id) => String(id) === key)) return
      set((s) => ({
        // Same promptId can arrive twice (local add + server sync) — keep one.
        history: [entry, ...s.history.filter((h) => String(h.id) !== key)].slice(0, 100),
      }))
      // Share the new entry with every other browser/origin.
      pushHistoryEntries([entry])
    },

    removeFromHistory: (id) => {
      const key = String(id)
      set((s) => {
        const entry = s.history.find((h) => String(h.id) === key)
        const hidden = s.hiddenHistoryIds.map(String)
        const patch = {
          history: s.history.filter((h) => String(h.id) !== key),
          // Remember the deletion so the next server sync doesn't
          // resurrect it from ComfyUI's /history. Normalise the ids to
          // strings: server entries and older saved lists can disagree on
          // type, which made the hidden check miss and the entry return.
          hiddenHistoryIds: hidden.includes(key) ? hidden : [...hidden, key].slice(-200),
        }
        if (String(s.selectedHistoryId) === key) patch.selectedHistoryId = null
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

    // Replace an existing history entry in place. Used when a texture is
    // post-processed into a seamless tile: the card and any open viewer must
    // point at the fixed PNG, not the original bordered render.
    updateHistoryEntry: (id, patchOrUpdater) => {
      const key = String(id)
      let updated = null
      set((s) => {
        const index = s.history.findIndex((h) => String(h.id) === key)
        if (index < 0) return {}
        const current = s.history[index]
        const patch =
          typeof patchOrUpdater === 'function' ? patchOrUpdater(current) : patchOrUpdater
        if (!patch) return {}
        updated = { ...current, ...patch }
        const history = [...s.history]
        history[index] = updated
        const out = { history }
        const oldData = current.data
        const newData = updated.data
        if (oldData && newData && oldData !== newData) {
          if (s.outputImage === oldData) out.outputImage = newData
          if (Array.isArray(s.batchImages) && s.batchImages.includes(oldData)) {
            out.batchImages = s.batchImages.map((url) => (url === oldData ? newData : url))
          }
        }
        return out
      })
      // Keep the durable, cross-browser copy in sync with the new URL.
      if (updated) pushHistoryEntries([updated])
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
      const ids = get().history.map((h) => String(h.id))
      set((s) => ({
        history: [],
        selectedHistoryId: null,
        outputImage: null,
        outputVideo: null,
        outputAudio: null,
        hiddenHistoryIds: [
          ...new Set([...s.hiddenHistoryIds.map(String), ...s.history.map((h) => String(h.id))]),
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
        const have = new Set(s.history.map((h) => String(h.id)))
        const hidden = new Set(s.hiddenHistoryIds.map(String))
        const fresh = entries.filter((e) => {
          if (!e?.id) return false
          const key = String(e.id)
          return !have.has(key) && !hidden.has(key)
        })
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
      const isAsset =
        entry.type === 'texture' ||
        entry.type === 'flipbook' ||
        entry.type === 'material' ||
        entry.type === 'h3image'
      const isAudio = isMusic || isSfx
      const mode = isVideo
        ? 'video'
        : isMusic
          ? 'music'
          : isSfx
            ? 'sfx'
            : isSprite
              ? 'sprite'
              : isAsset
                ? entry.type
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
