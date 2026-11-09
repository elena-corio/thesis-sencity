<script setup>
// The map, the two-click area selection (brief §6 "Study area", boards Flow 1, 1b, 1c) and the
// street segments of the analysed area: hover, click to select, selection ring (brief §4).
import { Map as MapLibreMap } from 'maplibre-gl'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import config from '../config.js'
import { useMedia } from '../composables.js'
import { bearing, bounds, circlePolygon, destination, midpoint } from '../lib/geo.js'
import { darkenBaseMap } from '../map/base.js'
import { addAreaLayers, updateAreaLayers } from '../map/layers.js'
import { addRouteLayers, ROUTE_HIT_LAYER, styleRoutes, updateRouteLayers } from '../map/routes.js'
import { addMarkerLayers, setMarkers } from '../map/markers.js'
import { addSegmentLayers, HIT_LAYER, setSegmentLayer, setSegments, setSegmentState } from '../map/segments.js'
import { typeLabel } from '../lib/place.js'
import { boundsOf, formatLength, stretchFeature } from '../lib/routes.js'
import { useAreaStore } from '../stores/area.js'
import { useRoutesStore } from '../stores/routes.js'
import { useSensesStore } from '../stores/senses.js'
import { useThemeStore } from '../stores/theme.js'
import MarkerPin from './MarkerPin.vue'

const props = defineProps({ routesMode: Boolean })
useSensesStore() // its watchers start the rating
const area = useAreaStore()
const routes = useRoutesStore()
const theme = useThemeStore()
const finePointer = useMedia('(pointer: fine)')
const reducedMotion = useMedia('(prefers-reduced-motion: reduce)')

const container = ref(null)
const map = shallowRef(null)
const frame = ref(0) // bumps on every map move, so screen positions recompute
const pointerPx = ref(null) // last pointer position over the map, or null
const edgeBearing = ref(60) // where the handle sits on the circle (degrees)
const dragging = ref(false)
const touchMode = ref(false) // last radius input was a finger: chip above the finger
let touchMoved = false

const edge = computed(() =>
  area.centre && area.step !== 'centre' ? destination(area.centre, edgeBearing.value, area.radius) : null)

function project(p) {
  frame.value // dependency: recompute after the map moves
  if (!map.value || !p) return null
  const { x, y } = map.value.project([p.lon, p.lat])
  return { x, y }
}
const centrePx = computed(() => project(area.centre))
const edgePx = computed(() => project(edge.value))
const containerSize = computed(() => {
  frame.value
  const el = container.value
  return el ? { w: el.clientWidth, h: el.clientHeight } : { w: 0, h: 0 }
})
const crosshairPx = computed(() => {
  if (props.routesMode || area.step !== 'centre') return null
  return pointerPx.value ?? { x: containerSize.value.w / 2, y: containerSize.value.h / 2 }
})

const showChip = computed(() => !props.routesMode && (area.step === 'radius' || (area.step === 'set' && edgePx.value)))
const areaMarks = computed(() => !props.routesMode)
// Routes: the Start ring and the End pin (boards Routes 1–4).
const startPx = computed(() => (props.routesMode ? project(routes.start) : null))
const endPx = computed(() => (props.routesMode ? project(routes.end) : null))
const picking = computed(() => props.routesMode && routes.step !== 'set')
const chipStyle = computed(() => {
  const p = edgePx.value
  if (!p) return {}
  const { w } = containerSize.value
  if (touchMode.value && area.step === 'radius') {
    return { left: `${p.x}px`, top: `${p.y}px`, transform: 'translate(-50%, calc(-100% - var(--chip-offset-touch)))' }
  }
  const flipX = p.x > w - 180
  const flipY = p.y < 90
  const tx = flipX ? 'calc(-100% - var(--chip-offset))' : 'var(--chip-offset)'
  const ty = flipY ? 'var(--chip-offset)' : 'calc(-100% + var(--chip-offset))'
  return { left: `${p.x}px`, top: `${p.y}px`, transform: `translate(${tx}, ${ty})` }
})

// Screen reader: the chip value, after the radius settles.
const announcement = ref('')
let announceTimer
watch(() => [area.step, area.radius, area.capped], () => {
  clearTimeout(announceTimer)
  if (area.step !== 'radius' && area.step !== 'set') return
  announceTimer = setTimeout(() => {
    announcement.value = area.capped ? `${area.radius} metres, maximum` : `Radius ${area.radius} metres`
  }, 400)
})

function lngLatToPoint(ll) {
  return { lat: ll.lat, lon: ll.lng }
}

function setRadiusTo(point) {
  area.radiusTo(point)
  edgeBearing.value = bearing(area.centre, point)
}

