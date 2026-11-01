// Arrangement repair: instrumental padding, lead-outs and wordless-run caps.
import { parseLyricSections } from './parse.js'
import { MAX_CONSECUTIVE_WORDLESS, isChorusTag, sectionCeiling } from './structure.js'
import { MIDDLE_BREAKDOWN_TAGS, leadGapTags, wantsMiddleBreakdown } from './style.js'

// Enforce instrumental section density in an AI-written tag map.
// MiniMax's AR planner sizes the song from the section map — a long song
// with stacked vocal sections and one [Instrumental] gap comes out short
// and lyric-heavy. Weak/local models ignore that instruction, so fix it
// deterministically: parse the sections, and if a long song has too few
// instrumental ones, fill the span between the last vocal section and the
// outro with varied section types. Never touches sections that have words.
export function padInstrumentalSections(lyrics, duration = 0, style = 'generic') {
  const text = String(lyrics || '').trim()
  if (!text) return text
  const dur = Number(duration) || 0
  if (dur < 180) return text // short songs don't need padding

  let sections = parseLyricSections(text)
  if (sections.length === 0) return text

  const isVocal = (s) => s.tag !== '' && s.words !== ''
  const isWordless = (s) =>
    s.tag !== '' && s.words === '' && !/intro/i.test(s.tag) && !/outro/i.test(s.tag)

  // Collapse adjacent duplicate tags — the AI sometimes writes [Drop][Drop]
  // back to back, which the planner reads as one repeated section.
  sections = sections.filter((s, i) => i === 0 || s.raw !== sections[i - 1].raw)

  let outroIdx = -1
  let introIdx = -1
  sections.forEach((s, i) => {
    if (/outro/i.test(s.tag)) outroIdx = i
    else if (/intro/i.test(s.tag)) introIdx = i
  })
  const vocalCount = sections.filter(isVocal).length

  const ensureOutro = (list) =>
    list.some((s) => /outro/i.test(s.tag))
      ? list
      : [...list, { tag: 'Outro', words: '', raw: '[Outro]' }]

  // PRESERVE a real AI arrangement — but ONLY when the map is something the
  // AR planner can actually track. The planner follows the tag map, NOT the
  // caption prose, and it exhausts its structural attention after ~5-8
  // distinct sections, then REPEATS the last groove until max_duration.
  // A map with 15+ consecutive wordless sections became 3+ minutes of
  // identical beats. So preservation requires: (a) the map fits the
  // section ceiling, AND (b) no run of consecutive wordless sections
  // exceeds MAX_CONSECUTIVE_WORDLESS.
  const ceiling = sectionCeiling(dur)
  const aiInstrumentals = sections.filter(isWordless).length
  const maxWordlessRun = (() => {
    let run = 0
    let max = 0
    for (const s of sections) {
      if (isWordless(s)) { run++; max = Math.max(max, run) }
      else run = 0
    }
    return max
  })()
  // Is every inter-chorus gap already filled with an instrumental? (A form
  // pass is verse→chorus with no break INSIDE it; the gaps that matter are
  // after each chorus except the last.)
  const vocalIdxs = sections.map((s, i) => (isVocal(s) ? i : -1)).filter((i) => i >= 0)
  const chorusIdxsP = sections
    .map((s, i) => (isVocal(s) && isChorusTag(s.tag) ? i : -1))
    .filter((i) => i >= 0)
  let arranged = chorusIdxsP.length >= 1
  for (let k = 0; k < chorusIdxsP.length - 1; k++) {
    const from = chorusIdxsP[k] + 1
    const nextVocal = vocalIdxs.find((vi) => vi > chorusIdxsP[k])
    const between = sections.slice(from, nextVocal != null ? nextVocal : sections.length)
    if (!between.some(isWordless)) { arranged = false; break }
  }
  // Preserve only when the map is LONG ENOUGH to fill the duration (at
  // least 90% of the ceiling) AND has no runaway wordless run. A 14-section
  // map at the planner's real ~20s/section pacing renders ~280s — too short
  // for a 360s request. Short-but-arranged maps fall through to the padding
  // path, which adds sections to reach the ceiling.
  const minPreserve = Math.ceil(ceiling * 0.9)
  if (sections.length >= minPreserve && maxWordlessRun <= MAX_CONSECUTIVE_WORDLESS && arranged && aiInstrumentals >= 3) {
    const kept = ensureOutro(sections)
    return collapseConsecutiveWordless(kept.map((s) => s.raw).join('\n\n'))
  }

  // Section budget: the planner sizes the song from the section COUNT and
  // ignores prose time spans. Use sectionCeiling (the same cap
  // trimSectionBudget enforces) so the padding target matches what the
  // final map can hold — the old plannerSectionTarget (8s/section) aimed
  // for 45 sections on a 360s request, which trimSectionBudget then cut
  // back to the ceiling, wasting the padding work.
  const total = sectionCeiling(dur)
  const fixedSlots = 1 + (introIdx >= 0 ? 1 : 0)
  // Never add instrumentals when the map is already at/over budget.
  if (sections.length >= total) return text
  const target = Math.max(0, total - vocalCount - fixedSlots)

  // Vocal sections in map order. The intro stays at the head of the map and
  // the outro at the tail — both keep their original slot. Only the gaps
  // between vocal passes are rebuilt. Dropping non-vocal tags is what
  // deleted the original [Intro] and left the map opening on a [Verse].
  const vocalSecs = sections.filter(isVocal)
  const intro = introIdx >= 0 ? [sections[introIdx]] : []
  const outro = outroIdx >= 0
    ? [sections[outroIdx]]
    : [{ tag: 'Outro', words: '', raw: '[Outro]' }]

  // Instrumental budget is split across the GAPS BETWEEN form passes, not
  // after every vocal section. A break between verse and chorus splits a
  // pass in half and the planner reads it as two half-forms; a break after
  // a chorus reads as a real instrumental break before the next pass.
  // gaps = (number of passes - 1), i.e. one slot after each chorus EXCEPT
  // the last — the final chorus is the climax and goes straight to the
  // outro. Trailing instrumentals after the last chorus make the AR planner
  // end the song early (it sees the vocal form complete and stops).
  // Match any real chorus tag — the AI writes [Chorus - euphoric],
  // [Drop + Chorus], [Final Chorus] etc., not just bare [Chorus]. Pre-Chorus
  // does NOT count (isChorusTag) — treating it as a form boundary put a
  // break after the pre-chorus and orphaned the real structure.
  const chorusIdxs = vocalSecs
    .map((s, i) => (isChorusTag(s.tag) ? i : -1))
    .filter((i) => i >= 0)
  const breakAfter = chorusIdxs.length > 1
    ? chorusIdxs.slice(0, -1) // all choruses except the last
    : chorusIdxs.length === 1
      ? [] // single chorus: no trailing break, goes straight to outro
      : [Math.max(0, vocalSecs.length - 1)] // no chorus: one break at the end

  // Distribute the instrumental budget ACROSS the gaps. Electronic/dance
  // styles put the long breakdown in the MIDDLE gap (between the two chorus
  // passes) — the emotional peak of a trance track sits there, not at the
  // end. Everything else splits the budget more evenly.
  //
  // The middle gap is CAPPED at MAX_CONSECUTIVE_WORDLESS (2): the AR
  // planner reads a long wordless run as ONE groove and loops it — a
  // 10-section middle gap became 3+ minutes of identical beats. Two
  // wordless sections between vocal passes is enough for a breakdown
  // without triggering the loop.
  const MIDDLE_GAP_CAP = { dance: MAX_CONSECUTIVE_WORDLESS, electronic: MAX_CONSECUTIVE_WORDLESS }
  const gaps = breakAfter.length
  const midGap = Math.floor((gaps - 1) / 2) // index of the middle gap
  const isMiddle = (k) =>
    wantsMiddleBreakdown(style) && gaps > 0 && (gaps === 1 ? true : k === midGap)
  const gapCounts = new Array(gaps).fill(0)
  let outroExtra = 0
  if (gaps > 0) {
    if (wantsMiddleBreakdown(style)) {
      const middleCap = MIDDLE_GAP_CAP[style]
      const desiredMiddle = gaps === 1 ? target : Math.round(target * 0.6)
      const middleCount = middleCap != null
        ? Math.min(desiredMiddle, middleCap)
        : desiredMiddle
      gapCounts[midGap] = middleCount
      // Side gaps take a modest, even share so the middle stays the feature
      // (they must not grow BIGGER than the capped middle — the old math
      // left 12 sections for the single side gap after capping middle at
      // 10). Anything beyond their cap extends the outro lead.
      const sideCap = middleCap != null
        ? Math.max(4, Math.floor(middleCap * 0.6))
        : Infinity
      const sideGaps = gaps - 1
      const sideBudget = Math.max(0, target - middleCount)
      const even = sideGaps > 0
        ? Math.min(Math.floor(sideBudget / sideGaps), sideCap)
        : 0
      let li = 0
      for (let k = 0; k < gaps; k++) {
        if (k === midGap) continue
        const bonus = li < sideBudget - even * sideGaps ? 1 : 0
        gapCounts[k] = Math.min(sideCap, even + bonus)
        li++
      }
      const assigned = gapCounts.reduce((n, c) => n + c, 0)
      outroExtra = Math.max(0, target - assigned)
    } else {
      const even = Math.floor(target / gaps)
      const leftover = target - even * gaps
      for (let k = 0; k < gaps; k++) {
        gapCounts[k] = even + (k < leftover ? 1 : 0)
      }
    }
  } else {
    // No inter-vocal gap (a single vocal section): all the filler extends
    // the outro lead — trailing sections before [Outro] still play.
    outroExtra = target
  }

  // Lead-gap tags cycle descriptive names with modifiers so consecutive tags
  // differ and the model gives each section real length (a bare
  // [Instrumental] run reads as ONE section and compresses to a few seconds).
  // [Intro] is deliberately NOT a lead-gap tag — the counter would stamp it
  // into every break. [Post-Chorus]/[Bridge] are excluded too: the planner
  // reads a bare one as a vocal section, so repeating them empty inflates
  // the vocal count. Tag modifiers ([Instrumental - extended]) per the
  // ACE-Step tutorial give the model a duration/character hint.
  const gapCountAt = new Map()
  breakAfter.forEach((vi, k) => gapCountAt.set(vi, gapCounts[k]))

  // Reassemble: intro (if the model wrote one) at the head, then the vocal
  // passes with an instrumental break after each chorus, then the outro.
  // Every map ends on [Outro] — a song that stops on a chorus reads as
  // truncated and the planner ends the track there. The MIDDLE gap gets the
  // style's breakdown sequence (breakdown → build for trance) instead of a
  // stack of generic tags, so the long section reads as one developing
  // passage the planner stretches, not a pile of short breaks.
  //
  // Lead tags come from a no-immediate-repeat picker: cycling a short pool
  // with a plain modulo stamped [Instrumental - driving] three times in a
  // row (the user saw a 20-tag run of cycling Drop/Build/Drum). The picker
  // walks the pool and skips whatever was just used.
  let leadCursor = 0
  let lastLeadTag = ''
  const leadTags = leadGapTags(style)
  const nextLead = () => {
    for (let n = 0; n < leadTags.length; n++) {
      const tag = leadTags[(leadCursor + n) % leadTags.length]
      if (tag !== lastLeadTag) {
        leadCursor = (leadCursor + n + 1) % leadTags.length
        lastLeadTag = tag
        return tag
      }
    }
    const tag = leadTags[leadCursor++ % leadTags.length]
    lastLeadTag = tag
    return tag
  }
  const body = vocalSecs.flatMap((v, i) => {
    const n = gapCountAt.get(i) || 0
    const gapK = breakAfter.indexOf(i)
    const middleSeq = MIDDLE_BREAKDOWN_TAGS[style] || MIDDLE_BREAKDOWN_TAGS.generic
    const breaks = Array.from({ length: n }, (_, k) => {
      let tag
      if (n > 0 && gapK >= 0 && isMiddle(gapK)) {
        // Lay the breakdown sequence across the middle gap (rotated by gap
        // so multiple middle gaps don't all start on the same tag), then
        // pad the remainder with lead-gap tags so the section count still
        // lands.
        const seq = middleSeq[gapK % middleSeq.length]
        if (k < seq.length) tag = seq[k]
        else tag = nextLead()
      } else {
        tag = nextLead()
      }
      return { tag, words: '', raw: `[${tag}]` }
    })
    return [v, ...breaks]
  })

  // Pure instrumental map: no vocal passes to hang breaks on, so the whole
  // filler budget lands between the intro and the outro.
  const fillerOnly = vocalSecs.length === 0
    ? Array.from({ length: target }, () => {
        const tag = nextLead()
        return { tag, words: '', raw: `[${tag}]` }
      })
    : []

  // Extended outro: when there are vocals, add 2–3 instrumental sections
  // before the [Outro] tag so the ending isn't a 10-second stub. The
  // planner plays through them because the outro tag signals the end —
  // it won't cut early like it did with trailing instrumentals after the
  // last chorus (those had no outro tag after them). `outroExtra` is the
  // remainder left after the middle-gap cap (and side-gap caps) — the
  // uncapped budget that used to stack in the middle now extends the
  // ending instead, and trimSectionBudget thins the tail to the ceiling.
  const outroBase = Math.min(3, Math.max(1, Math.floor(dur / 120)))
  const outroLead = vocalSecs.length > 0
    ? Array.from({ length: outroBase + outroExtra }, () => {
        const tag = nextLead()
        return { tag, words: '', raw: `[${tag}]` }
      })
    : []

  return [...intro, ...body, ...fillerOnly, ...outroLead, ...outro].map((s) => s.raw).join('\n\n')
}

