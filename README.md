# ComfyUI Studio

A self-hosted web UI for [ComfyUI](https://github.com/comfyanonymous/ComfyUI) — generate images, videos, and edit existing images from one clean interface.

Static frontend (React + Vite) served by nginx; every external request (ComfyUI, image search, LLM APIs) goes through a built-in dynamic reverse proxy on the same origin, so there is no backend to configure and no CORS to fight.

## Features

- **Image generation** — Qwen-Image workflows with aspect ratio, steps, CFG, turbo mode, seed control
- **Video generation** — Wan 2.1 text-to-video with resolution, frames, FPS controls
- **Edit mode** — upload an image (or pick one from the web) and change it with Qwen-Image-Edit
- **History** — last 50 generations kept in the browser, with download / copy / restore / delete
- **Style presets + offline Enhance** — expand a plain sentence into a detailed prompt without any AI server
- **AI prompt writer** (optional) — rewrites your idea into a full prompt and picks a web search query. Providers:
  - LM Studio (local, default)
  - OpenAI (ChatGPT)
  - Anthropic (Claude)
  - any OpenAI-compatible endpoint (OpenRouter, Groq, Ollama, vLLM, …)
- **Web image search → edit** — search your own [SearXNG](https://github.com/searxng/searxng), click a result, and use it as the edit source
- **3D generation** (optional) — character image → 3D model → auto-rig → walk/run/jump animation:
  - *Local pipeline*: [Pixal3D](https://github.com/TencentARC/Pixal3D) image → GLB, then MIA/UniRig auto-rig (+ Mixamo animations) on your own ComfyUI
  - *Tripo pipeline*: one cloud job — image → model → rig → 116 preset animations (needs ComfyUI signed in to comfy.org)
- **Idle model unloading** — tells ComfyUI to free VRAM after 5 minutes without generations (configurable)
- **On-disk deployment config** — instance settings live in a `config.json` file, not in the code; Settings → Save writes it back so every browser shares it

## Quick start

### Option A — prebuilt image (GitHub Packages)

The GitHub Actions workflow (`.github/workflows/docker.yml`) builds and publishes `ghcr.io/tiernan1979/comfyuistudio` on every push to `main`/`master` and on version tags.

```bash
docker pull ghcr.io/tiernan1979/comfyuistudio:latest
docker run -d --name comfyui-studio \
  -p 5555:80 \
  --add-host=host.docker.internal:host-gateway \
  ghcr.io/tiernan1979/comfyuistudio:latest
```

Open http://localhost:5555

### Option B — docker compose

```bash
mkdir comfyuistudio
cd comfyuistudio
mkdir public

cat << 'EOF' > docker-compose.yml
services:
  comfyui-studio:
    # Prebuilt image published by GitHub Actions (.github/workflows/docker.yml),
    # or build locally with:  docker compose up -d --build
    image: ghcr.io/tiernan1979/comfyuistudio:latest
    build: .
    ports:
      - "5555:80"
    volumes:
      # Deployment config: edit public/config.json on the host, then
      #    docker compose restart
      # Seeds browsers that have no saved settings yet.
      - ./public/config.json:/usr/share/nginx/html/config.json:ro
    environment:
      - NODE_ENV=production
    restart: unless-stopped
EOF


# use the prebuilt image
docker compose pull && docker compose up -d

# ...or build locally instead
./deploy.sh               # = docker compose build && up -d, but keeps your
                          #   saved Settings (plain `up -d --build` resets
                          #   config.json to defaults)
```

### Option C — from source (development)

Requires Node 20+.

```bash
npm install
npm run dev        # dev server with hot reload
npm run build      # production build into dist/
```

## Configuration

Instance configuration lives in **[`public/config.json`](public/config.json)**, baked into the image. It is served read-only (`Cache-Control: no-store`) and the in-app **Settings → Save** writes an updated copy back into the container through nginx's WebDAV `PUT /config.json` — no rebuild, no shell access, and every browser picks the change up on its next load.

> **Rebuilding the image resets `config.json`** to the baked defaults (it lives in the container, not a volume). Use **`./deploy.sh`** for local builds — it backs up the live config and restores it after the restart.

```jsonc
{
  "serverUrl": "http://127.0.0.1:8188",  // ComfyUI server
  "searchUrl": "",                        // your SearXNG instance (Web button)
  "llmProvider": "lmstudio",              // lmstudio | openai | anthropic | custom
  "llmConfigs": {
    "lmstudio": { "url": "http://host.docker.internal:1234", "model": "" },
    "openai":    { "model": "gpt-4o-mini" },
    "anthropic": { "model": "claude-haiku-4-5" },
    "custom":    { "url": "", "model": "" }
  },
  "models": { /* image / video / edit model filenames for your ComfyUI install */ },
  "threeD": {
    "enabled": false,             // show the 3D tab
    "pipeline": "local",          // local = Pixal3D + MIA (free), tripo = Tripo cloud (paid credits)
    "pixalModelRepo": "TencentARC/Pixal3D",
    "pixalEnhance": "sharpen",    // none | sharpen | esrgan (free, local) | magnific4x (paid)
    "tripoPreset": "preset:walk"  // default animation (walk/run/jump/…)
  }
}
```

**Precedence:** a fresh browser (no saved settings yet) always seeds from `config.json`. After any **Settings → Save** the file carries `synced: true`, and from then on every browser applies it on load — change a setting once, it shows up everywhere. Settings you made before that still win until the first Save. To re-seed one browser from scratch, clear the site's local storage.

**API keys are never read from disk.** OpenAI / Anthropic keys are typed into the Settings screen and stay in that browser's local storage — `config.json` only carries non-secret values, and the loader strips any `key` fields defensively.

All other settings (ComfyUI URL, models, providers, SearXNG URL) can also be changed in the in-app **Settings** dialog.

### What you need running

| Feature | Needs |
|---|---|
| Image generation | ComfyUI + Qwen-Image models (see [Models](#models)) |
| Edit mode | ComfyUI + `qwen_image_edit_*.safetensors` (see [Models](#models)) |
| Video generation | ComfyUI + Wan 2.1 or MiniMax H3 models |
| Music generation | ComfyUI + MiniMax Music 3 models |
| 3D (local pipeline) | ComfyUI ≥ 0.39 + the **Hunyuan3D-Paint**, **UltraShape** and **UniRig** node packs + 3D models |
| 3D (Tripo pipeline) | ComfyUI signed in to comfy.org (Menu → API keys) + Tripo credits (no local models) |
| AI prompt writer | LM Studio running, or an OpenAI/Anthropic API key |
| Web image search | A SearXNG instance with JSON format enabled (`search.formats: [html, json]`) |

The ComfyUI URL is set in Settings (or `config.json`); with the default `useProxy` enabled, all traffic flows through the app's `/proxy/...` nginx route, so plain HTTP backends work even though the UI runs in a browser.

## Models

ComfyUI Studio ships no weights — every feature runs against models installed in your
ComfyUI. Download only what you use. All links are direct Hugging Face `resolve` URLs;
`wget -c` each file into the folder shown (folder names match ComfyUI ≥ 0.39 — on older
builds `models/diffusion_models/` is called `models/unet/`). Quantized `*_int8_convrot`
/ `*_fp8_*` files are the practical choice on 12–16 GB cards; bf16/fp16 equivalents live
in the same repos.

File names in **Settings → Models** must match what you install — the dropdowns list the
files your server actually has, and the app picks up common variants automatically.

### Image generation — Qwen-Image

| File | Put in | Download |
|---|---|---|
| `qwen_image_fp8_e4m3fn.safetensors` | `models/diffusion_models/` | [Comfy-Org/Qwen-Image_ComfyUI](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_fp8_e4m3fn.safetensors) |
| `qwen_2.5_vl_7b_fp8_scaled.safetensors` | `models/text_encoders/` | [Comfy-Org/Qwen-Image_ComfyUI](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors) |
| `qwen_image_vae.safetensors` | `models/vae/` | [Comfy-Org/Qwen-Image_ComfyUI](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors) |

Lighter alternative ([Comfy-Org/Qwen-Image-2.1](https://huggingface.co/Comfy-Org/Qwen-Image-2.1),
used on low-VRAM installs): `qwen_image_2.1_int8_convrot.safetensors` →
`models/diffusion_models/`, `qwen3vl_8b_w4a8.safetensors` → `models/text_encoders/`,
`qwen_image_2.1_vae_bf16.safetensors` → `models/vae/`.

Turbo mode (optional): put `Qwen-Image-Lightning-8steps-V2.0-bf16.safetensors` in
`models/loras/` ([lightx2v/Qwen-Image-Lightning](https://huggingface.co/lightx2v/Qwen-Image-Lightning/resolve/main/Qwen-Image-Lightning-8steps-V2.0-bf16.safetensors))
and select it in Settings → Models → image LoRA.

### Edit mode & face fix — Qwen-Image-Edit

| File | Put in | Download |
|---|---|---|
| `qwen_image_edit_fp8_e4m3fn.safetensors` | `models/diffusion_models/` | [Comfy-Org/Qwen-Image-Edit_ComfyUI](https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_edit_fp8_e4m3fn.safetensors) |

Edit mode reuses the image text encoder + VAE above; newer variants
(`qwen_image_edit_2509_*`, `qwen_image_edit_2511_*`) from the same repo work too.

Optional — precise face mask for the **face fix** feature:

| File | Put in | Download |
|---|---|---|
| `mediapipe_face_fp32.safetensors` | `models/detection/` | [Comfy-Org/mediapipe](https://huggingface.co/Comfy-Org/mediapipe/resolve/main/detection/mediapipe_face_fp32.safetensors) |

Restart ComfyUI after adding it. Without it the face fix still runs, using a
low-strength whole-image pass instead of a face-only mask.

### Video generation — Wan 2.1 (default)

| File | Put in | Download |
|---|---|---|
| `wan2.1_t2v_1.3B_bf16.safetensors` | `models/diffusion_models/` | [Comfy-Org/Wan_2.1_ComfyUI_repackaged](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_t2v_1.3B_bf16.safetensors) |
| `umt5_xxl_fp8_e4m3fn_scaled.safetensors` | `models/text_encoders/` | [Comfy-Org/Wan_2.1_ComfyUI_repackaged](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors) |
| `wan_2.1_vae.safetensors` | `models/vae/` | [Comfy-Org/Wan_2.1_ComfyUI_repackaged](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors) |

Bigger resolutions need the 14B variants (`wan2.1_t2v_14B_*`) from the same repo.

### Video generation — MiniMax H3 (alternative)

Pick any `minimax_h3_*` file in Settings → Video Models and the app switches to the
native H3 workflow:

| File | Put in | Download |
|---|---|---|
| `minimax_h3_fl2va_pruned_int8_convrot.safetensors` | `models/diffusion_models/` | [Comfy-Org/MiniMax-H3](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors) |
| `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` | `models/text_encoders/` | [Comfy-Org/MiniMax-H3](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors) |
| `minimax_h3_video_vae_fp16.safetensors` | `models/vae/` | [Comfy-Org/MiniMax-H3](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_video_vae_fp16.safetensors) |
| `minimax_h3_audio_vae_fp32.safetensors` | `models/vae/` | [Comfy-Org/MiniMax-H3](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_audio_vae_fp32.safetensors) |

H3 videos carry audio, so the audio VAE is required — the app checks for it before
queueing.

### Music generation — MiniMax Music 3

| File | Put in | Download |
|---|---|---|
| `minimax_music3_dit_int8_convrot.safetensors` | `models/diffusion_models/` | [Comfy-Org/MiniMax-Music-3](https://huggingface.co/Comfy-Org/MiniMax-Music-3/resolve/main/diffusion_models/minimax_music3_dit_int8_convrot.safetensors) |
| `minimax_music3_text_encoder_pruned_int8_convrot.safetensors` | `models/text_encoders/` | [Comfy-Org/MiniMax-Music-3](https://huggingface.co/Comfy-Org/MiniMax-Music-3/resolve/main/text_encoders/minimax_music3_text_encoder_pruned_int8_convrot.safetensors) |
| `minimax_music3_dav.safetensors` | `models/vae/` | [Comfy-Org/MiniMax-Music-3](https://huggingface.co/Comfy-Org/MiniMax-Music-3/resolve/main/vae/minimax_music3_dav.safetensors) |

`minimax_music3_dit_fp16.safetensors` from the same repo is the full-precision DiT if
you have the VRAM. Music is subject to the [MiniMax community license](https://huggingface.co/MiniMaxAI/MiniMax-Music3/blob/main/LICENSE).

### 3D generation — engines & shared models

The **TRELLIS.2** and **Pixal3D** engines are built into ComfyUI ≥ 0.39 (no node pack
needed); only their weights must be installed. Settings → 3D lets you switch engines.

| File | Put in | Download | Used by |
|---|---|---|---|
| `trellis_2_int8_convrot.safetensors` | `models/diffusion_models/` | [Comfy-Org/TRELLIS.2](https://huggingface.co/Comfy-Org/TRELLIS.2/resolve/main/diffusion_models/trellis_2_int8_convrot.safetensors) | TRELLIS.2 engine |
| `trellis_2_shape_vae_bf16.safetensors` | `models/vae/` | [Comfy-Org/TRELLIS.2](https://huggingface.co/Comfy-Org/TRELLIS.2/resolve/main/vae/trellis_2_shape_vae_bf16.safetensors) | TRELLIS.2 (+ Pixal3D) |
| `trellis_2_texture_vae_bf16.safetensors` | `models/vae/` | [Comfy-Org/TRELLIS.2](https://huggingface.co/Comfy-Org/TRELLIS.2/resolve/main/vae/trellis_2_texture_vae_bf16.safetensors) | TRELLIS.2 (+ Pixal3D) |
| `pixal3d_int8_convrot.safetensors` | `models/diffusion_models/` | [Comfy-Org/Pixal3D](https://huggingface.co/Comfy-Org/Pixal3D/resolve/main/diffusion_models/pixal3d_int8_convrot.safetensors) | Pixal3D engine |
| `dino_v3_L_naf_fp32.safetensors` | `models/clip_vision/` | [Comfy-Org/Pixal3D](https://huggingface.co/Comfy-Org/Pixal3D/resolve/main/clip_vision/dino_v3_L_naf_fp32.safetensors) | both engines (image conditioning) |
| `birefnet.safetensors` | `models/background_removal/` | [Comfy-Org/BiRefNet](https://huggingface.co/Comfy-Org/BiRefNet/resolve/main/background_removal/birefnet.safetensors) | input cutout (built-in node) |
| `moge_2_vitl_normal_fp16.safetensors` | `models/geometry_estimation/` | [Comfy-Org/MoGe](https://huggingface.co/Comfy-Org/MoGe/resolve/main/geometry_estimation/moge_2_vitl_normal_fp16.safetensors) | Pixal3D camera FOV (built-in node) |
| `ultrashape_v1.pt` | `models/UltraShape/` | [infinith/UltraShape](https://huggingface.co/infinith/UltraShape/resolve/main/ultrashape_v1.pt) | **Upscale** button |

### 3D generation — node packs

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/agenticvibes/ComfyUI-Hunyuan3D-Paint.git   # Paint (texture)
git clone https://github.com/jtydhr88/ComfyUI-UltraShape1.git           # Upscale (refine)
git clone https://github.com/PozzettiAndrea/ComfyUI-UniRig.git          # auto-rig + animate
```

- **Hunyuan3D-Paint** installs its Python deps + C++ rasterizers automatically on load.
- **UltraShape1** additionally needs `pip install -r requirements.txt` inside the pack,
  and `ultrashape_v1.pt` (table above) in `models/UltraShape/`.
- **UniRig** (MIA/UniRig rigging) pulls its rigging models from Hugging Face on first
  run via its `install.py`, which also bundles Blender. Animation presets need Mixamo
  FBX files in `input/animation_templates/mixamo/`.

### 3D generation — Paint models

```
# Hunyuan3D 2.1 PBR paint model (~3.7 GB) → models/diffusers/hunyuan3d-paintpbr-v2-1/
huggingface-cli download tencent/Hunyuan3D-2.1 \
  --include "hunyuan3d-paintpbr-v2-1/*" \
  --local-dir ComfyUI/models/diffusers

# DINOv2 image encoder (~4.5 GB) → models/clip_vision/dinov2-giant/
huggingface-cli download facebook/dinov2-giant \
  --local-dir ComfyUI/models/clip_vision/dinov2-giant
```

### Texture enhance / image upscale — ESRGAN

Used by the 3D *enhance* setting (`esrgan`) and the `1080p-fast` image preset:

| File | Put in | Download |
|---|---|---|
| `4x-UltraSharp.pth` | `models/upscale_models/` | [Kim2091/UltraSharp](https://huggingface.co/Kim2091/UltraSharp/resolve/main/4x-UltraSharp.pth) |
| `RealESRGAN_x4plus.pth` (alt) | `models/upscale_models/` | [xinntao/Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth) |

### Not needed locally

- **Tripo / Meshy pipelines** — cloud jobs; only a comfy.org sign-in (+ credits) is required.
- **AI prompt writer** — LM Studio or an OpenAI/Anthropic key; no ComfyUI model.

## Repository layout

```
public/config.json        deployment config (baked into the image, updated by Settings → Save)
src/lib/                  comfyui client, workflows, llm client, search, config loader
src/store/useStore.js     persisted app state (Zustand)
src/components/           UI
nginx.conf                SPA + dynamic /proxy/<host>/<port>/... reverse proxy
Dockerfile                multi-stage: npm ci + vite build → nginx
.github/workflows/        builds the image and publishes to GHCR
```

## CI / publishing

On every push to `main` or `master`, and on `v*.*.*` tags, GitHub Actions builds the Docker image (linux/amd64 + linux/arm64) and pushes it to GitHub Container Registry with tags like `latest`, `master-<sha>`, and the version number. Pull requests build without pushing.

## License

[MIT](LICENSE)
