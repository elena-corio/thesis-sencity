// Your own photo ratings ("Rate this place"), in this browser only (Elena, 2026-11-16). Each rating is kept with the
// prediction that was on screen before you rated it, so the profile can show how close SenCity is to you. Never sent to
// the server, never in a model call (feeding them back comes later, if at all). "Delete my profile" clears them;
// "Download my data" and "Import a file" carry them.
// Stored under its own key: `sencity-ratings` is the cache of the model's personal predictions (lib/personalRatings.js).

export const MY_RATINGS_KEY = 'sencity-my-ratings'
export const MIN_RATINGS = 4 // ratings with a prediction before "how close" shows (how far predictions can be trusted for you)
/** "Something else?": at most this many characters, like the survey's "Other". */
export const OTHER_MAX = 150
const MARKS = { pleasant: ['pleasant'], unpleasant: ['unpleasant'] }
const SOURCES = ['map', 'photo', 'walk']

const store = () => (typeof localStorage === 'undefined' ? null : localStorage)
const isScore = (v) => Number.isInteger(v) && v >= 1 && v <= 5

/** Every rating, oldest first. A broken or blocked store reads as none. */
export function allRatings(storage = store()) {
  try {
    const v = JSON.parse(storage?.getItem(MY_RATINGS_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter(valid) : []
  } catch {
    return []
  }
}
function write(list, storage) {
  try {
    if (!list.length) storage?.removeItem(MY_RATINGS_KEY)
    else storage?.setItem(MY_RATINGS_KEY, JSON.stringify(list))
  } catch {
    // Storage full or blocked: the rating shows on the card; it is only not kept.
  }
}

/** B2 as the study stores it: { element: ["pleasant"] | ["unpleasant"] | ["pleasant", "unpleasant"] }, or null when
 *  nothing was ticked (the ticks are optional here, so none is "not said", not the study's "none"). */
const validB2 = (b2) => b2 === null || b2 === undefined || (typeof b2 === 'object' && !Array.isArray(b2) &&
  Object.values(b2).every((v) => Array.isArray(v) && v.length && v.every((a) => a === 'pleasant' || a === 'unpleasant')))

/** A rating as kept: photo, rating (B1, B2 ticks, B2_other), prediction (or null), when and where. */
function valid(e) {
  return e && typeof e === 'object' && e.photo?.id && isScore(e.rating?.B1) && validB2(e.rating.B2) &&
    (e.rating.B2_other == null || (typeof e.rating.B2_other === 'string' && e.rating.B2_other.length <= OTHER_MAX)) &&
    SOURCES.includes(e.from) && typeof e.at === 'string' && (e.prediction === null || isScore(e.prediction?.B1))
}

/**
 * The prediction on screen, as kept with a rating: { level, B1, version 'V2' | 'V0', profileHash, elements, prompt,
 * model, commit }; null when none was shown (not rated yet, or "Couldn't rate this photo"). From the photo's own rating
 * already in the app: nothing is asked again.
 */
export function predictionOf(result, profileVersion = null) {
  if (!result || !isScore(result.comfort)) return null
  const personal = !!result.personal
  return {
    level: result.comfort >= 4 ? 'easy' : result.comfort === 3 ? 'mixed' : 'hard',
    B1: result.comfort,
    version: personal ? 'V2' : 'V0',
    profileHash: personal ? profileVersion : null,
    elements: [...(result.listed ?? [])],
    prompt: result.prompt ?? null,
    model: result.model ?? null,
    commit: result.commit ?? null,
  }
}

/** Keep a rating: always a new entry (rating the same photo again keeps the history). Returns the entry. */
export function addRating({ photo, B1, prediction, from, at = new Date().toISOString() }, storage = store()) {
  if (!isScore(B1) || !SOURCES.includes(from) || !photo?.id) throw new Error('not a rating')
  const entry = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    photo: { id: String(photo.id), heading: photo.heading ?? null, source: photo.source ?? null }, // the ID only, never the image
    // B2: the chips ticked after rating, as the study stores B2; B2_other: "Something else?", in this browser only, never
    // sent to a model (as the study's "Other"). Your ratings are never put in a prompt: they only show the gap to the prediction.
    rating: { B1, B2: null, B2_other: null },
    prediction: prediction ?? null,
    at,
    from,
  }
  write([...allRatings(storage), entry], storage)
  return entry
}

/** The chip states as B2: { code: "+" | "−" } → { code: ["pleasant"] | ["unpleasant"] }, or null with none. */
export function b2From(ticks) {
  const out = {}
  for (const [code, t] of Object.entries(ticks ?? {})) if (t === '+') out[code] = MARKS.pleasant; else if (t === '−') out[code] = MARKS.unpleasant
  return Object.keys(out).length ? out : null
}
/** The chip state of one element from B2: '+', '−' or ''. */
export const tickOf = (b2, code) => (b2?.[code]?.includes('pleasant') ? '+' : b2?.[code]?.includes('unpleasant') ? '−' : '')
/** The next chip state: one tap +, two taps −, a third clears. */
export const nextTick = (t) => (t === '' ? '+' : t === '+' ? '−' : '')

/** After rating: the B2 ticks and "Something else?" of that rating (the same entry, not a new one). Returns it. */
export function updateRating(id, { B2, B2_other } = {}, storage = store()) {
  const list = allRatings(storage)
  const e = list.find((x) => x.id === id)
  if (!e) return null
  if (B2 !== undefined) e.rating.B2 = B2
  if (B2_other !== undefined) e.rating.B2_other = (B2_other ?? '').trim().slice(0, OTHER_MAX) || null
  write(list, storage)
  return e
}

/** Replace all (an imported file); only valid entries are kept. */
export function setRatings(list, storage = store()) {
  write((Array.isArray(list) ? list : []).filter(valid), storage)
}
/** "Delete my profile". */
export const clearRatings = (storage = store()) => write([], storage)

/** The latest rating of one photo, for "You: 2 · SenCity: 3" on its card. */
export function latestFor(photoId, storage = store()) {
  const id = String(photoId)
  return allRatings(storage).filter((e) => e.photo.id === id).at(-1) ?? null
}

/**
 * How close SenCity is to you: from the ratings with a prediction only. { n, gap (mean |prediction − you|), within1
 * (share within 1 point) }. n < MIN_RATINGS: not enough yet.
 */
export function closeness(entries) {
  const withP = entries.filter((e) => e.prediction)
  const gaps = withP.map((e) => Math.abs(e.prediction.B1 - e.rating.B1))
  const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)
  return { n: withP.length, gap: mean(gaps), within1: gaps.length ? gaps.filter((x) => x <= 1).length / gaps.length : null, enough: withP.length >= MIN_RATINGS }
}
