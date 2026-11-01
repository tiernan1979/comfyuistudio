import { prettyAnim } from '../../lib/animNames'

// Tick list for the Mixamo FBXs already on the server, plus the uploader and
// the "missing on disk" markers. One tick = one FBX in a single rig run.
export default function AnimationPicker({ t }) {
  const usable = t.animOptions.filter((o) => !t.animMissing.includes(o))
  const allOn = usable.length > 0 && t.animSel.length === usable.length

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs text-text-secondary">
          Animations{' '}
          <span className="text-text-muted">— tick several, one FBX each in a single run</span>
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => !t.busy && t.animFileRef.current?.click()}
            disabled={t.busy}
            title="Upload new Mixamo FBXs from your computer into ComfyUI's input/animation_templates/mixamo/ — only needed to ADD files that aren't already listed below."
            className="text-[10px] text-accent transition-colors hover:text-accent-hover disabled:opacity-40"
          >
            Upload new FBXs…
          </button>
          {usable.length > 1 && (
            <button
              type="button"
              onClick={() => t.setAnimSel(allOn ? [] : [...usable])}
              disabled={t.busy}
              className="text-[10px] text-accent transition-colors hover:text-accent-hover disabled:opacity-40"
            >
              {allOn ? 'none' : 'all'}
            </button>
          )}
        </div>
      </div>

      {t.animOptions.length > 0 ? (
        <div className="max-h-36 divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {t.animOptions.map((o) => {
            const gone = t.animMissing.includes(o)
            const checked = !gone && t.animSel.includes(o)
            return (
              <label
                key={o}
                className={`flex items-center gap-2 px-2 py-1.5 text-xs ${
                  gone ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:bg-bg-hover'
                }`}
                title={
                  gone
                    ? 'Listed by ComfyUI but missing on disk — re-download it (see hint below)'
                    : undefined
                }
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    t.setAnimSel((prev) =>
                      prev.includes(o) ? prev.filter((a) => a !== o) : [...prev, o],
                    )
                  }
                  disabled={t.busy || gone}
                  className="accent-[var(--color-accent)]"
                />
                <span className="truncate font-mono">{prettyAnim(o)}</span>
                {gone && (
                  <span className="ml-auto shrink-0 text-[10px] text-text-muted">
                    missing on server
                  </span>
                )}
              </label>
            )
          })}
        </div>
      ) : (
        <p className="text-[11px] text-text-muted">
          Animation file list not loaded — is the ComfyUI server reachable?
        </p>
      )}

      {t.uploadNote && <p className="text-[10px] text-accent/90">{t.uploadNote}</p>}
      <p className="text-[10px] text-text-muted">
        {t.animOptions.length > 0
          ? 'The list above is every animation already on the server — just tick the ones you want. Unticked = rig only. Want more (walk/run/jump/squat)? Download free FBXs from mixamo.com (Animations → Download as FBX, no skin) and use "Upload new FBXs…" to add them, then restart ComfyUI once so they appear in the list.'
          : 'Animation file list not loaded — is the ComfyUI server reachable?'}
      </p>
      <input
        ref={t.animFileRef}
        type="file"
        accept=".fbx,application/octet-stream"
        multiple
        className="hidden"
        onChange={t.handleAnimUpload}
      />
    </div>
  )
}
