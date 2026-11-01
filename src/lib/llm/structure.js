// Song structure planning: section budget, vocal form and lyric-map trimming.
import { parseLyricSections } from './parse.js'

// The MiniMax/ACE AR structure planner sizes the song from the NUMBER of
// [Tag] sections in the lyric map, capped by max_duration. It ignores prose
// time spans ("0:00–0:40 intro") in the caption entirely. Live probe in
// workflows.js: tiny lyric → 24s, a STRUCTURE_TAGS map (9 sections) → 151s,
// both under one 360s cap.
//
// Measured: 16 sections → 2:47 (167s) = ~10.4s per section, not 15s — the
// planner compresses sections stacked late in the map. Budget ~8s each so
// a 300s target gets 38 sections (not 30), giving the planner enough
// sections to actually reach the duration. Rely on max_duration headroom
// (see buildMusicWorkflow) for the rest.
export const PLANNER_SECONDS_PER_SECTION = 8
export function plannerSectionTarget(duration) {
  const dur = Number(duration) || 0
  if (dur <= 0) return 3
  return Math.max(3, Math.ceil(dur / PLANNER_SECONDS_PER_SECTION))
}

// MEASURED live pacing of the MiniMax AR structure planner: the planner
// tracks ~5–8 distinct section concepts, then REPEATS the last groove until
// max_duration. A 360s request with 34 sections (~10.4s each on paper)
// rendered 33s intro → 49s verse/chorus → 28s breakdown → then LOOPED one
// groove from 1:50 to 4:59. The planner cannot follow a 34-section map —
// it exhausts its structural attention and repeats.
//
// The real pacing when the planner IS tracking: intro ~30s, verse ~20s,
// chorus ~30s, breakdown ~28s — i.e. ~25s per section on average. Budget
// sections at that rate so the map has FEWER, longer, well-varied sections
// the planner can actually follow end-to-end.
export const DENSE_SECONDS_PER_SECTION = 20

// Fallback duration from the lyric map when the AI returns 0. The planner
// sizes songs from the section COUNT at the measured dense pacing, so the
// tag count is the most honest signal of intended length. Kept for the case
// where a weak model ignores the "always return duration" rule — without
// this, the 300s (5-min) knob default made EVERY song 4–5 minutes.
export function suggestDurationFromLyrics(lyrics) {
  const sections = parseLyricSections(lyrics)
  if (sections.length === 0) return 0
  const est = Math.round(sections.length * DENSE_SECONDS_PER_SECTION)
  return Math.min(360, Math.max(150, est))
}
export function sectionCeiling(duration) {
  const dur = Number(duration) || 0
  if (dur <= 0) return 3
  // Hard cap at 20 sections: the planner's practical tracking limit when
  // sections are well-varied (max 2 consecutive wordless enforced
  // separately). A 360s song with 20 sections runs ~18s each. The old
  // 34-section maps with 15 consecutive wordless sections caused the
  // planner to loop one groove for minutes — the cap plus the wordless
  // run limit keep the map trackable end-to-end. Floor of 8: the vocal
  // form (2 verse+chorus passes = 4 sections) plus a bridge and
  // intro/outro needs at least 8 slots for ballads.
  return Math.min(20, Math.max(8, Math.floor(dur / DENSE_SECONDS_PER_SECTION)))
}

// Hard cap on consecutive wordless (instrumental) sections anywhere in the
// map. The AR planner reads a long wordless run as ONE groove and loops it
// — a 15-section [Breakdown][Build][Drop][Instrumental]... run became 3+
// minutes of identical beats. Even 2 in a row caused an 80-second loop
// (Build → Instrumental interlude at 2:00-3:20). Max 1 forces the planner
// to hit a vocal before it can repeat.
export const MAX_CONSECUTIVE_WORDLESS = 1

// Cap headroom: the planner ends the song when the music is done, so a
// max_duration set exactly at the request makes the cap the limiter
// (a 240s ask came back 167s). Some headroom lets the planner's own length
// decision — driven by the section count — end the song naturally. But 1.3×
// was too loose: a 210s (3:30) request overran to 298s (4:58) because the
// planner ran each section ~15s and even blew past the 273s cap. padInstrumentalSections
// now guarantees enough sections to hit the target, so the oversized headroom
// only causes overshoot — tighten to 1.1× to bound the overrun.
export function plannerCapDuration(duration) {
  const dur = Number(duration) > 0 ? Math.round(Number(duration)) : 300
  return Math.min(360, Math.max(10, Math.ceil(dur * 1.1)))
}

