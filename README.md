# ComfyUI Studio

A self-hosted web UI for [ComfyUI](https://github.com/comfyanonymous/ComfyUI) — generate images, videos, music and 3D models, edit existing images, and assemble everything on a multi-track timeline from one clean interface.

Static frontend (React + Vite) served by nginx; every external request (ComfyUI, image search, LLM APIs) goes through a built-in dynamic reverse proxy on the same origin, so there is no backend to configure and no CORS to fight. Optional companion services add a LAN REST API and an MCP server for driving generation from other tools.

## Features

- **Image generation** — Qwen-Image (or the lighter Qwen-Image-2.1) workflows with aspect ratio, steps, CFG, turbo mode, seed control
- **Music generation** — MiniMax Music 3 or ACE-Step 1.5 XL (turbo) with prompt, lyrics (with structure tags), output quality (`wav` / `320k` / `V0` / `128k`); MiniMax exposes steps + guidance
- **Music editor** — a multi-track timeline for generated/imported audio (see [Music editor](#music-editor--stem-splitting)):
  - add clips from files on disk, from ComfyUI history, or the current generation
  - split / copy / delete clips, cut or mute time ranges, loop, zoom, undo/redo
  - **stem splitting** two ways:
    - *DSP split* (instant, no models) — drums / bass / vocals / synth via HPSS + center-aware bands
    - *AI split* (server) — htdemucs 6-source → UVR Karaoke → FoxJoy Reverb gives **drums / bass / guitar / piano / other / reverb / lead / backing**
  - **AI part presets** — generate a bassline, drum beat, guitar riff, keys, pad, lead, strings or percussion loop into the timeline (MiniMax Music 3)
  - export the arrangement as a WAV mixdown
- **Video generation** — Wan 2.1 text-to-video, or MiniMax H3 (videos carry audio) with resolution, frames, FPS controls
- **Edit mode** — upload an image (or pick one from the web) and change it with Qwen-Image-Edit
- **3D generation** (optional) — character image → 3D model → auto-rig → walk/run/jump animation:
  - *Local pipeline*: [TRELLIS.2](https://huggingface.co/Comfy-Org/TRELLIS.2) or [Pixal3D](https://github.com/TencentARC/Pixal3D) image → GLB (engines are built into ComfyUI ≥ 0.39), optional face fix (MediaPipe mask), ESRGAN enhance, UltraShape upscale, then MIA/UniRig auto-rig (+ Mixamo animations) on your own ComfyUI
  - *Tripo pipeline*: one cloud job — image → model → rig → 116 preset animations (needs ComfyUI signed in to comfy.org)
- **History** — last 100 generations kept in the browser, synced live across **every browser, window, origin and device**: the UI refreshes ~1s after any job finishes anywhere (each session watches the ComfyUI websocket), with a 20s safety-net poll on top; entries are shared through the Studio API's durable store (so they survive ComfyUI restarts and match on `http://host:5555` and `https://…` alike), deletions sync through the shared hidden-ids list; plus saved prompts/bookmarks
- **Style presets + offline Enhance** — expand a plain sentence into a detailed prompt without any AI server
- **AI prompt writer** (optional) — rewrites your idea into a full prompt and picks a web search query. Providers:
  - LM Studio (local, default)
  - OpenAI (ChatGPT)
  - Anthropic (Claude)
  - any OpenAI-compatible endpoint (OpenRouter, Groq, Ollama, vLLM, …)
- **Web image search → edit** — search [SearXNG](https://github.com/searxng/searxng), Serper, SerpAPI, Brave or Google CSE, click a result, and use it as the edit source
- **LAN REST API** (optional) — generate image/edit/video/music, read models/history/queue from any device on your LAN ([api/](api/))
- **MCP server** (optional) — drive the Studio REST API from Claude / any MCP client ([mcp/](mcp/))
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
    environment:
      - NODE_ENV=production
    extra_hosts:
      # Lets the container reach services on the Docker host by name,
      # e.g. LM Studio at http://host.docker.internal:1234
      - "host.docker.internal:host-gateway"
    volumes:
      # Deployment config (Settings → Save writes it here) — persists
      # across rebuilds; every browser/device shares it.
      - studio-config:/configdir
    restart: unless-stopped

  # Optional LAN REST API (generate, models, history, shared hidden-ids).
  studio-api:
    build:
      context: .
      dockerfile: api/Dockerfile
    ports:
      - "5557:5557"
    environment:
      - COMFYUI_URL=http://10.1.1.102:8188   # your ComfyUI server
      - API_KEY=                             # set to require Bearer auth
    restart: unless-stopped
    volumes:
      - studio-api-data:/app/data

volumes:
  studio-config:
  studio-api-data:
EOF

# use the prebuilt image
docker compose pull && docker compose up -d

# ...or build locally instead
./deploy.sh               # = docker compose build && up -d; backs up and
                          #   restores config.json (covers the migration
                          #   from images without the volume)
```

### Option C — from source (development)

Requires Node 20+.

```bash
npm install
npm run dev        # dev server with hot reload
npm run build      # production build into dist/
```

## Configuration

Instance configuration lives in **[`public/config.json`](public/config.json)**, baked into the image as the seed, then stored in the **`studio-config` docker volume** (`/configdir/config.json`). It is served with `Cache-Control: no-store` and the in-app **Settings → Save** writes an updated copy back through nginx's WebDAV `PUT /config.json` — no rebuild, no shell access, and every browser picks the change up on its next load (or on **Settings → Update from server**, which pulls on demand).

> **Rebuilds keep your settings** — the volume outlives `docker compose up -d --build` and image pulls. `./deploy.sh` additionally backs up and restores the live config, covering stacks that predate the volume.

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
  "models": {
    "image": { "unet": "...", "clip": "...", "vae": "...", "lora": "" },
    "video": { "unet": "...", "clip": "...", "vae": "..." },
    "edit":  { "unet": "..." },
    "music": { "unet": "minimax_music3_dit_int8_convrot.safetensors",
               "clip": "minimax_music3_text_encoder_pruned_int8_convrot.safetensors",
               "vae":  "minimax_music3_dav.safetensors" }
  },
  "threeD": {
    "enabled": false,             // show the 3D tab
    "pipeline": "local",          // local = TRELLIS.2/Pixal3D + MIA (free), tripo = Tripo cloud (paid credits)
    "pixalModelRepo": "TencentARC/Pixal3D",
    "pixalEnhance": "sharpen",    // none | sharpen | esrgan (free, local) | magnific4x (paid)
    "faceFix": true,              // MediaPipe face mask on the paint pass
    "tripoPreset": "preset:walk"  // default animation (walk/run/jump/…)
  }
}
```

**Precedence:** a fresh browser (no saved settings yet) always seeds from `config.json`. After any **Settings → Save** the file carries `synced: true`, and from then on every browser applies it on load — change a setting once, it shows up everywhere. **Settings → Update from server** force-pulls the saved config on demand (useful when another device saved after this one loaded). Settings you made before that still win until the first Save. To re-seed one browser from scratch, clear the site's local storage.

**What syncs:** server URL, models (image/video/edit/music), 3D options, per-mode generation settings (steps/cfg/seeds/resolution/quality), style, search and AI-provider config. **API keys never sync** — they stay in the browser that typed them.

**API keys are never read from disk.** OpenAI / Anthropic keys are typed into the Settings screen and stay in that browser's local storage — `config.json` only carries non-secret values, and the loader strips any `key` fields defensively.

All other settings (ComfyUI URL, models, providers, SearXNG URL) can also be changed in the in-app **Settings** dialog.

### What you need running

| Feature | Needs |
|---|---|
| Image generation | ComfyUI + Qwen-Image models (see [Models](#models)) |
| Edit mode | ComfyUI + `qwen_image_edit_*.safetensors` (see [Models](#models)) |
| Video generation | ComfyUI + Wan 2.1 or MiniMax H3 models |
| Music generation | ComfyUI + MiniMax Music 3 or ACE-Step 1.5 models |
| Music editor — timeline, DSP stems, mixdown | nothing extra (client-side only) |
| Music editor — **AI stems** | ComfyUI + the **AudioSeparation** node pack (see [Stem splitting](#music-editor--stem-splitting)) |
| AI part presets | ComfyUI + the music models above |
| 3D (local pipeline) | ComfyUI ≥ 0.39 + the **Hunyuan3D-Paint**, **UltraShape** and **UniRig** node packs + 3D models |
| 3D (Tripo pipeline) | ComfyUI signed in to comfy.org (Menu → API keys) + Tripo credits (no local models) |
| AI prompt writer | LM Studio running, or an OpenAI/Anthropic API key |
| Web image search | A search backend: SearXNG (self-hosted, free), or Serper/SerpAPI/Brave/Google CSE keys |
| LAN REST API | the `studio-api` compose service (Node 20+, no other deps) |
| MCP server | the Studio REST API + an MCP client (Claude, …) |

The ComfyUI URL is set in Settings (or `config.json`); with the default `useProxy` enabled, all traffic flows through the app's `/proxy/...` nginx route, so plain HTTP backends work even though the UI runs in a browser.

## Music editor & stem splitting

The **Scissors / Open in Studio** button on a generated track (or *Add file* / *From history* in the editor) opens a multi-track timeline: clips can be selected, split at the playhead, copied, deleted, or cut/muted over a time range, with undo/redo, looping, per-track gain/pan/mute/solo, and a WAV mixdown export.

**Stems — two buttons, two strategies:**

| | DSP **Stems** | **AI Stems** |
|---|---|---|
| Speed | instant | ~1–2 min per clip on the server |
| Models | none (pure browser DSP) | AudioSeparation node pack |
| Output | drums / bass / vocals / synth | drums / bass / guitar / piano / other / reverb / lead / backing |
| How | HPSS with center-aware band routing | htdemucs 6-source → UVR Karaoke (lead/backing) + FoxJoy Reverb (dry/reverb of `other`) |

The DSP split is an approximation (side-channel doubles and kick bleed are inherent), but it always works offline. The AI split uploads/reuses your clip's audio, runs the three-stage chain above on ComfyUI, and pulls back MP3 320k stems trimmed to the clip's length:

- Clips loaded **from the server reuse the file already there** — `input/` files go straight to `LoadAudio`; `output/` files (your generations) are reused by re-uploading their original bytes (usually a few MB), not a WAV re-encode, so long tracks no longer hit ComfyUI's 100 MB upload limit (HTTP 413).
- Clips added **from local disk** are WAV-uploaded; a clear error tells you to trim/split the clip if it would exceed the limit. Mono clips are upmixed to stereo automatically (the separation demixer rejects mono).
- Stem tracks are cached per source clip — re-splitting after an undo is instant.

### Stem separation — node pack & models

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/set-soft/AudioSeparation
pip install seconohe
# restart ComfyUI after installing
```

The three models the chain uses (**Hybrid Transformer 6 sources**, **UVR Karaoke**, **FoxJoy Reverb HQ**) auto-download from Hugging Face on first use — no manual model setup. The app probes for the nodes before queueing and tells you if the pack is missing (the DSP button keeps working either way).

> Optional: [kijai/ComfyUI-MelBandRoFormer](https://github.com/kijai/ComfyUI-MelBandRoFormer) is a high-quality vocal/instrument band model also used on this server — it is *not* required by the Studio's chain (on an already-separated vocals stem it passes audio through instead of splitting lead/backing, which is why UVR Karaoke does that stage).

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

### Edit mode — Qwen-Image-Edit

| File | Put in | Download |
|---|---|---|
| `qwen_image_edit_fp8_e4m3fn.safetensors` | `models/diffusion_models/` | [Comfy-Org/Qwen-Image-Edit_ComfyUI](https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_edit_fp8_e4m3fn.safetensors) |

Edit mode reuses the image text encoder + VAE above; newer variants
(`qwen_image_edit_2509_*`, `qwen_image_edit_2511_*`) from the same repo work too.

Optional — precise face mask for the 3D **face fix** setting (Settings → 3D):

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

### Video generation — MiniMax H3 (with audio)

Pick any `minimax_h3_*` file in Settings → Video Models and the app switches to the
native H3 workflow (videos carry an audio track):

| File | Put in | Download |
|---|---|---|
| `minimax_h3_fl2va_pruned_int8_convrot.safetensors` | `models/diffusion_models/` | [Comfy-Org/MiniMax-H3](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors) |
| `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` | `models/text_encoders/` | [Comfy-Org/MiniMax-H3](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors) |
| `minimax_h3_video_vae_fp16.safetensors` | `models/vae/` | [Comfy-Org/MiniMax-H3](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_video_vae_fp16.safetensors) |
| `minimax_h3_audio_vae_fp32.safetensors` | `models/vae/` | [Comfy-Org/MiniMax-H3](https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_audio_vae_fp32.safetensors) |

The audio VAE is required — the app checks for it before queueing.

### Music generation — MiniMax Music 3

| File | Put in | Download |
|---|---|---|
| `minimax_music3_dit_int8_convrot.safetensors` | `models/diffusion_models/` | [Comfy-Org/MiniMax-Music-3](https://huggingface.co/Comfy-Org/MiniMax-Music-3/resolve/main/diffusion_models/minimax_music3_dit_int8_convrot.safetensors) |
| `minimax_music3_text_encoder_pruned_int8_convrot.safetensors` | `models/text_encoders/` | [Comfy-Org/MiniMax-Music-3](https://huggingface.co/Comfy-Org/MiniMax-Music-3/resolve/main/text_encoders/minimax_music3_text_encoder_pruned_int8_convrot.safetensors) |
| `minimax_music3_dav.safetensors` | `models/vae/` | [Comfy-Org/MiniMax-Music-3](https://huggingface.co/Comfy-Org/MiniMax-Music-3/resolve/main/vae/minimax_music3_dav.safetensors) |

`minimax_music3_dit_fp16.safetensors` from the same repo is the full-precision DiT if
you have the VRAM. Music is subject to the [MiniMax community license](https://huggingface.co/MiniMaxAI/MiniMax-Music3/blob/main/LICENSE).

### Music generation — ACE-Step 1.5 XL (alternative)

Select the ACE unet in Settings → Music Models and the app/API switch to the official
ACE-Step graph automatically (8 steps, cfg 1, `ModelSamplingAuraFlow`). Either shape works:

| File | Put in | Notes |
|---|---|---|
| `ace_step_1.5_turbo_aio.safetensors` | `models/checkpoints/` | **Recommended** — AIO checkpoint carrying unet + text encoders + VAE in one file |
| `acestep_v1.5_xl_turbo_bf16.safetensors` | `models/diffusion_models/` | Split path — needs the two qwen encoders below + the VAE |
| `qwen_0.6b_ace15.safetensors` | `models/text_encoders/` | Split path only (slot 1 of DualCLIPLoader) |
| `qwen_1.7b_ace15.safetensors` | `models/text_encoders/` | Split path (slot 2); alone it is not enough |
| `ace_1.5_vae.safetensors` | `models/vae/` | Split path VAE |

All from [Comfy-Org/ace_step_1.5_ComfyUI_files](https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files).
A single-clip split (1.7B only, no 0.6B) fails server-side — use the AIO checkpoint on
such installs; the app resolves this for you and reports what's missing.

ACE auto-sizes track length the same way MiniMax Music 3 does: when the MiniMax music3
text encoder (`minimax_music3_text_encoder_pruned_int8_convrot.safetensors`) is on the
server, the graph adds the MiniMax AR structure planner and lets the model decide how
long the song wants to be (tiny lyric → ~25 s, full song → a few minutes) — the Max
length setting is the planner's `max_duration` cap (default 300 s / 5 min, range
10–360). Without that encoder, ACE falls back to rendering exactly the requested
duration. API/MCP callers can override the cap per run via `settings.duration` (10–360).

**Clean endings:** both engines fill their planned length exactly, so when the song is
musically done early the tail is dead air (up to ~7 s measured). Install the bundled
tail-trim node to fix this:

1. Copy [`comfy_nodes/AudioTailTrim.py`](comfy_nodes/AudioTailTrim.py) into your
   ComfyUI folder's `custom_nodes/` directory.
2. Restart ComfyUI (the node is a plain Python file with no extra dependencies — pure
   `torch`, already shipped with ComfyUI).
3. Reload the Studio tab. The app probes the server for the node on load and, when it
   finds it, wires every music graph as decode → **trim** → save: the saved mp3 ends at
   the last audible sample (RMS-based, −50 dBFS threshold, 0.3 s tail kept, short fade
   to avoid clicks). Without the file everything still works — tracks just keep their
   silent tail.

**Reference audio — what it actually does (and doesn't):** with an ACE unet selected,
Settings → Music shows a **Reference audio** picker. It feeds the uploaded track into
ACE's `ReferenceTimbreAudio` node, which extracts low-level *sonic texture* — synth
tones, vocal timbre, mix character — and conditions the generation on it. Think of it
as "produce the new song with the same gear and mix," not "copy this song."

**It does NOT grab notes, melody, chords, or song structure.** Those come from your
caption and lyrics (or from ACE's LM planner). If you upload Avicii's *Levels* and
write pop lyrics, the result will fight itself — the reference pushes an instrumental
EDM texture while the lyrics pull toward a vocal song. For "make something with a
similar vibe," a detailed caption (genre, BPM, instruments, production style) works
better than a reference. Reference audio is most useful for matching a specific vocal
timbre or synth palette across multiple generations.

**Cover / Repaint (editing an existing MP3) is not available in ComfyUI yet.**
ACE-Step 1.5 supports Cover mode — feed it a source song and it re-synthesizes it
with new style/lyrics while keeping the melody and chord structure — but ComfyUI's
native `TextEncodeAceStepAudio1.5` node only exposes text inputs; there is no socket
for source audio or audio codes. Comfy-Org lists Cover/Repaint as "Coming Soon."
Until then, the closest option is the third-party
[ACE-Step-ComfyUI](https://github.com/ace-step/ACE-Step-ComfyUI) node pack, which
supports Cover/Repaint but requires running a separate ACE-Step inference server
(`acestep-openrouter`) alongside ComfyUI — it is an API client, not a native node.

The file wires in via the native `ReferenceTimbreAudio` node (ComfyUI ≥ 0.39, already
present on stock installs — no extra install). MiniMax Music 3 has no equivalent node,
so the picker only appears when an ACE unet is selected.

For long tracks (full songs), install the bundled sampling node so the whole track's
timbre is captured instead of just the first N seconds (ComfyUI's native path encodes
the full file then truncates to the generation length — a 4 min track generating a
90 s song only feeds the intro):

1. Copy [`comfy_nodes/ReferenceAudioPrep.py`](comfy_nodes/ReferenceAudioPrep.py) into
   your ComfyUI folder's `custom_nodes/` directory.
2. Restart ComfyUI (the node is a plain Python file — pure `torch` + `torchaudio`,
   already shipped with ComfyUI).
3. Reload the Studio tab. The app probes for the node and, when present, samples three
   10 s windows (intro / middle / outro) from long uploads into a single 30 s clip
   before VAE-encoding — matching ACE-Step's own backend behaviour.

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
- **AI stem models** — auto-download through the AudioSeparation node pack (see [Stem separation — node pack & models](#stem-separation--node-pack--models)).

## LAN REST API

The optional `studio-api` service ([api/](api/)) exposes generation over HTTP for other
devices and scripts. It talks straight to your ComfyUI server and stores shared data in
its own docker volume:

| Route | Purpose |
|---|---|
| `GET /api/health` | Studio API + ComfyUI reachability |
| `POST /api/generate` | generate image / edit / video / music (blocks until done, or `wait=false` + poll). Per-mode knobs live in `settings` (e.g. `settings.upscale: "auto"` detail-upscales images when 4x-UltraSharp is installed) |
| `POST /api/generate` (modes `3d` / `skin` / `meshupscale`) | 3D flows — image→GLB, picture→skinned GLB, UltraShape mesh refine. Always block (5–45 min, `timeoutSec` up to 60min); `3d` takes `imageBase64`, `skin`/`meshupscale` take `imageBase64` + `mesh: {filename, subfolder?, type?}` (or `meshBase64`) |
| `GET /api/job/:promptId` | status of one graph generation (optional `?wait=true`) |
| `GET /api/models` | model files per mode + the defaults the API would use |
| `GET /api/history` / `GET /api/queue` | durable shared history (live ComfyUI merged in) / queue |
| `POST /api/history` | browsers upload their local-only entries so every origin/device converges |
| `POST /api/cancel` | interrupt the running generation |
| `GET /api/file` | fetch a generated file |
| `GET/POST /api/hidden-ids` | shared delete list — history deletions sync across browsers/devices |

Set `API_KEY` in compose to require `Authorization: Bearer <key>` on every route.
The web UI itself uses `/api/history` + `/api/hidden-ids` (nginx forwards `/api/` to this
service), so running it gives every browser/origin the same history — deletions included —
and history survives ComfyUI restarts (its own `/history` is in-memory).

## MCP server

[mcp/](mcp/) is an MCP stdio server that drives the Studio REST API — add it to Claude
or any MCP client to generate from chat:

```bash
cd mcp && npm install
# in your MCP client config:
#   { "command": "node", "args": ["…/mcp/index.mjs"],
#     "env": { "STUDIO_API_URL": "http://localhost:5557", "STUDIO_API_KEY": "" } }
```

Tools: `generate_image` (with optional `upscale`), `edit_image`, `generate_video`,
`generate_music`, `generate_3d`, `skin_mesh`, `upscale_mesh`,
`get_models`, `get_history`, `get_queue`, `get_job` (with `wait`), `cancel`,
`get_status`.

### Linking with other tools (HomeClaw, OpenClaw, automations)

- **MCP side by side** — MCP clients run multiple servers at once: register
  `comfyui-studio` next to HomeClaw's `homeclaw` server in the same config and the
  assistant can say *"turn off the lights"* (HomeClaw) and *"generate a cover image"*
  (Studio) in one conversation:

  ```json
  { "mcpServers": {
      "homeclaw":   { "command": "…/mcp-server.js" },
      "comfyuistudio": { "command": "node", "args": ["…/mcp/index.mjs"],
                         "env": { "STUDIO_API_URL": "http://localhost:5557" } }
  } }
  ```

- **Webhooks → REST API** — anything that can POST HTTP (HomeClaw webhooks, cron,
  Home Assistant) can trigger a generation and poll for the file:

  ```bash
  curl -X POST http://localhost:5557/api/generate \
    -H 'content-type: application/json' -H 'Authorization: Bearer <API_KEY>' \
    -d '{"mode":"image","prompt":"a red bicycle in the rain","wait":true}'
  ```

- **Full ComfyUI coverage** — the Studio API/MCP intentionally cover the four
  generative modes (image / edit / video / music) plus reads. If you need *everything*
  a ComfyUI server can do (3D, stems, custom node graphs), talk to ComfyUI directly:
  `POST /prompt` with any workflow executes it — that is the complete, unlimited
  surface, and the Studio is a friendly layer on top of it.


## Repository layout

```
public/config.json        deployment config seed (baked into the image; live copy lives in the studio-config volume, updated by Settings → Save)
src/lib/                  comfyui client, workflows, stems (DSP) + stemsAI (server chain), llm, search, config loader
src/components/           UI (MusicEditor = multi-track timeline, ThreeDPanel, players, settings)
src/store/useStore.js     persisted app state (Zustand)
nginx.conf                SPA, dynamic /proxy/<host>/<port>/... reverse proxy, WebDAV config PUT, /api/ → studio-api
api/                      optional LAN REST API service (port 5557)
mcp/                      optional MCP stdio server on top of the REST API
Dockerfile                multi-stage: npm ci + vite build → nginx
.github/workflows/        builds the image and publishes to GHCR
```

## CI / publishing

On every push to `main` or `master`, and on `v*.*.*` tags, GitHub Actions builds the Docker image (linux/amd64 + linux/arm64) and pushes it to GitHub Container Registry with tags like `latest`, `master-<sha>`, and the version number. Pull requests build without pushing.

## License

[MIT](LICENSE)
