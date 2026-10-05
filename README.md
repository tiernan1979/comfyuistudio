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

> The package is private until you change it: on GitHub open **Packages → comfyuistudio → Package settings → Change visibility → Public**.

### Option B — docker compose

```bash
git clone https://github.com/tiernan1979/comfyuistudio.git
cd comfyuistudio

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
| Image generation | ComfyUI + Qwen-Image models (UNet, CLIP, VAE) |
| Edit mode | ComfyUI + `qwen_image_edit_*.safetensors` in `models/diffusion_models/` |
| Video generation | ComfyUI + Wan 2.1 models |
| 3D (local pipeline) | ComfyUI + the **Pixal3D** and **MIA/UniRig** node packs; animation FBX files in `input/animation_templates/mixamo/` |
| 3D (Tripo pipeline) | ComfyUI signed in to comfy.org (Menu → API keys) + Tripo credits |
| AI prompt writer | LM Studio running, or an OpenAI/Anthropic API key |
| Web image search | A SearXNG instance with JSON format enabled (`search.formats: [html, json]`) |

The ComfyUI URL is set in Settings (or `config.json`); with the default `useProxy` enabled, all traffic flows through the app's `/proxy/...` nginx route, so plain HTTP backends work even though the UI runs in a browser.

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