// Structural tags that form the repeating "hook" of a song. Each occurrence
// with its own words is one pass through the form, so a 25% map that has
// only one Verse and one Chorus is under-formed no matter how many
// instrumental sections pad around it.
const CORE_VOCAL = ['verse', 'chorus']

// A form-completing CHORUS tag. "Pre-Chorus" and "Post-Chorus" contain the
// substring "chorus" but are NOT choruses — matching them made a Verse +
// Pre-Chorus map look like a balanced V-C form, so no real [Chorus] was
// synthesized and the song shipped without a hook. The AI also writes
// [Chorus - euphoric], [Final Chorus], [Drop + Chorus] — those all count.
export function isChorusTag(tag) {
  return /chorus/i.test(tag) && !/pre[- ]?chorus/i.test(tag) && !/post[- ]?chorus/i.test(tag)
}

// How many times the vocal form should repeat for a given length. A real
// song runs verse→chorus 2–3 times; a short one gets a single pass. This
// is a floor on form repeats, independent of the vocal-share percentage —
// sharing 25% of the song to lyrics must not collapse it to one pass. Capped
// at 3 (the cap matters: cycles feed the instrumental-fill pass, so an
// over-large floor would starve the instrumental sections that carry the
// remaining 75%).
export function vocalFormCycles(duration, share) {
  const dur = Number(duration) > 0 ? Number(duration) : 0
  // Rough seconds of one vocal form pass (verse+chorus) in a sparse map.
  const secondsPerCycle = 40
  const byLength = Math.round(dur / secondsPerCycle)
  // Cap at 3 only for long songs. A 300s request hitting the 3-cycle floor
  // rebuilt a 4th duplicate pass (verses 1↔3 and 2↔4 identical), which is
  // what pushed the map past the duration. Two passes is a complete form
  // (verse→chorus→verse→chorus); the third is reserved for >5 min.
  const cap = dur > 300 ? 3 : 2
  return Math.min(cap, Math.max(2, byLength))
}

// Vocal form budget in PASSES for a duration + share. The structural floor
// (vocalFormCycles) and the share target (sung seconds ÷ seconds per pass)
// compete: trance at 15%/300s wants 1 pass by share but the floor forces 2;
// pop at 35%/300s wants 3 and the floor must not cut it back to 2. Both
// trimVocalSections (build the form) and trimSectionBudget (protect the
// built form from dedup) use this so they always agree.
//
// `style` lifts the dance floor to 3 passes on long songs: with only 2
// passes, the second vocal lands at the very end of a trance track (the
// long middle breakdown eats the song), where the planner has no time left
// to play it. Three passes spread the vocals across the track so each one
// has airtime.
export function vocalPassBudget(duration, share, style) {
  const dur = Number(duration) > 0 ? Number(duration) : 300
  const s = Number(share) > 0 && Number(share) < 1 ? Number(share) : 0.2
  const byShare = Math.round((dur * s) / 40)
  // Only lifts LOW-share maps: an explicit "25% vocals" request gets its
  // requested passes (2 longer ones) — the floor exists to stop the
  // 15%-default trance map from collapsing to a form whose second pass has
  // no airtime, not to override an explicit share.
  const danceFloor = style === 'dance' && dur >= 240 && s <= 0.2 ? 3 : 0
  return Math.max(vocalFormCycles(dur, s), byShare, danceFloor)
}

// Rough seconds for one sung line. A line is 6–10 syllables; the model
// aligns syllables to beats, so a line lands around 3–4s. Use 3.5 as the
// working estimate when budgeting lyrics against a duration.
export const SECONDS_PER_SUNG_LINE = 3.5

// Count the sung lines in a parsed section (blank-line separated lines
// within the words block). Instrumental sections have no words → 0.
function countSungLines(section) {
  const words = String(section?.words || '').trim()
  if (!words) return 0
  return words.split(/\n/).map((l) => l.trim()).filter(Boolean).length
}

// Trim a parsed section to at most `maxLines` sung lines, keeping the head.
function trimSectionLines(section, maxLines) {
  if (maxLines <= 0) return null
  const lines = String(section.words || '')
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length <= maxLines) return section
  const kept = lines.slice(0, maxLines).join('\n')
  const tag = section.tag ? `[${section.tag}]\n` : ''
  return { tag: section.tag, words: kept, raw: `${tag}${kept}` }
}

