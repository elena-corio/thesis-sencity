// "Easier street nearby" (brief §3, place card): a segment within a short walk that is at least one
// comfort level better for this person, the one closest to comfort first. Written once for any layer:
// Thermal uses it now as "Cooler (or warmer) street nearby"; Senses and Overall can pass their own
// level and rank.
import config from '../config.js'
import { haversine, midpoint } from './geo.js'
import { compareComfort, comfortKey, thermalState } from './thermal.js'

/** Comfort levels, worst first: a candidate must have a higher one. */
export const LEVEL = { hard: 0, mixed: 1, easy: 2 }

/**
 * The best other segment within maxM (straight line between their middles) whose level is higher
 * than this one's: { f, mid, d } or null. None when this segment is already easy or has no level.
 * Best = lowest rank(f) by compare(a, b), then the shortest walk.
 * @param {object} feature
 * @param {object[]} features
 * @param {{ levelOf: (f: object) => number | null, rank?: (f: object) => any, compare?: (a: any, b: any) => number, maxM?: number }} rule
 */
export function easierNearby(feature, features, { levelOf, rank = () => 0, compare = (a, b) => a - b, maxM = config.nearby.maxM }) {
  const from = levelOf(feature)
  if (from == null || from >= LEVEL.easy) return null
  const here = midpoint(feature.geometry)
  let best = null
  for (const f of features) {
    if (f === feature || f.properties.id === feature.properties.id) continue
    const level = levelOf(f)
    if (level == null || level <= from) continue
    const mid = midpoint(f.geometry)
    const d = haversine(here, mid)
    if (d > maxM) continue
    const c = { f, mid, d, r: rank(f) }
    if (!best || compare(c.r, best.r) < 0 || (compare(c.r, best.r) === 0 && d < best.d)) best = c
  }
  return best && { f: best.f, mid: best.mid, d: best.d }
}

/** Thermal level of a feels-like value for these limits (the person's, once the profile sets them). */
export function thermalLevel(utci, limits = config.thermalLimits) {
  return utci == null ? null : LEVEL[thermalState(utci, limits)]
}

/** "Cooler (or warmer) street nearby": ranked by closeness to comfort (comfortKey), then walking distance. */
export function easierThermalNearby(feature, features, limits = config.thermalLimits, maxM = config.nearby.maxM) {
  if (feature.properties.utci == null) return null
  return easierNearby(feature, features, {
    levelOf: (f) => thermalLevel(f.properties.utci, limits),
    rank: (f) => comfortKey(f.properties.utci, limits),
    compare: compareComfort,
    maxM,
  })
}