// Pointer input
function onClick(e) {
  const p = lngLatToPoint(e.lngLat)
  if (props.routesMode) {
    // A Start or End field had the focus: this click fills that field (otherwise the next empty one).
    const field = routes.takeField()
    if (field) {
      routes.setPoint(field, p)
    } else if (picking.value) {
      routes.pick(p)
    } else if (routes.hasResult) {
      const key = routeStretchAt(e.point)
      if (key) routes.selectStretch(key, p)
      else routes.back()
    }
    return
  }
  // The Centre field had the focus and a circle exists: this click moves the centre (radius kept).
  if (area.takeField() === 'centre' && area.step !== 'centre' && area.step !== 'radius') {
    area.setCentre(p)
    return
  }
  if (area.step === 'centre') {
    area.placeCentre(p)
    if (finePointer.value) area.radiusTo(p) // the circle grows from the centre with the pointer
    return
  }
  if (area.step === 'radius') {
    if (touchMoved) { touchMoved = false; return }
    setRadiusTo(p)
    area.fix()
    return
  }
  if (area.step === 'analysed' && area.segments) {
    const id = segmentAt(e.point)
    if (id) {
      area.byKeyboard = false
      area.select(id, p)
    } else {
      area.clearSelection()
    }
  }
}

// Segments: hover and selection are feature-states on the segment itself (brief §4).
function segmentAt(point) {
  const m = map.value
  if (!m.getLayer(HIT_LAYER)) return null
  // Streets before parks and squares, so a street crossing a square can be picked.
  const lines = m.queryRenderedFeatures(point, { layers: [HIT_LAYER] })
    .filter((f) => f.geometry.type !== 'Polygon')
  const areas = m.queryRenderedFeatures(point, { layers: [HIT_LAYER, 'sc-seg-hit-area'] })
  return (lines[0] ?? areas[0])?.properties.id ?? null
}

// Routes: a stretch under the pointer, the top one where the two ways share a street.
function routeStretchAt(point) {
  const m = map.value
  if (!m.getLayer(ROUTE_HIT_LAYER)) return null
  return m.queryRenderedFeatures(point, { layers: [ROUTE_HIT_LAYER] })[0]?.properties.key ?? null
}
function routeLayerState() {
  return {
    routes: routes.shown,
    visible: routes.visible,
    selected: routes.selected?.key ?? null,
    hoverKey: routes.hoverKey,
    hoverRoute: routes.hoverRoute,
  }
}
function syncRoutes() {
  if (!map.value) return
  updateRouteLayers(map.value, props.routesMode ? routeLayerState() : { ...routeLayerState(), routes: [] })
}
watch(() => routes.shown, syncRoutes)
watch(() => [routes.visible, routes.selected, routes.hoverKey, routes.hoverRoute], () => {
  if (map.value) styleRoutes(map.value, routeLayerState())
})
watch(() => routes.selected, (s) => {
  if (!s) return
  restartPulse()
  const stretch = routes.selectedStretch
  if (stretch) nextTick(() => requestAnimationFrame(() => revealBounds(boundsOf(stretch.coordinates))))
})

function routePoints() {
  const pins = [routes.start, routes.end].filter(Boolean).map((p) => [p.lon, p.lat])
  return [...pins, ...routes.allStretches.flatMap((s) => s.coordinates)]
}
/** The whole way (or the pins) in the space the panels leave free. */
function revealRoutes() {
  const pts = routePoints()
  if (pts.length && map.value) {
    map.value.fitBounds(boundsOf(pts), { padding: freePadding(), maxZoom: map.value.getZoom(), animate: !reducedMotion.value })
  }
}
watch(() => routes.routes, (r) => {
  if (props.routesMode && r.length) nextTick(() => requestAnimationFrame(revealRoutes))
})
watch(() => routes.step, (s) => {
  if (props.routesMode && s === 'set') nextTick(() => requestAnimationFrame(revealRoutes))
})

// Switching between Area and Routes: each shows only its own things on the one map.
watch(() => props.routesMode, (on) => {
  hoverId.value = null
  routes.hoverKey = null
  stopPulse()
  if (map.value) {
    syncLayers()
    setSegments(map.value, on ? null : area.visibleSegments)
    setMarkers(map.value, shownMarkers.value)
    syncRoutes()
    map.value.getCanvas().style.cursor = ''
    map.value.getCanvas().setAttribute('aria-label', canvasLabel())
  }
})

