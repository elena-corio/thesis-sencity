// The two routes on the map (brief §3, §4): coloured street by street, A continuous, B dashed, with the
// stronger glow the brief keeps for places of attention. Each stretch (one street segment) is a feature
// keyed "A-2", so a single street can be hovered and selected. B's dashes are drawn over runs of the same
// state, so the pattern does not restart at every short segment; a hovered or selected B stretch turns solid.
// Selected: fully opaque, wider, with a light edge. Hover (from the map, a bar or a button) dims the rest.
import { cssVar } from '../composables.js'
import { runsOf } from '../lib/routes.js'

const EMPTY = { type: 'FeatureCollection', features: [] }
const num = (name) => Number(cssVar(name))
const IS_B = ['==', ['get', 'route'], 'B']

export const ROUTE_HIT_LAYER = 'sc-route-hit'

const stateColor = () => ['match', ['get', 'state'],
  'easy', cssVar('--easy'), 'mixed', cssVar('--mixed'), 'hard', cssVar('--hard'), cssVar('--map-seg-none')]

/** Dash pattern of route B, read from style.css ("1.2 1.8"), in line widths. */
const dash = () => cssVar('--map-route-dash').split(/\s+/).map(Number)

export function addRouteLayers(map) {
  map.addSource('sc-route', { type: 'geojson', data: EMPTY })
  map.addSource('sc-route-dash', { type: 'geojson', data: EMPTY })
  const round = { 'line-cap': 'round', 'line-join': 'round' }
  map.addLayer({
    id: 'sc-route-halo', type: 'line', source: 'sc-route', layout: round,
    paint: {
      'line-color': stateColor(),
      'line-width': num('--map-route-halo-width'),
      'line-blur': num('--map-route-halo-blur'),
      'line-opacity': num('--map-route-halo-opacity'),
    },
  })
  map.addLayer({
    id: 'sc-route-edge', type: 'line', source: 'sc-route', layout: round,
    paint: { 'line-color': cssVar('--map-seg-edge'), 'line-width': num('--map-route-edge-width'), 'line-opacity': 0 },
  })
  map.addLayer({
    id: 'sc-route-a', type: 'line', source: 'sc-route', filter: ['!', IS_B], layout: round,
    paint: { 'line-color': stateColor(), 'line-width': num('--map-route-width'), 'line-opacity': 1 },
  })
  map.addLayer({
    id: 'sc-route-b', type: 'line', source: 'sc-route-dash',
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: { 'line-color': stateColor(), 'line-width': num('--map-route-width'), 'line-opacity': 1, 'line-dasharray': dash() },
  })
  // One stretch of B, solid, while it is hovered or selected.
  map.addLayer({
    id: 'sc-route-b-focus', type: 'line', source: 'sc-route', filter: IS_B, layout: round,
    paint: { 'line-color': stateColor(), 'line-width': num('--map-route-width'), 'line-opacity': 0 },
  })
  map.addLayer({
    id: ROUTE_HIT_LAYER, type: 'line', source: 'sc-route',
    paint: { 'line-color': cssVar('--map-seg'), 'line-width': num('--map-seg-hit-width'), 'line-opacity': 0 },
  })
}

/** Every stretch of the routes as GeoJSON. */
export function routesGeojson(routes) {
  return {
    type: 'FeatureCollection',
    features: routes.flatMap((r) => r.stretches.map((s) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: s.coordinates },
      properties: { key: s.key, route: r.id, state: s.state },
    }))),
  }
}

function dashGeojson(routes) {
  return {
    type: 'FeatureCollection',
    features: routes.filter((r) => r.id === 'B').flatMap((r) => runsOf(r.stretches).map((run) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: run.coordinates },
      properties: { route: r.id, state: run.state },
    }))),
  }
}

/** @param {{routes:Array, visible:Record<string, boolean>, selected:string|null, hoverKey:string|null, hoverRoute:string|null}} s */
export function updateRouteLayers(map, s) {
  if (!map.getSource('sc-route')) return
  map.getSource('sc-route').setData(routesGeojson(s.routes))
  map.getSource('sc-route-dash').setData(dashGeojson(s.routes))
  styleRoutes(map, s)
}

export function styleRoutes(map, { visible, selected, hoverKey, hoverRoute }) {
  if (!map.getLayer('sc-route-a')) return
  const shownIds = Object.keys(visible).filter((id) => visible[id])
  const isShown = ['in', ['get', 'route'], ['literal', shownIds]]
  map.setFilter('sc-route-halo', isShown)
  map.setFilter('sc-route-edge', isShown)
  map.setFilter(ROUTE_HIT_LAYER, isShown)
  map.setFilter('sc-route-a', ['all', isShown, ['!', IS_B]])
  map.setFilter('sc-route-b', isShown)
  map.setFilter('sc-route-b-focus', ['all', isShown, IS_B])

  const isKey = (key) => ['==', ['get', 'key'], key ?? '']
  // Highlight (brief §8): what is hovered at full strength, the rest dimmed.
  const focus = hoverKey ? isKey(hoverKey) : hoverRoute ? ['==', ['get', 'route'], hoverRoute] : null
  const dim = num('--map-route-dim-opacity')
  const haloOpacity = num('--map-route-halo-opacity')
  map.setPaintProperty('sc-route-halo', 'line-opacity', focus ? ['case', focus, haloOpacity, haloOpacity * dim] : haloOpacity)
  map.setPaintProperty('sc-route-a', 'line-opacity', focus ? ['case', focus, 1, isKey(selected), 1, dim] : 1)
  // The dash layer has no keys: hovering one stretch dims it, and the solid layer shows that stretch.
  const dashFull = !hoverKey && (!hoverRoute || hoverRoute === 'B')
  map.setPaintProperty('sc-route-b', 'line-opacity', dashFull ? 1 : dim)
  map.setPaintProperty('sc-route-b-focus', 'line-opacity', ['case', isKey(selected), 1, isKey(hoverKey), 1, 0])
  const width = ['case', isKey(selected), num('--map-route-selected-width'), num('--map-route-width')]
  map.setPaintProperty('sc-route-a', 'line-width', width)
  map.setPaintProperty('sc-route-b-focus', 'line-width', width)
  map.setPaintProperty('sc-route-edge', 'line-opacity',
    ['case', isKey(selected), 1, isKey(hoverKey), num('--map-route-hover-edge-opacity'), 0])
}
