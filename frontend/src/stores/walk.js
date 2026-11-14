import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'
import config from '../config.js'
import { showsWalkPhotos } from '../lib/photos.js'
import { stretchFeature, stretchesOf, stretchMiddle } from '../lib/routes.js'
import { photoKey } from '../lib/senses.js'
import { ratedPhotoOf } from '../lib/walk.js'
import { useRoutesStore } from './routes.js'
import { useSensesStore } from './senses.js'

/**
 * Walk along a route: one of the two ways, stretch by stretch, as a slideshow of photos (Elena, 2026-11-14: no 3D street,
 * no turning camera; components/WalkView.vue). The layer, season and time are fixed when the walk starts (Elena,
 * 2026-11-11): exit the walk to change them. The walked route is a copy. Each stretch shows its street's photo and rating,
 * the same as the Routes view and the stretch card, so nothing is looked up or rated again and nothing changes colour
 * (Elena, 2026-11-14: stable and the same as the preview; a rating never without its photo). It opens playing (paused
 * with reduced motion); Play goes on every config.walk.stretchMs. Ratings and thermal values come from the routes store,
 * never a new call.
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
  /** Photo keys whose image could not be loaded: shown as no photo, so with no rating either. */
  const unloaded = shallowRef(new Set())
  let timer = null

  const ratedOf = (s) => ratedPhotoOf(s, routes.segments, useSensesStore().placeFor)
  /** The stretches as the Routes view colours them; on Senses one whose photo did not load is unlit (no photo, no rating). */
  const stretches = computed(() => {
    const base = route.value ? stretchesOf(route.value, routes.segments, layer.value) : []
    if (layer.value !== 'senses' || !unloaded.value.size) return base
    return base.map((s) => {
      const rated = ratedOf(s)
      return rated && unloaded.value.has(photoKey(rated.photo)) ? { ...s, state: 'none' } : s
    })
  })
  const current = computed(() => stretches.value[index.value] ?? null)
  const feature = computed(() => (current.value ? stretchFeature(current.value, routes.segments) : null))
  /** The current stretch's photo and rating, whether or not photos are shown: { photo, photos, place }, or null with none. */
  const ratedPhoto = computed(() => (current.value ? ratedOf(current.value) : null))
  const isUnloaded = computed(() => !!ratedPhoto.value && unloaded.value.has(photoKey(ratedPhoto.value.photo)))
  /** The photo shown, or null (none for the stretch, not loaded, or photos not shown). */
  const photo = computed(() => (showsWalkPhotos() && ratedPhoto.value && !isUnloaded.value ? ratedPhoto.value.photo : null))
  /** What the photo square shows: 'shown' | 'unloaded' (its image did not load) | 'none-here' (no photo for this stretch) |
   *  'off' (photos not shown). */
  const photoState = computed(() => {
    if (!current.value) return 'off'
    if (photo.value) return 'shown'
    if (!showsWalkPhotos()) return 'off'
    return isUnloaded.value ? 'unloaded' : 'none-here'
  })
  /** The shown photo's image did not load: from now on it counts as no photo, with no rating. */
  function photoFailed(p) {
    if (!p || unloaded.value.has(photoKey(p))) return
    unloaded.value = new Set([...unloaded.value, photoKey(p)])
  }
  /** "Where you are" on the mini map: the photo's spot, or the stretch's middle. */
  const point = computed(() => {
    if (!current.value) return null
    return photo.value ? { lat: photo.value.lat, lon: photo.value.lon } : stretchMiddle(current.value)
  })
  /** The walked route with its stretches on the walk's layer, in the shape the map's route layers draw. */
  const shown = computed(() => (route.value ? { ...route.value, stretches: stretches.value } : null))
  const atEnd = computed(() => index.value >= stretches.value.length - 1)

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
    // Play is the default (Elena, 2026-11-11); with reduced motion it opens paused and Next / Previous jump.
    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) play()
  }

  /** Back to the route card, with the same routes. */
  function exit(keyboard = false) {
    pause()
    const id = route.value?.id
    active.value = false
    route.value = null
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
    active, route, index, playing, layer, info, byKeyboard, stretches, current, feature, ratedPhoto, photo, photoState, photoFailed,
    point, shown, atEnd, start, exit, go, step, play, pause, toggle,
  }
})