const hoverId = ref(null)
watch(hoverId, (id, old) => {
  if (!map.value) return
  setSegmentState(map.value, old, { hover: false })
  setSegmentState(map.value, id, { hover: true })
})
watch(() => area.selectedId, (id, old) => {
  if (!map.value) return
  setSegmentState(map.value, old, { selected: false })
  setSegmentState(map.value, id, { selected: true })
  if (id) {
    const zoom = area.zoomToSelected
    restartPulse()
    nextTick(() => requestAnimationFrame(() => revealSelected(id, zoom)))
  }
})
watch(() => area.mapLayer, (layer) => {
  if (map.value) setSegmentLayer(map.value, layer)
})
watch(() => area.visibleSegments, (fc) => {
  if (map.value && !props.routesMode) setSegments(map.value, fc)
  if (!fc) hoverId.value = null
})

const hoverPx = ref(null) // pointer position over a street, for the name label
const routeHoverPx = ref(null)
function onSegmentHover(e) {
  if (props.routesMode) {
    hoverId.value = null
    const key = routes.hasResult ? routeStretchAt(e.point) : null
    routes.hoverKey = key
    routeHoverPx.value = key ? { x: e.point.x, y: e.point.y } : null
    map.value.getCanvas().style.cursor = key ? 'pointer' : ''
    return
  }
  if (area.step !== 'analysed' || !area.segments) {
    hoverId.value = null
    return
  }
  hoverId.value = segmentAt(e.point)
  hoverPx.value = hoverId.value ? { x: e.point.x, y: e.point.y } : null
  map.value.getCanvas().style.cursor = hoverId.value ? 'pointer' : ''
}

// Name label: the full street name and type, beside the pointer (or at the keyboard-focused
// street), in the tooltip style of the Profile board. Mouse and keyboard only, not touch.
const tooltip = computed(() => {
  if (props.routesMode) {
    const stretch = routes.allStretches.find((s) => s.key === routes.hoverKey)
    if (!stretch || !routeHoverPx.value || !finePointer.value) return null
    return {
      x: routeHoverPx.value.x,
      y: routeHoverPx.value.y,
      name: stretchFeature(stretch, routes.segments).properties.name,
      type: formatLength(stretch.length_m),
    }
  }
  const id = focusedSegId.value ?? hoverId.value
  const px = focusedSegId.value ? focusRingPx.value : hoverPx.value
  if (!id || !px || (!focusedSegId.value && !finePointer.value)) return null
  const f = area.segments?.features.find((s) => s.properties.id === id)
  if (!f) return null
  return { x: px.x, y: px.y, name: f.properties.name, type: typeLabel(f.properties, f.geometry.type) }
})

// Marked places (suggestions, later chat results): highlighted on the map with a numbered pin
// beside each. Hidden in Routes and while collapsed (another place was selected).
const shownMarkers = computed(() =>
  (props.routesMode || area.step !== 'analysed' || area.markersCollapsed ? [] : area.markers))
const markerWord = computed(() => (area.markerKind === 'chat' ? 'Result' : 'Suggestion'))
const pins = computed(() => shownMarkers.value
  .filter((m) => m.f.properties.id !== area.selectedId)
  .map((m) => ({ m, px: project(m.mid) }))
  .filter((p) => p.px))
watch(shownMarkers, (ms) => { if (map.value) setMarkers(map.value, ms) })

// Selection ring at the clicked point, with a soft pulse that stops after a few seconds or
// on interaction; no pulse with reduced motion (brief §4).
const ringPx = computed(() => {
  if (props.routesMode) return routes.selected ? project(routes.selected.point) : null
  return area.selectedId ? project(area.selectedPoint) : null
})

const pulsing = ref(false)
let pulseTimer
function restartPulse() {
  clearTimeout(pulseTimer)
  pulsing.value = !reducedMotion.value
  pulseTimer = setTimeout(() => { pulsing.value = false }, 6000)
}
function stopPulse() {
  clearTimeout(pulseTimer)
  pulsing.value = false
}

// Keyboard: segments in reading order (top to bottom, then left to right), in a hidden list.
const focusedSegId = ref(null)
const keyboardList = computed(() => {
  if (props.routesMode || area.step !== 'analysed' || !area.visibleSegments) return []
  const band = 0.0003 // about 30 m of latitude: one "line" of reading
  return area.visibleSegments.features
    .map((f) => ({ f, mid: midpoint(f.geometry) }))
    .sort((a, b) => Math.round(b.mid.lat / band) - Math.round(a.mid.lat / band) || a.mid.lon - b.mid.lon)
    .map(({ f, mid }) => {
      const p = f.properties
      const n = p.photos?.length ?? 0
      const photos = p.photos == null ? 'photos loading' : n ? `${n} photo${n > 1 ? 's' : ''}` : 'no photo'
      return { id: p.id, mid, label: `${p.name}, ${p.place_type}, ${photos}` }
    })
})
const focusRingPx = computed(() => {
  const item = keyboardList.value.find((s) => s.id === focusedSegId.value)
  return item ? project(item.mid) : null
})
let openerId = null
function onListFocus(id) {
  focusedSegId.value = id
  hoverId.value = id
}
function onListBlur() {
  focusedSegId.value = null
  hoverId.value = null
}
function openFromList(item) {
  openerId = item.id
  area.byKeyboard = true
  area.select(item.id, item.mid)
}
// When the card closes, focus goes back to the street that opened it (brief §3).
watch(() => area.selectedId, (id) => {
  if (id || !openerId) return
  const opener = openerId
  openerId = null
  nextTick(() => container.value?.parentElement.querySelector(`[data-seg="${CSS.escape(opener)}"]`)?.focus())
})

