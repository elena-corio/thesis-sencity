// Whether the app shows its street photos (Elena, 2026-11-11). They are Mapillary's (CC BY-SA 4.0): one per street or
// place, found with the area or route, and one per stretch of a walk (/api/mapillary/along). The photo shown is the photo
// the model rates. No Street View image is used any more. One place to switch:
//   'mapillary'   shown on the cards and in the walk (default)
//   'none'        no photo shown anywhere (they are still found and rated)
import config from '../config.js'

const OFF = { cards: false, walk: false, url: () => null, credit: () => '', link: () => null, name: '' }
const PROVIDERS = {
  none: OFF,
  mapillary: {
    cards: true,
    walk: true,
    url: (photo) => photo.thumb_url ?? null,
    credit: (photo) => `${photo.creator} · ${photo.year} · CC BY-SA 4.0`,
    link: (photo) => photo.link ?? null,
    name: 'Mapillary',
  },
}

/** The provider in use; an unknown name is 'none'. The end-to-end tests choose one before the page loads
 *  (window.__sencityPhotos), so they can check each. */
export function photoProvider(name = (typeof window !== 'undefined' && window.__sencityPhotos) || config.photos.provider) {
  return PROVIDERS[name] ?? PROVIDERS.none
}
export const providerName = () => {
  const n = (typeof window !== 'undefined' && window.__sencityPhotos) || config.photos.provider
  return PROVIDERS[n] ? n : 'none'
}

/** Photos are shown on the place and stretch cards (and the enlarged photo). */
export const showsPhotos = () => photoProvider().cards
/** A photo is shown in the walk's window. */
export const showsWalkPhotos = () => photoProvider().walk

/** The image URL of a photo, or null when photos are not shown. */
export const shownPhotoUrl = (photo) => (photo ? photoProvider().url(photo) : null)

/** The credit on a photo ("anna · 2024 · CC BY-SA 4.0"), or ''. */
export const photoCredit = (photo) => (photo ? photoProvider().credit(photo) : '')

/** Where the credit links to (the image page on Mapillary), or null. */
export const photoLink = (photo) => (photo ? photoProvider().link(photo) : null)

/**
 * A panorama shown as a square, 90 degree view looking `photo.heading` (the walk's bearing). Mapillary's panorama
 * thumbnail is equirectangular: 360 degrees across, 180 up and down, its middle looking `photo.pano_heading`. A quarter of
 * its width is 90 degrees, so it is drawn four times as wide as the frame (and so twice as high), around the horizon,
 * shifted so the walk's bearing is in the middle. Returns the left edge, as a share of the frame's width.
 */
export function panoShift(photo) {
  const turn = ((photo.heading - photo.pano_heading + 540) % 360) - 180 // -180..180, right of the pano's middle
  const at = 0.5 + turn / 360 // where the bearing is across the image (0..1)
  return 0.5 - 4 * at
}

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
