// Senses mode: words and colours for one general prediction. The labels themselves come from the API,
// which reads them from model/app_v0/elements.json; nothing about the model is hard-coded here.
import config from '../config.js'

/** The colour of a 1–5 rating, from --senses-low (1) to --senses-high (5). */
export function comfortColor(n) {
  return `color-mix(in srgb, var(--senses-high) ${((n - 1) / 4) * 100}%, var(--senses-low))`
}

/** "4 · fairly comfortable" */
export function comfortLabel(n) {
  return `${n} · ${config.comfortWords[n - 1]}`
}

/** An element's label in the app's language, split from its sense: "Signs, ads (sight)" → text and sense word.
 *  The card shows the sense as an icon (boards 2, 2c); the word stays as the icon's name. */
export function elementLabel(element) {
  const label = element[config.language]
  const m = label.match(/^(.*\S)\s*\(([^()]+)\)$/)
  return m ? { text: m[1], sense: m[2] } : { text: label, sense: '' }
}

/** "google/gemini-3.1-flash-lite · 1.4 s · $0.0005 · cached" */
export function statusLine(result) {
  const cost = result.cost_usd == null ? 'cost not reported' : `$${result.cost_usd.toFixed(4)}`
  const parts = [result.model, `${(result.latency_ms / 1000).toFixed(1)} s`, cost]
  if (result.cached) parts.push('cached')
  return parts.join(' · ')
}
