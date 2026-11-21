// "Adjust to my own ratings (experimental)" (Elena, 2026-11-21): a simple correction on this device, never a model call.
// From your own ratings of photos that had a personal prediction on screen (lib/myRatings.js, version 'V2'), the mean
// gap = your rating − the prediction. With the setting on and at least MIN_RATINGS such ratings, every personal
// prediction is shifted by it: rounded to whole points and kept between 1 and 5. General predictions ("not
// personalised yet", V0) are never adjusted and never count. The model's own value is kept beside the shown one, so a
// new rating is always compared with the model, and the correction never feeds on itself.

import { MIN_RATINGS } from './myRatings.js'

const isScore = (v) => Number.isInteger(v) && v >= 1 && v <= 5
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length

/** The ratings that count: a personal prediction was on screen. */
export const personalEntries = (entries) => (entries ?? []).filter((e) => e?.prediction?.version === 'V2' &&
  isScore(e.prediction.B1) && isScore(e.rating?.B1))

/** Your rating minus the prediction, on average, over the personal ones; null under MIN_RATINGS. */
export function meanGap(entries) {
  const list = personalEntries(entries)
  return list.length >= MIN_RATINGS ? mean(list.map((e) => e.rating.B1 - e.prediction.B1)) : null
}

/** A prediction shifted by the gap, rounded to whole points the same way up and down (half a point moves it, less
 *  does not: +0.5 → +1, −0.5 → −1, ±0.4 → 0), then kept between 1 and 5. Without a gap, the prediction itself. */
export function adjust(comfort, gap) {
  if (gap == null || !Number.isFinite(gap)) return comfort
  const shift = Math.sign(gap) * Math.round(Math.abs(gap))
  return Math.min(5, Math.max(1, comfort + shift))
}

/** A photo's rating as shown: a personal result with a gap gets the shifted comfort, and keeps the model's value in
 *  `adjusted: { from, gap }`. Anything else (general, failed, no gap) is returned as it is. */
export function adjustRating(rating, gap) {
  if (gap == null || rating?.status !== 'ok' || !rating.result?.personal || !isScore(rating.result.comfort)) return rating
  const from = rating.result.comfort
  return { ...rating, result: { ...rating.result, comfort: adjust(from, gap), adjusted: { from, gap } } }
}

/** The model's own value of a shown result (before any adjustment). */
export const modelComfort = (result) => result?.adjusted?.from ?? result?.comfort

/** The note under an adjusted prediction: "Adjusted to your own ratings (+0.6)"; under half a point it cannot move a
 *  whole-number prediction, so it says so. */
export function adjustNote(gap) {
  if (gap == null) return ''
  const small = Math.abs(gap) < 0.5
  // Under half a point, cut (not rounded) to one decimal, so the note never shows 0.5 beside "too small".
  const size = small ? (Math.trunc(Math.abs(gap) * 10) / 10).toFixed(1) : Math.abs(gap).toFixed(1)
  const n = `${gap < 0 ? '−' : '+'}${size}`
  return small ? `Adjusted to your own ratings (${n}, too small to change the level)` : `Adjusted to your own ratings (${n})`
}

/**
 * How close, for personal predictions: points off on average as predicted, and as adjusted. The adjusted one is fair:
 * each rating is shifted by the gap of the *other* ratings, as a new rating would be, so it is not flattered by its own
 * answer. { n, raw, adjusted, within1Raw, within1Adjusted }; null under MIN_RATINGS.
 */
export function adjustedCloseness(entries) {
  const list = personalEntries(entries)
  if (list.length < MIN_RATINGS) return null
  const diffs = list.map((e) => e.rating.B1 - e.prediction.B1)
  const total = diffs.reduce((s, d) => s + d, 0)
  const raw = diffs.map(Math.abs)
  const adj = list.map((e, i) => Math.abs(e.rating.B1 - adjust(e.prediction.B1, (total - diffs[i]) / (list.length - 1))))
  const within = (xs) => xs.filter((x) => x <= 1).length / xs.length
  return { n: list.length, raw: mean(raw), adjusted: mean(adj), within1Raw: within(raw), within1Adjusted: within(adj) }
}
