// Walk along a route (board Routes 5): where you are on the way, which way the camera looks, and the lines of
// the chip and the stretch card. Everything comes from what is already loaded: no new call.
import config from '../config.js'
import { comfortLabel, elementLabel, levelWord, photoKey } from './senses.js'
import { formatDegrees } from './thermal.js'

/**
 * The photo a stretch is rated from, which is also the photo its window shows (Elena, 2026-11-14: a rating never
 * without its photo, nor a photo without its rating): its own photo, facing along the walk; else its street's photo
 * (the one the map is coloured from); else none.
 * @param {object} stretch a stretch (lib/routes.js stretchesOf)
 * @param {object|null} own the walk's photos by stretch key, or null while they are being found
 * @param {Map} segments the routes' segments by id
 * @returns {{photo:object, from:'stretch'|'street'}|null|undefined} undefined while the stretch's own photo is being found
 */
export function ratedPhotoOf(stretch, own, segments) {
  if (own === null) return undefined
  if (own[stretch.key]) return { photo: own[stretch.key], from: 'stretch' }
  const street = segments.get(stretch.segmentId)?.properties.photos?.[0]
  return street ? { photo: street, from: 'street' } : null
}

/**
 * A stretch's state on Senses, from its rated photo alone: the photo's rating level; 'failed' if it could not be rated;
 * 'none' with no photo, a photo that could not be loaded, or no rating yet.
 * @param {{photo:object}|null} rated ratedPhotoOf()
 * @param {(photos: object[]) => object} placeFor stores/senses.js placeFor
 * @param {Set<string>} unloaded photo keys whose image could not be loaded
 */
export function sensesStateOf(rated, placeFor, unloaded) {
  if (!rated || unloaded.has(photoKey(rated.photo))) return 'none'
  const place = placeFor([rated.photo])
  return place.status === 'rated' ? place.level : place.status === 'failed' ? 'failed' : 'none'
}

/** Where you are: at the middle of stretch `index` (where its photo point is), in metres, and the whole way. */
export function progressAt(stretches, index) {
  const totalM = stretches.reduce((n, s) => n + s.length_m, 0)
  const before = stretches.slice(0, index).reduce((n, s) => n + s.length_m, 0)
  const doneM = before + (stretches[index]?.length_m ?? 0) / 2
  return { doneM, totalM, share: totalM ? doneM / totalM : 0 }
}

/** "0.35 of 1.6 km, 5 of 21 min". minutes: the route's own walking time. */
export function progressLine({ doneM, totalM }, minutes) {
  const done = Math.round(doneM / config.walkMetresPerMinute)
  return `${(doneM / 1000).toFixed(2)} of ${(totalM / 1000).toFixed(1)} km, ${Math.min(done, minutes)} of ${minutes} min`
}

/** Compass bearing in degrees (0 north, 90 east) from the stretch's first point to its last: the camera looks
 *  along the way. */
export function stretchBearing(stretch) {
  const c = stretch.coordinates
  const [lon1, lat1] = c[0].map((v) => (v * Math.PI) / 180)
  const [lon2, lat2] = c[c.length - 1].map((v) => (v * Math.PI) / 180)
  const y = Math.sin(lon2 - lon1) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

/** The route's word on the comparison card: A shortest, B easiest (or the alternative). */
export const routeKind = (route) => (route.id === 'A' ? 'shortest' : route.kind === 'easiest' ? 'easiest' : 'alternative')

/** The chip at the top (boards Routes 5, P6): "Walking route B" and "easiest overall, summer 15:00". A route found on
 *  Senses has no season or time. */
export function chipText(route, layer, info) {
  const kind = `${routeKind(route)} ${layer}`
  return { title: `Walking route ${route.id}`, detail: info ? `${kind}, ${info.season} ${info.time}` : kind }
}

/** Under the legend: the settings are fixed for the walk. "Summer, 15:00. To change the layer, season or time, exit the walk." */
export function fixedLine() {
  return 'To change the layer, season or time, exit the walk.'
}

/**
 * The stretch's state and its reason, for the card: "Hard" and "senses, because of signs, ads".
 * @param {string} layer 'senses' | 'thermal'
 * @param {object} properties the stretch's segment properties
 * @param {object|null} place Senses: the rating of the stretch's photo (stores/senses.js placeFor), or null with no photo
 * @returns {{state:string, label:string, reason:string}}
 */
export function comfortLine(layer, properties, place) {
  if (layer === 'thermal') {
    if (properties.utci == null) return { state: 'none', label: 'No value', reason: 'no thermal comfort for this stretch' }
    const state = properties.thermal_state
    return { state, label: levelWord(state), reason: `thermal, feels like ${formatDegrees(properties.utci)}` }
  }
  if (!place) return { state: 'none', label: 'No photo', reason: 'so no Senses rating here' }
  if (place.status === 'unloaded') return { state: 'none', label: 'No photo', reason: 'the photo could not be loaded, so no rating' }
  if (place.status === 'pending') return { state: 'none', label: 'Not rated yet', reason: 'waiting for its rating' }
  if (place.status === 'failed') return { state: 'none', label: 'Could not rate', reason: 'the photo and the map still work' }
  const bothers = place.bothers.slice(0, 2).map((e) => elementLabel(e).text.toLowerCase())
  const reason = place.level !== 'easy' && bothers.length ? `senses, because of ${bothers.join(' and ')}` : `senses, ${comfortLabel(place)}`
  return { state: place.level, label: levelWord(place.level), reason }
}
