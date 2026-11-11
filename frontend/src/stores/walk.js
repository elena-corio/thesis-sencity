import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'
import config from '../config.js'
import { loadBuildings } from '../lib/api.js'
import { stretchFeature, stretchesOf, stretchMiddle } from '../lib/routes.js'
import { useRoutesStore } from './routes.js'

/**
 * Walk along a route (board Routes 5, phone P6): one of the two ways, stretch by stretch, on a tilted map with
 * buildings. The walked route is a copy, so it stays the same while the routes are asked again for a new season
 * or time (Elena, 2026-11-11: inside the walk the controls only recolour it). Layer recolours it from what is
 * loaded; Overall is not built for routes, so the walk opens on the routes' own layer. It opens paused; Play goes
 * on every config.walk.stretchMs. Ratings, photos and thermal values come from the routes store, never a new call.
 */
export const useWalkStore = defineStore('walk', () => {
  const routes = useRoutesStore()
  const active = ref(false)
  const route = shallowRef(null)
  const index = ref(0)
  const photoIndex = ref(0)
  const playing = ref(false)
  const layer = ref(config.layerDefault)
  /** The last step was done with the keyboard, so focus can follow (Exit walk goes back to its button). */
  const byKeyboard = ref(false)
  /** 'idle' | 'loading' | 'ready' | 'error'. Without buildings the walk goes on flat. */
  const buildingsState = ref('idle')
  const buildings = shallowRef(null)
  const buildingsError = ref('')
  const buildingsSource = ref('')
  let timer = null
  let controller = null

  const stretches = computed(() => (route.value ? stretchesOf(route.value, routes.segments, layer.value) : []))
  const current = computed(() => stretches.value[index.value] ?? null)
  const feature = computed(() => (current.value ? stretchFeature(current.value, routes.segments) : null))
  const photos = computed(() => feature.value?.properties.photos ?? [])
  const photo = computed(() => photos.value[photoIndex.value] ?? null)
  /** The photo point shown, or the stretch's middle when it has no photo: the ring sits there. */
  const point = computed(() => {
    if (!current.value) return null
    return photo.value ? { lat: photo.value.lat, lon: photo.value.lon } : stretchMiddle(current.value)
  })
  /** The walked route with its stretches on the walk's layer, in the shape the map's route layers draw. */
  const shown = computed(() => (route.value ? { ...route.value, stretches: stretches.value } : null))
  const atEnd = computed(() => index.value >= stretches.value.length - 1)

  // Season and time, in the shape SeasonTime reads. They exist only when the routes were found on Thermal.
  const hasThermal = computed(() => routes.info != null)
  const thermalWindow = computed(() => routes.thermalWindow)
  const windowActive = computed(() => hasThermal.value && routes.windowActive)
  const load = computed(() => routes.load)

  function setThermalWindow(change) {
    if (windowActive.value) routes.setThermalWindow(change)
  }
  /** Recolour only: no new search (Elena, 2026-11-11). */
  function setLayer(id) {
    layer.value = id
  }

  async function fetchBuildings() {
    controller?.abort()
    controller = new AbortController()
    const { signal } = controller
    buildingsState.value = 'loading'
    buildings.value = null
    buildingsSource.value = ''
    buildingsError.value = ''
    const line = route.value.parts.flatMap((p, i) => (i ? p.coordinates.slice(1) : p.coordinates))
    try {
      const fc = await loadBuildings(line, signal)
      buildings.value = fc
      buildingsSource.value = fc.source
      buildingsState.value = 'ready'
    } catch (err) {
      if (signal.aborted) return
      buildingsError.value = err.status === 503 && err.message ? err.message : 'Buildings could not be loaded here.'
      buildingsState.value = 'error'
    }
  }

  function start(id, keyboard = false) {
    const r = routes.routes.find((x) => x.id === id)
    if (!r) return
    route.value = r
    index.value = 0
    photoIndex.value = 0
    playing.value = false
    layer.value = routes.layer === 'overall' ? config.layerDefault : routes.layer
    byKeyboard.value = keyboard
    routes.selected = null
    routes.hoverKey = null
    routes.hoverRoute = null
    active.value = true
    fetchBuildings()
  }

  /** Back to the route card, with the same routes. */
  function exit(keyboard = false) {
    pause()
    controller?.abort()
    const id = route.value?.id
    active.value = false
    route.value = null
    buildings.value = null
    buildingsState.value = 'idle'
    routes.byKeyboard = keyboard
    if (keyboard && id) {
      // Focus goes back to the button that opened the walk.
      requestAnimationFrame(() => document.querySelector(`[data-walk="${id}"]`)?.focus())
    }
  }

  function schedule() {
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (atEnd.value) {
        playing.value = false
        return
      }
      index.value++
      photoIndex.value = 0
      schedule()
    }, config.walk.stretchMs)
  }

  function go(i, keyboard = false) {
    if (i < 0 || i >= stretches.value.length) return
    byKeyboard.value = keyboard
    index.value = i
    photoIndex.value = 0
    if (playing.value) schedule()
  }
  const step = (d, keyboard = false) => go(index.value + d, keyboard)

  function play() {
    if (atEnd.value) go(0)
    playing.value = true
    schedule()
  }
  function pause() {
    clearTimeout(timer)
    playing.value = false
  }
  const toggle = () => (playing.value ? pause() : play())

  // The routes were cleared (a new start or end): there is nothing left to walk.
  watch(() => routes.hasResult, (has) => { if (!has && active.value) exit() })

  return {
    active, route, index, photoIndex, playing, layer, byKeyboard, stretches, current, feature, photos, photo, point,
    shown, atEnd, hasThermal, thermalWindow, windowActive, load, buildingsState, buildings, buildingsError,
    buildingsSource, setThermalWindow, setLayer, fetchBuildings, start, exit, go, step, play, pause, toggle,
  }
})
