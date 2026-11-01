// Saved prompts — the user's reusable prompt library (persisted).
// { id, title, prompt, negativePrompt, style, createdAt }

import { uid } from './helpers.js'

export function createPromptActions(set, get) {
  return {
    addSavedPrompt: ({ title, prompt, negativePrompt, style } = {}) => {
      const text = String(prompt ?? get().prompt ?? '').trim()
      if (!text) return null
      const firstLine = text.split('\n')[0]
      const entry = {
        id: uid(),
        title:
          String(title || '').trim() ||
          (firstLine.length > 48 ? `${firstLine.slice(0, 48)}…` : firstLine),
        prompt: text,
        negativePrompt: negativePrompt ?? get().negativePrompt,
        style: style ?? get().style,
        createdAt: Date.now(),
      }
      set((s) => ({ savedPrompts: [entry, ...s.savedPrompts].slice(0, 300) }))
      return entry
    },

    renameSavedPrompt: (id, title) =>
      set((s) => ({
        savedPrompts: s.savedPrompts.map((p) =>
          p.id === id ? { ...p, title: String(title || '').trim() || p.title } : p
        ),
      })),

    removeSavedPrompt: (id) =>
      set((s) => ({ savedPrompts: s.savedPrompts.filter((p) => p.id !== id) })),

    // Merge an exported JSON list — existing ids win, new ones are added.
    importSavedPrompts: (entries) =>
      set((s) => {
        const known = new Set(s.savedPrompts.map((p) => p.id))
        const incoming = (Array.isArray(entries) ? entries : [])
          .filter((e) => e && typeof e.prompt === 'string' && e.prompt.trim())
          .filter((e) => !known.has(e.id))
          .map((e) => ({
            id: typeof e.id === 'string' && e.id ? e.id : uid(),
            title: String(e.title || e.prompt.split('\n')[0]).slice(0, 80),
            prompt: e.prompt,
            negativePrompt: String(e.negativePrompt || ''),
            style: typeof e.style === 'string' ? e.style : 'photoreal',
            createdAt: Number(e.createdAt) || Date.now(),
          }))
        if (incoming.length === 0) return {}
        const all = [...s.savedPrompts, ...incoming].sort((a, b) => b.createdAt - a.createdAt)
        return { savedPrompts: all.slice(0, 300) }
      }),
  }
}
