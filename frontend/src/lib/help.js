// Help (Elena, 2026-11-16): the About page's sections, for "How this works" links to open it at one of them, and the
// first-time tips: one per part of the settings, in order, and one per view, each shown until dismissed. Which hints were seen is kept in this browser only
// (`sencity-tips-seen`); "Delete my profile" clears it, and "Show tips again" in About does the same.

export const TIPS_KEY = 'sencity-tips-seen'

/** The About page's sections, in order: `id` is what a "How this works" link opens. */
export const ABOUT_SECTIONS = ['what', 'colours', 'ratings', 'data', 'weather', 'photos', 'limits']

/** The first-time tips. `verb` is "Click" on a desktop and "Tap" on a phone. */
export const TIPS = {
  // The Area settings, one part at a time (Elena, 2026-11-16).
  area: (verb) => `${verb} the map to place the centre of your area, then set its radius, or type an address. Then Analyse.`,
  layer: () => 'Senses: from the street photos. Thermal: the simulated feels-like temperature. Overall: the worse of the two.',
  season: () => 'Thermal and Overall change with the season and time of day. Senses does not: a photo is one moment.',
  places: () => 'Show only streets, parks or squares, once the area is analysed.',
  // After Analyse, and the views.
  results: (verb) => `${verb} a street on the map to see why it may feel easy, mixed or hard.`,
  place: () => 'Why this place may feel this way, from its photo. On Senses and Overall, rate it yourself at the bottom.',
  // The Routes settings.
  'route-points': (verb) => `${verb} where you start, then where you want to go, or type the addresses. Then Analyse.`,
  'route-layer': () => 'The two routes are compared on this layer: A is the shortest, B the easiest on it, at most 25% longer.',
  'route-season': () => 'Thermal and Overall change with the season and the time you walk.',
  walk: (verb) => `Press Play, use the arrows or ${verb.toLowerCase()} the bar. Rating a photo pauses the walk.`,
  profile: () => 'Your profile stays in this browser. Edit any answer; download, import or delete it at the bottom.',
}
export const TIP_IDS = Object.keys(TIPS)

/** Tips that play in order, one at a time ("Tip 2 of 4"); a tip in no group stands alone. A tip whose part is not on
 *  screen (Season and time on Senses) is passed over and shows when its part appears. */
export const TIP_GROUPS = {
  area: ['area', 'layer', 'season', 'places'],
  routes: ['route-points', 'route-layer', 'route-season'],
}
export const groupOf = (id) => Object.keys(TIP_GROUPS).find((g) => TIP_GROUPS[g].includes(id)) ?? null

/**
 * The tip to show now in a group: the first one not seen yet among those on screen (`shown`), or null.
 * @param {string} group @param {string[]} seen @param {string[]} shown
 */
export function currentTip(group, seen, shown) {
  return TIP_GROUPS[group].find((id) => shown.includes(id) && !seen.includes(id)) ?? null
}

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
