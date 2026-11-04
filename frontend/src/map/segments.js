// Street segment layers (brief §4). Before rating: segments with photos are one neutral light teal
// with a soft halo ("has data, not rated yet"); segments without photos are thin and dim (unlit).
// Thermal layer: every segment with a feels-like value is lit in its state colour (easy / mixed /
// hard), photo or not. Hover and selection are feature-states on the segment itself, never an extra
// line on top.
import { cssVar } from '../composables.js'

const EMPTY = { type: 'FeatureCollection', features: [] }
const num = (name) => Number(cssVar(name))

const photoCount = ['length', ['coalesce', ['get', 'photos'], ['literal', []]]]
const HAS_PHOTOS = ['>', photoCount, 0]
const IS_AREA = ['==', ['geometry-type'], 'Polygon']
const HAS_THERMAL = ['has', 'thermal_state']
const selected = ['boolean', ['feature-state', 'selected'], false]
const hover = ['boolean', ['feature-state', 'hover'], false]

export const HIT_LAYER = 'sc-seg-hit'

/** Which segments are lit, and in what colour, for a layer (null = photos only, before rating). */
function lit(layer) {
  return layer === 'thermal' ? HAS_THERMAL : HAS_PHOTOS
}
function litColor(layer) {
  if (layer !== 'thermal') return cssVar('--map-seg')
  return ['match', ['get', 'thermal_state'],
    'easy', cssVar('--easy'), 'mixed', cssVar('--mixed'), 'hard', cssVar('--hard'), cssVar('--map-seg-none')]
}

export function addSegmentLayers(map, layer = null) {
  map.addSource('sc-seg', { type: 'geojson', data: EMPTY, promoteId: 'id' })

  map.addLayer({
    id: 'sc-seg-area', type: 'fill', source: 'sc-seg', filter: ['all', IS_AREA, lit(layer)],
    paint: { 'fill-color': litColor(layer), 'fill-opacity': num('--map-area-fill-opacity') },
  })
  map.addLayer({
    id: 'sc-seg-halo', type: 'line', source: 'sc-seg', filter: lit(layer),
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': litColor(layer),
      'line-width': num('--map-seg-halo-width'),
      'line-blur': num('--map-seg-halo-blur'),
      'line-opacity': num('--map-seg-halo-opacity'),
    },
  })
  map.addLayer({
    id: 'sc-seg-none', type: 'line', source: 'sc-seg', filter: ['!', lit(layer)],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': cssVar('--map-seg-none'),
      'line-width': ['case', selected, num('--map-seg-width'), num('--map-seg-none-width')],
      'line-opacity': ['case', selected, 1, hover, num('--map-seg-hover-opacity'), num('--map-seg-none-opacity')],
    },
  })
  // The edge of the selected segment: a wider line under its core.
  map.addLayer({
    id: 'sc-seg-edge', type: 'line', source: 'sc-seg',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': cssVar('--map-seg-edge'),
      'line-width': num('--map-seg-edge-width'),
      'line-opacity': ['case', selected, 1, 0],
    },
  })
  map.addLayer({
    id: 'sc-seg-core', type: 'line', source: 'sc-seg', filter: lit(layer),
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': litColor(layer),
      'line-width': ['case', selected, num('--map-seg-selected-width'), num('--map-seg-width')],
      'line-opacity': ['case', selected, 1, hover, num('--map-seg-hover-opacity'), num('--map-seg-opacity')],
    },
  })
  // Invisible, wide: makes thin streets easy to hover and click (also fills parks and squares).
  map.addLayer({
    id: HIT_LAYER, type: 'line', source: 'sc-seg',
    paint: { 'line-color': cssVar('--map-seg'), 'line-width': num('--map-seg-hit-width'), 'line-opacity': 0 },
  })
  map.addLayer({
    id: 'sc-seg-hit-area', type: 'fill', source: 'sc-seg', filter: IS_AREA,
    paint: { 'fill-color': cssVar('--map-seg'), 'fill-opacity': 0 },
  })
}

/** Switch the lit segments and their colour to another layer. */
export function setSegmentLayer(map, layer) {
  if (!map.getSource('sc-seg')) return
  map.setFilter('sc-seg-area', ['all', IS_AREA, lit(layer)])
  map.setFilter('sc-seg-halo', lit(layer))
  map.setFilter('sc-seg-none', ['!', lit(layer)])
  map.setFilter('sc-seg-core', lit(layer))
  for (const id of ['sc-seg-halo', 'sc-seg-core']) map.setPaintProperty(id, 'line-color', litColor(layer))
  map.setPaintProperty('sc-seg-area', 'fill-color', litColor(layer))
}

export function setSegments(map, fc) {
  map.getSource('sc-seg')?.setData(fc ?? EMPTY)
}

export function setSegmentState(map, id, state) {
  if (id == null || !map.getSource('sc-seg')) return
  map.setFeatureState({ source: 'sc-seg', id }, state)
}