/** A click on the map only pans if needed; a link on the card (zoom) also zooms to the street. */
function revealSelected(id, zoom = false) {
  const f = area.segments?.features.find((s) => s.properties.id === id)
  if (!f || !map.value) return
  if (!zoom) {
    revealBounds(bounds(f.geometry))
    return
  }
  const m = map.value
  m.fitBounds(bounds(f.geometry), {
    padding: freePadding(), maxZoom: Math.max(m.getZoom(), config.nearby.zoom), animate: !reducedMotion.value,
  })
}

function onMouseMove(e) {
  touchMode.value = false
  pointerPx.value = { x: e.point.x, y: e.point.y }
  if (!props.routesMode && area.step === 'radius') setRadiusTo(lngLatToPoint(e.lngLat))
}

function onMouseOut() {
  if (area.step === 'centre') pointerPx.value = null
}

function onContextMenu(e) {
  e.originalEvent.preventDefault()
  if (props.routesMode) return
  if (area.step === 'radius' || area.step === 'set') area.reset()
}

// Step 2: press and drag sets the radius live; releasing fixes it (phone: "drag or tap a second
// point"). Decided per gesture from the pointer type, not from the device, so it also works in a
// desktop browser's phone preview. Listeners run in the capture phase, before the map's own panning.
let sizing = null // { id, x, y } while a finger, pen or mouse is down in step 2
const MOVE_PX = 6 // below this, the gesture is a tap or click (handled by onClick)

