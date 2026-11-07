// "Likely easiest for you": up to 3 places in the loaded area to mark on the map (brief §3). Written
// once for any layer: Thermal uses it now; Senses and Overall can pass their own level and value.
import config from '../config.js'
import { haversine, midpoint } from './geo.js'
import { LEVEL, thermalLevel } from './nearby.js'
import { placeGroup } from './place.js'
import { comfortKey, thermalState } from './thermal.js'

/**
 * Greedy pick. Candidates are the features with keep(f) true, ranked by value(f) (higher is better;
 * a tie goes to the one nearer the centre). Each pick is the best one left that is at least minApartM
 * from every earlier pick (between middles), except that among those within `margin` of it, one of a
 * type not picked yet (street, park, square) goes first.
 * @returns {{ n:number, f:object, mid:{lat:number, lon:number}, type:string }[]}
 */
export function pickSuggestions(features, { keep, value, centre = null, n = config.suggest.count,
  minApartM = config.suggest.minApartM, margin = config.suggest.margin, typeOf = (f) => placeGroup(f.properties, f.geometry.type) }) {
  const ranked = features.filter(keep)
    .map((f) => {
      const mid = midpoint(f.geometry)
      return { f, mid, v: value(f), type: typeOf(f), dc: centre ? haversine(centre, mid) : 0 }
    })
    .sort((a, b) => b.v - a.v || a.dc - b.dc)
  const picks = []
  while (picks.length < n) {
    const pool = ranked.filter((c) => !picks.includes(c) && picks.every((p) => haversine(p.mid, c.mid) >= minApartM))
    if (!pool.length) break
    const types = new Set(picks.map((p) => p.type))
    const close = pool.filter((c) => pool[0].v - c.v <= margin)
    picks.push(close.find((c) => !types.has(c.type)) ?? pool[0])
  }
  return picks.map((p, i) => ({ n: i + 1, f: p.f, mid: p.mid, type: p.type }))
}

/**
 * Thermal: places rated easy for this person (their limits), in the Places filter ('all', 'streets',
 * 'parks', 'squares'), closest to comfort first (comfortKey, shared with the nearby street). All of
 * them are inside the easy range, so the rank is the degrees from its middle (17.5 °C with the
 * standard limits), and `margin` is in those degrees.
 */
export function thermalSuggestions(features, { limits, filter = 'all', centre = null, ...rest } = {}) {
  return pickSuggestions(features, {
    keep: (f) => thermalLevel(f.properties.utci, limits) === LEVEL.easy &&
      (filter === 'all' || placeGroup(f.properties, f.geometry.type) === filter),
    value: (f) => -comfortKey(f.properties.utci, limits)[1],
    centre,
    ...rest,
  }).map((s) => ({ ...s, level: thermalState(s.f.properties.utci, limits) }))
}
