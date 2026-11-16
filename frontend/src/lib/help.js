// Help (Elena, 2026-11-16): the About page's sections, for "How this works" links to open it at one of them, and the
// first-time hints, one per main view, each shown until dismissed. Which hints were seen is kept in this browser only
// (`sencity-tips-seen`); "Delete my profile" clears it, and "Show tips again" in About does the same.

export const TIPS_KEY = 'sencity-tips-seen'

/** The About page's sections, in order: `id` is what a "How this works" link opens. */
export const ABOUT_SECTIONS = ['what', 'colours', 'ratings', 'data', 'weather', 'photos', 'limits']

/** The first-time hints, one per main view. `verb` is "Click" on a desktop and "Tap" on a phone. */
export const TIPS = {
  map: (verb) => `${verb} the map to choose an area, then Analyse. Streets light up easy, mixed or hard as their photos ` +
    `are rated; ${verb.toLowerCase()} one to see why.`,
  place: () => 'This card says why this place may feel the way it does, from its photo. On Senses and Overall you can ' +
    'rate it yourself at the bottom, to see how close SenCity is to you.',
  routes: () => 'Set where you start and where you want to go, then Analyse. A is the shortest way; B is the easiest, ' +
    'at most 25% longer.',
  walk: (verb) => `Walk along the route photo by photo: press Play, use the arrows or ${verb.toLowerCase()} a point on the bar. Rating ` +
    'a photo pauses the walk.',
  profile: () => 'Your profile stays in this browser. Edit any answer here; download, import or delete it all at the ' +
    'bottom of the page.',
}
export const TIP_IDS = Object.keys(TIPS)

const store = () => (typeof localStorage === 'undefined' ? null : localStorage)

/** The hints already seen; a broken or blocked store reads as none. */
export function readSeen(storage = store()) {
  try {
    const v = JSON.parse(storage?.getItem(TIPS_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((id) => TIP_IDS.includes(id)) : []
  } catch {
    return []
  }
}

/** Keep the hints seen; none removes the key. */
export function writeSeen(ids, storage = store()) {
  try {
    const list = [...new Set(ids)].filter((id) => TIP_IDS.includes(id))
    if (!list.length) storage?.removeItem(TIPS_KEY)
    else storage?.setItem(TIPS_KEY, JSON.stringify(list))
  } catch {
    // Storage full or blocked: the hint hides for now and may show again next time.
  }
}
