import { defineStore } from 'pinia'
import { computed, markRaw, reactive, watch } from 'vue'
import { rateSenses } from '../lib/api.js'
import { haversine, midpoint } from '../lib/geo.js'
import { combinePlace, photoKey } from '../lib/senses.js'
import { useAreaStore } from './area.js'
import { useRoutesStore } from './routes.js'

function emptyRun() {
  return { key: null, places: markRaw([]), status: 'idle', error: '', model: '', costUsd: 0, streetviewUsd: 0, newCount: 0,
    cachedCount: 0, seconds: 0, remaining: 0, estimateUsd: 0, estimateStreetviewUsd: 0 }
}

/**
 * General predictions (Senses, no profile). As soon as an area or a pair of routes is ready, every photo not yet
 * rated goes to the API, nearest first; ratings arrive one by one. Nothing is written to the browser's storage:
 * the API's cache is what makes reopening instant and free.
 * A run: status 'idle' | 'rating' | 'paused' (over the cap, waiting for an answer) | 'done' | 'error'.
 */
export const useSensesStore = defineStore('senses', () => {
  const area = useAreaStore()
  const routes = useRoutesStore()
  /** photo key → { status: 'ok', result } | { status: 'failed', error } */
  const ratings = reactive(new Map())
  const runs = reactive({ area: emptyRun(), routes: emptyRun() })
  const controllers = {}
  const counted = { area: new Set(), routes: new Set() }

  const ratingOf = (photo) => ratings.get(photoKey(photo))
  /** One place from its photos (lib/senses.js). */
  const placeFor = (photos) => combinePlace(photos ?? [], ratingOf)

  function onEvent(scope, e) {
    const run = runs[scope]
    if (e.type === 'start') {
      run.model = e.model
    } else if (e.type === 'photo') {
      const key = photoKey(e)
      ratings.set(key, e.status === 'ok' ? { status: 'ok', result: e.result } : { status: 'failed', error: e.error })
      if (!e.cached) {
        run.costUsd += e.cost_usd ?? 0
        run.streetviewUsd += e.streetview_usd ?? 0
      }
      // A photo counts once per run, also when asking again after the cap brings it back from the cache.
      if (e.status === 'ok' && !counted[scope].has(key)) {
        counted[scope].add(key)
        if (e.cached) run.cachedCount++
        else run.newCount++
      }
    } else if (e.type === 'done') {
      run.seconds += e.seconds
      run.remaining = e.remaining
      run.estimateUsd = e.estimate_usd
      run.estimateStreetviewUsd = e.estimate_streetview_usd
      run.status = e.remaining > 0 ? 'paused' : 'done'
    } else if (e.type === 'error') {
      run.status = 'error'
      run.error = e.message
    }
  }

  /** Ask for every photo of the run. The API answers the cached ones and rates up to the cap of the others. */
  async function rate(scope) {
    const run = runs[scope]
    controllers[scope]?.abort()
    const controller = new AbortController()
    controllers[scope] = controller
    Object.assign(run, { status: 'rating', error: '', remaining: 0 })
    const seen = new Set()
    const photos = run.places.flatMap((p) => p.photos).filter((ph) => {
      const key = photoKey(ph)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).map((ph) => ({ pano_id: ph.pano_id, heading: ph.heading }))
    try {
      await rateSenses(photos, (e) => onEvent(scope, e), controller.signal)
      if (run.status === 'rating') Object.assign(run, { status: 'error', error: 'The rating stopped before the end. Retry to go on.' })
    } catch (err) {
      if (!controller.signal.aborted) Object.assign(run, { status: 'error', error: err.message || 'The rating failed on the server.' })
    }
  }

  function clear(scope) {
    controllers[scope]?.abort()
    Object.assign(runs[scope], emptyRun())
    counted[scope] = new Set()
  }

  function start(scope, key, places) {
    clear(scope)
    Object.assign(runs[scope], { key, places: markRaw(places) })
    return rate(scope)
  }

  /** Above the cap, the person chose not to go on: what is rated stays. */
  function stopHere(scope) {
    runs[scope].status = 'done'
  }

  const progressOf = (scope) => {
    const { places } = runs[scope]
    const settled = places.filter((p) => p.photos.every((ph) => ratings.has(photoKey(ph)))).length
    const rated = places.filter((p) => placeFor(p.photos).status === 'rated').length
    const failed = places.filter((p) => placeFor(p.photos).status === 'failed').length
    return { done: settled, total: places.length, rated, failed }
  }
  const areaProgress = computed(() => progressOf('area'))
  const routesProgress = computed(() => progressOf('routes'))

  // An area: when its photos are known and the Senses layer is on, nearest to the centre first.
  const areaKey = computed(() => {
    const a = area.analysed
    return area.step === 'analysed' && a ? `${a.lat}|${a.lon}|${a.radius}` : null
  })
  watch(areaKey, (key) => { if (runs.area.key && key !== runs.area.key) clear('area') })
  watch(() => (areaKey.value && area.load === 'ready' && area.layer === 'senses' ? areaKey.value : null), (key) => {
    if (!key || runs.area.key === key) return
    const centre = area.analysed
    const places = (area.segments?.features ?? []).filter((f) => f.properties.photos?.length)
      .map((f) => ({ id: f.properties.id, photos: f.properties.photos, d: haversine(centre, midpoint(f.geometry)) }))
      .sort((a, b) => a.d - b.d)
    start('area', key, places)
  }, { immediate: true })

  // Routes: only the streets on the two ways, along A from the start, then the rest of B.
  const routeIds = computed(() => {
    const ids = routes.routes.flatMap((r) => r.parts.map((p) => p.segment_id).filter(Boolean))
    return [...new Set(ids)]
  })
  const routeKey = computed(() => (routeIds.value.length ? routeIds.value.join('|') : null))
  watch(routeKey, (key) => {
    if (runs.routes.key === key) return
    if (!key) {
      clear('routes')
      return
    }
    const places = routeIds.value.map((id) => routes.segments.get(id)).filter((f) => f?.properties.photos?.length)
      .map((f) => ({ id: f.properties.id, photos: f.properties.photos }))
    start('routes', key, places)
  }, { immediate: true })

  // The map colours streets from a state on the segment, as for Thermal.
  const stateOf = (f) => {
    const place = placeFor(f.properties.photos)
    return place.status === 'rated' ? place.level : null
  }
  watch(() => new Map((area.segments?.features ?? []).map((f) => [f.properties.id, stateOf(f)])), (states) => area.applySenses(states))
  watch(() => new Map([...routes.segments.values()].map((f) => [f.properties.id, stateOf(f)])), (states) => routes.applySenses(states))

  return { ratings, runs, ratingOf, placeFor, areaProgress, routesProgress, retry: rate, continueRating: rate, stopHere }
})
