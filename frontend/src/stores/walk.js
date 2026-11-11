import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'
import config from '../config.js'
import { loadBuildings, loadMapillaryAlong } from '../lib/api.js'
import { showsWalkPhotos } from '../lib/photos.js'
import { stretchFeature, stretchesOf, stretchMiddle } from '../lib/routes.js'
import { stretchBearing } from '../lib/walk.js'
import { useRoutesStore } from './routes.js'

/**
 * Walk along a route (boards Routes 5, P6): one of the two ways, stretch by stretch, at eye level with the buildings.
 * The layer, season and time are fixed when the walk starts (Elena, 2026-11-11): exit the walk to change them. The walked
 * route is a copy. One photo per stretch, the one that faces along the walk (Mapillary, from the backend), and the one rated
 * in Senses; the 3D camera stands where it was taken and looks its way, so the photo reads as a window onto the street. Without a
 * photo (or with photos not shown, lib/photos.js) the camera stands at the start of the stretch, looking along it. It opens
 * playing (paused with reduced motion); Play goes on every config.walk.stretchMs. Ratings and thermal values come from the routes store, never a new call.
 */
export const useWalkStore = defineStore('walk', () => {
  const routes = useRoutesStore()
  const active = ref(false)
  const route = shallowRef(null)
  const index = ref(0)
  const playing = ref(false)
  /** Fixed for the walk: the layer and the window it started with. */
  const layer = ref(config.layerDefault)
  const info = shallowRef(null)
  /** The last step was done with the keyboard, so focus can follow (Exit walk goes back to its button). */
  const byKeyboard = ref(false)
  /** 'idle' | 'loading' | 'ready' | 'error'. Without buildings the walk goes on flat. */
  const buildingsState = ref('idle')
  const buildings = shallowRef(null)
  const buildingsError = ref('')
  const buildingsSource = ref('')
  /** Mapillary (lib/photos.js 'mapillary'): one photo or null per stretch key; 'idle' | 'loading' | 'ready' | 'error'. */
  const mapillary = shallowRef({})
  const mapillaryState = ref('idle')
  let timer = null
  let controller = null
  let photoController = null

  const stretches = computed(() => (route.value ? stretchesOf(route.value, routes.segments, layer.value) : []))
  const current = computed(() => stretches.value[index.value] ?? null)
  const feature = computed(() => (current.value ? stretchFeature(current.value, routes.segments) : null))
  /** The stretch's own photo, facing along the walk, whether or not photos are shown: the one rated in Senses. */
  const stretchPhoto = computed(() => (current.value ? mapillary.value[current.value.key] ?? null : null))
  /** The photo shown, or null (none along the stretch, or photos not shown). */
  const photo = computed(() => (showsWalkPhotos() ? stretchPhoto.value : null))
  /** What the photo window shows: 'shown' | 'loading' | 'error' | 'none-here' (no photo for this stretch) | 'off'
   *  (photos not shown: the 3D street alone). */
  const photoState = computed(() => {
    if (!current.value) return 'off'
    if (photo.value) return 'shown'
    if (!showsWalkPhotos()) return 'off'
    return { loading: 'loading', error: 'error' }[mapillaryState.value] ?? 'none-here'
  })
  /** Where the eyes are and which way they look: at the photo shown, its way; else the start of the stretch, along it. */
  const view = computed(() => {
    const s = current.value
    if (!s) return null
    if (photo.value) return { lon: photo.value.lon, lat: photo.value.lat, bearing: photo.value.heading }
    const [lon, lat] = s.coordinates[0]
    return { lon, lat, bearing: stretchBearing(s) }
  })
  /** The ring on the 3D view: the photo's spot, or the stretch's middle. */
  const point = computed(() => {
    if (!current.value) return null
    return photo.value ? { lat: photo.value.lat, lon: photo.value.lon } : stretchMiddle(current.value)
  })
  /** The walked route with its stretches on the walk's layer, in the shape the map's route layers draw. */
  const shown = computed(() => (route.value ? { ...route.value, stretches: stretches.value } : null))
  const atEnd = computed(() => index.value >= stretches.value.length - 1)

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

  async function fetchMapillary() {
    photoController?.abort()
    mapillary.value = {}
    photoController = new AbortController()
    const { signal } = photoController
    mapillaryState.value = 'loading'
    try {
      mapillary.value = await loadMapillaryAlong(stretches.value.map((s) => ({ key: s.key, coordinates: s.coordinates })), signal)
      mapillaryState.value = 'ready'
    } catch {
      if (signal.aborted) return
      mapillaryState.value = 'error'
    }
  }

  function start(id, keyboard = false) {
    const r = routes.routes.find((x) => x.id === id)
    if (!r) return
    route.value = r
    index.value = 0
    playing.value = false
    // Overall is not built for routes, so a route on it is walked on the default layer.
    layer.value = routes.layer === 'overall' ? config.layerDefault : routes.layer
    info.value = routes.info
    byKeyboard.value = keyboard
    routes.selected = null
    routes.hoverKey = null
    routes.hoverRoute = null
    active.value = true
    fetchBuildings()
    fetchMapillary()
    // Play is the default (Elena, 2026-11-11); with reduced motion it opens paused and Next / Previous jump.
    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) play()
  }

  /** Back to the route card, with the same routes. */
  function exit(keyboard = false) {
    pause()
    controller?.abort()
    photoController?.abort()
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
      schedule()
    }, config.walk.stretchMs)
  }

  function go(i, keyboard = false) {
    if (i < 0 || i >= stretches.value.length) return
    byKeyboard.value = keyboard
    index.value = i
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
    active, route, index, playing, layer, info, byKeyboard, stretches, current, feature, stretchPhoto, photo, photoState, view,
    point, shown, atEnd, mapillary, mapillaryState, buildingsState, buildings, buildingsError, buildingsSource,
    fetchBuildings, start, exit, go, step, play, pause, toggle,
  }
})
