// Thermal comfort in the app (brief §4): the feels-like temperature of a street (°C, from the
// API) to its state: easy, mixed or hard (no 1–5 score). All limits are in config.js (standard, for everyone).
import config from '../config.js'

const STANDARD = config.thermalLimits

/**
 * The limits in use: the standard ones from config.js, for everyone (no profiles yet). The card, the
 * legend, the nearby street, the suggestions and the routes all read them here.
 */
export function thermalLimits() {
  return STANDARD
}

/** The easy range [lower, upper] and its middle, the comfort target. */
export function easyRange(limits = STANDARD) {
  return [limits.cold[0], limits.heat[0]]
}
export function comfortTarget(limits = STANDARD) {
  const [lo, hi] = easyRange(limits)
  return (lo + hi) / 2
}

/**
 * How far a value is from comfort, for ranking (lower is better), shared by "Cooler / Warmer street
 * nearby" and the suggestions: [degrees outside the easy range (0 inside), and, inside it only, the
 * degrees from the middle of the range]. Compare with compareComfort.
 */
export function comfortKey(utci, limits = STANDARD) {
  const [lo, hi] = easyRange(limits)
  const outside = utci < lo ? lo - utci : utci > hi ? utci - hi : 0
  return [outside, outside ? 0 : Math.abs(utci - comfortTarget(limits))]
}
export function compareComfort(a, b) {
  return a[0] - b[0] || a[1] - b[1]
}

/** easy, mixed or hard for these limits (thermal has no 1–5 score). */
export function thermalState(utci, limits = STANDARD) {
  const [hMixed, hHard] = limits.heat
  const [cEasy, cHard] = limits.cold
  if (utci > hHard || utci < cHard) return 'hard'
  if (utci > hMixed || utci < cEasy) return 'mixed'
  return 'easy'
}

/** "−3 °C" with a real minus sign. */
export function formatDegrees(t) {
  return `${Math.round(t).toString().replace('-', '−')} °C`
}

const deg = (t) => t.toString().replace('-', '−')

/** Too warm: above the easy range (the nearby street to suggest is then a cooler one). */
export function isHot(utci, limits = STANDARD) {
  return utci > limits.heat[0]
}
/** Too cold: below the easy range (the nearby street to suggest is then a warmer one). */
export function isCold(utci, limits = STANDARD) {
  return utci < limits.cold[0]
}

/**
 * The card line, only for the side that applies: "Hard: above 32 °C", "Mixed: below 9 °C",
 * "Easy: 9 to 26 °C".
 */
export function thermalVerdict(utci, limits = STANDARD) {
  const [hMixed, hHard] = limits.heat
  const [cEasy, cHard] = limits.cold
  const state = thermalState(utci, limits)
  const label = { easy: 'Easy', mixed: 'Mixed', hard: 'Hard' }[state]
  let why = `${deg(cEasy)} to ${deg(hMixed)} °C`
  if (state === 'hard') why = utci > hHard ? `above ${deg(hHard)} °C` : `below ${deg(cHard)} °C`
  if (state === 'mixed') why = utci > hMixed ? `above ${deg(hMixed)} °C` : `below ${deg(cEasy)} °C`
  return { state, label, why, text: `${label}: ${why}` }
}

/** Walking minutes for a distance in metres (at least 1). */
export function walkMinutes(m) {
  return Math.max(1, Math.round(m / config.walkMetresPerMinute))
}

/**
 * Which side of the scale the values on screen reach: 'heat' when none is below the easy range,
 * 'cold' when some are below it and none above it, 'both' when there are some of each.
 */
export function thermalSide(values, limits = STANDARD) {
  const [lo, hi] = easyRange(limits)
  const cold = values.some((v) => v < lo)
  const hot = values.some((v) => v > hi)
  if (!cold) return 'heat'
  return hot ? 'both' : 'cold'
}

/**
 * Legend rows: Easy always with its range; Mixed and Hard only for the side shown ('heat', 'cold' or
 * 'both'; with both, each has two short lines). { state, label, lines }
 */
export function thermalLegend(limits = STANDARD, side = 'both') {
  const [hMixed, hHard] = limits.heat.map(deg)
  const [cEasy, cHard] = limits.cold.map(deg)
  const heat = side !== 'cold'
  const cold = side !== 'heat'
  return [
    { state: 'easy', label: 'Easy', lines: [`${cEasy} to ${hMixed} °C`] },
    { state: 'mixed', label: 'Mixed', lines: [heat && `${hMixed} to ${hHard} °C`, cold && `${cHard} to ${cEasy} °C`].filter(Boolean) },
    { state: 'hard', label: 'Hard', lines: [heat && `above ${hHard} °C`, cold && `below ${cHard} °C`].filter(Boolean) },
  ]
}

/**
 * The temperature bar on the place card, for the side shown (as the legend): its ends, the gradient
 * stops (cyan through the easy band, blending to amber in the middle of the mixed band and red from
 * the hard border on) and the ticks (the ends and the band borders). Heat side from cold[0] to the
 * bar's max; cold side from the bar's min to heat[0], so hard is on the left; both from min to max.
 * Positions are 0–100 (%). { min, max, stops: [{ at, state }], ticks: [{ at, value }] }
 */
export function thermalBar(limits = STANDARD, side = 'heat', ends = config.thermalBar) {
  const [hMixed, hHard] = limits.heat
  const [cEasy, cHard] = limits.cold
  const min = side === 'heat' ? cEasy : ends.min
  const max = side === 'cold' ? hMixed : ends.max
  const at = (v) => (100 * (v - min)) / (max - min)
  const heat = [[cEasy, 'easy'], [hMixed, 'easy'], [(hMixed + hHard) / 2, 'mixed'], [hHard, 'hard'], [max, 'hard']]
  const cold = [[min, 'hard'], [cHard, 'hard'], [(cHard + cEasy) / 2, 'mixed'], [cEasy, 'easy'], [hMixed, 'easy']]
  const pts = side === 'heat' ? heat : side === 'cold' ? cold : [...cold.slice(0, -1), ...heat.slice(1)]
  const borders = side === 'heat' ? [cEasy, hMixed, hHard, max]
    : side === 'cold' ? [min, cHard, cEasy, hMixed] : [min, cHard, cEasy, hMixed, hHard, max]
  return {
    min, max,
    stops: pts.filter(([v]) => v >= min && v <= max).map(([v, state]) => ({ at: at(v), state })),
    ticks: borders.map((value) => ({ at: at(value), value })),
  }
}

/** Where a value sits on the bar, 0–100, clamped at the ends. */
export function barPosition(utci, bar) {
  return Math.min(100, Math.max(0, (100 * (utci - bar.min)) / (bar.max - bar.min)))
}

/** The bar's label for screen readers: "Feels like 31 °C on the heat side of the scale". */
export function barLabel(utci, side) {
  const where = { heat: 'the heat side of the scale', cold: 'the cold side of the scale', both: 'the full scale, heat and cold' }[side]
  return `Feels like ${formatDegrees(utci)} on ${where}`
}

/** Set utci and thermal_state on every segment that has a value. */
export function withThermal(fc, values, limits = STANDARD) {
  return {
    type: 'FeatureCollection',
    features: fc.features.map((f) => {
      // Drop the values of an earlier season or time first (and any old score).
      const { utci: _u, thermal_score: _s, thermal_state: _t, ...props } = f.properties
      const utci = values[props.id]
      if (utci == null) return { ...f, properties: props }
      return { ...f, properties: { ...props, utci, thermal_state: thermalState(utci, limits) } }
    }),
  }
}
