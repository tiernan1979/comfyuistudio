import { plannerCapDuration } from '../llm.js'
import { isAceStepModel, buildAceStepWorkflow } from './acestep.js'
import { isStableAudioModel } from './acestep.js'
import { buildStableAudioWorkflow } from './stable-audio.js'
import { applyLoudness } from './loudness.js'

// ---------------------------------------------------------------------------
// Music workflow — MiniMax Music 3 (DiT + Music3 text encoder + audio VAE).
// Verified live against ComfyUI 0.37: UNETLoader + CLIPLoader(type 'minimax')
// → MiniMaxMusic3TextEncode (guidance lives HERE, so the sampler runs cfg 1.0
// with a zeroed negative) → KSampler → VAEDecodeAudio → SaveAudio/MP3.
// 8s of music generates in ~20s on an RTX 5060 Ti 16GB.
// ---------------------------------------------------------------------------
// AI-part caption builder: wraps a raw part description ("baseline dum
// dum…", "isolated guitar loop") in a solo-stem production description
// with a hard vocal ban — MiniMax Music 3 otherwise hallucinates singing
// from a bare prompt even with empty lyrics.
const PART_INSTRUMENTAL_BAN =
  'Strictly instrumental — no vocals, no singing, no lyrics, no vocal samples, no choir, no ad-libs.'

export function buildPartCaption(text) {
  const raw = (text || '').trim().replace(/[.\s]+$/, '')
  if (!raw) return ''
  const hasBan = /no vocals|no singing|strictly instrumental|instrumental only/i.test(raw)
  return (
    `${raw} — a soloed stem-like part for a modern track, only the instrument(s) ` +
    `described above, clean dry studio recording, tight and in-tune, continuous ` +
    `loopable phrase, modern mix, high quality production.` +
    (hasBan ? '' : ` ${PART_INSTRUMENTAL_BAN}`)
  )
}

// MiniMax Music3 has NO text negative prompt — the text encoder only takes
// caption + lyrics. (The graph's negative is a zeroed conditioning sampled
// at the official cfg 1.7: guidance amplification, not a text negative.) Users coming from other tools paste "Negative Prompt: ..." blocks
// into the caption; the model would read that list as POSITIVE description
// (literally conditioning on "vocals, singing, ..." — the opposite of the
// intent). Split that section out and re-phrase it as an in-caption ban,
// which is the phrasing that works for this model.
export function splitNegativeSection(text) {
  const s = (text || '').trim()
  const m = s.match(/(?:^|\n|[.!?][ \t]+)(?:negative\s*prompt|avoid)\s*:[ \t]*([\s\S]+)$/i)
  if (!m) return { caption: text || '', banned: [] }
  const banned = m[1]
    .split(/[,;\n]+/)
    .map((x) => x.trim().replace(/[.\s]+$/, ''))
    .filter(Boolean)
  return { caption: s.slice(0, m.index).trim(), banned }
}

function bannedClause(items, existing) {
  const hay = (existing || '').toLowerCase()
  const fresh = []
  for (const raw of items || []) {
    const word = raw.replace(/^no\s+/i, '').trim()
    if (!word || hay.includes(word.toLowerCase())) continue
    fresh.push(word)
  }
  if (!fresh.length) return ''
  const words = fresh.map((w) => 'no ' + w)
  const clause = words.join(', ')
  return ' ' + clause.charAt(0).toUpperCase() + clause.slice(1) + '.'
}

// Default section map used when the lyrics box is empty (and shown as the
// box's default text). MiniMax Music3 treats [Tag] lines as executable song
// structure; a section map is what makes the AR planner actually USE the
// requested duration instead of ending after 15-40s.

export const STRUCTURE_TAGS = '[Intro]\n\n[Verse]\n\n[Pre-Chorus]\n\n[Chorus]\n\n[Post-Chorus]\n\n[Bridge]\n\n[Instrumental]\n\n[Solo]\n\n[Outro]'