// Trim or EXPAND the vocal map to the requested share of the song, while
// never dropping below two passes of the vocal form (verse→chorus at
// least twice, three times on longer songs). Weak models write a single
// Verse+Chorus for a 25% request, which reads as a fragment, not a song —
// so this both cuts lyric-heavy maps and repeats sparse ones.
export function trimVocalSections(lyrics, duration, share, style = 'generic') {
  if (!lyrics || !duration || !share || share <= 0 || share >= 1) return lyrics
  const sections = parseLyricSections(lyrics)
    // Force the intro to be WORDLESS (pure instrumental). The AI often writes
    // instrumentation prose under it ("[Intro - banjos]Banjo plucks open the
    // track"), which makes isVocal() true — the intro then gets classified as
    // an "extra vocal", DEMOTED to just before the outro, and the planner
    // renders it as a rushed vocal stub instead of a real intro (the song
    // "went straight into the verse"). The instrumentation is already carried
    // by the tag suffix ("- banjos") and the caption, so stripping the words
    // keeps the intro at the head as a proper instrumental section.
    .map((s) =>
      /\bintro\b/i.test(s.tag) && s.words
        ? { tag: s.tag, words: '', raw: `[${s.tag}]` }
        : s
    )
  if (sections.length === 0) return lyrics

  const isVocal = (s) => s.tag !== '' && s.words !== ''
  const vocal = sections.map((s, i) => ({ s, i })).filter(({ s }) => isVocal(s))
  if (vocal.length === 0) return lyrics

  // Budget in FORM PASSES (a verse→chorus pair), then convert to section
  // slots. Two independent floors: the share-based target (how many seconds
  // of singing the user asked for, ÷ the seconds one pass takes) and the
  // structural minimum (so a sparse map still expands to a real form). The
  // share term used to be computed in raw SLOTS and compared against the
  // pass floor directly, which let a 20%/300s request inflate to 8 slots
  // (4 passes) instead of the intended 2 — verses cycled four deep and the
  // choruses got crowded together.
  const dur = Number(duration) > 0 ? Number(duration) : 300
  const vocalSecondsTarget = dur * share
  // Pass budget shared with trimSectionBudget's dedup floor: structural
  // minimum (sparse maps still expand to a real form) vs the share target
  // (pop at 35% gets 3 passes even though the floor is only 2).
  const passes = vocalPassBudget(dur, share, style)
  const budget = passes * CORE_VOCAL.length
  // Lines per vocal section from the SINGING budget: each section's share
  // of the target sung seconds ÷ seconds per line, capped at 5 (verses and
  // choruses are 3–5 lines in real songs; the old planner-slot derivation
  // floor(8/3.5) = 2 lines made every song a lyric fragment — and a cap of
  // 4 undershot a 50% pop request by a third).
  const capacityPerSection = (vocalSecondsTarget / budget) / SECONDS_PER_SUNG_LINE
  const linesPerSection = Math.max(2, Math.min(5, Math.floor(capacityPerSection)))

  // Normalize the base to a clean form pass (verse→chorus). The model's own
  // extras are dropped rather than ranked-and-kept: keeping a stray
  // Pre-Chorus or a 6th verse is what made maps read as broken form. When a
  // tag is missing (verse-only, or pre/post-heavy with no verse/chorus) the
  // missing one is synthesized from the model's own words — the planner
  // needs both halves of the pass to size the song correctly.
  const wordsOf = (s) => ({ tag: s.tag, words: s.words, raw: s.raw })
  const synthesize = (tag, from) => {
    const src = from || vocal[0]?.s
    if (!src) return null
    const words = src.words
    return { tag, words, raw: `[${tag}]\n${words}` }
  }
  // Collect ALL distinct verses and choruses the model wrote — verses get
  // cycled (verse 1, verse 2, verse 3 each with different words), the
  // chorus repeats identically (it's the hook). Match any tag containing
  // "verse"/"chorus" — the AI writes [Verse 1], [Chorus - euphoric],
  // [Final Chorus] etc., not just bare tags. Choruses use isChorusTag so a
  // lone [Pre-Chorus] does NOT pass as the hook — that match leaked here
  // before and kept a Verse+Pre-Chorus map "balanced", shipping songs with
  // no real chorus at all.
  const verses = vocal.filter(({ s }) => /verse/i.test(s.tag))
  const choruses = vocal.filter(({ s }) => isChorusTag(s.tag))
  const verse = verses[0]?.s || synthesize('Verse', vocal[0]?.s)
  const chorus = choruses[0]?.s || synthesize('Chorus', vocal[vocal.length - 1]?.s)

  // Rebuild the vocal list as repeated clean passes. Verses cycle through
  // the model's distinct verses; the chorus repeats. Wordless tags
  // (instrumentals) and the outro keep their original positions — only the
  // vocal slots are refilled, so the arrangement's shape survives.
  const rebuild = (slots) => {
    if (slots === 0 || !verse || !chorus) return []
    const verseList = verses.length > 0 ? verses.map((v) => v.s) : [verse]
    const out = []
    let vi = 0
    for (let i = 0; i < slots; i++) {
      if (CORE_VOCAL[i % CORE_VOCAL.length] === 'verse') {
        const trimmed = trimSectionLines(verseList[vi % verseList.length], linesPerSection)
        if (trimmed) out.push(wordsOf(trimmed))
        vi++
      } else {
        const trimmed = trimSectionLines(chorus, linesPerSection)
        if (trimmed) out.push(wordsOf(trimmed))
      }
    }
    return out
  }

  // Keep the model's original vocal order ONLY when it already fits the
  // budget AND reads as a balanced form (roughly alternating verse/chorus).
  // A map that happens to have the right COUNT but a lopsided order — say
  // three verses then one chorus crammed at the end — is not well-formed;
  // keeping it buries the chorus and crowds the verses, so it gets rebuilt.
  // Still trim any section whose lines overrun the ~8s slot either way.
  const chorusShare = vocal.filter(({ s }) => isChorusTag(s.tag)).length / vocal.length
  const balancedForm = chorusShare >= 0.3 && chorusShare <= 0.7
  if (vocal.length === budget && balancedForm) {
    const out = []
    for (const sec of sections) {
      if (isVocal(sec)) {
        const trimmed = trimSectionLines(sec, linesPerSection)
        out.push(trimmed || sec)
      } else {
        out.push(sec)
      }
    }
    return out.map((s) => s.raw).join('\n\n')
  }
  const rebuilt = rebuild(budget)
  // Non-core word-carrying sections (a ballad's [Bridge], a [Post-Chorus])
  // are part of the form, not junk — the rebuild only cycles verse/chorus,
  // so they'd be discarded along with their lyrics. Set them aside and
  // re-insert before the outro after the rebuilt passes.
  const isExtraVocal = (s) =>
    isVocal(s) && !/verse|chorus/i.test(s.tag) && !/outro/i.test(s.tag)
  const setAside = []
  const out = []
  let ri = 0
  for (const sec of sections) {
    if (isVocal(sec)) {
      if (isExtraVocal(sec)) {
        setAside.push(sec)
        continue
      }
      if (ri < rebuilt.length) out.push(rebuilt[ri++])
    } else {
      out.push(sec)
    }
  }
  // Instrumentals outnumbered vocals (or the map had none): the extra
  // rebuilt passes land before the outro.
  while (ri < rebuilt.length) {
    const at = out.findIndex((sec) => /outro/i.test(sec.tag))
    out.splice(at >= 0 ? at : out.length, 0, rebuilt[ri++])
  }
  for (const sec of setAside) {
    const at = out.findIndex((s) => /outro/i.test(s.tag))
    out.splice(at >= 0 ? at : out.length, 0, sec)
  }
  return out.map((s) => s.raw).join('\n\n')
}

