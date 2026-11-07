// Words for the place card and the enlarged photo.
import { compassWord, formatMonth, haversine, midpoint } from './geo.js'

/** "Pedestrian street", "Square", "Park", "Street". */
export function typeLabel(props, geometryType) {
  switch (props.place_type) {
    case 'park': return 'Park'
    case 'square': return 'Square'
    case 'pedestrian': return geometryType === 'Polygon' ? 'Pedestrian area' : 'Pedestrian street'
    default: return 'Street'
  }
}

/** The place filter, in order. 'all' shows every segment. */
export const PLACE_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'streets', label: 'Streets' },
  { id: 'parks', label: 'Parks' },
  { id: 'squares', label: 'Squares' },
]

/**
 * Which filter a segment belongs to, from its OSM tags: 'parks' (leisure=park), 'squares'
 * (place=square, or a highway=pedestrian area) or 'streets' (every highway way, pedestrian
 * streets included). Areas are Polygons; streets are lines.
 */
export function placeGroup(props, geometryType) {
  if (geometryType !== 'Polygon') return 'streets'
  return props.place_type === 'park' ? 'parks' : 'squares'
}

/** "78 m" for a street, "0.6 ha" or "850 m²" for a park or square. */
export function sizeLabel(props) {
  if (props.length_m != null) return `${Math.round(props.length_m)} m`
  const a = props.area_m2 ?? 0
  return a >= 10000 ? `${(a / 10000).toFixed(1)} ha` : `${Math.round(a / 10) * 10} m²`
}

/** "Looking north-east, July 2024" */
export function photoLine(photo) {
  return `Looking ${compassWord(photo.heading)}, ${formatMonth(photo.date)}`
}

/** "30 m from the street centre" (rounded to 5 m). */
export function distanceLine(photo, feature) {
  const d = Math.round(haversine(photo, midpoint(feature.geometry)) / 5) * 5
  const where = feature.geometry.type === 'Polygon' ? 'the middle of the place' : 'the street centre'
  return d < 5 ? `at ${where}` : `${d} m from ${where}`
}

/** "© Google" or "Contributor photo" (brief §4: contributor photos are flagged on the card). */
export function credit(photo) {
  return photo.contributor ? 'Contributor photo' : '© Google'
}

/** The nearest segment with photos, from the middle of this one. */
/** The nearest other segment that passes keep(f), by distance between middles: { f, mid, d } or null. */
export function nearest(feature, features, keep) {
  const from = midpoint(feature.geometry)
  let best = null
  for (const f of features) {
    if (f === feature || f.properties.id === feature.properties.id || !keep(f)) continue
    const mid = midpoint(f.geometry)
    const d = haversine(from, mid)
    if (!best || d < best.d) best = { f, mid, d }
  }
  return best
}

export function nearestWithPhotos(feature, features) {
  return nearest(feature, features, (f) => f.properties.photos?.length)
}
