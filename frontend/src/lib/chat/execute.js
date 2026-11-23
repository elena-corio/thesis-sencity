// The chat's actions, carried out on data the browser already holds (Elena, 2026-11-21). Pure: each takes the intent
// and the data it needs and returns facts; lib/chat/templates.js turns them into words, so the model never writes
// facts. Nothing here calls the server.

import { haversine, midpoint } from '../geo.js'
import { GRIDS, gridRows } from '../profile.js'
import { overallOf } from '../overall.js'

const LEVELS = ['easy', 'mixed', 'hard']
const RANK = { easy: 0, mixed: 1, hard: 2 }
const level = (s) => (LEVELS.includes(s) ? s : null)

/** A street's level on a layer: Senses from its photos, Thermal from its feels-like value, Overall the worse of both. */
export function levelOn(f, layer) {
  const p = f.properties
  if (layer === 'thermal') return level(p.thermal_state)
  if (layer === 'overall') return level(overallOf(p.senses_state, p.thermal_state).state)
  return level(p.senses_state)
}

/**
 * filter_places: the area's places that match. `listedOf(f)` gives the element codes in a place's photos (null when not
 * rated yet); `around` ({ lat, lon }) and `radius` limit the places to a circle. Places without a rating on the layer,
 * or without listed elements when elements are asked for, cannot match: they are counted as `unknown`.
 * → { total, unknown, matches: [{ f, level, comfort, d }], counts: { easy, mixed, hard } } — easiest first, then the
 * best comfort, then the nearest.
 */
export function filterPlaces(intent, { features, layer, listedOf, around = null, radius = null }) {
  const inside = (features ?? []).filter((f) => !around || !radius || haversine(around, midpoint(f.geometry)) <= radius)
  const wantsElements = intent.with.length || intent.without.length
  const matches = []
  let unknown = 0
  for (const f of inside) {
    const lv = levelOn(f, layer)
    const listed = wantsElements ? listedOf(f) : null
    if ((intent.level && !lv) || (wantsElements && !listed)) { unknown++; continue }
    if (intent.level && lv !== intent.level) continue
    if (intent.with.some((c) => !listed.includes(c)) || intent.without.some((c) => listed.includes(c))) continue
    matches.push({ f, level: lv, comfort: f.properties.senses_comfort ?? null, d: around ? haversine(around, midpoint(f.geometry)) : 0 })
  }
  matches.sort((a, b) => (RANK[a.level] ?? 3) - (RANK[b.level] ?? 3) || (b.comfort ?? 0) - (a.comfort ?? 0) || a.d - b.d)
  const counts = { easy: 0, mixed: 0, hard: 0 }
  for (const m of matches) if (m.level) counts[m.level]++
  return { total: inside.length, unknown, matches, counts }
}

/** Your 1–5 answer for an element (A12 or A13), or null. */
export function answerFor(answers, code) {
  for (const g of GRIDS) if (Number.isInteger(answers?.[g]?.[code])) return answers[g][code]
  return null
}

/**
 * explain_place: from the place's stored rating. `place` is lib/senses.js combinePlace (with `listed`), `answers` the
 * profile's (or null). → { name, layer, level, comfort, inPhotos, bothersYou, goodForYou, reason, utci, thermal }
 */
export function explainPlace({ f, place, layer, answers }) {
  const listed = place?.status === 'rated' ? place.listed ?? [] : []
  const score = (c) => answerFor(answers, c)
  return {
    id: f.properties.id,
    name: f.properties.name || null,
    layer,
    level: levelOn(f, layer),
    sensesLevel: place?.status === 'rated' ? place.level : null,
    comfort: place?.status === 'rated' ? place.comfort : null,
    inPhotos: listed,
    bothersYou: answers ? listed.filter((c) => score(c) != null && score(c) <= 2).sort((a, b) => score(a) - score(b)) : [],
    goodForYou: answers ? listed.filter((c) => score(c) != null && score(c) >= 4).sort((a, b) => score(b) - score(a)) : [],
    reason: place?.status === 'rated' ? place.reason ?? null : null,
    status: place?.status ?? 'none',
    thermal: level(f.properties.thermal_state),
    utci: Number.isFinite(f.properties.utci) ? f.properties.utci : null,
  }
}

/**
 * summarise_profile: what the radar shows, from the stored answers. → { overall (A11), bothers: [{ code, score }],
 * good: [{ code, score }] }, strongest first, at most `count` each.
 */
export function summariseProfile(survey, answers, count = 3) {
  const rows = GRIDS.flatMap((g) => gridRows(survey, g))
  const scored = rows.map((r) => ({ code: r.code, score: answerFor(answers, r.code) })).filter((r) => r.score != null)
  return {
    overall: Number.isInteger(answers?.A11) ? answers.A11 : null,
    bothers: scored.filter((r) => r.score <= 2).sort((a, b) => a.score - b.score).slice(0, count),
    good: scored.filter((r) => r.score >= 4).sort((a, b) => b.score - a.score).slice(0, count),
  }
}

