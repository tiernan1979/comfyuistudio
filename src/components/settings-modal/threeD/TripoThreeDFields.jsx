import { Note, SelectField } from '../fields'

// Tripo cloud pipeline: one job does model → rig → animation, using the
// account's comfy.org sign-in and Tripo credits.
export default function TripoThreeDFields({ localThreeD, setLocalThreeD, threeDLists }) {
  const patch = (p) => setLocalThreeD((t) => ({ ...t, ...p }))

  return (
    <>
      <SelectField
        label="Image → model version"
        value={localThreeD.tripoModelVersion}
        onChange={(v) => patch({ tripoModelVersion: v })}
        options={threeDLists.modelVersion}
      />
      <SelectField
        label="Texture quality"
        value={localThreeD.tripoTextureQuality || 'extreme'}
        onChange={(v) => patch({ tripoTextureQuality: v })}
        options={[
          ['standard', 'standard'],
          ['detailed', 'detailed — HD textures'],
          ['extreme', 'extreme — 8K ultra textures (best face detail)'],
        ]}
        hint="extreme = Tripo bakes 8K on their GPUs — the sharpest texture path available"
      />
      <SelectField
        label="Geometry quality"
        value={localThreeD.tripoGeometryQuality || 'detailed'}
        onChange={(v) => patch({ tripoGeometryQuality: v })}
        options={[
          ['standard', 'standard (~1.4M faces)'],
          ['detailed', 'detailed (~2M faces)'],
        ]}
      />
      <SelectField
        label="Texture alignment"
        value={localThreeD.tripoTextureAlignment || 'original_image'}
        onChange={(v) => patch({ tripoTextureAlignment: v })}
        options={[
          ['original_image', 'original_image — faithful to your photo (faces!)'],
          ['geometry', 'geometry — UV-optimal'],
        ]}
      />
      <SelectField
        label="PBR material maps"
        value={String(localThreeD.tripoPbr !== false)}
        onChange={(v) => patch({ tripoPbr: v === 'true' })}
        options={[
          ['true', 'On — normal/metallic/roughness maps'],
          ['false', 'Off — base color only (smaller files)'],
        ]}
      />
      <SelectField
        label="Rig version"
        value={localThreeD.tripoRigVersion}
        onChange={(v) => patch({ tripoRigVersion: v })}
        options={threeDLists.rigVersion}
        hint="v1.0 = humanoid biped + 90+ animation presets; v2.5 = creatures (quadruped, bird, …)"
      />
      <SelectField
        label="Skeleton type"
        value={localThreeD.tripoRigType}
        onChange={(v) => patch({ tripoRigType: v })}
        options={threeDLists.rigType}
        hint="auto = Tripo checks the model and picks the skeleton"
      />
      <SelectField
        label="Bone naming"
        value={localThreeD.tripoSpec}
        onChange={(v) => patch({ tripoSpec: v })}
        options={threeDLists.spec}
        hint="Keep tripo — preset animations can't retarget onto mixamo-spec rigs"
      />
      <SelectField
        label="Output format"
        value={localThreeD.tripoOutFormat}
        onChange={(v) => patch({ tripoOutFormat: v })}
        options={threeDLists.outFormat}
      />
      <SelectField
        label="Default animation preset"
        value={localThreeD.tripoPreset}
        onChange={(v) => patch({ tripoPreset: v })}
        options={threeDLists.presets}
        stripPrefix
        hint="Panel default — walk / run / jump / … (presets listed by your server)"
      />

      <Note>
        Tripo nodes call Tripo's cloud API through ComfyUI — sign in to comfy.org (ComfyUI menu → API keys) or jobs
        fail with an auth error. Uses your Tripo credits.
      </Note>
    </>
  )
}
