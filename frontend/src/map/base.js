// Dark mode's base map is the light one (Positron), drawn the same way, in dark colours with light names.
// The colours are --map-base-* in style.css, set for the dark theme only, so light mode stays as it comes.
// Runs after every style swap.
import { cssVar } from '../composables.js'

const COLOUR = { background: 'background-color', fill: 'fill-color', line: 'line-color', symbol: 'text-color' }

// The first rule that matches a layer's id gives its colour.
const RULES = [
  [/^(background|landcover_(ice_shelf|glacier)|landuse_residential|road_(area_)?pier|railway\w*_dashline)$/, '--map-base-ground'],
  [/^(park|landcover_wood)$/, '--map-base-park'],
  [/^(water|waterway)$/, '--map-base-water'],
  [/^building$/, '--map-base-building'],
  [/casing$/, '--map-base-road-casing'],
  [/_inner$|^aeroway-(area|runway)$/, '--map-base-road-major'],
  [/^(highway_minor|highway_\w+_subtle|aeroway-taxiway)$/, '--map-base-road'],
  [/^highway_path$/, '--map-base-path'],
  [/^(railway(_transit|_service)?|boundary_\w+)$/, '--map-base-rail'],
  [/^highway-name-/, '--map-base-name'],
  [/^water\w*_label$/, '--map-base-water-name'],
  [/^(label_|airport$)/, '--map-base-place'],
]

export function darkenBaseMap(map) {
  for (const { id, type } of map.getStyle().layers) {
    const token = RULES.find(([match]) => match.test(id))?.[1]
    const colour = token && cssVar(token)
    if (!colour) continue
    map.setPaintProperty(id, COLOUR[type], colour)
    if (type === 'symbol') map.setPaintProperty(id, 'text-halo-color', cssVar('--map-base-name-halo'))
  }
  const edge = cssVar('--map-base-building-edge')
  if (edge) map.setPaintProperty('building', 'fill-outline-color', edge)
}
