// Senses mode: from one rating per photo to one rating per place, and what to recommend. The labels themselves
// come from the API, which reads them from model/app_v0/; nothing about the model is hard-coded here.
import config from '../config.js'
import { pickSuggestions } from './suggest.js'

export const GENERAL_LABEL = 'General prediction: not yet personal'
const NOTHING = 'nothing'

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
    return { status: counts.nPending ? 'pending' : 'failed', error: states.find((s) => s?.error)?.error ?? '', ...counts }
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
    mainBothers: bothers.filter((e) => e.code !== NOTHING).slice(0, config.sensesRecommend.mainBothers),
    rep: rep.i, reason: rep.reason, ...counts,
  }
}

/** The segments with their Senses state on them, for the map. The same object if nothing changed. */
export function withSenses(fc, states) {
  let changed = false
  const features = fc.features.map((f) => {
    const state = states.get(f.properties.id) ?? null
    if ((f.properties.senses_state ?? null) === state) return f
    changed = true
    const { senses_state: _old, ...rest } = f.properties
    return { ...f, properties: state ? { ...rest, senses_state: state } : rest }
  })
  return changed ? { ...fc, features } : fc
}

/**
 * What to recommend in an area, from the places rated so far.
 * Most comfortable: rated 3 or better, best first. To avoid: rated 1 or 2, worst first. Ties go to the place nearer
 * the centre, and picks keep a distance from each other, so one long street does not fill the list.
 * @returns {{best:object[], avoid:object[]}} each { f, mid, place }
 */
export function recommendations(features, placeOf, centre) {
  const { count, avoid: nAvoid, minApartM } = config.sensesRecommend
  const rated = features.filter((f) => placeOf(f).status === 'rated')
  const comfort = (f) => placeOf(f).comfort
  const pick = (keep, value, n) => pickSuggestions(rated, { keep, value, centre, n, minApartM, margin: 0 })
    .map((s) => ({ f: s.f, mid: s.mid, place: placeOf(s.f) }))
  return { best: pick((f) => comfort(f) >= 3, comfort, count), avoid: pick((f) => comfort(f) <= 2, (f) => -comfort(f), nAvoid) }
}

/**
 * One route from its rated stretches: the median comfort weighted by length (the lower one on a tie, as for a
 * place), its hardest stretch (lowest comfort, then the longest), and the share of its length rated so far.
 * @returns {{comfort:number, level:string, anchors:string[], share:number, hardest:{stretch:object, place:object}} | null}
 */
export function routeSummary(stretches, placeOf) {
  const rated = stretches.map((stretch) => ({ stretch, place: placeOf(stretch) })).filter((x) => x.place.status === 'rated')
  if (!rated.length) return null
  const length = (x) => x.stretch.length_m
  const total = rated.reduce((n, x) => n + length(x), 0)
  let walked = 0
  const median = [...rated].sort((a, b) => a.place.comfort - b.place.comfort).find((x) => {
    walked += length(x)
    return walked >= total / 2
  })
  const hardest = [...rated].sort((a, b) => a.place.comfort - b.place.comfort || length(b) - length(a))[0]
  const comfort = median.place.comfort
  return { comfort, level: comfortLevel(comfort), anchors: median.place.anchors, hardest,
    share: total / stretches.reduce((n, s) => n + s.length_m, 0) }
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
