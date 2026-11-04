// Thermal comfort in the app (brief §4): the feels-like temperature of a street (°C, from the
// API) to its two-sided 1–5 score and state. Done here, not on the server, because personal
// limits will come from the profile, which stays in the browser.
import config from '../config.js'

/** 1–5: 5 no thermal stress, lower for more heat or cold stress. */
export function thermalScore(utci, limits = config.thermalLimits) {
  const [h3, h2, h1] = limits.heat
  const [c5, c4, c3, c2] = limits.cold
  if (utci > h1) return 1
  if (utci > h2) return 2
  if (utci > h3) return 3
  if (utci >= c5) return 5
  if (utci >= c4) return 4
  if (utci >= c3) return 3
  if (utci >= c2) return 2
  return 1
}

/** 4–5 easy, 3 mixed, 1–2 hard (the same rule as the photo score). */
export function scoreState(score) {
  if (score >= 4) return 'easy'
  return score === 3 ? 'mixed' : 'hard'
}

/** "−3 °C" with a real minus sign. */
export function formatDegrees(t) {
  return `${Math.round(t).toString().replace('-', '−')} °C`
}

const deg = (t) => t.toString().replace('-', '−')

/** Why a value has its state, for the card: "above 32 °C", "26 to 32 °C", "below −13 °C". */
export function thermalReason(utci, limits = config.thermalLimits) {
  const [h3, h2] = limits.heat
  const [, c4, c3] = limits.cold
  if (utci > h2) return `above ${deg(h2)} °C`
  if (utci > h3) return `${deg(h3)} to ${deg(h2)} °C`
  if (utci >= c4) return `${deg(c4)} to ${deg(h3)} °C`
  if (utci >= c3) return `${deg(c3)} to ${deg(c4)} °C`
  return `below ${deg(c3)} °C`
}

/** True on the cold side of no stress (the nearby street to suggest is then a warmer one). */
export function isCold(utci, limits = config.thermalLimits) {
  return utci < limits.cold[1]
}

/** Walking minutes for a distance in metres (at least 1). */
export function walkMinutes(m) {
  return Math.max(1, Math.round(m / config.walkMetresPerMinute))
}

/** Legend lines for the standard limits, e.g. "Easy, 0 to 26 °C". */
export function thermalLegend(limits = config.thermalLimits) {
  const d = deg
  const [h3, h2] = limits.heat
  const [, c4, c3] = limits.cold
  return [
    { state: 'easy', label: `Easy, ${d(c4)} to ${d(h3)} °C` },
    { state: 'mixed', label: `Mixed, ${d(h3)} to ${d(h2)} °C or ${d(c3)} to ${d(c4)} °C` },
    { state: 'hard', label: `Hard, above ${d(h2)} °C or below ${d(c3)} °C` },
  ]
}

/** Set utci, thermal_score and thermal_state on every segment that has a value. */
export function withThermal(fc, values) {
  return {
    type: 'FeatureCollection',
    features: fc.features.map((f) => {
      // Drop the values of an earlier season or time first.
      const { utci: _u, thermal_score: _s, thermal_state: _t, ...props } = f.properties
      const utci = values[props.id]
      if (utci == null) return { ...f, properties: props }
      const score = thermalScore(utci)
      return { ...f, properties: { ...props, utci, thermal_score: score, thermal_state: scoreState(score) } }
    }),
  }
}