function pointInMap(e) {
  const rect = container.value.getBoundingClientRect()
  return lngLatToPoint(map.value.unproject([e.clientX - rect.left, e.clientY - rect.top]))
}
function onSizeDown(e) {
  touchMoved = false
  if (props.routesMode || area.step !== 'radius' || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return
  sizing = { id: e.pointerId, x: e.clientX, y: e.clientY }
  touchMode.value = e.pointerType !== 'mouse'
  map.value.dragPan.disable()
}
function onSizeMove(e) {
  if (!sizing || e.pointerId !== sizing.id) return
  if (!touchMoved && Math.hypot(e.clientX - sizing.x, e.clientY - sizing.y) < MOVE_PX) return
  touchMoved = true
  setRadiusTo(pointInMap(e))
}
function onSizeUp(e) {
  if (!sizing || e.pointerId !== sizing.id) return
  sizing = null
  map.value.dragPan.enable()
  if (touchMoved && area.step === 'radius') {
    setRadiusTo(pointInMap(e))
    area.fix()
  }
}

// Edge handle (Flow 1c): drag to adjust, same limits.
function startDrag(e) {
  if (area.step !== 'set') return
  e.preventDefault()
  dragging.value = true
  touchMode.value = e.pointerType === 'touch'
  e.target.setPointerCapture(e.pointerId)
  map.value.dragPan.disable()
}
function moveDrag(e) {
  if (!dragging.value) return
  const rect = container.value.getBoundingClientRect()
  setRadiusTo(lngLatToPoint(map.value.unproject([e.clientX - rect.left, e.clientY - rect.top])))
}
function endDrag() {
  if (!dragging.value) return
  dragging.value = false
  area.capped = false
  map.value.dragPan.enable()
}

// Keyboard (brief §6): Enter places the centre at the map centre, arrows change the radius
// in 10 m steps, Enter fixes it. Arrow keys pan the map only before the centre is placed.
function onKeyDown(e) {
  if (props.routesMode) {
    // Enter sets the next point at the map centre.
    if (e.key !== 'Enter' || !picking.value) return
    const c = map.value.getCenter()
    routes.pick({ lat: c.lat, lon: c.lng }, null, true)
    e.preventDefault()
    e.stopPropagation()
    return
  }
  if (e.key === 'Enter' && area.step === 'centre') {
    const c = map.value.getCenter()
    area.placeCentre({ lat: c.lat, lon: c.lng }, true)
    edgeBearing.value = 60
  } else if (e.key === 'Enter' && area.step === 'radius') {
    area.fix(true)
  } else if (['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(e.key) &&
             (area.step === 'radius' || area.step === 'set')) {
    area.nudge(e.key === 'ArrowUp' || e.key === 'ArrowRight' ? config.radius.keyboardStep : -config.radius.keyboardStep)
  } else {
    return
  }
  e.preventDefault()
  e.stopPropagation()
}

function onWindowKey(e) {
  if (e.key !== 'Escape' || e.defaultPrevented) return
  if (props.routesMode) {
    // Esc: back to the comparison, or start choosing again. While loading, Cancel does it.
    if (routes.selected) routes.back(true)
    else if (routes.load === 'idle' && routes.start) routes.reset()
    return
  }
  if (area.step === 'radius' || area.step === 'set') {
    area.reset()
    map.value?.getCanvas().focus()
  } else if (area.selectedId) {
    area.clearSelection() // "Back to area" (brief §3: Esc does the same)
  }
}

// Map
function syncLayers() {
  if (!map.value) return
  // In Routes nothing of the area shows ("plain map with only the start and end pins").
  updateAreaLayers(map.value, props.routesMode
    ? { step: 'centre', centre: null, radius: 0, edge: null }
    : { step: area.step, centre: area.centre, radius: area.radius, edge: edge.value })
}

watch(() => [area.step, area.centre, area.radius, edgeBearing.value], syncLayers)

watch(() => theme.resolved, (t) => {
  map.value?.setStyle(config.mapStyles[t], { diff: false })
})


// Once the circle is fixed, the card (or the phone sheet) appears: pan so the whole circle
// stays visible in the space the panels leave free.
const TOP_PANELS = ['search', 'tabs', 'actions', 'hint']
const BOTTOM_PANELS = ['controls', 'tabbar', 'attribution', 'sheet', 'legend']

const MIN_FREE_PX = 80

function freePadding() {
  const W = window.innerWidth
  const H = window.innerHeight
  const gap = 16
  const pad = { top: gap, bottom: gap, left: gap, right: gap }
  let sideBottom = 0 // the lowest edge of the side panels
  for (const el of document.querySelectorAll('[data-panel]')) {
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) continue
    const name = el.dataset.panel
    if (name !== 'legend' && el.parentElement.closest('[data-panel="sheet"]')) continue // a card inside the phone sheet
    const card = ['area-card', 'place-card', 'loading-card', 'route-card'].includes(name)
    const sheet = card && r.width > W * 0.8
    if (TOP_PANELS.includes(name)) pad.top = Math.max(pad.top, r.bottom + gap)
    else if (BOTTOM_PANELS.includes(name) || sheet) pad.bottom = Math.max(pad.bottom, H - r.top + gap)
    else if (name === 'layers') {
      pad.left = Math.max(pad.left, r.right + gap)
      sideBottom = Math.max(sideBottom, r.bottom)
    } else if (card) {
      pad.right = Math.max(pad.right, W - r.left + gap)
      sideBottom = Math.max(sideBottom, r.bottom)
    }
  }
  // No room between the side panels (Routes on a tablet): use the space below them, if there is enough.
  if (pad.left + pad.right > W - 2 * MIN_FREE_PX && H - sideBottom - gap - pad.bottom >= 2 * MIN_FREE_PX) {
    pad.top = sideBottom + gap
    pad.left = gap
    pad.right = gap
  }
  // Leave at least a small window for the circle on very small screens.
  if (pad.top + pad.bottom > H - MIN_FREE_PX) pad.bottom = Math.max(gap, H - MIN_FREE_PX - pad.top)
  if (pad.left + pad.right > W - MIN_FREE_PX) pad.left = gap
  return pad
}

function circleBounds() {
  const ring = circlePolygon(area.centre, area.radius, config.circlePoints).coordinates[0]
  const lons = ring.map((p) => p[0])
  const lats = ring.map((p) => p[1])
  return [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]]
}

function revealCircle() {
  if (!map.value || !area.centre) return
  revealBounds(circleBounds())
}

/** Pan (and zoom out if needed) so these bounds sit in the space the panels leave free. */
function revealBounds([[w, s], [e, n]]) {
  const m = map.value
  const pad = freePadding()
  const a = m.project([w, n])
  const b = m.project([e, s])
  const inside = a.x >= pad.left && a.y >= pad.top &&
    b.x <= window.innerWidth - pad.right && b.y <= window.innerHeight - pad.bottom
  if (inside) return
  m.fitBounds([[w, s], [e, n]], { padding: pad, maxZoom: m.getZoom(), animate: !reducedMotion.value })
}

watch(() => area.step, (step) => {
  if (props.routesMode) return
  if (step === 'set' || step === 'analysed') nextTick(() => requestAnimationFrame(revealCircle))
})

