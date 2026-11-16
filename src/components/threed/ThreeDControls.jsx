import { motion, AnimatePresence } from 'framer-motion'
import clsx from 'clsx'
import {
  Box,
  Upload,
  X,
  Hammer,
  Settings,
  Sparkles,
  Loader2,
  Download,
  Package,
} from 'lucide-react'
import useStore from '../../store/useStore'
import { GAME_EXPORT_LODS, GAME_EXPORT_PRESETS } from '../../lib/workflows'
import Dropdown from '../Dropdown'
import { BTN_PRIMARY, BTN_GHOST } from './MeshActionRow'
import MeshActionRow from './MeshActionRow'
import AnimationPicker from './AnimationPicker'
import { prettyAnim } from '../../lib/animNames'

function StepBadge({ n }) {
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/20 text-[10px] font-bold text-accent">
      {n}
    </span>
  )
}

function Card({ children, disabled }) {
  return (
    <div
      className={clsx(
        'space-y-3 rounded-xl border border-border bg-bg-card p-4',
        disabled && 'opacity-50',
      )}
    >
      {children}
    </div>
  )
}

function CardHeader({ step, icon: Icon, title, description, action }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-semibold">
          {step ? <StepBadge n={step} /> : Icon ? <Icon size={14} className="text-text-muted" /> : null}
          {title}
        </p>
        {description && <p className="mt-1 text-[11px] text-text-muted">{description}</p>}
      </div>
      {action}
    </div>
  )
}

