import { Box } from 'lucide-react'
import { describeNode } from '../../lib/threed'
import { SectionTitle, SelectField, ToggleRow } from './fields'
import LocalThreeDFields from './threeD/LocalThreeDFields'
import TripoThreeDFields from './threeD/TripoThreeDFields'

function CheckResult({ check, checking, enabled, pipeline }) {
  if (checking) {
    return <p className="text-[11px] text-text-muted">Checking the ComfyUI server for required 3D nodes…</p>
  }
  if (!check) return null

  if (check.missing?.length > 0) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-[11px] leading-relaxed text-red-300">
        <p className="font-semibold">Can't enable the 3D tab — required node(s) missing on the server:</p>
        <ul className="mt-1 list-inside list-disc space-y-0.5">
          {check.missing.map((n) => (
            <li key={n}>{describeNode(n)}</li>
          ))}
        </ul>
        <p className="mt-1.5 text-red-200/80">
          Built-in nodes mean your ComfyUI is too old — update ComfyUI to ≥ 0.39 and restart it. MIA/UniRig entries
          go into <span className="font-mono">custom_nodes/</span> (pip install -r requirements.txt inside each
          pack), then restart ComfyUI and try again.
        </p>
      </div>
    )
  }
  if (check.unreachable) {
    return (
      <p className="text-[11px] text-warning">
        Couldn't verify — ComfyUI isn't reachable at the Server URL above. You can still enable the tab, but it will
        error out when used if the packs aren't installed.
      </p>
    )
  }
  if (check.busy) {
    return (
      <p className="text-[11px] text-warning">
        ComfyUI is busy or stuck and stopped answering, so the nodes couldn't be verified — this isn't a
        missing-pack problem. Finish or interrupt the current run there (Queue → Cancel All), then re-check.
      </p>
    )
  }
  if (check.ok && enabled) {
    return (
      <p className="text-[11px] text-green-400">
        Verified — all required nodes for the {pipeline === 'tripo' ? 'Tripo' : 'local'} pipeline are installed.
      </p>
    )
  }
  return null
}

export default function ThreeDSection({
  localThreeD,
  setLocalThreeD,
  threeDCheck,
  threeDChecking,
  toggleThreeD,
  changePipeline,
  threeDLists,
}) {
  return (
    <div className="space-y-3">
      <SectionTitle icon={Box} title="3D Generation" note="(optional)" />

      <ToggleRow
        title="Enable the 3D tab"
        description="Character image → 3D model → rig → walk / run / jump animation"
        value={!!localThreeD.enabled}
        onChange={toggleThreeD}
        disabled={threeDChecking}
      />

      <CheckResult
        check={threeDCheck}
        checking={threeDChecking}
        enabled={localThreeD.enabled}
        pipeline={localThreeD.pipeline}
      />

      {localThreeD.enabled && (
        <>
          <SelectField
            label="Pipeline"
            value={localThreeD.pipeline}
            onChange={changePipeline}
            options={['local', 'tripo']}
            hint={
              localThreeD.pipeline === 'local'
                ? 'Local: native Pixal3D/TRELLIS.2 mesh + MIA/UniRig rigging run on your own ComfyUI (needs ComfyUI ≥ 0.39).'
                : 'Tripo cloud: one job does model → rig → animation. Needs ComfyUI signed in to comfy.org.'
            }
          />

          {localThreeD.pipeline === 'local' ? (
            <LocalThreeDFields
              localThreeD={localThreeD}
              setLocalThreeD={setLocalThreeD}
              threeDLists={threeDLists}
            />
          ) : (
            <TripoThreeDFields
              localThreeD={localThreeD}
              setLocalThreeD={setLocalThreeD}
              threeDLists={threeDLists}
            />
          )}
        </>
      )}
    </div>
  )
}