// Final pass: guarantee 2–3 wordless sections immediately before the [Outro]
// tag. The AI often ends a map on a vocal (bridge/chorus) straight into
// [Outro] — the AR planner then cuts from full vocal to a stub fade, which is
// why endings sounded abrupt. padInstrumentalSections adds an outro lead for
// songs it processes, but it early-returns for short maps (dur < 180) and
// trimSectionBudget can strip the tail, so this runs LAST in the pipeline as
// the one place that always enforces the lead-out. Inserts from the style's
// lead-gap tag pool; skips when the section before the outro is already
// wordless (the lead exists) or there's no outro to lead into.
export function ensureOutroLead(lyrics, style = 'generic') {
  const sections = parseLyricSections(lyrics)
  if (sections.length < 3) return lyrics
  const outroIdx = sections.findIndex((s) => /outro/i.test(s.tag))
  if (outroIdx <= 0) return lyrics
  // Walk back over already-wordless sections (an existing lead) — if any of
  // the last 3 before the outro is wordless, there's enough wind-down room.
  let wordlessRun = 0
  for (let i = outroIdx - 1; i >= 0 && wordlessRun < 3; i--) {
    const s = sections[i]
    if (s.words !== '' || /intro/i.test(s.tag)) break
    wordlessRun++
  }
  if (wordlessRun >= 2) return lyrics // already has a lead-out
  const need = 3 - wordlessRun
  const pool = leadGapTags(style)
  const lead = Array.from({ length: need }, (_, i) => {
    const tag = pool[i % pool.length]
    return { tag, words: '', raw: `[${tag}]` }
  })
  sections.splice(outroIdx, 0, ...lead)
  return sections.map((s) => s.raw).join('\n\n')
}

