import { defineStore } from 'pinia'
import { shallowRef, watch } from 'vue'
import { loadMapillaryAlong } from '../lib/api.js'
import { providerName } from '../lib/photos.js'
import { stretchFeature } from '../lib/routes.js'
import { useAreaStore } from './area.js'
import { useRoutesStore } from './routes.js'

const BATCH = 50 // streets per request in the background (the API takes up to mapillary.max_stretches)

/**
 * Mapillary photos on the place and stretch cards (Elena, 2026-11-11), kept for the session in memory only. Once an
 * area or a route has loaded, every street's photo is asked for in the background, a batch at a time, so most cards
 * open with it ready; a card opened before its street's turn asks for it at once. Resting the pointer on a street
 * starts loading its image. A street has no walking direction, so either way along it counts; a park or square has none.
 * The ratings stay those of the Street View photos (not shown).
 * byKey: key → photo | null (none fits) | 'loading' | 'error'.
 */
export const useCardPhotosStore = defineStore('cardPhotos', () => {
  const area = useAreaStore()
  const routes = useRoutesStore()
  const byKey = shallowRef({})
  const preloaded = new Set()
  let queue = []
  let running = false

  const on = () => providerName() === 'mapillary'
  const item = (key, feature) => {
    const polygon = feature.geometry.type === 'Polygon'
    return { key: String(key), coordinates: polygon ? feature.geometry.coordinates[0] : feature.geometry.coordinates, kind: polygon ? 'area' : 'street' }
  }

  function merge(entries) {
    byKey.value = { ...byKey.value, ...entries }
  }

  async function ask(items) {
    merge(Object.fromEntries(items.map((i) => [i.key, 'loading'])))
    try {
      const photos = await loadMapillaryAlong(items)
      merge(Object.fromEntries(items.map((i) => [i.key, photos[i.key] ?? null])))
    } catch {
      merge(Object.fromEntries(items.map((i) => [i.key, 'error'])))
    }
  }

  /** The background queue: one batch at a time, skipping what a card has asked for meanwhile. */
  async function drain() {
    if (running) return
    running = true
    while (queue.length) {
      const batch = queue.splice(0, BATCH).filter((i) => !(i.key in byKey.value))
      if (batch.length) await ask(batch)
    }
    running = false
  }

  /** Ask for every street of an area or a route, in the background (a new area replaces the waiting ones). */
  function prefetch(pairs) {
    if (!on()) return
    queue = pairs.filter(([key, f]) => key && f && !(String(key) in byKey.value)).map(([key, f]) => item(key, f))
    drain()
  }

  /** A card opens: its street's photo now, unless known or on its way. */
  function ensure(key, feature) {
    if (!on() || !key || !feature || String(key) in byKey.value) return
    ask([item(key, feature)])
  }

  /** Ask again after an error. */
  function retry(key, feature) {
    const { [key]: _gone, ...rest } = byKey.value
    byKey.value = rest
    ensure(key, feature)
  }

  /** The pointer rests on a street: start loading its image, so it is there when the card opens. */
  function preload(key) {
    const photo = byKey.value[key]
    if (!photo || typeof photo !== 'object' || preloaded.has(photo.thumb_url)) return
    preloaded.add(photo.thumb_url)
    new Image().src = photo.thumb_url
  }

  // An area or a route has loaded: its streets' photos, in the background.
  watch(() => area.load === 'ready' && area.segments, (fc) => {
    if (fc) prefetch(fc.features.map((f) => [f.properties.id, f]))
  })
  watch(() => routes.hasResult && routes.allStretches, (stretches) => {
    if (stretches) prefetch(stretches.map((s) => [s.key, stretchFeature(s, routes.segments)]))
  })

  return { byKey, ensure, retry, prefetch, preload }
})
