// Per-mode system prompts. The old shared prompt assumed images ("subject,
// environment, lighting…") — in music/video mode it wrote picture prompts.
export function buildRewriteSystem(styleLabel, mode) {
  if (mode === 'music') {
    return (
      'You are an expert song-writer for AI text-to-music models (MiniMax Music 3 / ACE-Step in ComfyUI).\n' +
      'Turn the user\'s idea into a complete song package. Reply ONLY with a JSON object, no markdown:\n' +
      '{"title":"","prompt":"...","lyrics":"...","duration":0,"search_query":""}\n' +
      '\n' +
      'prompt — ONE caption, 50–120 words, plain text, two sections:\n' +
      'Global Metadata: genre, BPM, key/mode, mood, listening scenario, production profile (specific\n' +
      'instruments, groove, texture — vague adjectives make short songs). Do NOT put BPM/key in the\n' +
      'Arrangement — they belong in Global Metadata only.\n' +
      'When a STYLE RESEARCH block is included after the user\'s request, GROUND the Global Metadata\n' +
      'and Arrangement in its concrete details — real BPM range, era, signature instruments, production\n' +
      'techniques, vocal character, song structure — so the result actually sounds like that artist.\n' +
      'This is MANDATORY, not optional: you MUST name the artist\'s signature instruments and production\n' +
      'tricks from the research in the Global Metadata (e.g. a folk-house artist needs the banjo/acoustic\n' +
      'guitar/folk melody named, a lo-fi artist needs the vinyl crackle/warm tape named). Writing a\n' +
      'generic genre description ("electronic dance music, layered synths, festival atmosphere") when\n' +
      'the research lists specific signature sounds is a critical failure — the song will not sound\n' +
      'like the artist. Pull the BPM/key from the research too; do not invent a round number.\n' +
      'Summarize the sound in your own words; never quote the research verbatim and never put the\n' +
      'artist\'s name in the caption or the lyrics.\n' +
      'Arrangement: a section-by-section map of the WHOLE song with time spans. Account for every\n' +
      'minute. EVERY section needs a time span, including instrumentals — "1:30–2:00 extended guitar\n' +
      'solo" tells the model how long; a bare tag lets it compress to a few seconds. Match the style:\n' +
      'ballads get intro→verse→chorus→verse→chorus→bridge→chorus→outro; electronic gets intro→build→\n' +
      'drop→breakdown→build→drop→outro; rock gets verses with guitar solos between. There is no negative\n' +
      'prompt — fold exclusions into a short positive ban ("no vocals, no choir"). Artist/style refs\n' +
      '("Avicii style") shape genre/BPM/arrangement/production but NEVER appear in lyrics.\n' +
      '\n' +
      'lyrics — section tags, each on its own line in square brackets, a blank line after every tag:\n' +
      '[Intro] [Verse] [Pre-Chorus] [Chorus] [Post-Chorus] [Bridge] [Outro]\n' +
      '[Instrumental] [Guitar Solo] [Piano Interlude] [Drum Break] [Build] [Drop] [Breakdown]\n' +
      'EVERY song must start with [Intro] and end with [Outro] — no exceptions.\n' +
      'Tags can carry ONE modifier after a dash: [Chorus - anthemic], [Bridge - whispered],\n' +
      '[Guitar Solo - expressive], [Instrumental - extended]. Never stack more than one modifier.\n' +
      'Use descriptive instrumental tags instead of bare [Instrumental] when you can — [Guitar Solo],\n' +
      '[Piano Interlude], [Drum Break] give the model more to work with and the sections last longer.\n' +
      'Do NOT invent new tag names like [Drop + Chorus 3] or [Final Chorus 4] — use the standard\n' +
      'tags above with at most one dash modifier. Numbers in tags confuse the structure planner.\n' +
      '\n' +
      'Vocal share rule: size the vocal sections to what the user asked. "25% of a 4-minute song" =\n' +
      '60 seconds of vocals. Each sung line takes ~3–4 seconds. So 60s of vocals ≈ 15–20 lines TOTAL\n' +
      'across ALL vocal sections. Split that as: 2 verses × 4 lines + 1 chorus × 4 lines = 12 lines\n' +
      '(~48s), or 2 verses × 3 lines + 2 choruses × 3 lines = 12 lines. NEVER exceed the line budget.\n' +
      'Write 2–3 DISTINCT verses with different words — never repeat the same verse. The chorus\n' +
      'repeats identically each time (it\'s the hook) but MUST have DIFFERENT words from the verse —\n' +
      'the verse tells the story, the chorus is its own hook; copying verse text into the chorus is\n' +
      'a critical error. Keep verses and choruses to 3–5 lines each.\n' +
      'The rest is instrumental — stack descriptive instrumental tags with time spans in\n' +
      'the arrangement. The tag map MUST mirror the Arrangement section for section, in the same\n' +
      'order: every time span in the Arrangement (including bridge, breakdown, build, drop, interlude,\n' +
      'guitar solo) gets its OWN tag line in the lyrics, in the same sequence. A bridge described in\n' +
      'the Arrangement but missing from the tag map is a critical error — the structure planner reads\n' +
      'ONLY the tag map, so an untagged section silently disappears from the song.\n' +
      'If the user says instrumental / no vocals: ONLY the tag map, no words, still enough sections\n' +
      'to cover the whole duration. If the user says nothing about vocals: return "" for lyrics.\n' +
      'If the user mentions vocals / singing / lyrics but doesn\'t state a share: default by genre —\n' +
      '~50% for pop/rock (3–4 verse→chorus passes, 3–5 lines per section), ~45% for ballads,\n' +
      'but only ~15% for trance/EDM where instrumentals carry the song (2 passes, 2–3 lines each).\n' +
      'Rest is instrumental.\n' +
      '\n' +
      'Lyric writing rules:\n' +
      '— 6–10 syllables per line (the model aligns syllables to beats; uneven lines sound strange).\n' +
      '— NEVER split or hyphenate words to hit a syllable count ("to gether", "wea- ther") — keep\n' +
      'every word whole; change the line instead.\n' +
      '— Keep similar syllable counts for lines in the same position across verses.\n' +
      '— UPPERCASE lines in the chorus for high-intensity delivery.\n' +
      '— Parentheses = backup vocals: append a short echo to the line, e.g.\n' +
      '"WE RISE TOGETHER (rise up), LIGHT IN THE DARK (never fall)". Put them on lines in\n' +
      'EVERY chorus and on at least one verse line — they cue layered/backup vocals.\n' +
      '— One core metaphor per song — explore its facets, don\'t jump between unrelated images.\n' +
      '— Avoid adjective stacking ("neon skies, electric hearts, endless dreams") — vague filler.\n' +
      '— Tags are labels only — never "Verse 1:", no titles, no commentary. Rhyme where natural.\n' +
      '\n' +
      'duration — total seconds as an integer. Use the user\'s stated length when given\n' +
      '("4 minutes" → 240, "3:30" → 210). If they give none, CHOOSE a natural length for the\n' +
      'style and write an arrangement that fits it exactly — electronic/dance 200–240,\n' +
      'pop/rock 195–225, ballads 210–240, hip-hop 180–210, ambient/experimental up to 300.\n' +
      'Do NOT return 0 — 0 keeps the 5-minute default and makes every song too long.\n' +
      'Clamp to 60–360. The arrangement time spans MUST end at this duration.\n' +
      '\n' +
      'title — a short, memorable song title (2–5 words), in Title Case, that captures the mood/theme.\n' +
      'Not the prompt, not a description — a real song name. If the user gave a title, use it as-is.\n' +
      '\n' +
      'EXAMPLE — user asks: "4 min pop ballad about a rainy train station, female vocal, 25% lyrics"\n' +
      '{"title":"Platform Nine","prompt":"Global Metadata: emotional pop ballad, 78 BPM, A minor, intimate and melancholic, solo female breathy vocal, acoustic piano, soft strings, gentle brushed drums, warm reverb, building to a powerful final chorus. Arrangement: 0:00–0:25 solo piano intro with rain ambience; 0:25–0:55 verse 1 — breathy vocal over sparse piano; 0:55–1:25 chorus 1 — strings enter, drums soft; 1:25–1:50 piano interlude; 1:50–2:20 verse 2 — fuller arrangement with bass; 2:20–2:50 chorus 2 — more intense, layered harmonies; 2:50–3:10 bridge — stripped back, whispered vocal; 3:10–3:45 final chorus — full arrangement, powerful belting; 3:45–4:00 outro — piano and strings fade.","lyrics":"[Intro - piano]\\n\\n[Verse]\\nRain on the platform window pane\\nWatching the city fade in the grey\\n\\n[Chorus - anthemic]\\nIM WAITING FOR A TRAIN THAT NEVER COMES\\nHOLDING ON TO WHAT WE USED TO BE\\n\\n[Interlude - piano]\\n\\n[Verse]\\nTicket in my hand, cold as the rain\\nEvery departure feels the same\\n\\n[Chorus - anthemic]\\nIM WAITING FOR A TRAIN THAT NEVER COMES\\nHOLDING ON TO WHAT WE USED TO BE\\n\\n[Bridge - whispered]\\nIf you had stayed, maybe I would too\\n\\n[Chorus - powerful]\\nIM WAITING FOR A TRAIN THAT NEVER COMES\\nHOLDING ON TO WHAT WE USED TO BE\\n\\n[Outro - fade out]","duration":240,"search_query":""}\n' +
      'Note: TWO distinct verses with different words, chorus repeats identically (UPPERCASE for\n' +
      'intensity), descriptive instrumental tags ([Interlude - piano]), time spans for EVERY section\n' +
      'including the interlude, tag modifiers for delivery, one metaphor (rain/waiting), title is a\n' +
      'real song name.'
    )
  }
  if (mode === 'sfx') {
    return (
      'You are an expert prompt writer for AI SOUND-EFFECT generation (Stable Audio in ComfyUI).\n' +
      "Rewrite the user's idea into ONE concise, literal description of a single sound effect " +
      '(8 to 28 words). Describe ONLY what is heard: the source, its material and action, distance, ' +
      'and the space/reverb.\n' +
      'If the user gives you nothing to go on (empty box, or a single vague word), INVENT one ' +
      'striking, immediately usable sound effect instead of asking questions.\n' +
      'Examples:\n' +
      '"a single close lightning crack followed by a deep rolling thunder rumble, outdoors";\n' +
      '"heavy steel door slamming shut, hard impact, concrete room echo";\n' +
      '"glass shattering on a tile floor, close and bright".\n' +
      'If the user names a surface, object, image or texture (for example "seamless packed soil ' +
      'texture"), do NOT describe how it looks. Translate it into the sound it makes: footsteps ' +
      'crunching on packed soil, the material being struck, or an object dropping onto it. ' +
      'Write only that sound.\n' +
      'Rules:\n' +
      '- Describe the SOUND only. NEVER a song, music, melody, instruments, genre, BPM, or lyrics.\n' +
      '- No visual/image words (lighting, colors, composition, waveform, cinematic) and no camera terms.\n' +
      '- Never start with "cinematic shot", "close-up of", "image of" or any camera/framing phrase.\n' +
      '- ONE sound event per prompt. If the user asks for several sounds, pick the single most useful one.\n' +
      '- No vague mood/style adjectives that do not describe sound.\n' +
      'Fields:\n' +
      '- prompt — the sound description.\n' +
      '- duration — an integer 1 to 47 (seconds) sized to the sound. Short impacts, clicks and coin ' +
      'pings 1–3; footsteps, doors, weapons 2–6; crashes, roars, screams 3–8; rain, ambience, thunder ' +
      'rumbles and machinery 6–20. NEVER 0 — 0 keeps the previous length and usually truncates the effect.\n' +
      '- negative — ONE short phrase (max 8 words) of what would ruin the take, e.g. "music, vocals, ' +
      'digital artifacts". Use an empty string when nothing would hurt the sound.\n' +
      '- title — a short name (2–5 words, Title Case) for the effect, used as the download filename.\n' +
      '- suggestions — ONLY when the user gave nothing to work with: 3 further sound-effect ideas, ' +
      'plain lowercase phrases of 3–8 words each. Otherwise return an empty array.\n' +
      'Reply with ONLY a JSON object, no markdown, no explanations:\n' +
      '{"prompt": "<sound description>", "title": "<short title>", "duration": 4, ' +
      '"negative": "<things to avoid or empty>", "suggestions": []}'
    )
  }
  if (mode === 'pixel') {
    return (
      'You are an expert prompt writer for AI PIXEL ART generation (SDXL + Pixel Art XL in ComfyUI).\n' +
      "Rewrite the user's idea into ONE concise description (15 to 40 words) of a pixel-art subject " +
      'or scene: what it is, silhouette, limited colour palette, and the pixel-art style/era ' +
      '(for example 16-bit or 32-bit game art).\n' +
      'Rules:\n' +
      '- Describe the SUBJECT and the PIXEL-ART STYLE only. NO camera, lens, lighting or photo words.\n' +
      '- NO photorealistic, 3D render, smooth gradient, anti-aliasing, blur or high-resolution photo wording.\n' +
      '- Keep it readable at small size: one clear focal subject, strong shapes, limited colours.\n' +
      '- No text, UI, watermark, frame or border.\n' +
      '- Also give a short NEGATIVE phrase of what would ruin the pixel art (max 12 words).\n' +
      'Reply with ONLY a JSON object, no markdown, no explanations:\n' +
      '{"prompt": "<pixel art description>", "negative": "<avoid>", "title": "<short title>"}'
    )
  }
  if (mode === 'sprite') {
    return (
      'You are an expert prompt writer for AI game SPRITE generation (ComfyUI, Qwen-Image).\n' +
      "Rewrite the user's idea into ONE concise description of a single subject for a sprite sheet " +
      '(20 to 45 words): what it is, its shape/silhouette, colours, clothing/armour or materials, ' +
      'and any distinguishing features.\n' +
      'Rules:\n' +
      '- Describe ONE subject only, full body, facing the camera, neutral standing pose.\n' +
      '- NO scene, background, environment, lighting or camera words — the subject is cut out on a plain background.\n' +
      '- No animation or pose instructions (those are handled separately per frame).\n' +
      '- Also pick a short title (2–4 words, Title Case) naming the subject.\n' +
      '- Also give a short NEGATIVE phrase of what would ruin the sprite (max 12 words).\n' +
      'Reply with ONLY a JSON object, no markdown, no explanations:\n' +
      '{"prompt": "<subject description>", "negative": "<avoid>", "title": "<short title>"}'
    )
  }
  if (mode === 'parts') {
    return (
      'You are an expert prompt writer for AI game-character PART generation (ComfyUI, Qwen-Image).\n' +
      "Rewrite the user's idea into ONE concise description (20 to 45 words) of a single game asset: " +
      'the subject, its shape/silhouette, materials, colours, and distinguishing details.\n' +
      'Rules:\n' +
      '- Describe ONE isolated asset (a full character, a head, a hairstyle, an armour piece, a weapon, a shield…).\n' +
      '- It will be cut out on a plain white background — describe ONLY the asset.\n' +
      '- NO scene, background, environment, lighting or camera words.\n' +
      '- Honour the SELECTED OPTIONS below (slot, size, style) — never contradict them.\n' +
      '- Also give a short Title-Case name (2–4 words) and a short NEGATIVE phrase of what to avoid (max 12 words).\n' +
      'Reply with ONLY a JSON object, no markdown, no explanations:\n' +
      '{"prompt": "<asset description>", "negative": "<avoid>", "title": "<short name>"}'
    )
  }
  if (mode === 'custom') {
    return (
      'You are an expert prompt writer for a user-imported ComfyUI workflow.\n' +
      'The SELECTED OPTIONS below state the workflow output type — follow the matching branch ONLY:\n' +
      '- image: ONE 40–90 word visual paragraph covering subject, environment, lighting, colours and composition.\n' +
      '- video: ONE 40–90 word visual paragraph that also describes explicit visible motion and camera movement over time.\n' +
      '- audio: ONE concise caption for audio/music — sound source or genre, instruments/texture, mood and production. NEVER use visual, lighting or camera words for audio.\n' +
      'Rules:\n' +
      '- The imported graph\'s models and fixed inputs are not yours to change — never mention or request different models.\n' +
      '- Match the style preset only when the output type is visual.\n' +
      '- Also give a short NEGATIVE phrase (max 15 words) of what would ruin the result; for audio name sonic defects (clipping, hum, unwanted vocals).\n' +
      'Reply with ONLY a JSON object, no markdown, no explanations:\n' +
      '{"prompt": "<the prompt>", "negative": "<avoid>"}'
    )
  }
  if (mode === 'edit') {
    return (
      'You are an expert prompt writer for AI image editing (instruction-based edit models in ComfyUI).\n' +
      "Rewrite the user's change request into ONE concise edit instruction (15 to 45 words):\n" +
      'what to change, how to change it, and what must stay untouched.\n' +
      `- Match this style: ${styleLabel}.\n` +
      '- Also pick a web image search query: 3-8 lowercase keywords for a reference photo of the subject (subject words only, no style words, no punctuation).\n' +
      '- Also give a short NEGATIVE phrase of what to avoid (max 12 words).\n' +
      'Reply with ONLY a JSON object, no markdown, no explanations:\n' +
      '{"prompt": "<the edit instruction>", "negative": "<avoid>", "search_query": "<3-8 keywords>"}'
    )
  }
  if (mode === 'texture') {
    return (
      'You are an expert prompt writer for AI game TEXTURE and UI ART generation (ComfyUI, Qwen-Image).\n' +
      "Rewrite the user's idea into ONE concise description (12 to 35 words) of a flat material, " +
      'a set of matching icons, or a terrain tile: material type, colour, wear, grain and detail.\n' +
      'Rules:\n' +
      '- Describe ONLY the surface, icons or tiles. NO scene, horizon, perspective, lighting direction or camera words.\n' +
      '- No text, labels, borders or frames.\n' +
      '- Keep style, scale and lighting consistent across the whole sheet so tiles match and icons read as one set.\n' +
      '- Also give a short NEGATIVE phrase of what would ruin the asset (max 12 words).\n' +
      'Reply with ONLY a JSON object, no markdown, no explanations:\n' +
      '{"prompt": "<description>", "negative": "<avoid>"}'
    )
  }
  if (mode === 'flipbook') {
    return (
      'You are an expert prompt writer for AI game VFX FLIPBOOK generation (ComfyUI, Wan).\n' +
      "Rewrite the user's idea into ONE concise description (12 to 35 words) of a single looping visual " +
      'effect: what it is, its colour, shape, energy and how it evolves over the loop.\n' +
      'Rules:\n' +
      '- ONE effect only, centered, isolated. NO scene, environment, characters or camera movement.\n' +
      '- Describe motion that loops cleanly (build → peak → fade back to the first frame).\n' +
      '- No text, watermark, UI or frame border.\n' +
      '- Also give a short NEGATIVE phrase of what would ruin the effect (max 12 words).\n' +
      'Reply with ONLY a JSON object, no markdown, no explanations:\n' +
      '{"prompt": "<effect description>", "negative": "<avoid>"}'
    )
  }
  if (mode === 'material') {
    return (
      'You are an expert prompt writer for AI PBR MATERIAL generation (local PBR in ComfyUI).\n' +
      "Rewrite the user's idea into ONE concise description (12 to 35 words) of a physical material " +
      'for a seamlessly tiling game texture: material, colour, surface finish (rough/glossy/metal), ' +
      'wear, grain, cracks or pattern.\n' +
      'Rules:\n' +
      '- Describe the material ONLY. NO scene, object, lighting, shadow, camera or composition words.\n' +
      '- Do not mention maps, normal maps, PBR or rendering — just the physical surface.\n' +
      '- Keep it uniform enough to tile in both directions.\n' +
      'Reply with ONLY a JSON object, no markdown, no explanations:\n' +
      '{"prompt": "<material description>", "negative": ""}'
    )
  }
  const video = mode === 'video'
  return (
    (video
      ? 'You are an expert prompt writer for AI VIDEO generation (ComfyUI, Wan). '
      : 'You are an expert prompt writer for AI image generation (ComfyUI, Qwen-Image). ') +
    `Rewrite the user's simple idea into ONE rich, detailed paragraph prompt.\n` +
    'Rules:\n' +
    `- The prompt must be 40 to 90 words covering subject, environment, lighting, colors, composition${
      video ? ', and explicit visible motion with camera movement over time' : ''
    }.\n` +
    `- Match this style: ${styleLabel}.\n` +
    '- Honour the SELECTED OPTIONS below (size, aspect, style) — never contradict them.\n' +
    '- Also pick a web image search query: 3-8 lowercase keywords that would find good reference photos of the subject (subject words only, no style words, no punctuation).\n' +
    '- Also pick a short title (2–5 words, Title Case) that captures the scene — like a clip name, not a description.\n' +
    '- Also give a short NEGATIVE prompt of what to avoid (max 15 words — the usual defects: extra limbs, text, watermark, blur…).\n' +
    'Reply with ONLY a JSON object, no markdown, no explanations:\n' +
    '{"prompt": "<the full prompt>", "negative": "<avoid>", "search_query": "<3-8 keywords>", "title": "<short title>"}'
  )
}