onMounted(() => {
  const m = new MapLibreMap({
    container: container.value,
    style: config.mapStyles[theme.resolved],
    center: [config.start.lon, config.start.lat],
    zoom: config.start.zoom,
    pitch: 0,
    maxPitch: 0,
    dragRotate: false,
    pitchWithRotate: false,
    attributionControl: false, // credits are shown in the attribution panel
  })
  m.touchZoomRotate.disableRotation()
  m.keyboard.disableRotation()
  map.value = m

  m.on('style.load', () => {
    darkenBaseMap(m)
    addAreaLayers(m)
    addSegmentLayers(m, area.mapLayer)
    addMarkerLayers(m)
    addRouteLayers(m)
    syncLayers()
    setSegments(m, props.routesMode ? null : area.visibleSegments)
    setMarkers(m, shownMarkers.value)
    setSegmentState(m, area.selectedId, { selected: true }) // states are lost with the old style
    syncRoutes()
  })
  m.on('move', () => { frame.value++ })
  // Only the person's own pan or zoom stops the pulse; the app's camera moves (going to a nearby
  // street, revealing a selection) carry no originalEvent and keep it.
  m.on('movestart', (e) => { if (e.originalEvent) stopPulse() })
  m.on('mousemove', onSegmentHover)
  m.on('mouseout', () => {
    hoverPx.value = null
    if (!focusedSegId.value) hoverId.value = null
  })
  m.on('resize', () => { frame.value++ })
  m.on('click', onClick)
  m.on('mousemove', onMouseMove)
  m.on('mouseout', onMouseOut)
  m.on('contextmenu', onContextMenu)
  m.once('idle', () => { document.documentElement.dataset.mapReady = 'true' })

  const canvas = m.getCanvas()
  canvas.setAttribute('aria-label', canvasLabel())
  container.value.addEventListener('keydown', onKeyDown, true)
  container.value.addEventListener('pointerdown', onSizeDown, true)
  container.value.addEventListener('pointermove', onSizeMove, true)
  container.value.addEventListener('pointerup', onSizeUp, true)
  container.value.addEventListener('pointercancel', onSizeUp, true)
  window.addEventListener('keydown', onWindowKey)
  window.__sencityMap = m // for the Playwright checks
})

onBeforeUnmount(() => {
  clearTimeout(pulseTimer)
  window.removeEventListener('keydown', onWindowKey)
  map.value?.remove()
})

function canvasLabel() {
  return props.routesMode
    ? 'Map. Press Enter to set the start at the map centre, move the map with the arrow keys, then press Enter to set the end.'
    : 'Map. Press Enter to place the centre of your area at the map centre, then the arrow keys to change the radius and Enter to fix it.'
}

// Controls used by the map buttons
function zoomIn() { map.value?.zoomIn({ animate: !reducedMotion.value }) }
function zoomOut() { map.value?.zoomOut({ animate: !reducedMotion.value }) }
function recentre() {
  const m = map.value
  if (!m) return
  if (props.routesMode) {
    const pts = routePoints()
    if (pts.length) {
      m.fitBounds(boundsOf(pts), { padding: freePadding(), animate: !reducedMotion.value })
      return
    }
  }
  if (!props.routesMode && area.centre && area.step !== 'centre') {
    m.fitBounds(circleBounds(), { padding: freePadding(), animate: !reducedMotion.value })
  } else {
    m.easeTo({ center: [config.start.lon, config.start.lat], zoom: config.start.zoom, animate: !reducedMotion.value })
  }
}
function focusMap() { map.value?.getCanvas().focus() }

/** Map centre, for ranking search results near the current view. */
function getCentre() {
  const c = map.value?.getCenter()
  return c ? { lat: c.lat, lon: c.lng } : null
}

/** Search result: move the map there (the area is still chosen with two clicks). */
function flyToPlace(place) {
  const m = map.value
  if (!m) return
  const animate = !reducedMotion.value
  if (place.bbox) {
    m.fitBounds(place.bbox, { padding: freePadding(), maxZoom: config.search.maxZoom, animate })
  } else {
    m.flyTo({ center: [place.lon, place.lat], zoom: Math.max(m.getZoom(), config.search.placeZoom), animate })
  }
}

/** Keep what is shown in the free space, after the phone sheet has changed height. */
function reveal() {
  if (!map.value) return
  if (props.routesMode) {
    const stretch = routes.selectedStretch
    if (stretch) revealBounds(boundsOf(stretch.coordinates))
    else revealRoutes()
  } else if (area.selectedId) {
    revealSelected(area.selectedId)
  } else if (area.centre && area.step !== 'centre') {
    revealCircle()
  }
}

defineExpose({ zoomIn, zoomOut, recentre, focusMap, getCentre, flyToPlace, reveal })
</script>

