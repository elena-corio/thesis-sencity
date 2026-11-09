import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import config from '../config.js'
import { ApiError, loadArea, pointName } from '../lib/api.js'
import { POINT_LABEL, haversine, limitRadius } from '../lib/geo.js'
import { placeGroup } from '../lib/place.js'
import { sensesMarkers, withSenses } from '../lib/senses.js'
import { thermalSuggestions } from '../lib/suggest.js'
import { thermalLimits, withThermal } from '../lib/thermal.js'

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
  /** The centre's name: typed, or found for a clicked point; '' until that is known, or if there is none. */
  const centreLabel = ref('')
  const centreName = computed(() => centreLabel.value || POINT_LABEL)
  /** Name a clicked centre. The answer is dropped if the centre has moved meanwhile. */
  async function nameCentre(point) {
    const name = await pointName(point)
    if (name && centre.value?.lat === point.lat && centre.value?.lon === point.lon) centreLabel.value = name
  }
  /** The input section (centre and radius) is open: from the hint's "type an address", or by the user. */
  const inputsOpen = ref(false)
  /** A focused input field ('centre'): the next map click fills it (see takeField). */
  const fieldTarget = ref(null)
  let disarmTimer = null

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
  /** The chosen layer, before or after Analyse: 'senses' | 'thermal' | 'overall'. Decides what is loaded. */
  const layer = ref(config.layerDefault)
  /** What the chosen layer needs: { thermal }. */
  const needs = computed(() => config.layers[layer.value])
  /** What the map colours by: 'thermal' once it is known, 'senses', or null (photos only: Overall has no ratings yet). */
  const mapLayer = computed(() => {
    if (layer.value === 'senses') return 'senses'
    return layer.value === 'thermal' && thermalInfo.value ? 'thermal' : null
  })
  /** A later layer is loading its missing part: Cancel keeps the area. */
  const switching = ref(false)
  let layerTimer = null
  /** Selected segment id (the place card shows it). */
  const selectedId = ref(null)
  /** Where the selection ring sits: the click point, or the segment's middle. */
  const selectedPoint = ref(null)
  /** The street a "Cooler street nearby" link was followed from: { id, point, name } or null. */
  const cameFrom = ref(null)
  /** True when the selection came from a link on the card: the map zooms to it, not only pans. */
  const zoomToSelected = ref(false)
  let controller = null

  const selected = computed(() =>
    segments.value?.features.find((f) => f.properties.id === selectedId.value) ?? null)
  const counts = computed(() => {
    const fs = segments.value?.features ?? []
    return { all: fs.length, withPhotos: fs.filter((f) => f.properties.photos?.length).length }
  })
  /** The legend waits for its data; a new season or time keeps it, as the old values stay on the map. */
  const legendReady = computed(() => (layer.value === 'thermal'
    ? !!thermalInfo.value
    : step.value === 'analysed' && load.value === 'ready'))
  /** Something is loading: the layer waits. */
  const busy = computed(() => load.value === 'loading' || thermal.value === 'loading')

  // Places filter (left panel): 'all' | 'streets' | 'parks' | 'squares'. It filters the map and the
  // suggestions; the area card's counts stay for the whole area.
  const placeFilter = ref('all')
  const visibleSegments = computed(() => {
    const fc = segments.value
    if (!fc || placeFilter.value === 'all') return fc
    return { type: 'FeatureCollection',
      features: fc.features.filter((f) => placeGroup(f.properties, f.geometry.type) === placeFilter.value) }
  })

  /** The rating of this area has ended: only then are places recommended (set by stores/senses.js). */
  const sensesFinished = ref(false)

  // Markers: numbered places on the map and in the area card (brief §3, "Likely easiest for you").
  // Suggestions follow the area and the Places filter: on Thermal the values for the season and time, on Senses
  // once the rating has ended. Each: { n, f, mid, type, level }.
  const suggestions = computed(() => {
    if (!visibleSegments.value) return []
    if (mapLayer.value === 'senses') return sensesFinished.value ? sensesMarkers(visibleSegments.value.features, analysed.value) : []
    if (mapLayer.value !== 'thermal') return []
    return thermalSuggestions(visibleSegments.value.features,
      { limits: thermalLimits(), filter: placeFilter.value, centre: analysed.value })
  })
  /** Hook for the chat: its places replace the suggestions with the same markers, until cleared. */
  const chatMarkers = shallowRef(null)
  const markers = computed(() => chatMarkers.value ?? suggestions.value)
  /** 'chat' | 'suggestions': what the markers are (the list title and the Clear action follow it). */
  const markerKind = computed(() => (chatMarkers.value ? 'chat' : 'suggestions'))
  /** Hidden on the map after selecting a place that is not marked, until "Back to area". */
  const markersCollapsed = ref(false)
  /** Marked places whose card was opened ("seen" tick in the list). */
  const seenIds = ref(new Set())
  const isMarked = (id) => markers.value.some((m) => m.f.properties.id === id)
  /** For the chat (not built yet): show its places with the same markers. Same shape as suggestions. */
  function showChatResults(list) {
    chatMarkers.value = list.map((m, i) => ({ ...m, n: i + 1 }))
    markersCollapsed.value = false
    seenIds.value = new Set()
  }
  function clearChatResults() {
    chatMarkers.value = null
    markersCollapsed.value = false
    seenIds.value = new Set()
  }
  function setPlaceFilter(id) {
    placeFilter.value = id
    // A selected place the filter now hides closes its card.
    if (selected.value && id !== 'all' && placeGroup(selected.value.properties, selected.value.geometry.type) !== id) {
      clearSelection()
    }
  }

  /** The Senses state of each street, as ratings arrive (stores/senses.js). */
  function applySenses(states) {
    if (segments.value) segments.value = withSenses(segments.value, states)
  }

  function setFeature(feature) {
    const fs = segments.value.features.map((f) => (f.properties.id === feature.properties.id ? feature : f))
    segments.value = { type: 'FeatureCollection', features: fs }
  }

  /** Load the analysed area. resume: "Try again" after a failure keeps what is on the map and the
   *  progress; the API goes on from the failed step (its finished steps are kept, app/steps.py). */
  async function startLoad({ resume = false } = {}) {
    controller?.abort()
    controller = new AbortController()
    const signal = controller.signal
    load.value = 'loading'
    loadError.value = ''
    if (!resume) {
      segments.value = null
      progress.value = { stage: 'streets', done: 0, total: 0 }
      // A new area: its own markers.
      chatMarkers.value = null
      markersCollapsed.value = false
      seenIds.value = new Set()
    }
    resetThermal()
    try {
      await loadArea({ ...analysed.value, ...thermalWindow.value, layer: layer.value }, (e) => {
        if (e.type === 'segments') {
          segments.value = { type: 'FeatureCollection', features: e.features }
          progress.value = { stage: 'photos', done: e.done ?? 0, total: e.total }
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
  }

  /** "Try again" after the streets or photos failed: go on from there, not from the beginning. */
  function retryLoad() {
    return startLoad({ resume: true })
  }

  /** "Try again" after thermal comfort failed: ask for thermal only. The area is cached by then, so
   *  the API answers it at once; the streets and photos stay on the map as they are. */
  async function retryThermal() {
    controller?.abort()
    controller = new AbortController()
    const signal = controller.signal
    const failed = 'Thermal comfort could not be loaded. Try again.'
    thermal.value = 'loading'
    thermalError.value = ''
    try {
      await loadArea({ ...analysed.value, ...thermalWindow.value, layer: 'thermal' }, (e) => {
        if (e.type === 'thermal') applyThermal(e)
        else if (e.type === 'thermal_error') { thermal.value = 'error'; thermalError.value = e.message }
        else if (e.type === 'error') throw new ApiError(500, e.message)
      }, signal)
      if (thermal.value === 'loading') { thermal.value = 'error'; thermalError.value = failed }
    } catch {
      if (!signal.aborted) { thermal.value = 'error'; thermalError.value = failed }
    }
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
      await loadArea({ ...analysed.value, ...thermalWindow.value, layer: 'thermal' }, (e) => {
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
    clearTimeout(layerTimer)
    thermal.value = 'idle'
    thermalError.value = ''
    thermalInfo.value = null
    switching.value = false
  }

  /** After a change of layer, load only what the new one still lacks. */
  async function loadMissing() {
    if (step.value !== 'analysed' || load.value !== 'ready' || busy.value) return
    if (!needs.value.thermal || thermal.value === 'ready') return
    switching.value = true
    await retryThermal()
    switching.value = false
  }

  /** The Layer buttons. Before Analyse this only records the choice. On an analysed area it loads what is
   *  missing, after a moment, so arrow keys passing over a layer do not start a billed run. */
  function setLayer(id) {
    if (busy.value) return
    layer.value = id
    clearTimeout(layerTimer)
    if (step.value === 'analysed') layerTimer = setTimeout(loadMissing, config.thermalDebounceMs)
  }

  /** Cancel loading: back to the set circle (Flow 1c), or, for a change of layer, to the area as it was. */
  function cancelLoad() {
    controller?.abort()
    controller = null
    if (switching.value) {
      switching.value = false
      if (thermal.value === 'loading') thermal.value = 'idle'
      return
    }
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
    // A marked place: the selection ring takes the place of its pin, wherever it was clicked.
    const marker = markers.value.find((m) => m.f.properties.id === id)
    selectedId.value = id
    selectedPoint.value = marker ? marker.mid : point
    cameFrom.value = null
    zoomToSelected.value = false
    // A marked place: the others stay visible, and it gets the "seen" tick. Any other place hides them.
    if (isMarked(id)) {
      seenIds.value = new Set([...seenIds.value, id])
      markersCollapsed.value = false
    } else if (markers.value.length) {
      markersCollapsed.value = true
    }
  }
  /** Select a marked place from its pin or list row. */
  function selectMarker(marker, keyboard = false) {
    byKeyboard.value = keyboard
    select(marker.f.properties.id, marker.mid)
  }
  function clearSelection() {
    selectedId.value = null
    selectedPoint.value = null
    cameFrom.value = null
    markersCollapsed.value = false // "Back to area" brings the markers back
  }
  /** "Cooler street nearby": select that street, zoom to it, and remember the one we came from. */
  function goNearby(id, point, keyboard = false) {
    const from = selected.value && { id: selectedId.value, point: selectedPoint.value, name: selected.value.properties.name }
    select(id, point)
    cameFrom.value = from
    byKeyboard.value = keyboard
    zoomToSelected.value = true
  }
  /** "Back to <street>": the street the nearby link was followed from. */
  function goBack(keyboard = false) {
    const from = cameFrom.value
    if (!from) return
    select(from.id, from.point)
    byKeyboard.value = keyboard
    zoomToSelected.value = true
  }

  /** A field was focused: the next map click fills it. Kept for a moment after it loses focus, since
   *  clicking the map takes the focus away just before the click arrives. */
  function armField(name) {
    clearTimeout(disarmTimer)
    fieldTarget.value = name
  }
  function disarmField(name) {
    clearTimeout(disarmTimer)
    disarmTimer = setTimeout(() => { if (fieldTarget.value === name) fieldTarget.value = null }, 1000)
  }
  function takeField() {
    clearTimeout(disarmTimer)
    const name = fieldTarget.value
    fieldTarget.value = null
    return name
  }

  /** Leave an analysed area: back to a set circle that can be changed and analysed again. */
  function discardAnalysis() {
    if (step.value !== 'analysed') return
    controller?.abort()
    controller = null
    load.value = 'idle'
    segments.value = null
    resetThermal()
    clearSelection()
  }
  /** The centre from the Centre field (an address or a place) or a map click into that field. Keeps
   *  the radius; the circle is set at once (Flow 1c), ready to analyse. */
  function setCentre(point, label = '', keyboard = false) {
    discardAnalysis()
    centre.value = { lat: point.lat, lon: point.lon }
    centreLabel.value = label
    capped.value = false
    byKeyboard.value = keyboard
    step.value = 'set'
    if (!label) nameCentre(point)
  }
  /** The radius from the Radius choice. While the mouse is sizing the circle, it fixes it. */
  function setRadius(r) {
    if (step.value !== 'radius') discardAnalysis()
    radius.value = r
    capped.value = false
    if (centre.value) step.value = 'set'
  }

  function placeCentre(point, keyboard = false) {
    centreLabel.value = ''
    centre.value = { lat: point.lat, lon: point.lon }
    radius.value = config.radius.default
    capped.value = false
    byKeyboard.value = keyboard
    step.value = 'radius'
    nameCentre(point)
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
    centreLabel.value = ''
    inputsOpen.value = false
    capped.value = false
    radius.value = config.radius.default
  }

  return {
    step, centre, radius, capped, analysed, byKeyboard, hasCircle, placeCentre, radiusTo, nudge, fix, analyse, reset,
    centreLabel, centreName, inputsOpen, fieldTarget, armField, disarmField, takeField, setCentre, setRadius,
    load, progress, loadError, segments, selectedId, selectedPoint, selected, counts,
    thermal, thermalError, thermalInfo, thermalWindow, windowActive, setThermalWindow, layer, setLayer, needs, mapLayer,
    busy, legendReady, applySenses, sensesFinished,
    startLoad, retryLoad, retryThermal, cancelLoad, select, clearSelection, cameFrom, zoomToSelected, goNearby, goBack,
    placeFilter, visibleSegments, setPlaceFilter,
    suggestions, markers, markerKind, markersCollapsed, seenIds, selectMarker, showChatResults, clearChatResults,
  }
})
