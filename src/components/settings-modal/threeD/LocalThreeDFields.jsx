import { QUALITY_PRESETS } from '../../../lib/config'
import { Note, NumberField, SelectField } from '../fields'

// Local pipeline (Pixal3D/TRELLIS.2 mesh → MIA/UniRig rig → Hunyuan paint →
// UltraShape refine). Every numeric field that participates in a quality preset
// flips the preset to Custom, so the values shown are exactly what will run.
export default function LocalThreeDFields({ localThreeD, setLocalThreeD, threeDLists }) {
  const patch = (p) => setLocalThreeD((t) => ({ ...t, ...p }))
  const patchCustom = (p) => setLocalThreeD((t) => ({ ...t, ...p, qualityPreset: 'custom' }))

  return (
    <>
      <SelectField
        label="3D engine"
        value={localThreeD.meshMode || 'pixal3d'}
        onChange={(v) => patch({ meshMode: v })}
        options={[
          ['pixal3d', 'Pixal3D — stable, proven (default)'],
          ['trellis2', 'TRELLIS.2 — newer, sometimes sharper detail'],
        ]}
        hint="Both engines ship built into ComfyUI ≥ 0.39 (no custom pack); models are already in models/diffusion/"
      />
      <SelectField
        label="Quality preset"
        value={localThreeD.qualityPreset || 'standard'}
        onChange={(v) => {
          if (v === 'custom') patch({ qualityPreset: 'custom' })
          else patch({ qualityPreset: v, ...QUALITY_PRESETS[v] })
        }}
        options={[
          ['standard', 'Standard — proven baseline'],
          ['high', 'High — sharper texture & geometry'],
          ['ultra', 'Ultra — 8k texture, maximum detail'],
          ['custom', 'Custom — use the values below as-is'],
        ]}
        hint="One pick sets the whole pipeline — mesh generation, Skin (paint) and Upscale (UltraShape) — so every stage stays matched and file-size friendly (~40 MB GLBs): texture 4096 (8192 on Ultra), VRAM-safe upscaler values for 16GB cards. Past ~30 sampling steps the distilled sampler just burns time. Editing any field below switches to Custom."
      />
      <SelectField
        label="Face fix"
        value={String(localThreeD.faceFix ?? true)}
        onChange={(v) => patch({ faceFix: v === 'true' })}
        options={[
          ['true', 'On — sharpen the face before mesh gen and during Skin'],
          ['false', 'Off — use the picture as-is'],
        ]}
        hint="Faces get ~1-2% of the texture, so this runs a face-focused Qwen edit on your picture before generation, then refines the face on the front paint view to photoreal quality (views 1024px default, texture 4096). Precise face masking switches on automatically when models/detection/mediapipe_face_fp32.safetensors is installed (restart ComfyUI after adding it); until then a low-strength whole-image face pass is used. Any failure falls back to your original picture."
      />
      <SelectField
        label="Skin face blend"
        value={String(localThreeD.hunyuanSkinBlend ?? true)}
        onChange={(v) => patch({ hunyuanSkinBlend: v === 'true' })}
        options={[
          ['true', 'On — paint only the face, keep generated hair/clothes'],
          ['false', 'Off — use the painted texture as-is'],
        ]}
        hint="Hybrid skin: after Skin finishes, the painted face (eyes, lips, skin detail) is blended back into your generated texture, so the paint pass can't blotch the crown hair or orange-tint the neck. Fails safe — on any mismatch it keeps the painted texture unchanged."
      />
      <SelectField
        label="Skin detail views"
        value={String(localThreeD.hunyuanViewUpscale ?? true)}
        onChange={(v) => patch({ hunyuanViewUpscale: v === 'true' })}
        options={[
          ['true', 'On — sharpen views before bake (much crisper faces)'],
          ['false', 'Off — bake from the raw views'],
        ]}
        hint="The face only gets ~2.5% of the texture atlas, so Skin detail views upscales the front view with a local 4x detail model (and feeds the bake views at 2× size) to fill the atlas's real face density instead of upsampling a soft view. Adds a few seconds; free and local."
      />
      <SelectField
        label="Source pre-enhance"
        value={localThreeD.pixalEnhance || 'sharpen'}
        onChange={(v) => patch({ pixalEnhance: v })}
        options={[
          ['none', 'Off — use the source image as-is'],
          ['sharpen', 'Sharpen — local unsharp mask (free)'],
          ['esrgan', 'ESRGAN 4x upscale (local, free — needs a model file)'],
          ['magnific4x', 'Magnific 4x + detail (PAID — comfy.org credits)'],
        ]}
        hint="The mesh bakes texture FROM this image, so a sharper input = sharper face. Mesh generation is always free — only Magnific/Tripo cloud nodes cost credits"
      />
      {localThreeD.pixalEnhance === 'esrgan' && (
        <SelectField
          label="ESRGAN model file"
          value={localThreeD.pixalUpscaleModel || ''}
          onChange={(v) => patch({ pixalUpscaleModel: v })}
          options={threeDLists.upscaleModels}
          hint={
            threeDLists.upscaleModels.length > 0
              ? 'Found on your ComfyUI server'
              : 'No model files found — download a free one (4x-UltraSharp.pth or RealESRGAN_x4plus.pth) into ComfyUI/models/upscale_models/, then restart ComfyUI'
          }
        />
      )}
      <NumberField
        label="Texture size (px)"
        value={localThreeD.pixalTextureSize ?? 4096}
        onChange={(n) => patchCustom({ pixalTextureSize: n })}
        min={512}
        max={8192}
        step={512}
        hint="4096 = sweet spot (~40 MB GLB). 8192 quadruples texture bytes and pushed one run to 159 MB with no visible detail gain"
      />
      <NumberField
        label="Triangle budget"
        value={localThreeD.pixalDecimation ?? 300000}
        onChange={(n) => patchCustom({ pixalDecimation: n })}
        min={5000}
        max={5000000}
        step={50000}
        hint="300k suits most characters; 1M (Pixal's demo default) tripled the file for a smooth model. Oversized meshes are auto-decimated before Upscale anyway"
      />
      <NumberField
        label="Subject crop (px)"
        value={localThreeD.pixalCameraRes ?? 1024}
        onChange={(n) => patchCustom({ pixalCameraRes: n })}
        min={256}
        max={2048}
        step={64}
        hint="Square crop box around the subject before the 3D conditioning (1024 is plenty; does not affect texture resolution)"
      />
      <NumberField
        label="Sampling steps"
        value={localThreeD.pixalSteps ?? 20}
        onChange={(n) => patchCustom({ pixalSteps: n })}
        min={1}
        max={100}
        hint="20 (template default) — shape & upsample samplers; the distilled model gains nothing past ~30 and just burns time"
      />
      <NumberField
        label="Shape guidance"
        value={localThreeD.pixalGuidance ?? 7.5}
        onChange={(n) => patchCustom({ pixalGuidance: n })}
        min={0}
        max={20}
        step={0.1}
        hint="Locks the shape harder to the image (template default 7.5; too high causes artifacts)"
      />
      <SelectField
        label="Voxel remesh at export"
        value={String(localThreeD.pixalRemesh ?? true)}
        onChange={(v) => patchCustom({ pixalRemesh: v === 'true' })}
        options={[
          ['true', 'On — cleans topology for rigging (smooths fine detail)'],
          ['false', 'Off — keeps raw geometry but fragments the UV atlas (distance shimmer)'],
        ]}
        hint="On for every preset: without the remesh the unwelded mesh breaks the UV unwrap into ~23k tiny charts, and texture mip-mapping then bleeds across them (measured 29% seam jumps at distance vs 9% with remesh). Off only if you need maximum micro-geometry and can accept the shimmer"
      />

      <p className="pt-1 text-xs font-semibold text-text-secondary">
        Hunyuan3D paint — Skin button (texture refine)
      </p>
      <NumberField
        label="View render size (px)"
        value={localThreeD.hunyuanViewSize ?? 1024}
        onChange={(n) => patchCustom({ hunyuanViewSize: n })}
        min={128}
        max={1024}
        step={64}
        hint="Per-view repaint resolution — 512 standard / 1024 high+ultra; higher = sharper face and texture, slower Skin. Node caps at 1024."
      />
      <NumberField
        label="Paint texture (px)"
        value={localThreeD.hunyuanTextureSize ?? 4096}
        onChange={(n) => patchCustom({ hunyuanTextureSize: n })}
        min={256}
        max={8192}
        step={512}
        hint="Atlas the Skin pass writes — 4096 recommended (same as generation, keeps the file lean)"
      />
      <NumberField
        label="Paint steps"
        value={localThreeD.hunyuanPaintSteps ?? 10}
        onChange={(n) => patchCustom({ hunyuanPaintSteps: n })}
        min={1}
        max={100}
        hint="10 default — Skin is a light refinement pass, returns diminish past ~20 and it just burns time"
      />
      <NumberField
        label="Paint guidance"
        value={localThreeD.hunyuanGuidance ?? 3}
        onChange={(n) => patchCustom({ hunyuanGuidance: n })}
        min={0}
        max={20}
        step={0.1}
        hint="How hard the repaint follows your photo (3 default; too high copies source-image artifacts into the texture)"
      />
      <SelectField
        label="MIA precision"
        value={localThreeD.miaPrecision}
        onChange={(v) => patch({ miaPrecision: v })}
        options={['fp32']}
        hint="fp32 only — bf16/fp16/auto crash the rig: torch_cluster's farthest-point-sampling kernel has no bf16 support ('_' not implemented for 'BFloat16'). If you have an older saved setting, it gets overridden to fp32 at queue time."
      />
      <SelectField
        label="Default animation"
        value={localThreeD.localAnimationFile}
        onChange={(v) => patch({ localAnimationFile: v })}
        options={threeDLists.localAnims}
        hint="Blanks = rig only. Add FBX files to ComfyUI's input/animation_templates/mixamo/ then restart ComfyUI"
      />

      <p className="pt-1 text-xs font-semibold text-text-secondary">
        UltraShape 1.0 — Upscale button (mesh refine)
      </p>
      <SelectField
        label="Checkpoint"
        value={localThreeD.ultrashapeCheckpoint || 'ultrashape_v1.pt'}
        onChange={(v) => patch({ ultrashapeCheckpoint: v })}
        options={threeDLists.ultrashapeCkpts || []}
        hint={
          (threeDLists.ultrashapeCkpts || []).length > 0
            ? 'Found in ComfyUI/models/UltraShape/ — the Upscale button refines the generated or imported mesh with it'
            : 'Checkpoint not found — put ultrashape_v1.pt in ComfyUI/models/UltraShape/ and run pip install -r requirements.txt inside custom_nodes/ComfyUI-UltraShape1'
        }
      />
      <SelectField
        label="Precision"
        value={localThreeD.ultrashapeDtype || 'bfloat16'}
        onChange={(v) => patch({ ultrashapeDtype: v })}
        options={['float16', 'bfloat16', 'float32']}
        hint="bfloat16 is the pack default; float16 is the safest fallback on older GPUs"
      />
      <SelectField
        label="Low VRAM mode"
        value={String(localThreeD.ultrashapeLowVram !== false)}
        onChange={(v) => patch({ ultrashapeLowVram: v === 'true' })}
        options={[
          ['true', 'On — only the active model on the GPU (default)'],
          ['false', 'Off — everything resident on the GPU'],
        ]}
        hint="On is required for ≤16GB GPUs: off the allocator thrashes (~165 s/step, OOM), on runs ~10 s/step"
      />
      <NumberField
        label="Detail tokens (VRAM)"
        value={localThreeD.ultrashapeNumLatents ?? 16384}
        onChange={(n) => patchCustom({ ultrashapeNumLatents: n })}
        min={0}
        max={131072}
        step={1024}
        hint="Latent tokens through the diffusion model. 16384 fits 16GB (tested 9.8 s/step); 0 = 32768 full quality, needs ~20–24GB"
      />
      <NumberField
        label="Refine steps"
        value={localThreeD.ultrashapeSteps ?? 20}
        onChange={(n) => patchCustom({ ultrashapeSteps: n })}
        min={10}
        max={200}
        step={5}
        hint="≈10 s/step at 16k tokens: 10 ≈ 1.5 min, 20 ≈ 3.5 min, 50 (pack default) ≈ 8 min"
      />
      <NumberField
        label="Guidance scale"
        value={localThreeD.ultrashapeGuidance ?? 5}
        onChange={(n) => patchCustom({ ultrashapeGuidance: n })}
        min={1}
        max={15}
        step={0.5}
        hint="How tightly the refine follows your source image (pack default 5.0)"
      />
      <NumberField
        label="Detail resolution (octree)"
        value={localThreeD.ultrashapeOctree ?? 384}
        onChange={(n) => patchCustom({ ultrashapeOctree: n })}
        min={256}
        max={2048}
        step={64}
        hint="384 ≈ 8GB VRAM, 512 ≈ 16GB — higher = sharper detail, much more memory"
      />
      <NumberField
        label="Decode chunks"
        value={localThreeD.ultrashapeNumChunks ?? 8000}
        onChange={(n) => patchCustom({ ultrashapeNumChunks: n })}
        min={1000}
        max={50000}
        step={1000}
        hint="Volume-decode chunk size — lower it to save VRAM (slower)"
      />

      <Note>
        Steps: image → mesh (Pixal3D) → mesh uploaded to input/3d under a unique name → MIA auto-rig → FBX
        download. Mesh loading uses a free path (no dropdown), so uploads and server files just work — no ComfyUI
        restarts. New <em>animation</em> FBX files still need one restart (their picker list is cached at startup).
      </Note>
    </>
  )
}