<template>
  <div class="map-wrap" @pointermove="moveDrag" @pointerup="endDrag" @pointercancel="endDrag">
    <div ref="container" class="map"
         :class="{ picking: areaMarks && area.step === 'centre' && finePointer, sizing: areaMarks && area.step === 'radius', 'route-pick': picking }" />

    <!-- Step 1: the crosshair follows the pointer (at the map centre for keyboard users). -->
    <div v-if="crosshairPx && finePointer" class="crosshair" aria-hidden="true"
         :style="{ left: `${crosshairPx.x}px`, top: `${crosshairPx.y}px` }">
      <span class="dot" />
    </div>

    <!-- Centre of the area: thin crosshair with a dot (brief §4: the point that picks an area). -->
    <div v-if="areaMarks && area.hasCircle && centrePx" class="crosshair centre" aria-hidden="true"
         :style="{ left: `${centrePx.x}px`, top: `${centrePx.y}px` }">
      <span class="dot" />
    </div>

    <!-- Edge handle: hollow while choosing, filled and draggable once set. -->
    <div v-if="areaMarks && (area.step === 'radius' || area.step === 'set') && edgePx" class="handle"
         :class="{ set: area.step === 'set', dragging }" aria-hidden="true"
         :style="{ left: `${edgePx.x}px`, top: `${edgePx.y}px` }"
         @pointerdown="startDrag" />

    <div v-if="showChip && edgePx" class="radius-chip" :class="{ capped: area.capped, small: area.step === 'set' && !dragging }"
         :style="chipStyle" aria-hidden="true">
      <template v-if="area.capped">
        <strong>{{ area.radius }} m,</strong> <span>maximum</span>
      </template>
      <template v-else>
        <strong>{{ area.radius }} m</strong>
        <span v-if="area.step === 'radius'">max {{ config.radius.max }} m</span>
      </template>
    </div>

    <!-- Routes: Start (a ring) and End (a pin). -->
    <div v-if="startPx" class="route-start" data-testid="route-start" aria-hidden="true"
         :style="{ left: `${startPx.x}px`, top: `${startPx.y}px` }" />
    <svg v-if="endPx" class="route-end" data-testid="route-end" viewBox="0 0 28 38" aria-hidden="true"
         :style="{ left: `${endPx.x}px`, top: `${endPx.y}px` }">
      <path d="M14 1C6.8 1 1 6.8 1 14c0 9.5 13 23 13 23s13-13.5 13-23C27 6.8 21.2 1 14 1z" />
      <circle cx="14" cy="14" r="5" />
    </svg>

    <!-- Numbered pins of the marked places: a 44 px button around the visible badge, centred on the
         middle of its stretch. The selected one gives way to the selection ring. -->
    <button v-for="p in pins" :key="p.m.f.properties.id" type="button" class="marker-btn"
            :data-marker="p.m.n" :aria-label="`${markerWord} ${p.m.n}: ${p.m.f.properties.name}`"
            :aria-pressed="area.selectedId === p.m.f.properties.id"
            :style="{ left: `${p.px.x}px`, top: `${p.px.y}px` }" @click="area.selectMarker(p.m, $event.detail === 0)">
      <MarkerPin :n="p.m.n" :level="p.m.level" />
    </button>

    <!-- Selection ring: what the place card shows (brief §4). -->
    <div v-if="ringPx" class="ring" :class="{ pulsing }" aria-hidden="true"
         :style="{ left: `${ringPx.x}px`, top: `${ringPx.y}px` }">
      <span class="dot" />
    </div>
    <!-- Keyboard focus on a street (from the hidden list): a ring without pulse. -->
    <div v-if="focusRingPx" class="ring focus" aria-hidden="true"
         :style="{ left: `${focusRingPx.x}px`, top: `${focusRingPx.y}px` }" />

    <div v-if="tooltip" class="street-tip" aria-hidden="true"
         :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }">
      <strong>{{ tooltip.name }}</strong> · {{ tooltip.type }}
    </div>

    <div class="visually-hidden" aria-live="polite">{{ announcement }}</div>

    <!-- Streets of the area in reading order, for Tab and Enter (brief §3 keyboard focus). -->
    <ul v-if="keyboardList.length" class="visually-hidden" aria-label="Streets in this area">
      <li v-for="s in keyboardList" :key="s.id">
        <button type="button" :data-seg="s.id" :aria-label="s.label" :aria-pressed="area.selectedId === s.id"
                @focus="onListFocus(s.id)" @blur="onListBlur" @click="openFromList(s)">{{ s.label }}</button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.map-wrap { position: absolute; inset: 0; }