function stripStructureTags(text) {
  return (text || '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim()
}

// Lyrics semantics: empty → inject the default section map; tag-only input
// counts as INSTRUMENTAL (the vocal ban still applies — tags describe
// structure, not vocals); real words → sung lyrics, caption left alone.
export function normalizeLyrics(lyrics, structure = true) {
  const t = (lyrics || '').trim()
  const text = t || (structure ? STRUCTURE_TAGS : '')
  return { text, instrumental: stripStructureTags(text) === '' }
}

// Loudness post-processing lives in a shared module because both the MiniMax
// and ACE-Step graphs chain it (see loudness.js).

export function buildMusicWorkflow({
  caption, // style / instrumentation description (the main prompt)
  negativePrompt = '', // merged into an in-caption "no X, no Y" ban clause
  lyrics = '', // sung lyrics; '' = default section map (instrumental)
  structure = true, // inject STRUCTURE_TAGS when lyrics are empty
  // Cap in seconds for the AR structure planner (the music "Max length"
  // knob, 10–360). The planner ends the song when the music is done —
  // this only bounds how long it may keep planning (default 5 minutes).
  // Part/stem generation passes its own short duration explicitly.
  duration = 300,
  seed = -1,
  steps = 30, // official template default
  cfgScale = 1.7, // MiniMaxMusic3TextEncode.cfg_scale (official template)
  quality = '320k', // 'wav' | '320k' | 'V0' | '128k'
  // ACE-Step only: uploaded reference-audio filename (timbre/style source).
  referenceAudio = '',
  // SFX (Studio mode "sfx"): require the ACE-Step engine — MiniMax Music 3
  // cannot render sound effects, so a MiniMax-resolved model is an error.
  forceAce = false,
  // Sound-effect mode: keep the prompt LITERAL. The music caption assembly
  // (the "strictly instrumental — no vocals…" ban clause and folding the
  // negative into the positive) reads as music direction to the audio model
  // and measurably hurts sound-effect fidelity, so SFX uses the raw caption
  // and passes the negative through the engine's own negative conditioning.
  sfx = false,
  models,
}) {
  const actualSeed = seed === -1 ? Math.floor(Math.random() * 2 ** 48) : seed

  // Empty lyrics = instrumental. The model still hallucinates vocals from
  // bare prompts, so pin the intent down in the caption itself (skipped
  // when the caller already bans vocals, e.g. buildPartCaption).
  const { text: lyricText, instrumental } = normalizeLyrics(lyrics, structure)
  const { caption: rawCaption, banned: sectionBanned } = splitNegativeSection(caption)
  const trimmedCaption = (rawCaption || '').trim()
  const hasBan = /no vocals|no singing|strictly instrumental/i.test(trimmedCaption)
  const baseCaption = !instrumental
    ? trimmedCaption
    : hasBan || !trimmedCaption
      ? trimmedCaption || `${PART_INSTRUMENTAL_BAN}`
      : `${trimmedCaption.replace(/[.\s]+$/, '')}. ${PART_INSTRUMENTAL_BAN}`
  const negItems = [
    ...sectionBanned,
    ...(negativePrompt || '').split(/[,;\n]+/).map((x) => x.trim().replace(/[.\s]+$/, '')).filter(Boolean),
  ]
  // SFX keeps the caption literal (no ban clause / negative folding).
  const fullCaption = sfx ? trimmedCaption : baseCaption + bannedClause(negItems, baseCaption)

  // ACE-Step 1.5 (ComfyUI-ACE-Step) shares the MiniMax music slot but has a
  // completely different stack (qwen ACE text encoders / AIO checkpoint, its
  // own latent + encoder). Detect it and build its graph from the resolved
  // { ace } assets instead of the MiniMax trio.
  if (forceAce && !isAceStepModel(models.unet) && !models.ace) {
    throw new Error(
      'SFX needs the ACE-Step engine — no ACE-Step model resolved on the ComfyUI server. ' +
        'Install ace_step_1.5_turbo_aio.safetensors in models/checkpoints/.',
    )
  }
  if (isAceStepModel(models.unet) || models.ace) {
    if (!models.ace) {
      throw new Error(
        `ACE-Step music model "${models.unet}" needs its text encoder/VAE resolved on the ComfyUI server — ` +
          'either the AIO checkpoint (ace_step_1.5_*_aio*.safetensors) or the split set ' +
          '(qwen_0.6b_ace15 + qwen_1.7b_ace15 text encoders + ace_1.5_vae). ' +
          'Install the missing files or pick MiniMax Music 3 in Settings → Music Models.',
      )
    }
    return buildAceStepWorkflow({
      caption: fullCaption, lyrics: lyricText, duration, seed: actualSeed, quality, cfgScale, referenceAudio, models,
    })
  }

  // Stable Audio 3 — the SFX-oriented engine. Shares the music slot but has a
  // completely different native-node stack (CheckpointLoaderSimple + a T5Gemma
  // text encoder via CLIPLoader type 'stable_audio' + ConditioningStableAudio).
  // Its `stable` assets are resolved by resolveStableAudioModels in comfyui.js.
  if (isStableAudioModel(models.unet) || models.engine === 'stable_audio') {
    if (!models.stable) {
      throw new Error(
        'Stable Audio 3 needs its checkpoint + text encoder resolved on the ComfyUI server — ' +
          'stable_audio_3_*.safetensors in models/checkpoints/ and t5gemma_b_b_ul2.safetensors ' +
          'in models/text_encoders/. Pick it in Settings → Models → Music.',
      )
    }
    return buildStableAudioWorkflow({
      caption: fullCaption,
      negativePrompt: (negativePrompt || '').trim(),
      duration,
      seed: actualSeed,
      quality,
      subfolder: sfx ? 'sfx' : 'music',
      models,
    })
  }

  const wf = {
    '37': {
      class_type: 'UNETLoader',
      inputs: {
        unet_name: models.unet,
        weight_dtype: 'default',
      },
    },
    '38': {
      class_type: 'CLIPLoader',
      inputs: {
        clip_name: models.clip,
        type: 'minimax',
        device: 'default',
      },
    },
    '39': {
      class_type: 'VAELoader',
      inputs: {
        vae_name: models.vae,
      },
    },
    '40': {
      class_type: 'MiniMaxMusic3TextEncode',
      inputs: {
        clip: ['38', 0],
        caption: fullCaption,
        lyrics: lyricText,
        seed: actualSeed,
        // Cap set ABOVE the requested length (see plannerCapDuration): the
        // planner ends the song when the music is done, so a cap pinned at
        // the request makes the cap the limiter — a 240s ask came back 2:47.
        // The section count drives the real length; headroom just stops the
        // ceiling from cutting it short.
        max_duration: plannerCapDuration(duration),
        cfg_scale: cfgScale,
        top_k: 50,
      },
    },
    '41': {
      class_type: 'EmptyMiniMaxMusic3LatentAudio',
      inputs: {
        // Linked to the text encoder's `seconds` output: the AR structure
        // planner inside MiniMaxMusic3TextEncode can end the song BEFORE
        // max_duration (`<|audio_end|>`). If the latent is sized to the
        // REQUESTED duration instead of the PLANNED one, the DiT samples
        // tens of seconds with no structure plan behind them — the weird,
        // drifting tail users hear in the last 30-60s of a 2-minute mp3.
        // The encode runs first (it feeds the KSampler anyway), so comfy
        // resolves this as a plain float at execution time.
        seconds: ['40', 1],
        batch_size: 1,
      },
    },
    '42': {
      class_type: 'ConditioningZeroOut',
      inputs: {
        conditioning: ['40', 0],
      },
    },
    '3': {
      class_type: 'KSampler',
      inputs: {
        model: ['37', 0],
        positive: ['40', 0],
        negative: ['42', 0],
        latent_image: ['41', 0],
        seed: actualSeed,
        control_after_generate: 'randomize',
        steps,
        // Official ComfyUI template: euler + simple scheduler, cfg 1.7
        // against the zeroed negative (flow-matching model — the old
        // cfg 1.0/normal pairing suppressed CFG entirely).
        cfg: 1.7,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1,
      },
    },
    '8': {
      // Tiled audio decode: the plain VAEDecodeAudio OOMs at the final
      // decode on a 16 GB card (TE + DIT still resident), which burns
      // minutes in failed cudaMalloc retries before ComfyUI falls back
      // to tiling anyway. Tiling from the start is the same result,
      // without the VRAM death spiral.
      class_type: 'VAEDecodeAudioTiled',
      inputs: {
        samples: ['3', 0],
        vae: ['39', 0],
        // Official template value: fewer, longer tiles than the old 512;
        // still far below a full-track decode, which OOMs on 16 GB with
        // the TE + DIT resident.
        tile_size: 1536,
        overlap: 64,
      },
    },
  }

  // Dead-air trim (custom node comfy_nodes/AudioTailTrim.py): MiniMax fills
  // the planned length exactly, so when the song is musically done early
  // the tail is silence codes (measured up to 7.5s on a 30s track). Trim
  // before save so the stored mp3 every client downloads is clean.
  let saveAudio = ['8', 0]
  const loud = applyLoudness(wf, 70, saveAudio, models)
  saveAudio = loud.audioRef
  if (models.trimAudio) {
    wf['55'] = {
      class_type: 'AudioTailTrim',
      inputs: { audio: saveAudio, threshold_db: -50, min_silence: 0.4, keep_tail: 0.3 },
    }
    saveAudio = ['55', 0]
  }

  if (quality === 'wav') {
    wf['60'] = {
      class_type: 'SaveAudio',
      inputs: {
        audio: saveAudio,
        filename_prefix: 'music/track',
      },
    }
  } else {
    wf['60'] = {
      class_type: 'SaveAudioMP3',
      inputs: {
        audio: saveAudio,
        filename_prefix: 'music/track',
        quality: quality === 'V0' || quality === '128k' || quality === '320k' ? quality : '320k',
      },
    }
  }

  return wf
}
