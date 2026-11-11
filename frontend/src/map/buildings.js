// The buildings of the walk view (board Routes 5): extruded from their footprints (h, b in metres), on both sides
// of the walked route. They lie under the route layers, so the route always reads on top. Empty outside a walk.
import { cssVar } from '../composables.js'

const EMPTY = { type: 'FeatureCollection', features: [] }
export const BUILDINGS_LAYER = 'sc-buildings'

export function addBuildingLayers(map) {
  map.addSource(BUILDINGS_LAYER, { type: 'geojson', data: EMPTY })
  map.addLayer({
    id: BUILDINGS_LAYER, type: 'fill-extrusion', source: BUILDINGS_LAYER,
    paint: {
      'fill-extrusion-color': cssVar('--map-building'),
      'fill-extrusion-height': ['get', 'h'],
      'fill-extrusion-base': ['get', 'b'],
      'fill-extrusion-opacity': Number(cssVar('--map-building-opacity')),
      'fill-extrusion-vertical-gradient': true,
    },
  })
}

/** @param {object|null} fc the buildings, or null for none */
export function setBuildings(map, fc) {
  map.getSource(BUILDINGS_LAYER)?.setData(fc ?? EMPTY)
}
