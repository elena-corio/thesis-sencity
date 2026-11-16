// The app's street photos (Elena, 2026-11-16): one source, PHOTO_SOURCE, chosen on the server, which finds and rates
// them. Street View in the local prototype (the study's photos), with a Mapillary photo where Street View has none
// (parks, paths); Mapillary in any public version. Each photo says where it is from (`source`; an older area's photos,
// without one, are Mapillary's), and that decides its image, credit and link. The photo shown is the photo rated.
// Street View images come through our API (/api/photo), one paid call each, never kept by the browser either.
// One switch shows no photo at all: config.photos.shown (or window.__sencityPhotos = 'none' in the end-to-end tests).
import { ref } from 'vue'
import config from '../config.js'

const SOURCES = {
  mapillary: {
    url: (photo) => photo.thumb_url ?? null,
    credit: (photo) => `${photo.creator} · ${photo.year} · CC BY-SA 4.0`,
    link: (photo) => photo.link ?? null,
    name: 'Mapillary',
    paid: false,
  },
  streetview: {
    url: (photo) => `${config.apiBase}/api/photo/${encodeURIComponent(photo.pano_id)}?heading=${photo.heading}`,
    // A contributor photosphere (parks and squares only) is credited to its author.
    credit: (photo) => photo.copyright || '© Google',
    link: () => null,
    name: 'Google',
    paid: true,
  },
}

/** Where a photo is from. */
export const sourceOf = (photo) => SOURCES[photo?.source] ?? SOURCES.mapillary
/** The source the build was made for (vite.config.js, from PHOTO_SOURCE): 'streetview' or 'mapillary'. */
export const buildSource = () => import.meta.env?.PHOTO_SOURCE ?? 'streetview'
/** The photo credit of the map's attribution: the shown photo's source, else the build's ("Google, Mapillary"). */
export const sourcesName = (photo = null) =>
  (photo ? sourceOf(photo).name : buildSource() === 'streetview' ? 'Google, Mapillary' : 'Mapillary')

/** Photos are shown at all (on the cards, the enlarged photo and the walk). They are found and rated either way. */
export function showsPhotos() {
  const forced = typeof window !== 'undefined' ? window.__sencityPhotos : undefined
  return forced ? forced !== 'none' : config.photos.shown
}
/** A photo is shown in the walk's window: the same switch. */
export const showsWalkPhotos = showsPhotos

/** The image URL of a photo, or null when photos are not shown. */
export const shownPhotoUrl = (photo) => (photo && showsPhotos() ? sourceOf(photo).url(photo) : null)

/** The credit on a photo ("© Google", "anna · 2024 · CC BY-SA 4.0"), or ''. */
export const photoCredit = (photo) => (photo && showsPhotos() ? sourceOf(photo).credit(photo) : '')

/** Where the credit links to (the image page on Mapillary), or null. */
export const photoLink = (photo) => (photo && showsPhotos() ? sourceOf(photo).link(photo) : null)

/** Loading this photo's image is a paid call (Street View), so it is never loaded ahead of time. */
export const isPaid = (photo) => sourceOf(photo).paid

/** Street View images the browser loaded this session, for the cost counter in development (each load is a call:
 *  the API tells the browser not to keep them). */
export const streetViewShown = ref(0)
export function countShown(photo) {
  if (photo && isPaid(photo)) streetViewShown.value++
}

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

