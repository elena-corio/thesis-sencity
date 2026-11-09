// Senses mode: from one rating per photo to one rating per place, and what to recommend. The labels themselves
// come from the API, which reads them from model/app_v0/; nothing about the model is hard-coded here.
import config from '../config.js'
import { pickSuggestions } from './suggest.js'

export const GENERAL_LABEL = 'General prediction: not yet personal'

/** The key of one photo in the ratings of this session. */
export const photoKey = (photo) => `${photo.pano_id}|${photo.heading}`

/** The state of a 1–5 rating (brief §4): 4–5 easy, 3 mixed, 1–2 hard. It names the colour (--easy, …). */
export function comfortLevel(n) {
  return n >= 4 ? 'easy' : n === 3 ? 'mixed' : 'hard'
}

export const levelWord = (level) => level[0].toUpperCase() + level.slice(1)

/** "4 · fairly comfortable". 1 and 5 use the survey's own words, from the export. */
export function comfortLabel({ comfort, anchors }) {
  const words = comfort === 1 ? anchors[0] : comfort === 5 ? anchors[1] : config.comfortWords[comfort]
  return `${comfort} · ${words}`
}

/** An element's label in the app's language, split from its sense: "Signs, ads (sight)" → text and sense word.
 *  The card shows the sense as an icon (boards 2, 2c); the word stays as the icon's name. */
export function elementLabel(element) {
  const label = element[config.language]
  const m = label.match(/^(.*\S)\s*\(([^()]+)\)$/)
  return m ? { text: m[1], sense: m[2] } : { text: label, sense: '' }
}

/** The elements named in enough of the photos (brief §4): the one photo, both of two, at least 2 of 3. */
function shared(lists) {
  const need = lists.length === 1 ? 1 : 2
  const counts = new Map()
  for (const list of lists) {
    for (const element of list) counts.set(element.code, { element, n: (counts.get(element.code)?.n ?? 0) + 1 })
  }
  return [...counts.values()].filter((c) => c.n >= need).sort((a, b) => b.n - a.n).map((c) => c.element)
}

/**
 * One place from its photos (brief §4): the median rating (with two photos the lower one, so a rating stays a
 * whole number and doubt counts against comfort) and the elements shared by the photos. Shown as soon as one
 * photo is rated, and updated as the others arrive. This combination is the app's, not the study's V0.
 * @param {object[]} photos the place's photos
 * @param {(photo: object) => ({status:'ok', result:object}|{status:'failed', error:string}|undefined)} ratingOf
 */
export function combinePlace(photos, ratingOf) {
  const states = photos.map(ratingOf)
  const rated = states.flatMap((s, i) => (s?.status === 'ok' ? [{ i, ...s.result }] : []))
  const nFailed = states.filter((s) => s?.status === 'failed').length
  const counts = { nPhotos: photos.length, nRated: rated.length, nFailed, nPending: photos.length - rated.length - nFailed }
  if (!rated.length) {
    return { status: counts.nPending || !photos.length ? 'pending' : 'failed', error: states.find((s) => s?.error)?.error ?? '', ...counts }
  }
  const sorted = rated.map((r) => r.comfort).sort((a, b) => a - b)
  const comfort = sorted[Math.floor((sorted.length - 1) / 2)]
  // The photo the card opens on: the closest to the median, then the most recent.
  const rep = [...rated].sort((a, b) => Math.abs(a.comfort - comfort) - Math.abs(b.comfort - comfort)
    || String(photos[b.i].date ?? '').localeCompare(String(photos[a.i].date ?? '')))[0]
  const bothers = shared(rated.map((r) => r.bothers))
  return {
    status: 'rated', comfort, level: comfortLevel(comfort), anchors: rated[0].anchors, bothers,
    feelsGood: shared(rated.map((r) => r.feels_good)),
    rep: rep.i, reason: rep.reason, ...counts,
  }
}

/** The segments with their Senses state and comfort on them, for the map and the markers: states is a Map of
 *  id → { state, comfort } or null. The same object if nothing changed. */
