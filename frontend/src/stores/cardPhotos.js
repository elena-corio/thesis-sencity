import { defineStore } from 'pinia'
import { ref } from 'vue'
import { isPaid, showsPhotos, shownPhotoUrl } from '../lib/photos.js'

/**
 * The photos on the place and stretch cards (Elena, 2026-11-11). Each street or place comes with its photos, found by the
 * API with the area or the route (lib/photos.js), and the photo shown is the one the model rates. Here: resting the pointer
 * on a street starts loading its Mapillary image, so it is there when the card opens (never a Street View image: each load
 * is a paid call, Elena 2026-11-16); and the direction of the photo on the open card, which the map draws as an arc on the
 * selected point. Images are in the browser's memory only.
 */
export const useCardPhotosStore = defineStore('cardPhotos', () => {
  /** The compass direction of the photo the open card shows, or null (the map draws it as an arc on the selected point). */
  const shownHeading = ref(null)
  const preloaded = new Set()

  /** The direction of a street's photo, for its suggestion pin, or null with no photo or photos off. */
  function headingOf(feature) {
    if (!showsPhotos()) return null
    return feature?.properties.photos?.[0]?.heading ?? null
  }

  /** The pointer rests on a street: start loading its image, so it is there when the card opens. */
  function preload(feature) {
    const photo = feature?.properties.photos?.[0]
    const url = photo && !isPaid(photo) ? shownPhotoUrl(photo) : null
    if (!url || preloaded.has(url)) return
    preloaded.add(url)
    new Image().src = url
  }

  return { shownHeading, headingOf, preload }
})
