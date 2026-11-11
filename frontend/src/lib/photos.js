// Which street photos the app shows, and from where (Elena, 2026-11-11). Google's EEA terms forbid Street View Static
// images "on, next to, or in a manner that is visually associated with any map", so the default is 'none': no photo is
// fetched or shown in any view (place card, stretch card, enlarged photo, walk). The photos still rate the streets on the
// server; only showing them is off. One place to switch:
//   'none'        no photo shown (default)
//   'streetview'  Street View Static, through /api/photo (not with a map in the EEA)
//   'mapillary'   not built yet: needs a Mapillary access token and its own lookup
import config from '../config.js'
import { photoUrl } from './api.js'

const PROVIDERS = {
  none: { shows: false, url: () => null, credit: () => '' },
  streetview: {
    shows: true,
    url: (photo) => photoUrl(photo),
    credit: (photo) => (photo.contributor ? 'Contributor photo' : '© Google'),
  },
  mapillary: { shows: false, url: () => null, credit: () => '' },
}

/** The provider in use; an unknown name is 'none'. The end-to-end tests choose one before the page loads
 *  (window.__sencityPhotos), so they can check both what is shipped and the photo views. */
export function photoProvider(name = (typeof window !== 'undefined' && window.__sencityPhotos) || config.photos.provider) {
  return PROVIDERS[name] ?? PROVIDERS.none
}

/** Photos are shown at all. */
export const showsPhotos = () => photoProvider().shows

/** The image URL of a photo, or null when photos are not shown. */
export const shownPhotoUrl = (photo) => (photo ? photoProvider().url(photo) : null)

/** The credit on a photo ("© Google"), or '' when none is shown. */
export const photoCredit = (photo) => (photo ? photoProvider().credit(photo) : '')

/** Of a stretch's photos, the one that faces most nearly along the walk (heading closest to `bearing`), or null. */
export function photoAlong(photos, bearing) {
  let best = null
  let bestTurn = Infinity
  for (const p of photos ?? []) {
    const turn = Math.abs(((p.heading - bearing + 540) % 360) - 180)
    if (turn < bestTurn) {
      best = p
      bestTurn = turn
    }
  }
  return best
}
