// Street segment layers (brief §4). Before rating: segments with photos are one neutral light teal
// with a soft halo ("has data, not rated yet"); segments without photos are thin and dim (unlit).
// Hover and selection are feature-states on the segment itself, never an extra line on top.
import { cssVar } from '../composables.js'

const EMPTY = { type: 'FeatureCollection', features: [] }
const num = (name) => Number(cssVar(name))

const photoCount = ['length', ['coalesce', ['get', 'photos'], ['literal', []]]]
const HAS_PHOTOS = ['>', photoCount, 0]
const NO_PHOTOS = ['==', photoCount, 0]
const IS_AREA = ['==', ['geometry-type'], 'Polygon']
const selected = ['boolean', ['feature-state', 'selected'], false]
const hover = ['boolean', ['feature-state', 'hover'], false]

export const HIT_LAYER = 'sc-seg-hit'

export function addSegmentLayers(map) {
  map.addSource('sc-seg', { type: 'geojson', data: EMPTY, promoteId: 'id' })

  map.addLayer({
    id: 'sc-seg-area', type: 'fill', source: 'sc-seg', filter: ['all', IS_AREA, HAS_PHOTOS],
    paint: { 'fill-color': cssVar('--map-seg'), 'fill-opacity': num('--map-area-fill-opacity') },
  })
  map.addLayer({
    id: 'sc-seg-halo', type: 'line', source: 'sc-seg', filter: HAS_PHOTOS,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': cssVar('--map-seg'),
      'line-width': num('--map-seg-halo-width'),
      'line-blur': num('--map-seg-halo-blur'),
      'line-opacity': num('--map-seg-halo-opacity'),
    },
  })
  map.addLayer({
    id: 'sc-seg-none', type: 'line', source: 'sc-seg', filter: NO_PHOTOS,
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
    id: 'sc-seg-core', type: 'line', source: 'sc-seg', filter: HAS_PHOTOS,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': cssVar('--map-seg'),
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

export function setSegments(map, fc) {
  map.getSource('sc-seg')?.setData(fc ?? EMPTY)
}

export function setSegmentState(map, id, state) {
  if (id == null || !map.getSource('sc-seg')) return
  map.setFeatureState({ source: 'sc-seg', id }, state)
}
