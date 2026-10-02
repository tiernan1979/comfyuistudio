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
- **Idle model unloading** — tells ComfyUI to free VRAM after 5 minutes without generations (configurable)
- **On-disk deployment config** — instance settings live in a `config.json` file, not in the code

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
docker compose up -d --build
```

### Option C — from source (development)

Requires Node 20+.

```bash
npm install
npm run dev        # dev server with hot reload
npm run build      # production build into dist/
```

## Configuration

Instance configuration lives in **[`public/config.json`](public/config.json)** — a plain file on disk, mounted read-only into the container by `docker-compose.yml`. Edit it, run `docker compose restart`, done. No rebuild needed.

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
  "models": { /* image / video / edit model filenames for your ComfyUI install */ }
}
```

**Precedence:** `config.json` only seeds browsers that have **no saved settings yet**. Anything you change in the in-app Settings screen is stored in that browser and wins from then on. To re-seed a browser from the config file, clear the site's local storage.

**API keys are never read from disk.** OpenAI / Anthropic keys are typed into the Settings screen and stay in that browser's local storage — `config.json` only carries non-secret values, and the loader strips any `key` fields defensively.

All other settings (ComfyUI URL, models, providers, SearXNG URL) can also be changed in the in-app **Settings** dialog.

### What you need running

| Feature | Needs |
|---|---|
| Image generation | ComfyUI + Qwen-Image models (UNet, CLIP, VAE) |
| Edit mode | ComfyUI + `qwen_image_edit_*.safetensors` in `models/diffusion_models/` |
| Video generation | ComfyUI + Wan 2.1 models |
| AI prompt writer | LM Studio running, or an OpenAI/Anthropic API key |
| Web image search | A SearXNG instance with JSON format enabled (`search.formats: [html, json]`) |

The ComfyUI URL is set in Settings (or `config.json`); with the default `useProxy` enabled, all traffic flows through the app's `/proxy/...` nginx route, so plain HTTP backends work even though the UI runs in a browser.

## Repository layout

```
public/config.json        deployment config (mounted into the container)
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
