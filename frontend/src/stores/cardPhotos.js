import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import { loadMapillaryAlong } from '../lib/api.js'

/**
 * Mapillary photos on the place and stretch cards (Elena, 2026-11-11): asked for when a card opens, one street or place
 * at a time, and kept for the session (in memory only). A street has no walking direction, so either way along it
 * counts; a park or square has none. The ratings stay those of the Street View photos (not shown).
 * byKey: key → photo | null (none fits) | 'loading' | 'error'.
 */
export const useCardPhotosStore = defineStore('cardPhotos', () => {
  const byKey = shallowRef({})

  function set(key, value) {
    byKey.value = { ...byKey.value, [key]: value }
  }

  /** Ask for the photo of one card's street or place, unless it is known or on its way. */
  async function ensure(key, feature) {
    if (!key || !feature || key in byKey.value) return
    const polygon = feature.geometry.type === 'Polygon'
    const coordinates = polygon ? feature.geometry.coordinates[0] : feature.geometry.coordinates
    set(key, 'loading')
    try {
      const photos = await loadMapillaryAlong([{ key: String(key), coordinates, kind: polygon ? 'area' : 'street' }])
      set(key, photos[String(key)] ?? null)
    } catch {
      set(key, 'error')
    }
  }

  /** Ask again after an error. */
  function retry(key, feature) {
    const { [key]: _gone, ...rest } = byKey.value
    byKey.value = rest
    ensure(key, feature)
  }

  return { byKey, ensure, retry }
})
