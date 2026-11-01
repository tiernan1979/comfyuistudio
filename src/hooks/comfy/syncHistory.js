// Pull the shared generation history into the store.

import { getServerHistory, rebuildViewUrl, resolveApiBase } from '../../lib/comfyui'
import useStore, { pushHistoryEntries } from '../../store/useStore'

// Primary source is the app's own API (/api/history) — a durable,
// origin-neutral store that merges live ComfyUI entries with ones pushed by
// other browsers, so every origin (http://host:5555, https://host, …)
// converges on the same list even after ComfyUI restarts or clears its
// in-memory history. Falls back to a direct ComfyUI /history read when the
// API is offline. Local entries win on id conflict; deleted ones stay hidden.
export async function syncServerHistory() {
  const st = useStore.getState()
  const apiBase = resolveApiBase(st.serverUrl, st.useProxy)
  try {
    // Fold in deletions made on other browsers/machines first, so they
    // drop locally before the fresh server list is merged. Best-effort —
    // a missing API keeps deletes local-only.
    try {
      const h = await fetch('/api/hidden-ids')
      if (h.ok) {
        const data = await h.json()
        useStore.getState().mergeHiddenIds(data?.ids || [])
      }
    } catch {
      /* API offline — nothing to sync */
    }

    let entries = null
    let viaApi = false
    try {
      const r = await fetch('/api/history?limit=200')
      if (r.ok) {
        const data = await r.json()
        if (Array.isArray(data?.entries)) {
          entries = data.entries
          viaApi = true
        }
      }
    } catch {
      /* API offline — direct ComfyUI read below */
    }
    if (!entries) entries = await getServerHistory(apiBase, 60)

    // Rebuild output URLs against THIS origin: entries recorded elsewhere
    // point at that origin's proxy (or at direct http:// ComfyUI URLs,
    // which https pages refuse to load) — both are dead links here.
    entries = entries.map((e) => {
      if (!e?.data) return e
      const url = rebuildViewUrl(e, apiBase)
      return url && url !== e.data ? { ...e, data: url } : e
    })

    // Catch-up: push entries only this browser has (e.g. localStorage
    // accumulated before history became shared) so other origins see
    // them too. Ids already in the shared store are skipped, so this
    // fires once per entry, not on every sync.
    if (viaApi) {
      const fetched = new Set(entries.map((e) => String(e.id)))
      const hidden = new Set(useStore.getState().hiddenHistoryIds.map(String))
      const localOnly = useStore.getState().history.filter(
        (h) => h?.id && h?.data && !fetched.has(String(h.id)) && !hidden.has(String(h.id))
      )
      if (localOnly.length) pushHistoryEntries(localOnly)
    }

    useStore.getState().mergeServerHistory(entries)
    return { ok: true, count: entries.length, source: viaApi ? 'shared' : 'server' }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}
