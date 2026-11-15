// Your personal ratings, in this browser only (Elena, 2026-11-15): the server relays them and keeps nothing personal.
// An entry is found by photo and profile version, and holds what it was made from: the element list of the photo, the
// model and the export (prompt) version. That stamp, and nothing personal, goes with the next request for the photo;
// the server answers "keep" while the photo's element list, the model and the export are the same, else rates it again.
// "Delete my profile" clears it all; a new or edited profile keeps only its own ratings.

export const RATINGS_KEY = 'sencity-ratings'
export const MAX_ENTRIES = 3000 // about 1 kB each; the oldest go first

// The heading as the API rounds it (0.1°), so a rating kept from its answer is found from the photo itself.
const keyOf = (photo, version) => `${photo.id}|${Math.round(Number(photo.heading) * 10) / 10}|${version}`

function read(storage) {
  try {
    const v = JSON.parse(storage?.getItem(RATINGS_KEY) ?? 'null')
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch {
    return {}
  }
}
function write(storage, all) {
  try {
    if (!Object.keys(all).length) storage?.removeItem(RATINGS_KEY)
    else storage?.setItem(RATINGS_KEY, JSON.stringify(all))
  } catch {
    // Storage full or blocked: the rating is still shown; it is only not kept for next time.
  }
}
const store = () => (typeof localStorage === 'undefined' ? null : localStorage)

/** The browser's rating of a photo with this profile version, or null: { stamp: { listed, model, commit }, result }. */
export function find(photo, version, storage = store()) {
  const e = read(storage)[keyOf(photo, version)]
  return e && e.stamp && e.result ? e : null
}

/** Keep a personal rating the server relayed (its result and stamp). */
export function keep(photo, version, stamp, result, storage = store()) {
  const all = read(storage)
  delete all[keyOf(photo, version)]
  all[keyOf(photo, version)] = { stamp, result, saved: Date.now() }
  const keys = Object.keys(all)
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete all[k]
  write(storage, all)
}

/** Keep only the ratings of this profile version (a new or edited profile); none at all with null. */
export function keepOnly(version, storage = store()) {
  const all = read(storage)
  const end = `|${version}`
  for (const k of Object.keys(all)) if (version == null || !k.endsWith(end)) delete all[k]
  write(storage, all)
}

/** "Delete my profile": every personal rating goes. */
export const clearAll = (storage = store()) => keepOnly(null, storage)

/** How many personal ratings this browser holds (for the tests). */
export const count = (storage = store()) => Object.keys(read(storage)).length
