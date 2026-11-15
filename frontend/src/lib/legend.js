// The comfort key and the layer's one-line explanation (Elena, 2026-11-11): the key sits in the right card, under the
// coloured bar(s), never in the left panel; the left panel says in one line what the colours mean.

const NAMES = { senses: 'Sensory comfort', thermal: 'Thermal', overall: 'Overall comfort' } // Elena, 2026-11-11: "Sensory comfort"; boards 1, 2b: "Overall comfort"
const when = (w) => (w ? `${w.season}, ${w.time}` : '')

/** "Overall · summer, 15:00" or "Sensory comfort" as { name, when }. Senses has no season and time: the photo rating does not change with them. */
export function keyTitle(layer, window) {
  return { name: NAMES[layer] ?? layer, when: layer === 'senses' ? '' : when(window) }
}

/** Easy, Mixed, Hard, and the grey: Thermal lights every street with a value, photo or not, so its grey means no value.
 *  Overall also has "Partial" (one layer only, drawn dashed; not on the routes, where B is the dashed one) and calls
 *  its grey "No data". */
export function keyRows(layer, { partial = true } = {}) {
  const rows = [
    { id: 'easy', label: 'Easy', color: 'var(--easy)' },
    { id: 'mixed', label: 'Mixed', color: 'var(--mixed)' },
    { id: 'hard', label: 'Hard', color: 'var(--hard)' },
  ]
  if (layer === 'overall' && partial) {
    rows.push({ id: 'partial', label: 'Partial: one layer only', color: 'var(--partial-swatch)', partial: true })
  }
  rows.push({ id: 'none', label: layer === 'thermal' ? 'No value' : layer === 'overall' ? 'No data' : 'No photo', color: 'var(--no-photo)' })
  return rows
}

/** The left panel's line about the layer. */
export function layerNote(layer, window) {
  const w = when(window)
  if (layer === 'senses') return 'Each street stretch is rated from its photo.'
  if (layer === 'thermal') return `Each street stretch shows its simulated feels-like temperature${w ? ` (${w})` : ''}.`
  return `Each street stretch shows the worse of thermal comfort${w ? ` (${w})` : ''} and its photo rating. The photo ` +
    'rating is from when the photo was taken: season and time change only the thermal part.'
}

/**
 * The area's bar by street length, like a route's (Elena, 2026-11-11): metres per state of the streets (parks and squares
 * have no length, so they are left out), the hard share of that length, and the number of stretches per state.
 * @param {object[]} features the area's segments
 * @param {(f: object) => string|null} stateOf 'easy' | 'mixed' | 'hard', or null (no value or no rating)
 */
export function lengthShares(features, stateOf) {
  const metres = { easy: 0, mixed: 0, hard: 0, none: 0 }
  const counts = { easy: 0, mixed: 0, hard: 0, none: 0 }
  for (const f of features) {
    const s = stateOf(f) ?? 'none'
    counts[s]++
    if (f.geometry.type === 'LineString') metres[s] += f.properties.length_m ?? 0
  }
  const total = metres.easy + metres.mixed + metres.hard + metres.none
  return { metres, counts, total, hard: total ? metres.hard / total : 0 }
}
