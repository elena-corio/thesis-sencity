// Our MapLibre layers over the base map (brief §2): teal tint, lit circle, dimmed outside,
// dashed circle and radius line. Colours and opacities come from styles/style.css.
// They are added again after every style swap (theme change).
import config from '../config.js'
import { circlePolygon, worldMask } from '../lib/geo.js'
import { cssVar } from '../composables.js'

const EMPTY = { type: 'FeatureCollection', features: [] }
const WORLD = { type: 'Polygon', coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]] }

const num = (name) => Number(cssVar(name))

/** Remove 3D buildings if a base style has them (brief §2: no 3D). */
function removeExtrusions(map) {
  for (const layer of map.getStyle().layers) {
    if (layer.type === 'fill-extrusion') map.removeLayer(layer.id)
  }
}

export function addAreaLayers(map) {
  removeExtrusions(map)
  // Tint and lit circle go under the base map's labels, so street names stay readable.
  const beforeLabels = map.getStyle().layers.find((l) => l.type === 'symbol')?.id

  map.addSource('sc-tint', { type: 'geojson', data: WORLD })
  map.addLayer({
    id: 'sc-tint', type: 'fill', source: 'sc-tint',
    paint: { 'fill-color': cssVar('--map-tint'), 'fill-opacity': num('--map-tint-opacity') },
  }, beforeLabels)

  map.addSource('sc-lit', { type: 'geojson', data: EMPTY })
  map.addLayer({
    id: 'sc-lit', type: 'fill', source: 'sc-lit',
    paint: { 'fill-color': cssVar('--map-lit'), 'fill-opacity': num('--map-lit-opacity') },
  }, beforeLabels)

  // The mask dims everything outside the circle, labels included (brief §2), so it goes on top.
  map.addSource('sc-mask', { type: 'geojson', data: EMPTY })
  map.addLayer({
    id: 'sc-mask', type: 'fill', source: 'sc-mask',
    paint: { 'fill-color': cssVar('--map-mask'), 'fill-opacity': num('--map-mask-opacity') },
  })

  map.addSource('sc-circle', { type: 'geojson', data: EMPTY })
  map.addLayer({
    id: 'sc-circle', type: 'line', source: 'sc-circle',
    paint: { 'line-color': cssVar('--map-circle'), 'line-width': num('--map-circle-width'), 'line-dasharray': [3, 3] },
  })

  map.addSource('sc-radius', { type: 'geojson', data: EMPTY })
  map.addLayer({
    id: 'sc-radius', type: 'line', source: 'sc-radius',
    paint: { 'line-color': cssVar('--map-circle'), 'line-width': num('--map-radius-line-width'), 'line-dasharray': [3, 3] },
  })
}

/**
 * @param {import('maplibre-gl').Map} map
 * @param {{step:string, centre:{lat:number,lon:number}|null, radius:number, edge:{lat:number,lon:number}|null}} s
 */
export function updateAreaLayers(map, s) {
  if (!map.getSource('sc-lit')) return
  const circle = s.centre && s.step !== 'centre'
  const poly = circle ? circlePolygon(s.centre, s.radius, config.circlePoints) : null
  map.getSource('sc-lit').setData(poly ?? EMPTY)
  map.getSource('sc-circle').setData(poly ?? EMPTY)
  // Outside dims once the circle is fixed (Flow 1c) and while it is analysed (Flow 2).
  const dim = circle && (s.step === 'set' || s.step === 'analysed')
  map.getSource('sc-mask').setData(dim ? worldMask(s.centre, s.radius, config.circlePoints) : EMPTY)
  const line = circle && s.edge && (s.step === 'radius' || s.step === 'set')
  map.getSource('sc-radius').setData(line
    ? { type: 'LineString', coordinates: [[s.centre.lon, s.centre.lat], [s.edge.lon, s.edge.lat]] }
    : EMPTY)
}
