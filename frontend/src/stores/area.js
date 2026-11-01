import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import config from '../config.js'
import { ApiError, loadArea } from '../lib/api.js'
import { haversine, limitRadius } from '../lib/geo.js'

/**
 * Two-click area selection (brief §6 "Study area", boards Flow 1, 1b, 1c).
 * step: 'centre' (Flow 1) → 'radius' (1b) → 'set' (1c) → 'analysed'.
 */
export const useAreaStore = defineStore('area', () => {
  const step = ref('centre')
  /** @type {import('vue').Ref<{lat:number, lon:number} | null>} */
  const centre = ref(null)
  const radius = ref(config.radius.default)
  const capped = ref(false)
  /** The area sent for analysis. @type {import('vue').Ref<{lat:number, lon:number, radius:number} | null>} */
  const analysed = ref(null)
  /** True when the last step was done with the keyboard, so focus can follow. */
  const byKeyboard = ref(false)

  const hasCircle = computed(() => step.value !== 'centre' && centre.value !== null)

  // Loading the analysed area: street segments and their photos (Flow 2).
  /** 'idle' | 'loading' | 'ready' | 'error' */
  const load = ref('idle')
  const progress = ref({ stage: 'streets', done: 0, total: 0 })
  const loadError = ref('')
  /** GeoJSON FeatureCollection of segments; photos is null while still being looked up. */
  const segments = shallowRef(null)
  /** Selected segment id (the place card shows it). */
  const selectedId = ref(null)
  /** Where the selection ring sits: the click point, or the segment's middle. */
  const selectedPoint = ref(null)
  let controller = null

  const selected = computed(() =>
    segments.value?.features.find((f) => f.properties.id === selectedId.value) ?? null)
  const counts = computed(() => {
    const fs = segments.value?.features ?? []
    return { all: fs.length, withPhotos: fs.filter((f) => f.properties.photos?.length).length }
  })

  function setFeature(feature) {
    const fs = segments.value.features.map((f) => (f.properties.id === feature.properties.id ? feature : f))
    segments.value = { type: 'FeatureCollection', features: fs }
  }

  async function startLoad() {
    controller?.abort()
    controller = new AbortController()
    const signal = controller.signal
    load.value = 'loading'
    loadError.value = ''
    segments.value = null
    progress.value = { stage: 'streets', done: 0, total: 0 }
    try {
      await loadArea(analysed.value, (e) => {
        if (e.type === 'segments') {
          segments.value = { type: 'FeatureCollection', features: e.features }
          progress.value = { stage: 'photos', done: 0, total: e.total }
        } else if (e.type === 'segment') {
          setFeature(e.feature)
          progress.value = { stage: 'photos', done: e.done, total: e.total }
        } else if (e.type === 'done') {
          segments.value = e.area
          load.value = 'ready'
        } else if (e.type === 'error') {
          throw new ApiError(500, e.message)
        }
      }, signal)
      if (load.value !== 'ready') throw new ApiError(500, '')
    } catch (err) {
      if (signal.aborted) return
      load.value = 'error'
      loadError.value = err.status === 429
        ? 'Too many new areas in a short time. Wait a while and try again.'
        : 'Could not load street photos for this area. Check that the API is running, then try again.'
    }
  }

  /** Cancel loading: back to the set circle (Flow 1c). */
  function cancelLoad() {
    controller?.abort()
    controller = null
    load.value = 'idle'
    segments.value = null
    clearSelection()
    step.value = 'set'
  }

  function select(id, point) {
    selectedId.value = id
    selectedPoint.value = point
  }
  function clearSelection() {
    selectedId.value = null
    selectedPoint.value = null
  }

  function placeCentre(point, keyboard = false) {
    centre.value = { lat: point.lat, lon: point.lon }
    radius.value = config.radius.default
    capped.value = false
    byKeyboard.value = keyboard
    step.value = 'radius'
  }

  /** Radius from a point on the map: ground distance, rounded, snapped and capped. */
  function radiusTo(point) {
    if (!centre.value) return
    const r = limitRadius(haversine(centre.value, point), config.radius)
    radius.value = r.radius
    capped.value = r.capped
  }

  /** Keyboard: change the radius in 10 m steps within the limits. */
  function nudge(deltaM) {
    const { min, max } = config.radius
    const next = radius.value + deltaM
    capped.value = next > max
    radius.value = Math.min(max, Math.max(min, next))
  }

  function fix(keyboard = false) {
    if (step.value !== 'radius') return
    byKeyboard.value = keyboard
    capped.value = false
    step.value = 'set'
  }

  function analyse(keyboard = false) {
    if (step.value !== 'set' || !centre.value) return
    byKeyboard.value = keyboard
    analysed.value = { lat: centre.value.lat, lon: centre.value.lon, radius: radius.value }
    step.value = 'analysed'
    startLoad()
  }

  function reset() {
    controller?.abort()
    controller = null
    load.value = 'idle'
    segments.value = null
    clearSelection()
    step.value = 'centre'
    centre.value = null
    capped.value = false
    radius.value = config.radius.default
  }

  return {
    step, centre, radius, capped, analysed, byKeyboard, hasCircle, placeCentre, radiusTo, nudge, fix, analyse, reset,
    load, progress, loadError, segments, selectedId, selectedPoint, selected, counts,
    startLoad, cancelLoad, select, clearSelection,
  }
})
