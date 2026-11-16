// Walk along a route (board Routes 5): where you are on the way, which way the camera looks, and the lines of
// the chip and the stretch card. Everything comes from what is already loaded: no new call.
import config from '../config.js'
import { comfortLabel, elementLabel, levelWord } from './senses.js'
import { formatDegrees } from './thermal.js'

/**
 * What a stretch of the walk shows and is rated from: its street's photos and their rating, exactly as the Routes view
 * and the stretch card (Elena, 2026-11-14: the walk is stable and the same as the preview; a rating never without its
 * photo). The photo shown is the one the card opens on, the closest to the rating (`rep`).
 * @param {object} stretch a stretch (lib/routes.js stretchesOf)
 * @param {Map} segments the routes' segments by id
 * @param {(photos: object[]) => object} placeFor stores/senses.js placeFor
 * @returns {{photo:object, photos:object[], place:object}|null} null when the street has no photo
 */
export function ratedPhotoOf(stretch, segments, placeFor) {
  const photos = segments.get(stretch.segmentId)?.properties.photos ?? []
  if (!photos.length) return null
  const place = placeFor(photos)
  return { photo: photos[place.rep ?? 0], photos, place }
}

/** Distance (m) from point p to a line, and how far along the line its nearest point is (m); [lon, lat], small areas. */
function nearestOn(coords, [lon, lat]) {
  const k = Math.cos((lat * Math.PI) / 180) * 111320
  const xy = ([x, y]) => [x * k, y * 110540]
  const [px, py] = xy([lon, lat])
  let best = { dist: Infinity, along: 0 }
  let walked = 0
  for (let i = 0; i + 1 < coords.length; i++) {
    const [ax, ay] = xy(coords[i])
    const [bx, by] = xy(coords[i + 1])
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len2)) : 0
    const dist = Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)))
    if (dist < best.dist) best = { dist, along: walked + t * Math.sqrt(len2) }
    walked += Math.sqrt(len2)
  }
  return best
}

/**
 * A stretch's photos along the part of the street it walks, in the order they are walked past (Elena, 2026-11-16: the
 * walk went back and forth). A route starts and ends part way along a street, so a photo behind the start or past the end
 * (further from the stretch than from the whole street, by more than `slack` m) is left out. With Street View a walked
 * street has one every 10 to 20 m. The API does the same for each route; this keeps the walk right on a street that two
 * routes walk in different parts.
 * @param {object[]} photos
 * @param {number[][]} coordinates the stretch, [lon, lat], in the walking direction
 * @param {number[][]} [street] the whole street's line, [lon, lat]
 */
export function photosInOrder(photos, coordinates, street = null, slack = 2) {
  if (!coordinates?.length) return photos
  return photos
    .map((p) => ({ p, at: nearestOn(coordinates, [p.lon, p.lat]) }))
    .filter(({ p, at }) => !street || street.length < 2 || coordinates.length < 2
      || at.dist <= nearestOn(street, [p.lon, p.lat]).dist + slack)
    .sort((a, b) => a.at.along - b.at.along)
    .map(({ p }) => p)
}

/** Where you are: at the middle of stretch `index` (where its photo point is), in metres, and the whole way. With several
 *  photos on the stretch, at photo `sub` of `n`, spread evenly along it. */
export function progressAt(stretches, index, sub = 0, n = 1) {
  const totalM = stretches.reduce((m, s) => m + s.length_m, 0)
  const before = stretches.slice(0, index).reduce((m, s) => m + s.length_m, 0)
  const doneM = before + ((stretches[index]?.length_m ?? 0) * (sub + 0.5)) / Math.max(1, n)
  return { doneM, totalM, share: totalM ? doneM / totalM : 0 }
}

/** "0.35 of 1.6 km · 16 min left" (board Routes 5, photos and play). minutes: the route's own walking time. */
export function progressLine({ doneM, totalM }, minutes) {
  const done = Math.min(Math.round(doneM / config.walkMetresPerMinute), minutes)
  return `${(doneM / 1000).toFixed(2)} of ${(totalM / 1000).toFixed(1)} km · ${minutes - done} min left`
}

/** The route's word on the comparison card: A shortest, B easiest (or the alternative). */
export const routeKind = (route) => (route.id === 'A' ? 'shortest' : route.kind === 'easiest' ? 'easiest' : 'alternative')

/** The chip (Elena, 2026-11-14; board Routes 5, photos and play): "Walking route B" and "easiest for your senses" (or
 *  "easiest for thermal comfort"); "shortest" and "alternative" say nothing more. The window is in the key under the photo. */
const EASIEST_FOR = { senses: 'easiest for your senses', thermal: 'easiest for thermal comfort' }
export function chipText(route, layer) {
  const kind = routeKind(route)
  return { title: `Walking route ${route.id}`, detail: kind === 'easiest' ? EASIEST_FOR[layer] ?? kind : kind }
}

/**
 * The stretch's state on the walk's card (board Routes 5, photos and play): "Mixed" and "for your senses" on one line, then
 * "The model points to: asphalt, stone, concrete; direct sun, little shade." The names have commas of their own, so a
 * semicolon parts them (Elena, 2026-11-14).
 * @param {string} layer 'senses' | 'thermal'
 * @param {object} properties the stretch's segment properties
 * @param {object|null} place Senses: the stretch's rating (stores/walk.js ratedPhoto.place), or null with no photo
 * @returns {{state:string, label:string, context:string, detail:string}}
 */
export function comfortLine(layer, properties, place) {
  const none = (label, detail) => ({ state: 'none', label, context: '', detail })
  if (layer === 'thermal') {
    if (properties.utci == null) return none('No value', 'No thermal comfort here.')
    const state = properties.thermal_state
    return { state, label: levelWord(state), context: 'for thermal comfort', detail: `Feels like ${formatDegrees(properties.utci)}.` }
  }
  if (!place) return none('No photo', 'So no Senses rating here.')
  if (place.status === 'unloaded') return none('No photo', 'The photo could not be loaded, so no rating.')
  if (place.status === 'pending') return none('Not rated yet', 'Waiting for its rating.')
  if (place.status === 'failed') return none('Couldn’t rate this photo', 'The photo and the map still work.')
  const bothers = place.bothers.slice(0, 2).map((e) => elementLabel(e).text.toLowerCase())
  const detail = place.level !== 'easy' && bothers.length ? `The model points to: ${bothers.join('; ')}.` : `${comfortLabel(place)}.`
  return { state: place.level, label: levelWord(place.level), context: 'for your senses', detail }
}