// Trim a tag map that OVERSHOOTS the duration. The planner sizes the song
// from the section COUNT (~8s each), so a 300s request with 43 sections
// (344s) runs past the lyrics — the song ends before the last vocal. Cut the
// instrumental bulk (never the vocal form) until total×8s fits the duration,
// keeping at least one break between consecutive form passes and the
// intro/outro bookends. Returns the original text when it already fits.
export function trimSectionBudget(lyrics, duration, share = 0.2, style = 'generic') {
  const text = String(lyrics || '').trim()
  if (!text) return text
  const dur = Number(duration) || 0
  if (dur <= 0) return text

  let sections = parseLyricSections(text)
  const isVocal = (s) => s.tag !== '' && s.words !== ''
  const isOutro = (s) => /outro/i.test(s.tag)
  const isIntro = (s) => /intro/i.test(s.tag)
  // Real choruses only — a Pre-Chorus must not protect its duplicate
  // pre-chorus text from dedup (isChorusTag excludes pre/post-chorus).
  const isChorus = (s) => isChorusTag(s.tag)

  // Ceiling adjusted for how heavy the vocal sections actually are. The
  // dense-map constant (25s/section, the planner's real pacing) means a
  // 4-line vocal section (~14s of singing) fits INSIDE its 25s slot — no
  // extra reservation needed. The old 10.4s constant over-counted vocal
  // weight and produced 30+ section maps the planner couldn't track.
  const vocalSecs = sections.filter(isVocal)
  const maxSections = sectionCeiling(dur)

  if (sections.length <= maxSections) return text

  // De-duplicate IDENTICAL vocal sections first. The AI repeats verse 1 as
  // verse 3 word-for-word; the chorus is the hook and is meant to repeat, so
  // only verses/bridges are deduped. Drop the duplicate vocal AND the vocal
  // form that trails it (its chorus) as one run — removing just the verse
  // leaves an orphan chorus after the form already completed, which makes
  // the AR planner end the track early.
  //
  // Floor: never drop below the structural minimum (2 form passes, 3 on
  // long songs). trimVocalSections EXPANDS a sparse map by cycling the
  // model's single verse, so the second pass looks "duplicate" here — but
  // dropping it undid the expansion and shipped a 1-verse/1-chorus fragment.
  // The floor is SHARE-aware (same budget trimVocalSections built with), so
  // a pop 35% map keeps its 3 passes while a repeated-verse AI map still
  // gets its junk passes deduped down to the floor.
  const minVocal = vocalPassBudget(dur, share, style) * CORE_VOCAL.length
  const vocalTotal = sections.reduce((n, s) => n + (isVocal(s) ? 1 : 0), 0)
  const runs = []
  const seenWords = new Set()
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]
    if (!isVocal(s) || isChorus(s)) continue
    const key = s.words.trim()
    if (key && seenWords.has(key)) {
      // This duplicate plus any following vocal sections until the next
      // unique (non-duplicate) vocal — i.e. the trailing form pass.
      const run = new Set([i])
      for (let j = i + 1; j < sections.length; j++) {
        if (isVocal(sections[j])) {
          const k2 = sections[j].words.trim()
          if (k2 && !seenWords.has(k2) && !isChorus(sections[j])) break // next real verse ends the run
          run.add(j)
          if (!isChorus(sections[j])) break
        }
      }
      runs.push(run)
    } else if (key) {
      seenWords.add(key)
    }
  }
  const dropRun = new Set()
  let remainingVocal = vocalTotal
  for (const run of runs) {
    const runVocals = [...run].filter((i) => isVocal(sections[i])).length
    if (remainingVocal - runVocals < minVocal) continue // floor holds the expansion
    run.forEach((i) => dropRun.add(i))
    remainingVocal -= runVocals
  }
  if (dropRun.size) sections = sections.filter((_, i) => !dropRun.has(i))
  if (sections.length <= maxSections) return sections.map((s) => s.raw).join('\n\n')

  // Mark which sections are protected (never dropped): the form skeleton is
  // intro + every vocal + the outro. We additionally protect ONE instrumental
  // break between consecutive vocal passes and the final break before the
  // outro, so the arrangement keeps its shape and the ending has a lead-out.
  const protectedIdx = new Set()
  sections.forEach((s, i) => {
    if (isVocal(s) || isOutro(s) || isIntro(s)) protectedIdx.add(i)
  })
  const vocalIdxs = sections.map((s, i) => (isVocal(s) ? i : -1)).filter((i) => i >= 0)
  const outroIdx = sections.findIndex(isOutro)
  if (outroIdx > 0) {
    // Protect up to 3 consecutive wordless sections before the outro — the
    // lead-out padInstrumentalSections guarantees so the ending has room to
    // wind down. Protecting only ONE let trimSectionBudget strip the other
    // 1–2 right back off, returning to a stub-fade outro.
    let protected_ = 0
    for (let i = outroIdx - 1; i >= 0 && protected_ < 3; i--) {
      if (isVocal(sections[i])) break
      protectedIdx.add(i)
      protected_++
    }
  }
  for (let k = 1; k < vocalIdxs.length; k++) {
    const prev = vocalIdxs[k - 1]
    const cur = vocalIdxs[k]
    for (let i = cur - 1; i > prev; i--) {
      if (!isVocal(sections[i])) { protectedIdx.add(i); break }
    }
  }

  // Drop instrumentals from the END backward until we fit the budget. The
  // tail is what the planner compresses anyway, so thinning it costs the
  // least arrangement character.
  const drop = sections.length - maxSections
  const dropIdx = new Set()
  for (let i = sections.length - 1; i >= 0 && dropIdx.size < drop; i--) {
    if (protectedIdx.has(i)) continue
    dropIdx.add(i)
  }
  sections = sections.filter((_, i) => !dropIdx.has(i))
  return sections.map((s) => s.raw).join('\n\n')
}
