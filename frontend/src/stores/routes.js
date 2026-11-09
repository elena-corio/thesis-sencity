import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import config from '../config.js'
import { loadRoutes, pointName } from '../lib/api.js'
import { formatKm, stretchesOf, stretchMiddle } from '../lib/routes.js'
import { pickWays, withSenses } from '../lib/senses.js'
import { POINT_LABEL, haversine } from '../lib/geo.js'
import { thermalLimits, withThermal } from '../lib/thermal.js'

/**
 * Routes (brief §3, boards Routes 1–4). Start and End come from a map click or search. Once both are set
 * there is a preview, and nothing is asked for until Analyse (as in Area: a misclick costs nothing). The
 * two ways appear on the map only when they are ready.
 * The two ways are found on Thermal. Their streets are then rated for Senses (stores/senses.js); Overall is not built.
 */
export const useRoutesStore = defineStore('routes', () => {
  /** named: the label is a place from search, not a point on the map.
   *  @type {import('vue').Ref<{lat:number, lon:number, label:string, named:boolean} | null>} */
  const start = ref(null)
  const end = ref(null)
  /** The input section (Start and End) is open: from the hint's "type an address", or by the user. */
  const inputsOpen = ref(false)
  /** A focused input field ('start' or 'end'): the next map click fills it (see takeField). */
  const fieldTarget = ref(null)
  let disarmTimer = null
  /** 'idle' | 'loading' | 'ready' | 'error' */
  const load = ref('idle')
  const progress = ref({ stage: 'streets', done: 0, total: 0 })
  const error = ref('')
  /** Why the chosen end was refused before asking (too close, too far). */
  const pointError = ref('')
  /** Why a new season or time could not be shown; the previous one stays on the map. */
  const windowError = ref('')
  const thermalWindow = ref({ ...config.thermalDefault })
  /** The window and station of the routes shown. */
  const info = ref(null)
  const layer = ref('thermal')
  const routes = shallowRef([])
  /** Senses: the ways to rate; the two routes are chosen from them when the rating ends (stores/senses.js). */
  const candidates = shallowRef([])
  /** The layer the routes on the map were found for: going to the other one asks again. */
  let loadedFor = null
  const verdict = ref('')
  const segments = shallowRef(new Map())
  const visible = ref({ A: true, B: true })
  /** The selected stretch: { key, point } */
  const selected = ref(null)
  /** Linked highlight (brief §8): a stretch key or a route id, from the map, a bar or a button. */
  const hoverKey = ref(null)
  const hoverRoute = ref(null)
  /** The last step was done with the keyboard, so focus can follow. */
  const byKeyboard = ref(false)
  /** The bar section to focus again after Back to comparison. */
  const returnKey = ref(null)
  let controller = null
  let windowTimer = null
  let layerTimer = null

  const step = computed(() => {
    if (!start.value) return 'start'
    if (!end.value) return 'end'
    return 'set'
  })
  const hasResult = computed(() => routes.value.length > 0)
  const windowActive = computed(() => load.value !== 'loading')
  /** Both points are set and nothing has been asked for yet. */
  const previewing = computed(() => step.value === 'set' && load.value === 'idle' && !hasResult.value)
  const aerialDistance = computed(() => (start.value && end.value ? haversine(start.value, end.value) : 0))
  /** Every route with its stretches on the chosen layer. */
  const shown = computed(() => routes.value.map((r) => ({ ...r, stretches: stretchesOf(r, segments.value, layer.value) })))
  const allStretches = computed(() => shown.value.flatMap((r) => r.stretches))
  const selectedStretch = computed(() => allStretches.value.find((s) => s.key === selected.value?.key) ?? null)
  const selectedRoute = computed(() => shown.value.find((r) => r.id === selectedStretch.value?.routeId) ?? null)

  /** The Senses state of each street on the two ways, as ratings arrive (stores/senses.js). */
  function applySenses(states) {
    const features = [...segments.value.values()]
    const fc = { features }
    const next = withSenses(fc, states)
    if (next !== fc) segments.value = new Map(next.features.map((f) => [f.properties.id, f]))
  }

  function clearResult() {
    routes.value = []
    verdict.value = ''
    segments.value = new Map()
    info.value = null
    selected.value = null
    hoverKey.value = null
    hoverRoute.value = null
    visible.value = { A: true, B: true }
    windowError.value = ''
    loadedFor = null
  }

  function stopLoading() {
    controller?.abort()
    controller = null
    clearTimeout(windowTimer)
    clearTimeout(layerTimer)
    if (candidates.value.length) candidates.value = []
  }

  /** Set the next empty point: the first click is Start, the second End (brief §3). */
  /** A field was focused: the next map click fills it (kept a moment after the click takes the focus). */
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

  /** Name a clicked point, wherever it is by then (Swap may have moved it); dropped if it has gone. */
  async function namePoint(point) {
    const name = await pointName(point)
    if (!name) return
    for (const p of [start, end]) {
      if (p.value?.lat === point.lat && p.value?.lon === point.lon && !p.value.named) p.value = { ...p.value, label: name }
    }
  }

  /** A point from the map (a click, or Enter at the map centre): named once the lookup answers. */
  function pick(point, label = null, keyboard = false) {
    byKeyboard.value = keyboard
    if (!start.value) setPoint('start', point, label)
    else if (!end.value) setPoint('end', point, label)
  }

  function setPoint(which, point, label, named = false) {
    stopLoading()
    clearResult()
    load.value = 'idle'
    error.value = ''
    pointError.value = ''
    const next = { lat: point.lat, lon: point.lon, label: label || POINT_LABEL, named }
    if (which === 'start') start.value = next
    else end.value = next
    if (start.value && end.value && !distanceAllowed(which)) return
    if (!label) namePoint(next)
  }

  /** Refuse points too close or too far before asking the API. The point just chosen is cleared. */
  function distanceAllowed(which) {
    const d = haversine(start.value, end.value)
    const { minM, maxM } = config.routes
    if (d >= minM && d <= maxM) return true
    pointError.value = d < minM
      ? `Start and end are only ${Math.round(d)} m apart. Choose points further apart.`
      : `That is ${formatKm(d)} in a straight line. Routes go up to ${formatKm(maxM)} for now. Choose a closer point.`
    if (which === 'start') start.value = null
    else end.value = null
    return false
  }

  function clearPoint(which) {
    stopLoading()
    clearResult()
    load.value = 'idle'
    error.value = ''
    pointError.value = ''
    if (which === 'start') start.value = null
    else end.value = null
  }

  function swap() {
    if (!start.value && !end.value) return
    const was = start.value
    // With routes on the map the answer is already paid for, either way round: ask at once.
    const again = hasResult.value
    stopLoading()
    clearResult()
    start.value = end.value
    end.value = was
    if (again) find()
    else load.value = 'idle'
  }

  function reset() {
    stopLoading()
    clearResult()
    load.value = 'idle'
    error.value = ''
    pointError.value = ''
    start.value = null
    end.value = null
    inputsOpen.value = false
  }

  function apply(e) {
    segments.value = new Map(withThermal(e.segments, e.values).features.map((f) => [f.properties.id, f]))
    if (e.candidates) { // Senses: still loading, until the rating has chosen the two ways
      info.value = null
      windowError.value = ''
      candidates.value = e.candidates
      return
    }
    loadedFor = 'thermal'
    routes.value = e.routes
    verdict.value = e.verdict
    // A Senses route has no thermal comfort: nothing to say about a season or time.
    info.value = e.station ? { season: e.season, time: e.time, station: e.station } : null
    if (info.value) thermalWindow.value = { season: e.season, time: e.time }
    selected.value = null
    visible.value = { A: true, B: true }
    windowError.value = ''
    load.value = 'ready'
  }

  /** Senses: the rating has ended, also when stopped or at the cap. stateOf gives the state of a segment. */
  function finishSenses(stateOf) {
    if (!candidates.value.length) return
    routes.value = pickWays(candidates.value, stateOf)
    verdict.value = ''
    selected.value = null
    visible.value = { A: true, B: true }
    windowError.value = ''
    loadedFor = 'senses'
    if (load.value === 'loading') load.value = 'ready'
  }

  /** Something failed: with routes on the map they stay, for the season and time they show. */
  function failed(message) {
    if (hasResult.value) {
      if (info.value) thermalWindow.value = { season: info.value.season, time: info.value.time }
      windowError.value = message
      load.value = 'ready'
    } else {
      error.value = message
      load.value = 'error'
    }
  }

  /** Find the two ways. resume: "Try again" after a failure keeps the progress on screen; the API goes
   *  on from the failed step (its finished steps and the corridor are kept). */
  async function find({ resume = false } = {}) {
    stopLoading()
    controller = new AbortController()
    const { signal } = controller
    load.value = 'loading'
    error.value = ''
    windowError.value = ''
    if (resume) {
      const { failed: _f, ...kept } = progress.value
      progress.value = kept
    } else {
      progress.value = { stage: 'streets', done: 0, total: 0 }
    }
    const generic = 'Could not find the two ways. Check that the API is running, then try again.'
    try {
      await loadRoutes({
        start: { lat: start.value.lat, lon: start.value.lon },
        end: { lat: end.value.lat, lon: end.value.lon },
        limits: thermalLimits(),
        ...thermalWindow.value,
        layer: layer.value,
      }, (e) => {
        if (e.type === 'stage') progress.value = { ...progress.value, stage: e.stage }
        // A retry goes on from the photos already found (the API keeps the finished steps).
        else if (e.type === 'segments') progress.value = { stage: 'photos', done: e.done ?? 0, total: e.total }
        else if (e.type === 'segment') progress.value = { stage: 'photos', done: e.done, total: e.total }
        else if (e.type === 'routes') apply(e)
        else if (e.type === 'thermal_error' || e.type === 'error') {
          progress.value = { ...progress.value, failed: e.type === 'thermal_error' ? 'thermal' : progress.value.stage }
          failed(e.message)
        }
      }, signal)
      if (load.value === 'loading' && !candidates.value.length) failed(generic)
    } catch (err) {
      if (signal.aborted) return
      failed((err.status === 429 || err.status === 422) && err.message ? err.message : generic)
    }
  }

  /** The Analyse button, or Enter in the End field: only once both points are set and nothing is asked yet. */
  function analyse(keyboard = false) {
    if (!previewing.value) return
    byKeyboard.value = keyboard
    find()
  }

  /** Cancel loading. With routes on the map they stay; otherwise back to the preview, as in Area. */
  function cancel() {
    stopLoading()
    if (hasResult.value) {
      if (info.value) thermalWindow.value = { season: info.value.season, time: info.value.time }
      load.value = 'ready'
      return
    }
    load.value = 'idle'
    error.value = ''
  }

  /** Season chips and time slider: free until Analyse; on a result it asks again. */
  function setThermalWindow(change) {
    if (!windowActive.value) return
    thermalWindow.value = { ...thermalWindow.value, ...change }
    windowError.value = ''
    if (!hasResult.value) return
    clearTimeout(windowTimer)
    windowTimer = setTimeout(() => {
      const { season, time } = thermalWindow.value
      if (season !== info.value?.season || time !== info.value?.time) find()
    }, config.thermalDebounceMs)
  }

  /** The Layer buttons. Each layer finds its own two ways, after a moment, so arrow keys passing over a layer do not
   *  start a billed run. The streets and what is already rated or simulated are cached. */
  function setLayer(id) {
    layer.value = id
    clearTimeout(layerTimer)
    if (hasResult.value && loadedFor !== id) layerTimer = setTimeout(find, config.thermalDebounceMs)
  }

  function toggleRoute(id) {
    visible.value = { ...visible.value, [id]: !visible.value[id] }
    if (selectedStretch.value?.routeId === id && !visible.value[id]) selected.value = null
  }

  function selectStretch(key, point, keyboard = false) {
    const stretch = allStretches.value.find((s) => s.key === key)
    if (!stretch) return
    byKeyboard.value = keyboard
    selected.value = { key, point: point ?? stretchMiddle(stretch) }
    returnKey.value = key
  }

  /** The next or previous stretch of the same route (arrow keys and the card's buttons). */
  function stepStretch(delta, keyboard = false) {
    const s = selectedStretch.value
    if (!s) return
    const next = selectedRoute.value.stretches[s.index + delta]
    if (next) selectStretch(next.key, undefined, keyboard)
  }

  function back(keyboard = false) {
    byKeyboard.value = keyboard
    selected.value = null
  }

  return {
    inputsOpen, fieldTarget, armField, disarmField, takeField,
    start, end, load, progress, error, pointError, windowError, thermalWindow, info, layer, routes, verdict,
    segments, visible, selected, hoverKey, hoverRoute, byKeyboard, returnKey, step, hasResult, windowActive,
    shown, allStretches, selectedStretch, selectedRoute, previewing, aerialDistance,
    applySenses, setLayer, candidates, finishSenses,
    pick, setPoint, clearPoint, swap, reset, find, analyse, cancel, setThermalWindow, toggleRoute, selectStretch, stepStretch, back,
  }
})
