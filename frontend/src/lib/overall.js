// Overall (Elena, 2026-11-15; boards 1, 2b): per street, the worse of Senses and Thermal (hard > mixed > easy). Worked
// out in the browser from the levels already on each street (senses_state from the photo ratings, thermal_state from
// the feels-like value and the limits in use, personal or standard): no model call, nothing new sent to the server.
// Changing the season or time changes only the thermal part.

export const RANK = { easy: 0, mixed: 1, hard: 2 }
const LEVELS = Object.keys(RANK)
const level = (s) => (LEVELS.includes(s) ? s : null) // 'failed', 'pending' or nothing: not a level

/**
 * The overall level of one street from its two levels (each 'easy' | 'mixed' | 'hard', or missing):
 * { state, partial, basis, decider }.
 * - both there: the worse; decider 'senses', 'thermal', or 'both' when they are equal;
 * - one missing: the other, partial (drawn hatched), basis 'senses' or 'thermal';
 * - both missing: state null ("No data", like "No photo").
 */
export function overallOf(senses, thermal) {
  const s = level(senses)
  const t = level(thermal)
  if (s && t) {
    const decider = RANK[s] === RANK[t] ? 'both' : RANK[s] > RANK[t] ? 'senses' : 'thermal'
    return { state: decider === 'thermal' ? t : s, partial: false, basis: 'both', decider }
  }
  if (s) return { state: s, partial: true, basis: 'senses', decider: 'senses' }
  if (t) return { state: t, partial: true, basis: 'thermal', decider: 'thermal' }
  return { state: null, partial: false, basis: null, decider: null }
}

/** overall_state and overall_partial on every street, from its senses_state and thermal_state. */
export function withOverall(fc) {
  if (!fc) return fc
  return {
    ...fc,
    features: fc.features.map((f) => {
      const { overall_state: _s, overall_partial: _p, ...props } = f.properties
      const o = overallOf(props.senses_state, props.thermal_state)
      return { ...f, properties: o.state ? { ...props, overall_state: o.state, overall_partial: o.partial } : props }
    }),
  }
}

const WORD = { easy: 'Easy', mixed: 'Mixed', hard: 'Hard' }
const deg = (t) => `${Math.round(t).toString().replace('-', '−')} °C`
/** "traffic, trams; signs, ads": up to two of what might bother, in plain words (names keep their commas). */
function bothersText(place) {
  const names = (place?.bothers ?? []).slice(0, 2).map((e) => e.en.toLowerCase())
  return names.join('; ')
}

/**
 * The card's line on what decides (Elena): "Hard because of heat: feels like 34 °C", "Mixed because of your senses:
 * traffic, trams; signs, ads", "Hard because of heat and your senses" (both the same), "Easy for your senses and the
 * temperature"; with one part missing, "Mixed · based on thermal only". `personal`: the senses part is the person's
 * (else "the senses", not "your senses").
 */
export function overallReason(o, { utci = null, hot = true, place = null, comfort = null, personal = true } = {}) {
  if (!o?.state) return 'No data: no photo and no thermal comfort here.'
  const W = WORD[o.state]
  const senses = personal ? 'your senses' : 'the senses'
  const weather = hot ? 'heat' : 'cold'
  if (o.partial) return `${W} · based on ${o.basis === 'thermal' ? 'thermal' : 'senses'} only`
  if (o.state === 'easy') return `Easy for ${senses} and the temperature`
  if (o.decider === 'both') return `${W} because of ${weather} and ${senses}`
  if (o.decider === 'thermal') return `${W} because of ${weather}${utci != null ? `: feels like ${deg(utci)}` : ''}`
  const why = bothersText(place) || (comfort ? `rated ${comfort} of 5` : '')
  return `${W} because of ${senses}${why ? `: ${why}` : ''}`
}

/** A route's share of easy, mixed and hard on Overall, by length: { easy, mixed, hard, none } (0–1). */
export function overallShares(stretches) {
  const len = { easy: 0, mixed: 0, hard: 0, none: 0 }
  for (const s of stretches) len[s.state && RANK[s.state] != null ? s.state : 'none'] += s.length ?? 0
  const total = len.easy + len.mixed + len.hard + len.none
  return Object.fromEntries(Object.entries(len).map(([k, v]) => [k, total ? v / total : 0]))
}
