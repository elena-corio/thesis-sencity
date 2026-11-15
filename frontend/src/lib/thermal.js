// Thermal comfort in the app (brief §4): the feels-like temperature of a street (°C, from the
// API) to its state: easy, mixed or hard (no 1–5 score). The standard limits and the personal shifts are in config.js.
import { shallowRef } from 'vue'
import config from '../config.js'

const STANDARD = config.thermalLimits
const PERSONAL = config.thermalPersonal
const personal = shallowRef(null)

/**
 * The limits in use: personal when the profile has weather answers or a limit moved on its bar (stores/profile.js
 * sets them), else the standard ones. The card, the legend, the nearby street, the suggestions, the map and the routes
 * all read them here, and follow when they change. They stay on this device, except as the four numbers a Thermal
 * route request uses for its answer (not kept by the API).
 */
export function thermalLimits() {
  return personal.value ?? STANDARD
}
export const standardLimits = () => STANDARD
export const hasPersonalLimits = () => personal.value != null
/** Set by the profile store: the personal limits, or null for the standard ones. */
export function setPersonalLimits(limits) {
  personal.value = limits
}

const answerShift = (answer) => PERSONAL.shift[answer] ?? 0

/**
 * Personal limits from the weather answers ({ hot, cold, wind }: 1–5) and the starts moved by hand on the profile's bar
 * ({ heat, cold }: °C, or null to follow the answers). Hot 1 → heat limits −3 °C, 2 → −1.5 °C; cold 1 → cold limits
 * +3 °C, 2 → +1.5 °C (config.thermalPersonal). A start moved by hand moves its side's two limits together. Null when
 * nothing is personal.
 */
export function personalLimits(weather, manual = null) {
  const heatShift = manual?.heat != null ? manual.heat - STANDARD.heat[0] : -answerShift(weather?.hot)
  const coldShift = manual?.cold != null ? manual.cold - STANDARD.cold[0] : answerShift(weather?.cold)
  if (!heatShift && !coldShift) return null
  return { heat: STANDARD.heat.map((t) => t + heatShift), cold: STANDARD.cold.map((t) => t + coldShift) }
}

/** The start of hot and of cold that the answers alone give (what Reset goes back to). */
export function startsFromAnswers(weather) {
  const l = personalLimits(weather) ?? STANDARD
  return { heat: l.heat[0], cold: l.cold[0] }
}

/**
 * How far a start can move (Elena, 2026-11-15): its side's outer limit stays on the bar, so the start of hot goes up to
 * 40 − 6 = 34 °C and the start of cold down to −20 + 22 = 2 °C; and the easy range stays at least minEasy wide.
 * `other` is the other side's start. { min, max } in °C.
 */
export function startRange(side, other) {
  const { min, max } = config.thermalBar
  const heatBand = STANDARD.heat[1] - STANDARD.heat[0]
  const coldBand = STANDARD.cold[0] - STANDARD.cold[1]
  return side === 'heat'
    ? { min: other + PERSONAL.minEasy, max: max - heatBand }
    : { min: min + coldBand, max: other - PERSONAL.minEasy }
}

/** A start moved by hand, in its steps and within its range (startRange). */
export function clampStart(side, value, other) {
  const step = PERSONAL.step
  const { min, max } = startRange(side, other)
  const v = Math.round(value / step) * step
  return Math.min(max, Math.max(min, v))
}

/** "9", "24.5", "−1.5": a limit in the profile's words, with a real minus sign. */
export const limitText = (t) => (Number.isInteger(t) ? String(t) : t.toFixed(1)).replace('-', '−')

/** "Comfortable for you: about 9 to 23 °C (feels like). Standard: 9 to 26 °C." */
export function comfortSummary(limits) {
  const [lo, hi] = easyRange(limits)
  const [slo, shi] = easyRange(STANDARD)
  return `Comfortable for you: about ${limitText(lo)} to ${limitText(hi)} °C (feels like). Standard: ${limitText(slo)} to ${limitText(shi)} °C.`
}

/** The easy range [lower, upper] and its middle, the comfort target. */
export function easyRange(limits = thermalLimits()) {
  return [limits.cold[0], limits.heat[0]]
}
export function comfortTarget(limits = thermalLimits()) {
  const [lo, hi] = easyRange(limits)
  return (lo + hi) / 2
}

/**
 * How far a value is from comfort, for ranking (lower is better), shared by "Cooler / Warmer street
 * nearby" and the suggestions: [degrees outside the easy range (0 inside), and, inside it only, the
 * degrees from the middle of the range]. Compare with compareComfort.
 */
export function comfortKey(utci, limits = thermalLimits()) {
  const [lo, hi] = easyRange(limits)
  const outside = utci < lo ? lo - utci : utci > hi ? utci - hi : 0
  return [outside, outside ? 0 : Math.abs(utci - comfortTarget(limits))]
}
export function compareComfort(a, b) {
  return a[0] - b[0] || a[1] - b[1]
}

/** easy, mixed or hard for these limits (thermal has no 1–5 score). */
export function thermalState(utci, limits = thermalLimits()) {
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
export function isHot(utci, limits = thermalLimits()) {
  return utci > limits.heat[0]
}
/** Too cold: below the easy range (the nearby street to suggest is then a warmer one). */
export function isCold(utci, limits = thermalLimits()) {
  return utci < limits.cold[0]
}

/**
 * The card line, only for the side that applies: "Hard: above 32 °C", "Mixed: below 9 °C",
 * "Easy: 9 to 26 °C".
 */
export function thermalVerdict(utci, limits = thermalLimits()) {
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
export function thermalSide(values, limits = thermalLimits()) {
  const [lo, hi] = easyRange(limits)
  const cold = values.some((v) => v < lo)
  const hot = values.some((v) => v > hi)
  if (!cold) return 'heat'
  return hot ? 'both' : 'cold'
}

/**
 * Legend rows: Easy always with its range; Mixed and Hard only for the side shown ('heat', 'cold' or
 * 'both'; with both, each has two short lines). Plain numbers: the legend's title carries the °C.
 * { state, label, lines }
 */
export function thermalLegend(limits = thermalLimits(), side = 'both') {
  const [hMixed, hHard] = limits.heat.map(deg)
  const [cEasy, cHard] = limits.cold.map(deg)
  const heat = side !== 'cold'
  const cold = side !== 'heat'
  return [
    { state: 'easy', label: 'Easy', lines: [`${cEasy} to ${hMixed}`] },
    { state: 'mixed', label: 'Mixed', lines: [heat && `${hMixed} to ${hHard}`, cold && `${cHard} to ${cEasy}`].filter(Boolean) },
    { state: 'hard', label: 'Hard', lines: [heat && `above ${hHard}`, cold && `below ${cHard}`].filter(Boolean) },
  ]
}

/**
 * The temperature bar on the place card, for the side shown (as the legend): its ends, the gradient
 * stops (cyan through the easy band, blending to amber in the middle of the mixed band and red from
 * the hard border on) and the ticks (the ends and the band borders). Heat side from cold[0] to the
 * bar's max; cold side from the bar's min to heat[0], so hard is on the left; both from min to max.
 * Positions are 0–100 (%). { min, max, stops: [{ at, state }], ticks: [{ at, value }] }
 */
export function thermalBar(limits = thermalLimits(), side = 'heat', ends = config.thermalBar) {
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
export function withThermal(fc, values, limits = thermalLimits()) {
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
