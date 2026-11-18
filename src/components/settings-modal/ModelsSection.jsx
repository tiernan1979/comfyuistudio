import { motion } from 'framer-motion'
import { FolderSearch, HardDrive, RefreshCw } from 'lucide-react'
import ModelPresets from './ModelPresets'
import { SectionTitle, Note, ModelField } from './fields'
import { filterModelOptions } from '../../lib/modelFilters'
import { isH3ImageClip, isH3ImageModel, isH3ImageVae } from '../../lib/workflows'
import { DEFAULT_MODELS } from '../../store/defaults.js'

function Divider() {
  return <hr className="border-border" />
}

// Every picker is scoped to files the current pipeline can load. ComfyUI
// exposes one flat list per file type, which otherwise mixes image, video,
// music, audio and 3D models in every dropdown.
function PipelineModelField({ section, slot, list, ...props }) {
  return (
    <ModelField
      {...props}
      filtered
      options={filterModelOptions(section, slot, list || [])}
    />
  )
}

export default function ModelsSection({
  localUrl,
  loadModelLists,
  loadingLists,
  listsError,
  modelLists,
  localModels,
  setLocalModels,
  imageDraft,
  setImageDraft,
  editDraft,
  setEditDraft,
  videoDraft,
  setVideoDraft,
  sfxDraft,
  setSfxDraft,
}) {
  const editModel = (key, patch) => setLocalModels((m) => ({ ...m, [key]: { ...(m[key] || {}), ...patch } }))
  const imageModel = imageDraft || {}
  const count = (key) => (modelLists[key] || []).length

  // H3 and Qwen use different text encoders and VAEs even though both now
  // appear in the image dropdowns. Switch the companion files when the UNET
  // family changes so a preset can't be saved as a mismatched half-stack.
  const setImageUnet = (unet) => {
    const firstH3 = (slot) =>
      filterModelOptions('h3image', slot, modelLists[slot] || [])[0]
    const firstQwen = (slot, isH3) =>
      filterModelOptions('image', slot, modelLists[slot] || []).find((n) => !isH3(n))
    setImageDraft((draft) => {
      const next = { ...draft, unet }
      if (isH3ImageModel(unet)) {
        if (!isH3ImageClip(next.clip)) {
          next.clip = firstH3('clip') || DEFAULT_MODELS.h3image.clip
        }
        if (!isH3ImageVae(next.vae)) {
          next.vae = firstH3('vae') || DEFAULT_MODELS.h3image.vae
        }
        next.lora = ''
      } else if (isH3ImageClip(next.clip) || isH3ImageVae(next.vae)) {
        next.clip = firstQwen('clip', isH3ImageClip) || DEFAULT_MODELS.image.clip
        next.vae = firstQwen('vae', isH3ImageVae) || DEFAULT_MODELS.image.vae
      }
      return next
    })
  }

  return (
    <>
      <div className="rounded-lg border border-border bg-bg-card px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-xs text-text-secondary">
            <FolderSearch size={14} className="text-accent" />
            Model files on your ComfyUI server
          </span>
          <motion.button
            type="button"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => loadModelLists(localUrl)}
            disabled={loadingLists}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-bg-hover px-2.5 py-1 text-[11px] transition-colors hover:border-accent/40 hover:bg-accent/20 hover:text-accent disabled:opacity-50"
          >
            <RefreshCw size={12} className={loadingLists ? 'animate-spin' : ''} />
            {loadingLists ? 'Loading...' : 'Refresh'}
          </motion.button>
        </div>
        {listsError && <p className="mt-1.5 text-[11px] text-warning">{listsError}</p>}
        {!listsError && !loadingLists && (
          <p className="mt-1.5 text-[11px] text-text-muted">
            UNET: {count('unet')} · GGUF: {count('gguf')} · CLIP: {count('clip')} · VAE: {count('vae')} · LoRA:{' '}
            {count('lora')} · Checkpoint: {count('checkpoint')}
          </p>
        )}
      </div>

      <Note>
        Model dropdowns are filtered per pipeline: image sections list Qwen-Image and MiniMax H3 Image files,
        video only Wan / MiniMax H3 video, music only MiniMax Music / ACE-Step, and so on. An existing value that
        is not in the filtered list is flagged so it can be replaced.
      </Note>

      <div className="space-y-3">
        <SectionTitle icon={HardDrive} title="Image Models (Qwen-Image)" />
        <Note>
          Image presets can use Qwen-Image or MiniMax H3 Image. Selecting an H3 UNET automatically
          swaps the text encoder and VAE to the matching H3 stack. H3 runs its own conditioning
          graph; Textures, PBR, Sprites and Image Edit still use the Qwen fallback. SDXL or Flux
          checkpoints need a different pipeline rather than just different filenames.
        </Note>
        <ModelPresets mode="image" editDraft={imageModel} setEditDraft={setImageDraft} />
        <PipelineModelField
          section="image"
          slot="unet"
          label="Diffusion Model (UNET)"
          value={imageModel.unet || ''}
          onChange={setImageUnet}
          list={modelLists.unet}
          placeholder="qwen_image_fp8_e4m3fn.safetensors"
        />
        <PipelineModelField
          section="image"
          slot="clip"
          label="Text Encoder (CLIP)"
          value={imageModel.clip || ''}
          onChange={(v) => setImageDraft((d) => ({ ...d, clip: v }))}
          list={modelLists.clip}
          placeholder="qwen_2.5_vl_7b_fp8_scaled.safetensors"
        />
        <PipelineModelField
          section="image"
          slot="vae"
          label="VAE"
          value={imageModel.vae || ''}
          onChange={(v) => setImageDraft((d) => ({ ...d, vae: v }))}
          list={modelLists.vae}
          placeholder="qwen_image_vae.safetensors"
        />
        <PipelineModelField
          section="image"
          slot="lora"
          label="LoRA (optional, for turbo mode)"
          value={imageModel.lora || ''}
          onChange={(v) => setImageDraft((d) => ({ ...d, lora: v }))}
          list={modelLists.lora}
          placeholder="Qwen-Image-Lightning-8steps-V1.0.safetensors"
        />
      </div>

      <Divider />

      <div className="space-y-3">
        <SectionTitle icon={HardDrive} title="MiniMax H3 Image Models" tone="text-cyan-400" />
        <Note>
          A separate 16MP text-to-image stack. It needs the{' '}
          <span className="font-mono">MiniMaxH3ImageConditioning</span> node (ComfyUI 0.45+),
          the H3 32B text encoder (not the Qwen3.5 prompt expander) and H3's image VAE.
        </Note>
        <PipelineModelField
          section="h3image"
          slot="unet"
          label="Diffusion Model (UNET)"
          value={localModels.h3image?.unet || ''}
          onChange={(v) => editModel('h3image', { unet: v })}
          list={modelLists.unet}
          placeholder="minimax_h3_image_pruned_w4a8.safetensors"
        />
        <PipelineModelField
          section="h3image"
          slot="clip"
          label="Text Encoder (H3 32B)"
          value={localModels.h3image?.clip || ''}
          onChange={(v) => editModel('h3image', { clip: v })}
          list={modelLists.clip}
          placeholder="qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
        />
        <PipelineModelField
          section="h3image"
          slot="vae"
          label="Image VAE"
          value={localModels.h3image?.vae || ''}
          onChange={(v) => editModel('h3image', { vae: v })}
          list={modelLists.vae}
          placeholder="minimax_h3_image_vae_fp16.safetensors"
        />
      </div>

      <Divider />

      <div className="space-y-3">
        <SectionTitle icon={HardDrive} title="Pixel Art Models (SDXL + Pixel Art XL)" tone="text-amber-400" />
        <p className="text-[11px] text-text-muted">
          Separate from the Qwen image stack. Pixel Art mode loads an SDXL checkpoint from{' '}
          <span className="font-mono">models/checkpoints</span> and the Pixel Art XL LoRA from{' '}
          <span className="font-mono">models/loras</span>.
        </p>
        <PipelineModelField
          section="pixel"
          slot="checkpoint"
          label="SDXL Checkpoint"
          value={localModels.pixel?.ckpt || ''}
          onChange={(v) => editModel('pixel', { ckpt: v })}
          list={modelLists.checkpoint}
          placeholder="sd_xl_base_1.0_0.9vae.safetensors"
        />
        <PipelineModelField
          section="pixel"
          slot="lora"
          label="Pixel Art XL LoRA"
          value={localModels.pixel?.lora || ''}
          onChange={(v) => editModel('pixel', { lora: v })}
          list={modelLists.lora}
          placeholder="pixel-art-xl.safetensors"
        />
      </div>

      <Divider />

      <div className="space-y-3">
        <SectionTitle icon={HardDrive} title="Image Edit Model (Qwen-Image-Edit)" tone="text-green-400" />
        <p className="text-[11px] text-text-muted">Uses the same text encoder + VAE as image mode above.</p>
        <PipelineModelField
          section="edit"
          slot="unet"
          label="Edit Diffusion Model (UNET)"
          value={localModels.edit?.unet || ''}
          onChange={(v) => editModel('edit', { unet: v })}
          list={modelLists.unet}
          placeholder="qwen_image_edit_fp8_e4m3fn.safetensors"
        />
      </div>

      <Divider />

      <div className="space-y-3">
        <SectionTitle icon={HardDrive} title="Video Models" tone="text-purple-400" />
        <Note>
          These dropdowns only list video-capable files from <span className="font-mono">models/unet</span> —
          image, music and 3D models are hidden. Video mode needs a VIDEO model plus its text encoder and VAE. Good
          picks for a 16GB card: <span className="text-text-secondary">Wan 2.1 t2v 1.3B</span> (fast, ~7GB),{' '}
          <span className="text-text-secondary">Wan 2.2 TI2V-5B</span> (best quality/VRAM balance),{' '}
          <span className="text-text-secondary">Wan 2.1/2.2 14B GGUF Q4</span> (highest quality, ~10–12GB), or{' '}
          <span className="text-text-secondary">LTX-Video 13B Q4</span> (very fast). Wan needs{' '}
          <span className="font-mono">umt5_xxl</span> as CLIP and <span className="font-mono">Wan2.1_VAE</span>.
          MiniMax H3 uses a different stack (<span className="font-mono">qwen3vl_32b_minimax_h3</span> text encoder,
          an H3 video VAE and an H3 audio VAE) — it auto-corrects a mismatched pick but the fields below let you pin
          the exact files.
        </Note>
        <ModelPresets mode="video" editDraft={videoDraft} setEditDraft={setVideoDraft} />
        <PipelineModelField
          section="video"
          slot="unet"
          label="Diffusion Model (UNET)"
          value={videoDraft.unet || ''}
          onChange={(v) => setVideoDraft((d) => ({ ...d, unet: v }))}
          list={modelLists.unet}
          placeholder="wan2.1_t2v_1.3B_bf16.safetensors"
        />
        <PipelineModelField
          section="video"
          slot="clip"
          label="Text Encoder (CLIP)"
          value={videoDraft.clip || ''}
          onChange={(v) => setVideoDraft((d) => ({ ...d, clip: v }))}
          list={modelLists.clip}
          placeholder="umt5_xxl_fp8_e4m3fn_scaled.safetensors"
        />
        <PipelineModelField
          section="video"
          slot="vae"
          label="VAE"
          value={videoDraft.vae || ''}
          onChange={(v) => setVideoDraft((d) => ({ ...d, vae: v }))}
          list={modelLists.vae}
          placeholder="Wan2.1_VAE.safetensors"
        />
        <PipelineModelField
          section="video"
          slot="vaeAudio"
          label="Audio VAE (MiniMax H3)"
          value={videoDraft.vaeAudio || ''}
          onChange={(v) => setVideoDraft((d) => ({ ...d, vaeAudio: v }))}
          list={modelLists.vae}
          placeholder="minimax_h3_audio_vae_fp32.safetensors (empty = auto)"
        />
        <PipelineModelField
          section="video"
          slot="lora"
          label="Turbo LoRA (optional — MiniMax H3, sample at 4–8 steps)"
          value={videoDraft.lora || ''}
          onChange={(v) => setVideoDraft((d) => ({ ...d, lora: v }))}
          list={modelLists.lora}
          placeholder="minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors"
        />
      </div>

      <Divider />

      <div className="space-y-3">
        <SectionTitle icon={HardDrive} title="Character video (WAN 2.2 — Sprites engine)" tone="text-orange-400" />
        <Note>
          Used by Sprites → Engine → <span className="text-text-secondary">Video (WAN 2.2)</span>: two GGUF experts
          (high-noise + low-noise, 4-step lightx2v distill — ~9.7 GB each from{' '}
          <span className="font-mono">jayn7/WAN2.2-I2V_A14B-DISTILL-LIGHTX2V-4STEP-GGUF</span> in{' '}
          <span className="font-mono">models/unet/</span>) plus the <span className="font-mono">umt5_xxl</span> text
          encoder and the <span className="font-mono">Wan 2.1 VAE</span>. Requires the ComfyUI-GGUF node pack.
        </Note>
        <PipelineModelField
          section="character"
          slot="gguf"
          label="High-noise expert (GGUF)"
          value={localModels.character?.high || ''}
          onChange={(v) => editModel('character', { high: v })}
          list={modelLists.gguf || []}
          placeholder="wan2.2_i2v_A14b_high_noise_lightx2v_4step-Q4_K_M.gguf"
        />
        <PipelineModelField
          section="character"
          slot="gguf"
          label="Low-noise expert (GGUF)"
          value={localModels.character?.low || ''}
          onChange={(v) => editModel('character', { low: v })}
          list={modelLists.gguf || []}
          placeholder="wan2.2_i2v_A14b_low_noise_lightx2v_4step-Q4_K_M.gguf"
        />
        <PipelineModelField
          section="character"
          slot="clip"
          label="WAN text encoder (CLIP)"
          value={localModels.character?.clip || ''}
          onChange={(v) => editModel('character', { clip: v })}
          list={modelLists.clip}
          placeholder="umt5_xxl_fp8_e4m3fn_scaled.safetensors"
        />
        <PipelineModelField
          section="character"
          slot="vae"
          label="WAN VAE"
          value={localModels.character?.vae || ''}
          onChange={(v) => editModel('character', { vae: v })}
          list={modelLists.vae}
          placeholder="Wan2.1_VAE.safetensors"
        />
      </div>

      <Divider />

      <div className="space-y-3">
        <SectionTitle icon={HardDrive} title="Music Models" tone="text-pink-400" />
        <Note>
          Music mode generates full songs (style + optional sung lyrics) locally on your ComfyUI. Pick a preset below
          to load its model files into the fields, then tweak and Save. ACE-Step 1.5 assets resolve automatically
          (single AIO checkpoint, or split qwen encoders + ACE VAE). Generated tracks open in the built-in Studio
          editor for multi-track arrangement (split, trim, fades, layers, WAV export).
        </Note>
        <ModelPresets mode="music" editDraft={editDraft} setEditDraft={setEditDraft} />
        <PipelineModelField
          section="music"
          slot="unet"
          label="Music Diffusion Model (UNET)"
          value={editDraft.unet || ''}
          onChange={(v) => setEditDraft((d) => ({ ...d, unet: v }))}
          list={[...new Set([...(modelLists.unet || []), ...(modelLists.checkpoint || [])])]}
          placeholder="minimax_music3_dit_int8_convrot.safetensors"
        />
        <PipelineModelField
          section="music"
          slot="clip"
          label="Music Text Encoder (CLIP)"
          value={editDraft.clip || ''}
          onChange={(v) => setEditDraft((d) => ({ ...d, clip: v }))}
          list={modelLists.clip}
          placeholder="minimax_music3_text_encoder_pruned_int8_convrot.safetensors"
        />
        <PipelineModelField
          section="music"
          slot="vae"
          label="Audio VAE"
          value={editDraft.vae || ''}
          onChange={(v) => setEditDraft((d) => ({ ...d, vae: v }))}
          list={modelLists.vae}
          placeholder="minimax_music3_dav.safetensors"
        />
      </div>

      <Divider />

      <div className="space-y-3">
        <SectionTitle icon={HardDrive} title="SFX Models" tone="text-amber-400" />
        <Note>
          The SFX tab renders short, high-quality sound effects with Stable Audio 3 — a checkpoint in{' '}
          <span className="font-mono">models/checkpoints/</span> plus the T5Gemma text encoder in{' '}
          <span className="font-mono">models/text_encoders/</span> (loaded via CLIPLoader type{' '}
          <span className="font-mono">stable_audio</span>). Pick a preset, tweak the file names, then Save.
        </Note>
        <ModelPresets mode="sfx" editDraft={sfxDraft} setEditDraft={setSfxDraft} />
        <PipelineModelField
          section="sfx"
          slot="checkpoint"
          label="Stable Audio Checkpoint"
          value={sfxDraft.unet || ''}
          onChange={(v) => setSfxDraft((d) => ({ ...d, unet: v }))}
          list={modelLists.checkpoint}
          placeholder="stable_audio_3_small_sfx.safetensors"
        />
        <PipelineModelField
          section="sfx"
          slot="clip"
          label="Text Encoder (T5Gemma)"
          value={sfxDraft.clip || ''}
          onChange={(v) => setSfxDraft((d) => ({ ...d, clip: v }))}
          list={modelLists.clip}
          placeholder="t5gemma_b_b_ul2.safetensors"
        />
      </div>
    </>
  )
}