/**
 * What the app knows about where the person is going (Elena, 2026-11-21): one place, or every place of the area.
 * → { scope, count, comfort: [min, max] | null (photo ratings 1–5), rated, thermal: { levels: ['mixed', 'hard'],
 *   heat, cold, max, min } | null, elements: { code: places listing it }, looked (places with listed elements),
 *   easy: [{ id, name } of places easy on the layer], easier: { id, name, d } | null (a calmer street near one place) }
 */
export function placeFacts(features, { listedOf, layer, scope = 'area', easier = null, coldOf = () => false }) {
  const list = features ?? []
  const comforts = list.map((f) => f.properties.senses_comfort).filter(Number.isInteger)
  const thermal = list.filter((f) => level(f.properties.thermal_state) && Number.isFinite(f.properties.utci))
  const hardish = thermal.filter((f) => f.properties.thermal_state !== 'easy')
  const elements = {}
  let looked = 0
  for (const f of list) {
    const listed = listedOf(f)
    if (!listed) continue
    looked++
    for (const c of listed) elements[c] = (elements[c] ?? 0) + 1
  }
  return {
    scope,
    count: list.length,
    comfort: comforts.length ? [Math.min(...comforts), Math.max(...comforts)] : null,
    rated: comforts.length,
    thermal: thermal.length ? {
      levels: LEVELS.filter((l) => thermal.some((f) => f.properties.thermal_state === l)),
      heat: hardish.some((f) => !coldOf(f.properties.utci)),
      cold: hardish.some((f) => coldOf(f.properties.utci)),
      max: Math.max(...thermal.map((f) => f.properties.utci)),
      min: Math.min(...thermal.map((f) => f.properties.utci)),
    } : null,
    elements,
    looked,
    easy: scope !== 'place' ? list.filter((f) => levelOn(f, layer) === 'easy' && f.properties.name).map((f) => ({ id: f.properties.id, name: f.properties.name })) : [],
    easier,
  }
}

/**
 * prepare_cope: the person's own answers (Q2: how they prepare, Q4: what helps) and the facts. Only ticked answers are
 * used; none is invented. → { answered, helps: [codes], prepares: [codes], other: '' }
 */
export function prepareCope({ prepare }) {
  const helps = prepare?.Q4?.ticked ?? []
  const prepares = prepare?.Q2?.ticked ?? []
  return { answered: helps.length + prepares.length > 0, helps, prepares, other: helps.includes('other') ? prepare?.Q4?.other || '' : '' }
}

export const SEASONS = ['spring', 'summer', 'autumn', 'winter']

/**
 * compare_seasons (Elena, 2026-11-23: "which season is the best to go?"). Only thermal comfort changes with the season;
 * the photo ratings stay. For each season: its feels-like values per street (`values[season]`: { id: °C }), read with the
 * person's limits (`stateOf`), combined with the street's Senses level into Overall, the worse of both, as on the map.
 * features: the area's streets (or the one place asked about). coldOf(°C): too cold rather than too hot.
 * Returns { rows: [{ season, easy, mixed, hard, rated, why: 'heat' | 'cold' | null, utci }], best: [season…], photos }
 * in the order of SEASONS; best: the seasons with the most easy places, then the fewest hard (ties all listed).
 */
export function compareSeasons(features, values, { stateOf, coldOf = () => false }) {
  const photos = features.some((f) => level(f.properties.senses_state))
  const rows = SEASONS.filter((s) => values[s]).map((season) => {
    const n = { easy: 0, mixed: 0, hard: 0 }
    let hot = 0
    let cold = 0
    const temps = []
    for (const f of features) {
      const utci = values[season][f.properties.id]
      const thermal = utci == null ? null : stateOf(utci)
      if (utci != null) temps.push(utci)
      if (thermal === 'hard' || thermal === 'mixed') coldOf(utci) ? cold++ : hot++
      const s = level(overallOf(f.properties.senses_state, thermal).state)
      if (s) n[s]++
    }
    const rated = n.easy + n.mixed + n.hard
    const why = hot + cold === 0 ? null : hot >= cold ? 'heat' : 'cold'
    const utci = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null
    return { season, ...n, rated, why, utci }
  })
  const score = (r) => (r.rated ? [r.easy / r.rated, -r.hard / r.rated] : [-1, 0])
  const better = (a, b) => { const [x, y] = [score(a), score(b)]; return x[0] - y[0] || x[1] - y[1] }
  const top = rows.reduce((m, r) => (!m || better(r, m) > 0 ? r : m), null)
  const best = top?.rated ? rows.filter((r) => better(r, top) === 0).map((r) => r.season) : []
  return { rows, best, photos }
}