export default function ThreeDControls({ t, threeD, run, setShowSettings }) {
  const { busy, image } = t
  const setThreeD = useStore((s) => s.setThreeD)
  const hasMesh = !!(run.mesh || t.importedMesh || t.idleMesh)
  const canRig = hasMesh || !!t.serverMesh.trim()

  return (
    <div className="flex-1 space-y-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/20">
            <Box size={20} className="text-accent" />
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">3D Generation</h2>
            <p className="text-xs text-text-muted">
              {t.isLocal
                ? 'Local · image → mesh (Pixal3D/TRELLIS.2) + MIA auto-rig on your ComfyUI'
                : 'Tripo cloud · image → model → rig → preset animation'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowSettings(true)}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-accent"
        >
          <Settings size={14} />
          Configure
        </button>
      </div>

      {/* Source image */}
      <div className="space-y-1.5">
        <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          Character image
        </label>
        <AnimatePresence mode="wait">
          {image ? (
            <motion.div
              key="preview"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onDragOver={(e) => {
                e.preventDefault()
                t.setDragOver(true)
              }}
              onDragLeave={() => t.setDragOver(false)}
              onDrop={t.dropImage}
              className={clsx(
                'group relative overflow-hidden rounded-xl border transition-colors',
                t.dragOver ? 'border-accent ring-2 ring-accent/50' : 'border-border',
              )}
            >
              <img
                src={image.preview}
                alt="Source"
                className="max-h-52 w-full bg-black/30 object-contain"
              />
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6">
                <span className="max-w-[240px] truncate text-[10px] text-white/80">
                  {image.name}
                </span>
                {!busy && (
                  <button
                    type="button"
                    onClick={t.clearImage}
                    className="rounded-lg bg-black/50 p-1.5 transition-colors hover:bg-red-500/60"
                    title="Remove image"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="dropzone"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !busy && t.fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault()
                t.setDragOver(true)
              }}
              onDragLeave={() => t.setDragOver(false)}
              onDrop={t.dropImage}
              className={clsx(
                'flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors',
                t.dragOver
                  ? 'border-accent bg-accent/10'
                  : 'border-border hover:border-accent/50 hover:bg-bg-card',
                busy && 'pointer-events-none opacity-50',
              )}
            >
              {t.dragOver ? (
                <Upload size={22} className="text-accent" />
              ) : (
                <Box size={22} className="text-text-muted" />
              )}
              <p className="text-xs text-text-secondary">
                Drop a character image here, drag one from your generations, or{' '}
                <span className="font-medium text-accent">browse</span>
              </p>
              <p className="text-[10px] text-text-muted">
                Full-body or 3/4 view works best — one clear character
              </p>
            </motion.div>
          )}
        </AnimatePresence>
        <input
          ref={t.fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            t.pick(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </div>

      {t.isLocal ? (
        <>
          {/* Step 1: generate mesh */}
          <Card>
            <CardHeader
              step={1}
              title="Generate mesh"
              description="The native 3D engine turns the image into a textured GLB on your ComfyUI box (built into ComfyUI ≥ 0.39 — first run loads the model)."
              action={
                <button
                  type="button"
                  onClick={t.handleGenerate}
                  disabled={!image || busy}
                  className={BTN_PRIMARY}
                >
                  {busy && !t.paintBusy && !t.usBusy && !t.idleBusy && !t.exportBusy && run.mesh === null ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Sparkles size={13} />
                  )}
                  Generate
                </button>
              }
            />
            {run.mesh && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-secondary px-3 py-2">
                <span className="truncate font-mono text-xs text-text-secondary">
                  {t.idleMesh ? t.idleMesh.name : run.mesh.filename}
                </span>
                <MeshActionRow t={t} showDownload />
              </div>
            )}
            {!run.mesh && !t.importedMesh && (
              <p className="text-[11px] text-text-muted">
                Once a mesh exists, <span className="font-medium text-accent">Skin</span>{' '}
                (Hunyuan3D-Paint),{' '}
                <span className="font-medium text-accent">Upscale</span> (UltraShape 1.0) and{' '}
                <span className="font-medium text-accent">Idle</span> (breathing + blinks) buttons
                appear here — or import a .glb below to work on an existing model.
              </p>
            )}
          </Card>

          {/* Already have a mesh? import it and skip Step 1 */}
          <Card>
            <CardHeader
              icon={Upload}
              title="Have a mesh already?"
              description="Pick a .glb from your computer — then Skin (Hunyuan3D-Paint), Upscale (UltraShape 1.0 refine), Idle (breathing + blinks) or go straight to Rig."
              action={
                <button
                  type="button"
                  onClick={() => !busy && t.glbRef.current?.click()}
                  disabled={busy || t.pickLock}
                  className={clsx(BTN_GHOST, 'shrink-0')}
                >
                  <Upload size={13} />
                  Choose .glb
                </button>
              }
            />
            {t.importedMesh && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2">
                <span className="truncate font-mono text-xs text-accent">
                  {t.idleMesh ? t.idleMesh.name : t.importedMesh.name}
                </span>
                <MeshActionRow t={t} onClear={t.clearImported} />
              </div>
            )}
            <input
              ref={t.glbRef}
              type="file"
              accept=".glb,model/gltf-binary"
              className="hidden"
              onChange={(e) => {
                t.pickGlb(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </Card>

          {/* Game-ready export: LODs + collision proxy on MeshTools */}
          <Card>
            <CardHeader
              icon={Package}
              title="Export for game"
              description="Clean, decimate and export LODs plus an optional collision proxy — all local MeshTools nodes."
              action={
                <button
                  type="button"
                  onClick={t.handleGameExport}
                  disabled={!hasMesh || busy}
                  className={BTN_PRIMARY}
                >
                  {t.exportBusy ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Package size={13} />
                  )}
                  Export
                </button>
              }
            />

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[10px] font-medium uppercase tracking-wider text-text-muted">
                  Budget
                </label>
                <Dropdown
                  value={threeD.gameExportPreset}
                  onChange={(gameExportPreset) => setThreeD({ gameExportPreset })}
                  disabled={busy}
                  options={GAME_EXPORT_PRESETS.map((p) => ({
                    value: p.value,
                    label: `${p.label} · ${p.faces.toLocaleString()}`,
                  }))}
                  ariaLabel="Game export triangle budget"
                  className="text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-medium uppercase tracking-wider text-text-muted">
                  LODs
                </label>
                <Dropdown
                  value={threeD.gameExportLods}
                  onChange={(gameExportLods) => setThreeD({ gameExportLods: Number(gameExportLods) })}
                  disabled={busy}
                  options={GAME_EXPORT_LODS.map((n) => ({
                    value: n,
                    label: `${n} level${n > 1 ? 's' : ''}`,
                  }))}
                  ariaLabel="Number of LODs"
                  className="text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              {[
                ['gameExportCollision', 'Collision proxy'],
                ['gameExportSmooth', 'Smooth normals'],
                ['gameExportCleanup', 'Remove floaters'],
                ['gameExportUnwrap', 'Re-unwrap UVs'],
              ].map(([key, label]) => (
                <label
                  key={key}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-bg-secondary px-2 py-1.5 text-[11px] text-text-secondary"
                >
                  <input
                    type="checkbox"
                    checked={threeD[key] !== false}
                    onChange={(e) => setThreeD({ [key]: e.target.checked })}
                    disabled={busy}
                    className="accent-accent"
                  />
                  {label}
                </label>
              ))}
            </div>

            <p className="text-[10px] leading-relaxed text-text-muted">
              Exports GLB{threeD.gameExportUnwrap ? ' with fresh UVs' : ''}; textured models keep
              their original atlas. Collision is a low-poly proxy — mark it “convex” in your engine.
            </p>

            {run.exports?.length > 0 && (
              <div className="space-y-1.5 border-t border-border pt-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                  Last export
                </p>
                {run.exports.map((r) => (
                  <div
                    key={`${r.subfolder}/${r.filename}`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border bg-bg-secondary px-2.5 py-1.5"
                  >
                    <span className="min-w-0 truncate font-mono text-[11px] text-text-secondary">
                      {r.label} · {r.filename}
                    </span>
                    <button
                      type="button"
                      onClick={() => t.download(r)}
                      className={clsx(BTN_GHOST, 'shrink-0 px-2 py-1')}
                    >
                      <Download size={12} />
                      Save
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Step 2: rig + optional animation */}
          <Card disabled={!canRig}>
            <CardHeader
              step={2}
              title={`Rig${t.animSel.length > 0 ? ` & ${t.animSel.length} anim${t.animSel.length > 1 ? 's' : ''}` : ''}`}
              description={
                <>
                  MIA auto-rigs the mesh
                  {t.animSel.length > 0 ? (
                    <>
                      {' '}
                      and applies{' '}
                      <span className="font-mono text-accent">
                        {t.animSel.map(prettyAnim).join(', ')}
                      </span>
                    </>
                  ) : (
                    ' (skips animation)'
                  )}
                  . Output: FBX ready for Godot/Unity.
                </>
              }
              action={
                <button
                  type="button"
                  onClick={t.handleRig}
                  disabled={!canRig || busy || t.pickLock}
                  className={BTN_PRIMARY}
                >
                  {busy && !t.usBusy && !t.exportBusy && run.stage === 'working' && hasMesh ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Hammer size={13} />
                  )}
                  {t.animSel.length > 0 ? 'Rig & animate' : 'Rig only'}
                </button>
              }
            />

            <div className="space-y-1">
              <label className="text-xs text-text-secondary">Mesh</label>
              <Dropdown
                editable
                value={t.serverMesh}
                onChange={t.setServerMesh}
                disabled={busy}
                options={[
                  { value: '', label: 'Panel mesh (generated / imported)' },
                  ...t.meshHints.map((h) => ({ value: h, label: h })),
                ]}
                ariaLabel="Server mesh file"
                className="text-xs"
              />
              <p className="text-[10px] text-text-muted">
                {t.idleMesh?.file || t.importedMesh?.file
                  ? `Using “${t.idleMesh?.name || t.importedMesh?.name}” from this panel (uploads it, no restart needed).`
                  : t.serverMesh.trim()
                    ? `Using server file “${t.serverMesh.trim()}” as-is — no upload, no restart.`
                    : run.mesh?.filename
                      ? `Using “${run.mesh.filename}” from this panel (uploads it, no restart needed).`
                      : 'No mesh yet — generate/import one, or type a file already on the server (e.g. 3d/hero.glb).'}
              </p>
            </div>

            <AnimationPicker t={t} />
          </Card>
        </>
      ) : (
        /* Tripo pipeline: one chain */
        <Card>
          <p className="flex items-center gap-2 text-sm font-semibold">
            <StepBadge n={1} />
            Generate, rig & animate
          </p>
          <p className="-mt-1 text-[11px] text-text-muted">
            One Tripo cloud job: image → model → skeleton → preset animation. Requires ComfyUI
            signed in to comfy.org (Settings → API keys) and uses your Tripo credits.
          </p>
          <div className="space-y-1">
            <label className="text-xs text-text-secondary">Animation preset</label>
            <Dropdown
              value={t.presetSel}
              onChange={t.setPresetSel}
              disabled={busy}
              options={
                t.presets.length === 0
                  ? [{ value: t.presetSel, label: t.presetSel }]
                  : t.presets.map((o) => ({ value: o, label: o.replace('preset:', '') }))
              }
              ariaLabel="Animation preset"
              className="text-xs"
            />
            <p className="text-[10px] text-text-muted">
              {t.presets.length > 0
                ? `${t.presets.length} presets on server (walk, run, jump, …)`
                : 'Preset list not loaded — using the saved selection'}
            </p>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={t.handleGenerate}
              disabled={!image || busy}
              className={BTN_PRIMARY}
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              Generate & animate
            </button>
          </div>
        </Card>
      )}

      <p className="text-[10px] text-text-muted/70">
        Pipeline: {threeD.pipeline === 'tripo' ? 'Tripo cloud' : 'local'} · change it in Settings → 3D.
      </p>
    </div>
  )
}