.ring {
  position: absolute;
  width: var(--ring-size);
  height: var(--ring-size);
  border-radius: 50%;
  border: var(--focus-width) solid var(--ring);
  box-shadow: 0 0 var(--space-2) var(--ring);
  transform: translate(-50%, -50%);
  pointer-events: none;
}
.ring .dot {
  position: absolute; left: 50%; top: 50%;
  width: var(--ring-dot); height: var(--ring-dot);
  border-radius: 50%;
  background: var(--ring);
  border: var(--focus-width) solid var(--ring-edge);
  transform: translate(-50%, -50%);
}
/* Soft pulse: a second ring grows to about 2x and fades, every ~2.4 s, ease-out. */
.ring.pulsing::after {
  content: "";
  position: absolute; inset: calc(-1 * var(--focus-width));
  border-radius: 50%;
  border: var(--focus-width) solid var(--ring);
  animation: pulse var(--ring-pulse-s) ease-out infinite;
}
@keyframes pulse {
  from { transform: scale(1); opacity: 0.5; }
  to { transform: scale(2); opacity: 0; }
}
.ring.focus { box-shadow: none; border-style: dashed; }

.marker-btn {
  position: absolute; display: grid; place-items: center;
  width: var(--touch-phone); height: var(--touch-phone); padding: 0;
  border: 0; border-radius: 50%; background: transparent;
  transform: translate(-50%, -50%); /* centred on the middle of the stretch */
}

/* Street name on hover: the tooltip style of the Profile board ("Sight"). */
.street-tip {
  position: absolute;
  transform: translate(var(--chip-offset), calc(-100% - var(--chip-offset)));
  width: max-content;
  max-width: var(--tip-max-w);
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-chip);
  background: var(--btn-selected-bg);
  color: var(--text-2);
  font-size: var(--fs-sm);
  overflow-wrap: anywhere;
  pointer-events: none;
  z-index: 5;
}
.street-tip strong { color: var(--text); font-weight: var(--fw-medium); }
.map { position: absolute; inset: 0; }
.map.picking :deep(canvas) { cursor: none; }
.map.sizing :deep(canvas) { cursor: crosshair; }
.map.route-pick :deep(canvas) { cursor: crosshair; }

.route-start {
  position: absolute; width: var(--route-start-size); height: var(--route-start-size);
  border: var(--space-1) solid var(--ring); border-radius: 50%; background: var(--ring-edge);
  transform: translate(-50%, -50%); pointer-events: none;
}
.route-end {
  position: absolute; width: var(--route-pin-w); height: var(--route-pin-h);
  transform: translate(-50%, -100%); pointer-events: none;
}
.route-end path { fill: var(--ring); stroke: var(--ring-edge); stroke-width: var(--hairline); }
.route-end circle { fill: var(--ring-edge); }

.crosshair {
  position: absolute;
  width: var(--crosshair-size);
  height: var(--crosshair-size);
  transform: translate(-50%, -50%);
  pointer-events: none;
  color: var(--map-circle);
  background:
    linear-gradient(currentColor, currentColor) center top / var(--focus-width) 35% no-repeat,
    linear-gradient(currentColor, currentColor) center bottom / var(--focus-width) 35% no-repeat,
    linear-gradient(currentColor, currentColor) left center / 35% var(--focus-width) no-repeat,
    linear-gradient(currentColor, currentColor) right center / 35% var(--focus-width) no-repeat;
}
.crosshair .dot {
  position: absolute;
  left: 50%; top: 50%;
  width: var(--centre-dot);
  height: var(--centre-dot);
  border-radius: 50%;
  background: currentColor;
  transform: translate(-50%, -50%);
}

.handle {
  position: absolute;
  width: var(--handle-size);
  height: var(--handle-size);
  border-radius: 50%;
  border: var(--focus-width) solid var(--map-circle);
  background: transparent;
  transform: translate(-50%, -50%);
  pointer-events: none;
}
.handle.set {
  background: var(--map-circle);
  pointer-events: auto;
  cursor: grab;
  touch-action: none;
}
/* Bigger invisible target for fingers and mice (≥ 44 px). */
.handle.set::before {
  content: "";
  position: absolute;
  inset: calc((var(--handle-size) - var(--touch-phone)) / 2);
  border-radius: 50%;
}
.handle.dragging { cursor: grabbing; }

.radius-chip {
  position: absolute;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  padding: var(--space-2) var(--space-3);
  background: var(--panel);
  color: var(--text);
  border: var(--hairline) solid var(--line);
  border-radius: var(--radius-chip);
  box-shadow: var(--shadow);
  white-space: nowrap;
  line-height: 1.25;
}
.radius-chip strong { font-size: var(--fs-md); font-weight: var(--fw-semibold); }
.radius-chip span { font-size: var(--fs-xs); color: var(--text-2); }
.radius-chip.small { padding: var(--space-1) var(--space-2); flex-direction: row; }
.radius-chip.small strong { font-size: var(--fs-sm); }
.radius-chip.capped { border-color: var(--warning); }
.radius-chip.capped strong, .radius-chip.capped span { color: var(--warning); }
</style>
