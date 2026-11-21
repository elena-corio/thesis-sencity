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

// What each answer about preparing or coping can be paired with, among the facts the app has (the elements in the
// photos, a calmer street nearby). Only answers the person ticked are used.
const HELPS = ['quieter_spot', 'sit_rest', 'drink_eat', 'headphones_earplugs', 'sunglasses_hat', 'leave_earlier', 'trusted_person', 'nothing_helps', 'other']
const PREPARES = ['look_at_photos', 'check_busy', 'calmer_route', 'rest_places']

/**
 * prepare_cope: the person's own answers (Q2: how they prepare, Q4: what helps) with the facts about the place.
 * → { answered, place, tips: [{ kind, code, facts }] } — one tip per ticked answer the app can say something true
 * about; `facts` are element codes found in the photos, or { easier } for a calmer street nearby.
 */
export function prepareCope({ prepare, listed = null, easier = null, name = null }) {
  const q2 = prepare?.Q2?.ticked ?? []
  const q4 = prepare?.Q4?.ticked ?? []
  const has = (codes) => (listed ?? []).filter((c) => codes.includes(c))
  const tips = []
  for (const code of HELPS.filter((c) => q4.includes(c))) {
    const facts = {
      quieter_spot: { easier },
      sit_rest: { found: has(['seats']), looked: listed != null },
      drink_eat: { found: has(['drinking_fountains_toilets', 'food_stalls_cafes']), looked: listed != null },
      headphones_earplugs: { found: has(['traffic_trams', 'crowds']), looked: listed != null },
      sunglasses_hat: { found: has(['direct_sun', 'shade']), looked: listed != null },
      other: { text: prepare?.Q4?.other || '' },
    }[code] ?? {}
    tips.push({ kind: 'helps', code, facts })
  }
  for (const code of PREPARES.filter((c) => q2.includes(c))) {
    const facts = {
      check_busy: { found: has(['crowds']), looked: listed != null },
      rest_places: { found: has(['seats', 'drinking_fountains_toilets', 'shade']), looked: listed != null },
    }[code] ?? {}
    tips.push({ kind: 'prepares', code, facts })
  }
  return { answered: q2.length + q4.length > 0, place: name, tips }
}
