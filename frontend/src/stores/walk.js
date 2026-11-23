import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'
import config from '../config.js'
import { showsWalkPhotos } from '../lib/photos.js'
import { stretchFeature, stretchesOf, stretchMiddle } from '../lib/routes.js'
import { photoKey } from '../lib/senses.js'
import { photosInOrder, ratedPhotoOf } from '../lib/walk.js'
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
 *
 * The enlarged photo is this same view (Elena, 2026-11-14): from a stretch of a route it opens paused at that stretch
 * (Play goes on from there; Back returns to the stretch card, at the stretch you stopped on); from a place of an area it
 * opens in 'place' mode, one stretch with no Play, arrows or bar (Back returns to the place card).
 */
export const useWalkStore = defineStore('walk', () => {
  const routes = useRoutesStore()
  const active = ref(false)
  const route = shallowRef(null)
  const index = ref(0)
  const playing = ref(false)
  /** Fixed for the walk: the layer and the window it started with. */
  const layer = ref(config.walkLayerDefault)
  const info = shallowRef(null)
  /** The last step was done with the keyboard, so focus can follow (Exit walk goes back to its button). */
  const byKeyboard = ref(false)
  /** 'route' (a walk) or 'place' (the enlarged photo of a place of an area: one stretch). */
  const mode = ref('route')
  /** Where Back goes: 'comparison' (the route card), 'stretch' (the stretch card, at the current stretch) or 'place'. */
  const back = ref('comparison')
  /** The place shown in 'place' mode, with its own geometry (a street or a park). */
  const place = shallowRef(null)
  /** The segments the stretches come from: the routes', or the one place. */
  const byId = computed(() => (mode.value === 'place' && place.value ? new Map([[place.value.properties.id, place.value]]) : routes.segments))
  /** Photo keys whose image could not be loaded: shown as no photo, so with no rating either. */
  const unloaded = shallowRef(new Set())
  let timer = null

  const ratedOf = (s) => ratedPhotoOf(s, byId.value, useSensesStore().placeFor)
  /** The stretches as the Routes view colours them; on Senses one whose photo did not load is unlit (no photo, no rating). */
  const stretches = computed(() => {
    const base = route.value ? stretchesOf(route.value, byId.value, layer.value) : []
    if (layer.value !== 'senses' || !unloaded.value.size) return base
    return base.map((s) => {
      const rated = ratedOf(s)
      return rated && unloaded.value.has(photoKey(rated.photo)) ? { ...s, state: 'none' } : s
    })
  })
  const current = computed(() => stretches.value[index.value] ?? null)
  const feature = computed(() => {
    if (!current.value) return null
    return mode.value === 'place' ? place.value : stretchFeature(current.value, byId.value)
  })
  /** The current stretch's photo and rating, whether or not photos are shown: { photo, photos, place }, or null with none. */
  const ratedPhoto = computed(() => (current.value ? ratedOf(current.value) : null))
  /** The stretch's photos along the part of the street it walks, in the order they are walked past (Elena, 2026-11-16:
   *  with Street View a walked street has one every 10 to 20 m, each its own step; with Mapillary one per street; none
   *  behind the start or past the end, which made the walk go back and forth). A place keeps its own order. */
  const photos = computed(() => {
    const list = ratedPhoto.value?.photos ?? []
    if (mode.value === 'place' || !list.length) return list
    const street = byId.value.get(current.value.segmentId)?.geometry
    return photosInOrder(list, current.value.coordinates, street?.type === 'LineString' ? street.coordinates : null)
  })
  /** Which of the stretch's photos is shown. */
  const sub = ref(0)
  const framePhoto = computed(() => photos.value[Math.min(sub.value, photos.value.length - 1)] ?? null)
  const isUnloaded = computed(() => !!framePhoto.value && unloaded.value.has(photoKey(framePhoto.value)))
  /** The photo shown, or null (none for the stretch, not loaded, or photos not shown). */
  const photo = computed(() => (showsWalkPhotos() && framePhoto.value && !isUnloaded.value ? framePhoto.value : null))
  /** The step of the photo whose rating the card shows (the closest to the stretch's rating), as the card opens on it. */
  const repStep = () => {
    const rep = ratedPhoto.value?.photo
    return Math.max(0, photos.value.findIndex((p) => p === rep))
  }
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
  const atEnd = computed(() => index.value >= stretches.value.length - 1 && sub.value >= photos.value.length - 1)
  const atStart = computed(() => index.value === 0 && sub.value === 0)
  /** What the arrows step to: another photo of this stretch, or the next stretch. */
  const nextIs = computed(() => (sub.value < photos.value.length - 1 ? 'photo' : 'stretch'))
  const prevIs = computed(() => (sub.value > 0 ? 'photo' : 'stretch'))

  /** Overall is not built for the walk, so it is shown on the default layer. */
  const walkLayer = (l) => (l === 'overall' ? config.walkLayerDefault : l)

  /**
   * Walk a route. From "Walk route" it plays from the first stretch (Elena, 2026-11-11; paused with reduced motion);
   * from the enlarged photo of a stretch it opens paused there, and Back returns to that card (Elena, 2026-11-14).
   * @param {string} id the route
   * @param {boolean} keyboard
   * @param {{index?: number, autoplay?: boolean, backTo?: 'comparison'|'stretch'}} [options]
   */
  function start(id, keyboard = false, { index: at = 0, autoplay = true, backTo = 'comparison' } = {}) {
    const r = routes.routes.find((x) => x.id === id)
    if (!r) return
    mode.value = 'route'
    place.value = null
    back.value = backTo
    route.value = r
    index.value = at
    playing.value = false
    layer.value = walkLayer(routes.layer)
    info.value = routes.info
    // A walk starts at the stretch's first photo; the enlarged photo of a stretch on the photo its card showed.
    sub.value = autoplay ? 0 : repStep()
    byKeyboard.value = keyboard
    routes.selected = null
    routes.hoverKey = null
    routes.hoverRoute = null
    active.value = true
    if (autoplay && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) play()
  }

  /** The enlarged photo of a place of an area: the same view, one stretch, nothing to walk (Elena, 2026-11-14). */
  /** `shown`: the photo the card had on screen (Elena, 2026-11-22: Enlarge opens that one, not the card's first). */
  function openPlace(feature, mapLayer, window_, keyboard = false, shown = null) {
    const g = feature.geometry
    const coordinates = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates
    pause()
    mode.value = 'place'
    back.value = 'place'
    place.value = feature
    route.value = { id: 'place', minutes: 0, length_m: feature.properties.length_m ?? 0,
      parts: [{ segment_id: feature.properties.id, length_m: feature.properties.length_m ?? 0, coordinates }] }
    index.value = 0
    layer.value = walkLayer(mapLayer)
    info.value = window_
    // The photo the card showed; the arrows go through the place's other photos.
    const at = shown ? photos.value.findIndex((p) => p.id === shown.id && p.heading === shown.heading) : -1
    sub.value = at >= 0 ? at : repStep()
    byKeyboard.value = keyboard
    active.value = true
  }

  /** Back where the view was opened from: the route card, the stretch card (at the stretch you stopped on) or the
   *  place card. Focus goes back to the button that opened it. */
  function exit(keyboard = false) {
    pause()
    const id = route.value?.id
    const key = current.value?.key
    const to = back.value
    active.value = false
    route.value = null
    place.value = null
    mode.value = 'route'
    routes.byKeyboard = keyboard
    if (to === 'stretch' && key) routes.selectStretch(key, undefined, keyboard)
    if (!keyboard) return
    const target = to === 'comparison' ? `[data-walk="${id}"]` : '[data-panel="place-card"] .enlarge'
    requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector(target)?.focus()))
  }

  /** A stretch takes config.walk.stretchMs whatever its number of photos: they share it, each at least photoMinMs. */
  const photoMs = () => Math.max(config.walk.photoMinMs, config.walk.stretchMs / Math.max(1, photos.value.length))

  function schedule() {
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (atEnd.value) {
        playing.value = false
        return
      }
      advance(1)
      schedule()
    }, photoMs())
  }

  /** One photo on or back: within the stretch, else to the next stretch's first photo or the previous one's last. */
  function advance(d) {
    const s = sub.value + d
    if (s >= 0 && s < photos.value.length) {
      sub.value = s
      return true
    }
    const i = index.value + d
    if (i < 0 || i >= stretches.value.length) return false
    index.value = i
    sub.value = d > 0 ? 0 : Math.max(0, photos.value.length - 1)
    return true
  }

  function go(i, keyboard = false) {
    if (i < 0 || i >= stretches.value.length) return
    byKeyboard.value = keyboard
    index.value = i
    sub.value = 0
    if (playing.value) schedule()
  }
  function step(d, keyboard = false) {
    byKeyboard.value = keyboard
    if (advance(d) && playing.value) schedule()
  }

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
  watch(() => routes.hasResult, (has) => { if (!has && active.value && mode.value === 'route') exit() })

  return {
    active, route, index, sub, photos, playing, layer, info, byKeyboard, mode, back, stretches, current, feature, ratedPhoto, photo,
    photoState, photoFailed, point, shown, atEnd, atStart, nextIs, prevIs, start, openPlace, exit, go, step, play, pause, toggle,
  }
})
