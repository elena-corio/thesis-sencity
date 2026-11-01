<script setup>
// The map and the two-click area selection (brief §6 "Study area", boards Flow 1, 1b, 1c).
import { Map as MapLibreMap } from 'maplibre-gl'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import config from '../config.js'
import { useMedia } from '../composables.js'
import { bearing, circlePolygon, destination } from '../lib/geo.js'
import { addAreaLayers, updateAreaLayers } from '../map/layers.js'
import { useAreaStore } from '../stores/area.js'
import { useThemeStore } from '../stores/theme.js'

const area = useAreaStore()
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
  if (area.step !== 'centre') return null
  return pointerPx.value ?? { x: containerSize.value.w / 2, y: containerSize.value.h / 2 }
})

const showChip = computed(() => area.step === 'radius' || (area.step === 'set' && edgePx.value))
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
  if (area.step === 'centre') {
    area.placeCentre(p)
    if (finePointer.value) area.radiusTo(p) // the circle grows from the centre with the pointer
    return
  }
  if (area.step === 'radius') {
    if (touchMoved) { touchMoved = false; return }
    setRadiusTo(p)
    area.fix()
  }
}

function onMouseMove(e) {
  touchMode.value = false
  pointerPx.value = { x: e.point.x, y: e.point.y }
  if (area.step === 'radius') setRadiusTo(lngLatToPoint(e.lngLat))
}

function onMouseOut() {
  if (area.step === 'centre') pointerPx.value = null
}

function onContextMenu(e) {
  e.originalEvent.preventDefault()
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
  if (area.step !== 'radius' || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return
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
  if (e.key === 'Escape' && (area.step === 'radius' || area.step === 'set') && !e.defaultPrevented) {
    area.reset()
    map.value?.getCanvas().focus()
  }
}

// Map
function syncLayers() {
  if (!map.value) return
  updateAreaLayers(map.value, { step: area.step, centre: area.centre, radius: area.radius, edge: edge.value })
}

watch(() => [area.step, area.centre, area.radius, edgeBearing.value], syncLayers)

watch(() => theme.resolved, (t) => {
  map.value?.setStyle(config.mapStyles[t], { diff: false })
})


// Once the circle is fixed, the card (or the phone sheet) appears: pan so the whole circle
// stays visible in the space the panels leave free.
const TOP_PANELS = ['search', 'tabs', 'actions', 'hint', 'season-chip', 'time', 'ask']
const BOTTOM_PANELS = ['season', 'controls', 'tabbar', 'attribution']

function freePadding() {
  const W = window.innerWidth
  const H = window.innerHeight
  const gap = 16
  const pad = { top: gap, bottom: gap, left: gap, right: gap }
  for (const el of document.querySelectorAll('[data-panel]')) {
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) continue
    const name = el.dataset.panel
    const sheet = name === 'area-card' && r.width > W * 0.8
    if (TOP_PANELS.includes(name)) pad.top = Math.max(pad.top, r.bottom + gap)
    else if (BOTTOM_PANELS.includes(name) || sheet) pad.bottom = Math.max(pad.bottom, H - r.top + gap)
    else if (name === 'layers') pad.left = Math.max(pad.left, r.right + gap)
    else if (name === 'area-card') pad.right = Math.max(pad.right, W - r.left + gap)
  }
  // Leave at least a small window for the circle on very small screens.
  if (pad.top + pad.bottom > H - 80) pad.bottom = Math.max(gap, H - 80 - pad.top)
  if (pad.left + pad.right > W - 80) pad.left = gap
  return pad
}

function circleBounds() {
  const ring = circlePolygon(area.centre, area.radius, config.circlePoints).coordinates[0]
  const lons = ring.map((p) => p[0])
  const lats = ring.map((p) => p[1])
  return [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]]
}

function revealCircle() {
  const m = map.value
  if (!m || !area.centre) return
  const pad = freePadding()
  const [[w, s], [e, n]] = circleBounds()
  const a = m.project([w, n])
  const b = m.project([e, s])
  const inside = a.x >= pad.left && a.y >= pad.top &&
    b.x <= window.innerWidth - pad.right && b.y <= window.innerHeight - pad.bottom
  if (inside) return
  m.fitBounds([[w, s], [e, n]], { padding: pad, maxZoom: m.getZoom(), animate: !reducedMotion.value })
}

watch(() => area.step, (step) => {
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

  m.on('style.load', () => { addAreaLayers(m); syncLayers() })
  m.on('move', () => { frame.value++ })
  m.on('resize', () => { frame.value++ })
  m.on('click', onClick)
  m.on('mousemove', onMouseMove)
  m.on('mouseout', onMouseOut)
  m.on('contextmenu', onContextMenu)
  m.once('idle', () => { document.documentElement.dataset.mapReady = 'true' })

  const canvas = m.getCanvas()
  canvas.setAttribute('aria-label',
    'Map. Press Enter to place the centre of your area at the map centre, then the arrow keys to change the radius and Enter to fix it.')
  container.value.addEventListener('keydown', onKeyDown, true)
  container.value.addEventListener('pointerdown', onSizeDown, true)
  container.value.addEventListener('pointermove', onSizeMove, true)
  container.value.addEventListener('pointerup', onSizeUp, true)
  container.value.addEventListener('pointercancel', onSizeUp, true)
  window.addEventListener('keydown', onWindowKey)
  window.__sencityMap = m // for the Playwright checks
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onWindowKey)
  map.value?.remove()
})

// Controls used by the map buttons
function zoomIn() { map.value?.zoomIn({ animate: !reducedMotion.value }) }
function zoomOut() { map.value?.zoomOut({ animate: !reducedMotion.value }) }
function recentre() {
  const m = map.value
  if (!m) return
  if (area.centre && area.step !== 'centre') {
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

defineExpose({ zoomIn, zoomOut, recentre, focusMap, getCentre, flyToPlace })
</script>

<template>
  <div class="map-wrap" @pointermove="moveDrag" @pointerup="endDrag" @pointercancel="endDrag">
    <div ref="container" class="map" :class="{ picking: area.step === 'centre' && finePointer, sizing: area.step === 'radius' }" />

    <!-- Step 1: the crosshair follows the pointer (at the map centre for keyboard users). -->
    <div v-if="crosshairPx && finePointer" class="crosshair" aria-hidden="true"
         :style="{ left: `${crosshairPx.x}px`, top: `${crosshairPx.y}px` }">
      <span class="dot" />
    </div>

    <!-- Centre of the area: thin crosshair with a dot (brief §4: the point that picks an area). -->
    <div v-if="area.hasCircle && centrePx" class="crosshair centre" aria-hidden="true"
         :style="{ left: `${centrePx.x}px`, top: `${centrePx.y}px` }">
      <span class="dot" />
    </div>

    <!-- Edge handle: hollow while choosing, filled and draggable once set. -->
    <div v-if="(area.step === 'radius' || area.step === 'set') && edgePx" class="handle"
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

    <div class="visually-hidden" aria-live="polite">{{ announcement }}</div>
  </div>
</template>

<style scoped>
.map-wrap { position: absolute; inset: 0; }
.map { position: absolute; inset: 0; }
.map.picking :deep(canvas) { cursor: none; }
.map.sizing :deep(canvas) { cursor: crosshair; }

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