export function withSenses(fc, states) {
  let changed = false
  const features = fc.features.map((f) => {
    const next = states.get(f.properties.id) ?? null
    const { senses_state: oldState, senses_comfort: oldComfort, ...rest } = f.properties
    if ((oldState ?? null) === (next?.state ?? null) && (oldComfort ?? null) === (next?.comfort ?? null)) return f
    changed = true
    return { ...f, properties: next ? { ...rest, senses_state: next.state, ...(next.comfort ? { senses_comfort: next.comfort } : {}) } : rest }
  })
  return changed ? { ...fc, features } : fc
}

/**
 * What to recommend in Senses, as numbered pins like the Thermal suggestions (boards Flow 4, 4b): up to 3 places rated
 * 3 or better, best first. Ties go to the place nearer the centre, and picks keep a distance from each other, so one
 * long street does not fill the list. Only positive: a place rated 1 or 2 is never listed.
 * @returns {{n:number, f:object, mid:object, type:string, level:string}[]}
 */
export function sensesMarkers(features, centre) {
  const { count, minApartM } = config.sensesRecommend
  const comfort = (f) => f.properties.senses_comfort
  return pickSuggestions(features.filter((f) => comfort(f)), { keep: (f) => comfort(f) >= 3, value: comfort, centre, n: count, minApartM, margin: 0 })
    .map((s) => ({ ...s, level: comfortLevel(comfort(s.f)) }))
}

/** The share of a route's length rated hard, 0 to 1 (board Routes 3). */
export function hardShare(stretches) {
  const total = stretches.reduce((n, s) => n + s.length_m, 0)
  return total ? stretches.filter((s) => s.state === 'hard').reduce((n, s) => n + s.length_m, 0) / total : 0
}

/**
 * A and B from the rated candidates, by the rule Thermal uses: B is the way with the least hard walking, then the least
 * mixed or unrated, then the shortest, if that is easier than A; otherwise the next shortest, as an "alternative".
 * @param {object[]} ways shortest first; each with { parts: [{ segment_id, length_m }], length_m }
 * @param {(segmentId: string) => string|null} stateOf 'easy' | 'mixed' | 'hard', or null when not rated
 */
export function pickWays(ways, stateOf) {
  const round3 = (x) => Math.round(x * 1000)
  const rank = (w) => {
    const total = w.length_m || 1
    const share = (test) => w.parts.filter((p) => test(p.segment_id ? stateOf(p.segment_id) : null)).reduce((n, p) => n + p.length_m, 0) / total
    return [round3(share((s) => s === 'hard')), round3(share((s) => s !== 'hard' && s !== 'easy'))]
  }
  const compare = (x, y) => x[0] - y[0] || x[1] - y[1]
  const [a, ...others] = ways
  const ranked = others.map((w) => ({ w, r: rank(w) })).sort((x, y) => compare(x.r, y.r) || x.w.length_m - y.w.length_m)
  const easier = ranked[0] && compare(ranked[0].r, rank(a)) < 0 ? ranked[0].w : null
  const b = easier ?? others[0]
  return b ? [a, { ...b, id: 'B', kind: easier ? 'easiest' : 'second' }] : [a]
}

/** One sentence comparing the two ways on Senses (board Routes 3). Plain rules, no AI. */
export function sensesVerdict([a, b]) {
  if (!b) return 'There is only one sensible way here within a quarter more walking.'
  const extra = b.minutes - a.minutes
  const took = extra > 0 ? `B is ${extra} minute${extra === 1 ? '' : 's'} longer` : 'B takes about the same time'
  if (b.kind === 'second') return `A is already the easiest way within a quarter more walking. ${took}, with no less hard walking.`
  return hardShare(b.stretches) < hardShare(a.stretches) ? `${took} but has less hard walking.` : `${took} but has less mixed walking.`
}

/** "$0.0512 model, about $0.67 Street View" */
export function moneyLine(run) {
  const street = run.streetviewUsd ? `, about $${run.streetviewUsd.toFixed(2)} Street View` : ''
  return `$${run.costUsd.toFixed(4)} model${street}`
}

/** "google/gemini-3.1-flash-lite · 40 places rated · 12 cached, 96 new · $0.05 model … · 38 s" */
export function runStatusLine(run, rated) {
  const parts = [run.model, `${rated} ${rated === 1 ? 'place' : 'places'} rated`, `${run.cachedCount} cached, ${run.newCount} new`,
    moneyLine(run), `${run.seconds.toFixed(0)} s`]
  return parts.join(' · ')
}