// Collapse any run of more than MAX_CONSECUTIVE_WORDLESS consecutive
// wordless (instrumental) sections down to the cap, then REBALANCE: the
// AI often clusters vocals at the end of the map, leaving a long wordless
// run in the middle. Collapse truncates that run (correctly — the planner
// would loop it), but that drops below the section ceiling and the song
// comes up short. After collapsing, re-insert wordless sections into the
// gaps between vocal sections (max MAX_CONSECUTIVE_WORDLESS per gap) to
// fill back up to `targetSections` without ever exceeding the run cap.
// Intro and outro are exempt (they're bookends, not mid-song runs).
export function collapseConsecutiveWordless(lyrics, targetSections = 0) {
  const sections = parseLyricSections(lyrics)
  if (sections.length === 0) return lyrics
  const isWordless = (s) =>
    s.tag !== '' && s.words === '' && !/intro/i.test(s.tag) && !/outro/i.test(s.tag)
  const isVocal = (s) => s.tag !== '' && s.words !== ''
  // Find the outro index — the trailing wordless run before it is the
  // LEAD-OUT (wind-down before the fade), not a mid-song groove. The
  // planner plays these because the outro tag signals the end; collapsing
  // them to 2 would starve the ending. Only collapse MID-SONG runs.
  const outroIdx = sections.findIndex((s) => /outro/i.test(s.tag))
  // Walk back from the outro over wordless sections to find where the
  // lead-out starts. Everything from there to the outro is exempt.
  let leadOutStart = outroIdx >= 0 ? outroIdx : sections.length
  while (leadOutStart > 0 && isWordless(sections[leadOutStart - 1])) leadOutStart--
  // Phase 1: collapse mid-song wordless runs to the cap.
  const collapsed = []
  let run = 0
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]
    const exempt = /intro|outro/i.test(s.tag) || (outroIdx >= 0 && i >= leadOutStart && i < outroIdx)
    if (isWordless(s) && !exempt) {
      run++
      if (run > MAX_CONSECUTIVE_WORDLESS) continue // drop excess
    } else {
      run = 0
    }
    collapsed.push(s)
  }
  // Phase 2: rebalance — if under target, insert wordless sections into
  // the gaps between vocals (max MAX_CONSECUTIVE_WORDLESS per gap) to
  // fill back up. This interleaves instrumentals with vocals instead of
  // clustering them, which is what the planner needs to keep variety.
  if (targetSections <= 0 || collapsed.length >= targetSections) {
    return collapsed.map((s) => s.raw).join('\n\n')
  }
  // Find gaps between consecutive vocal sections (excluding intro/outro/
  // lead-out). Each gap currently has some wordless sections; we can add
  // up to (MAX_CONSECUTIVE_WORDLESS - currentRun) more per gap.
  const leadGapPool = leadGapTags('generic')
  let gapCursor = 0
  const result = [...collapsed]
  let added = 0
  // Iterate until we hit the target or run out of insertable gaps.
  while (added < targetSections - collapsed.length) {
    let inserted = false
    for (let i = 0; i < result.length - 1 && added < targetSections - collapsed.length; i++) {
      if (!isVocal(result[i])) continue
      // Find the next vocal (or outro) after i
      let next = i + 1
      while (next < result.length && !isVocal(result[next]) && !/outro/i.test(result[next].tag)) next++
      if (next >= result.length) break
      // Count current wordless run in this gap
      let gapRun = 0
      for (let j = i + 1; j < next; j++) {
        if (isWordless(result[j])) gapRun++
        else break
      }
      if (gapRun < MAX_CONSECUTIVE_WORDLESS) {
        const tag = leadGapPool[gapCursor++ % leadGapPool.length]
        result.splice(next, 0, { tag, words: '', raw: `[${tag}]` })
        added++
        inserted = true
      }
    }
    if (!inserted) break // no gap can take more
  }
  return result.map((s) => s.raw).join('\n\n')
}
