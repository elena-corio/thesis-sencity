// Marked places (suggestions now, chat results later): each one's stretch or outline is drawn thicker
// in its level colour with a light outline, above the normal street colours and below the invisible
// hit layers, so a marked street is still hovered and clicked as usual. The numbered pins are HTML
// buttons in MapCanvas (MarkerPin.vue).
import { cssVar } from '../composables.js'
import { HIT_LAYER } from './segments.js'

const EMPTY = { type: 'FeatureCollection', features: [] }
const num = (name) => Number(cssVar(name))
const IS_AREA = ['==', ['geometry-type'], 'Polygon']
const levelColor = () => ['match', ['get', 'level'],
  'easy', cssVar('--easy'), 'mixed', cssVar('--mixed'), 'hard', cssVar('--hard'), cssVar('--easy')]

export function addMarkerLayers(map) {
  map.addSource('sc-mark', { type: 'geojson', data: EMPTY })
  map.addLayer({
    id: 'sc-mark-area', type: 'fill', source: 'sc-mark', filter: IS_AREA,
    paint: { 'fill-color': levelColor(), 'fill-opacity': num('--map-marker-area-opacity') },
  }, HIT_LAYER)
  map.addLayer({
    id: 'sc-mark-outline', type: 'line', source: 'sc-mark',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': cssVar('--marker-outline'), 'line-width': num('--map-marker-outline-width') },
  }, HIT_LAYER)
  map.addLayer({
    id: 'sc-mark-core', type: 'line', source: 'sc-mark',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': levelColor(), 'line-width': num('--map-marker-width') },
  }, HIT_LAYER)
}

/** Draw these markers ({ f, level }), or none. */
export function setMarkers(map, markers) {
  const features = (markers ?? []).map((m) => ({ ...m.f, properties: { id: m.f.properties.id, level: m.level } }))
  map.getSource('sc-mark')?.setData({ type: 'FeatureCollection', features })
}

// Senses: one dot per rated place, in the colour of its rating, above the streets and routes. A dot is not a
// click target: the street under it is. A place that could not be rated stays visible, as an amber-edged grey dot.
export function addSensesDots(map) {
  map.addSource('sc-senses', { type: 'geojson', data: EMPTY })
  map.addLayer({
    id: 'sc-senses-dot', type: 'circle', source: 'sc-senses',
    paint: {
      'circle-radius': num('--map-senses-dot-radius'),
      'circle-color': ['match', ['get', 'level'], 'easy', cssVar('--easy'), 'mixed', cssVar('--mixed'), 'hard', cssVar('--hard'), cssVar('--no-photo')],
      'circle-stroke-width': num('--map-senses-dot-stroke'),
      'circle-stroke-color': ['case', ['==', ['get', 'level'], 'failed'], cssVar('--warning'), cssVar('--marker-edge')],
    },
  })
}

/** Draw these dots: [{ point: {lat, lon}, level: 'easy'|'mixed'|'hard'|'failed' }]. */
export function setSensesDots(map, dots) {
  map.getSource('sc-senses')?.setData({ type: 'FeatureCollection', features: dots.map((d) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [d.point.lon, d.point.lat] }, properties: { level: d.level },
  })) })
}
