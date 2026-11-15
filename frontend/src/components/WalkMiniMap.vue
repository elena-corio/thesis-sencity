<script setup>
// "Where you are" (WalkView): a small flat map of the walked route, north up, coloured as the walk rates its stretches,
// that follows you: your place (the photo's spot) is always the circle in its middle, with the photo's direction as an
// arc. A click on a stretch jumps there; for the keyboard each stretch is also a button (in a list only screen readers
// and Tab see).
import { Map as MapLibreMap } from 'maplibre-gl'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import config from '../config.js'
import { cssVar, useMedia } from '../composables.js'
import { darkenBaseMap } from '../map/base.js'
import { sectionLabel, stretchFeature } from '../lib/routes.js'
import { useRoutesStore } from '../stores/routes.js'
import { useThemeStore } from '../stores/theme.js'
import { useWalkStore } from '../stores/walk.js'
import MarkerArc from './MarkerArc.vue'

const walk = useWalkStore()
const routes = useRoutesStore()
const theme = useThemeStore()
const reducedMotion = useMedia('(prefers-reduced-motion: reduce)')
const container = ref(null)
const map = shallowRef(null)
const SOURCE = 'sc-walk-mini'

const total = computed(() => walk.stretches.length)
const label = (s) => {
  const f = stretchFeature(s, routes.segments).properties
  return sectionLabel(s, total.value, f.name, f.utci)
}
const figureLabel = computed(() => `Map of route ${walk.route.id} coloured by comfort. You are on stretch ${walk.index + 1} of ${total.value}. Select a stretch to jump to it.`)

/** Start (a ring) and End (a dot), as on the board. */
function ends() {
  const c = walk.stretches.flatMap((s) => s.coordinates)
  if (!c.length) return { type: 'FeatureCollection', features: [] }
  const pt = (p, end) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: { end } })
  return { type: 'FeatureCollection', features: [pt(c[0], false), pt(c[c.length - 1], true)] }
}
function data() {
  return {
    type: 'FeatureCollection',
    features: walk.stretches.map((s, i) => ({
      type: 'Feature', geometry: { type: 'LineString', coordinates: s.coordinates }, properties: { i, state: s.state },
    })),
  }
}
const stateColor = () => ['match', ['get', 'state'], 'easy', cssVar('--easy'), 'mixed', cssVar('--mixed'), 'hard', cssVar('--hard'), cssVar('--map-seg-none')]
const isCurrent = () => ['==', ['get', 'i'], walk.index]

function addLayers(m) {
  if (theme.resolved === 'dark') darkenBaseMap(m)
  m.addSource(SOURCE, { type: 'geojson', data: data() })
  m.addLayer({ id: `${SOURCE}-edge`, type: 'line', source: SOURCE, layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': cssVar('--map-seg-edge'), 'line-width': Number(cssVar('--map-route-edge-width')), 'line-opacity': ['case', isCurrent(), 1, 0] } })
  m.addLayer({ id: SOURCE, type: 'line', source: SOURCE, layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': stateColor(), 'line-width': ['case', isCurrent(), Number(cssVar('--map-route-selected-width')), Number(cssVar('--map-route-width'))] } })
  m.addSource(`${SOURCE}-ends`, { type: 'geojson', data: ends() })
  m.addLayer({ id: `${SOURCE}-ends`, type: 'circle', source: `${SOURCE}-ends`,
    paint: {
      'circle-radius': Number(cssVar('--map-mini-end-r')),
      'circle-color': ['case', ['get', 'end'], cssVar('--ring'), cssVar('--ring-edge')],
      'circle-stroke-color': ['case', ['get', 'end'], cssVar('--ring-edge'), cssVar('--ring')],
      'circle-stroke-width': Number(cssVar('--map-mini-end-stroke')),
    } })
}
function restyle() {
  const m = map.value
  if (!m?.getLayer(SOURCE)) return
  m.setPaintProperty(`${SOURCE}-edge`, 'line-opacity', ['case', isCurrent(), 1, 0])
  m.setPaintProperty(SOURCE, 'line-width', ['case', isCurrent(), Number(cssVar('--map-route-selected-width')), Number(cssVar('--map-route-width'))])
}
function follow() {
  const m = map.value
  if (!m || !walk.point) return
  const center = [walk.point.lon, walk.point.lat]
  if (reducedMotion.value) m.jumpTo({ center })
  else m.easeTo({ center, duration: config.walk.glideMs })
}

onMounted(() => {
  const m = new MapLibreMap({
    container: container.value,
    style: config.mapStyles[theme.resolved],
    center: walk.point ? [walk.point.lon, walk.point.lat] : [config.start.lon, config.start.lat],
    zoom: config.walk.miniZoom,
    interactive: true, dragPan: false, scrollZoom: false, boxZoom: false, dragRotate: false, keyboard: false,
    doubleClickZoom: false, touchZoomRotate: false, touchPitch: false, pitchWithRotate: false, maxPitch: 0,
    attributionControl: false, // the page's credits cover it
  })
  map.value = m
  m.on('style.load', () => addLayers(m))
  m.on('click', (e) => {
    const box = [[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]]
    const hit = m.getLayer(SOURCE) ? m.queryRenderedFeatures(box, { layers: [SOURCE] })[0] : null
    if (hit) walk.go(hit.properties.i)
  })
  m.on('mousemove', (e) => {
    const box = [[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]]
    m.getCanvas().style.cursor = m.getLayer(SOURCE) && m.queryRenderedFeatures(box, { layers: [SOURCE] }).length ? 'pointer' : ''
  })
})
onBeforeUnmount(() => map.value?.remove())

watch(() => walk.stretches, () => {
  map.value?.getSource(SOURCE)?.setData(data())
  map.value?.getSource(`${SOURCE}-ends`)?.setData(ends())
})
watch(() => walk.index, () => { restyle(); follow() })
watch(() => walk.point, follow)
watch(() => theme.resolved, (t) => map.value?.setStyle(config.mapStyles[t], { diff: false }))
</script>

<template>
  <div class="mini">
    <div ref="container" class="map" role="img" :aria-label="figureLabel" />
    <!-- You: the dot, and the photo's direction as an arc with a pulse (the map points north). -->
    <span class="you" aria-hidden="true">
      <MarkerArc v-if="walk.photo" :angle="walk.photo.heading" radius="var(--point-arc-r)" pulse />
      <span class="dot" />
    </span>
    <ul class="visually-hidden" aria-label="Stretches of the walk">
      <li v-for="(s, i) in walk.stretches" :key="s.key">
        <button type="button" :aria-current="i === walk.index ? 'step' : undefined" @click="walk.go(i, $event.detail === 0)">{{ label(s) }}</button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.mini { position: relative; width: 100%; aspect-ratio: var(--walk-mini-ratio); border-radius: var(--radius-btn); overflow: hidden; background: var(--ground); }
.map { position: absolute; inset: 0; }
/* You: always in the middle (the map moves under it). */
.you {
  position: absolute; left: 50%; top: 50%; width: var(--ring-size); height: var(--ring-size); transform: translate(-50%, -50%);
  pointer-events: none;
}
.you .dot {
  box-shadow: var(--arc-glow);
  position: absolute; left: 50%; top: 50%; width: var(--point-dot); height: var(--point-dot); transform: translate(-50%, -50%);
  border: var(--focus-width) solid var(--ring-edge); border-radius: 50%; background: var(--ring);
}
</style>
