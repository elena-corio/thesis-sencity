import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import config from '../config.js'
import { ApiError, loadArea } from '../lib/api.js'
import { haversine, limitRadius } from '../lib/geo.js'
import { withThermal } from '../lib/thermal.js'

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
  // Thermal comfort, after the photos (Flow 3): 'idle' | 'loading' | 'ready' | 'error'.
  const thermal = ref('idle')
  const thermalError = ref('')
  /** The window and weather station of the values shown. @type {import('vue').Ref<{season:string, time:string, station:{name:string, distance_km:number|null}} | null>} */
  const thermalInfo = ref(null)
  /** The season and time asked for; thermalInfo is what the streets show until it arrives. */
  const thermalWindow = ref({ ...config.thermalDefault })
  let windowTimer = null
  /** The bar can be used before analysis (the choice is free) and whenever nothing is loading. */
  const windowActive = computed(() => step.value !== 'analysed' ||
    (load.value === 'ready' && (thermal.value === 'ready' || thermal.value === 'error')))
  /** Layer on the map: null (photos only, before any rating) or 'thermal'. Senses and Overall come with rating. */
  const layer = ref(null)
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
    resetThermal()
    try {
      await loadArea({ ...analysed.value, ...thermalWindow.value }, (e) => {
        if (e.type === 'segments') {
          segments.value = { type: 'FeatureCollection', features: e.features }
          progress.value = { stage: 'photos', done: 0, total: e.total }
        } else if (e.type === 'segment') {
          setFeature(e.feature)
          progress.value = { stage: 'photos', done: e.done, total: e.total }
        } else if (e.type === 'done') {
          segments.value = e.area
          load.value = 'ready'
        } else if (e.type === 'stage' && e.stage === 'thermal') {
          thermal.value = 'loading'
        } else if (e.type === 'thermal') {
          applyThermal(e)
        } else if (e.type === 'thermal_error') {
          thermal.value = 'error'
          thermalError.value = e.message
        } else if (e.type === 'error') {
          throw new ApiError(500, e.message)
        }
      }, signal)
      if (load.value !== 'ready') throw new ApiError(500, '')
      if (thermal.value === 'loading') {
        thermal.value = 'error'
        thermalError.value = 'Thermal comfort could not be loaded. Try again.'
      }
    } catch (err) {
      if (signal.aborted) return
      if (load.value === 'ready') {
        // The photos arrived; only thermal comfort was cut off.
        thermal.value = 'error'
        thermalError.value = 'Thermal comfort could not be loaded. Try again.'
        return
      }
      load.value = 'error'
      loadError.value = err.status === 429
        ? 'Too many new areas in a short time. Wait a while and try again.'
        : 'Could not load street photos for this area. Check that the API is running, then try again.'
    }
  }

  function applyThermal(e) {
    segments.value = withThermal(segments.value, e.values)
    thermalInfo.value = { season: e.season, time: e.time, station: e.station }
    thermal.value = 'ready'
    layer.value = 'thermal'
  }

  /** Back to the season and time on screen: the streets keep their colours. */
  function keepShownWindow(message = '') {
    thermal.value = 'ready'
    thermalError.value = message
    thermalWindow.value = { season: thermalInfo.value.season, time: thermalInfo.value.time }
  }

  /** Thermal comfort for another season or time. The segments stay on the map; the same request
   *  answers at once from the cache when this area and window were already paid for. */
  async function reloadThermal() {
    controller?.abort()
    controller = new AbortController()
    const signal = controller.signal
    const failed = 'Thermal comfort could not be loaded for that season and time. Try again.'
    thermal.value = 'loading'
    thermalError.value = ''
    try {
      await loadArea({ ...analysed.value, ...thermalWindow.value }, (e) => {
        if (e.type === 'thermal') applyThermal(e)
        else if (e.type === 'thermal_error') keepShownWindow(e.message)
        else if (e.type === 'error') throw new ApiError(500, e.message)
      }, signal)
      if (thermal.value === 'loading') keepShownWindow(failed)
    } catch {
      if (!signal.aborted) keepShownWindow(failed)
    }
  }

  /** Season chips and time slider. Before analysis this only records the choice: Analyse uses it.
   *  On a loaded area it asks for thermal again, after a moment, so arrow-key steps ask only once. */
  function setThermalWindow(change) {
    if (!windowActive.value) return
    thermalWindow.value = { ...thermalWindow.value, ...change }
    if (thermal.value !== 'ready') return
    thermalError.value = ''
    clearTimeout(windowTimer)
    windowTimer = setTimeout(() => {
      const { season, time } = thermalWindow.value
      if (season !== thermalInfo.value?.season || time !== thermalInfo.value?.time) reloadThermal()
    }, config.thermalDebounceMs)
  }

  function resetThermal() {
    clearTimeout(windowTimer)
    thermal.value = 'idle'
    thermalError.value = ''
    thermalInfo.value = null
    layer.value = null
  }

  /** Cancel loading: back to the set circle (Flow 1c). */
  function cancelLoad() {
    controller?.abort()
    controller = null
    // Only another season or time was loading: keep the area and what it showed.
    if (load.value === 'ready' && thermalInfo.value) {
      keepShownWindow()
      return
    }
    load.value = 'idle'
    segments.value = null
    resetThermal()
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
    resetThermal()
    clearSelection()
    step.value = 'centre'
    centre.value = null
    capped.value = false
    radius.value = config.radius.default
  }

  return {
    step, centre, radius, capped, analysed, byKeyboard, hasCircle, placeCentre, radiusTo, nudge, fix, analyse, reset,
    load, progress, loadError, segments, selectedId, selectedPoint, selected, counts,
    thermal, thermalError, thermalInfo, thermalWindow, windowActive, setThermalWindow, layer,
    startLoad, cancelLoad, select, clearSelection,
  }
})
