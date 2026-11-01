// Radius maths for the two-click area selection. Distances are on the ground (metres),
// never in pixels, so the circle is right at any zoom.

const EARTH_RADIUS_M = 6371008.8
const toRad = (d) => (d * Math.PI) / 180
const toDeg = (r) => (r * 180) / Math.PI

/** Great-circle distance in metres between two {lat, lon} points. */
export function haversine(a, b) {
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Compass bearing in degrees from a to b. */
export function bearing(a, b) {
  const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat))
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon))
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

/** The point at a distance (m) and bearing (degrees) from a start point. */
export function destination(start, bearingDeg, distance) {
  const d = distance / EARTH_RADIUS_M
  const br = toRad(bearingDeg)
  const lat1 = toRad(start.lat)
  const lon1 = toRad(start.lon)
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br))
  const lon2 = lon1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2))
  return { lat: toDeg(lat2), lon: ((toDeg(lon2) + 540) % 360) - 180 }
}

/** Round to the chip step (10 m). */
export function roundTo(value, step) {
  return Math.round(value / step) * step
}

/**
 * Radius from a raw ground distance: rounded to the step, snapped up to the minimum,
 * stopped at the maximum. `capped` is true when the pointer is past the maximum.
 * @param {number} raw metres
 * @param {{min:number, max:number, rounding:number}} limits
 */
export function limitRadius(raw, { min, max, rounding }) {
  if (raw > max) return { radius: max, capped: true }
  return { radius: Math.min(max, Math.max(min, roundTo(raw, rounding))), capped: false }
}

/** Circle as a closed GeoJSON ring of n points ([lon, lat]). */
export function circleRing(centre, radius, n = 64) {
  const ring = []
  for (let i = 0; i < n; i++) {
    const p = destination(centre, (360 * i) / n, radius)
    ring.push([p.lon, p.lat])
  }
  ring.push(ring[0])
  return ring
}

export function circlePolygon(centre, radius, n = 64) {
  return { type: 'Polygon', coordinates: [circleRing(centre, radius, n)] }
}

/** World minus circle: dims everything outside the area (brief §2). */
export function worldMask(centre, radius, n = 64) {
  const world = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]
  return { type: 'Polygon', coordinates: [world, circleRing(centre, radius, n).reverse()] }
}

/** "About N street photos": area × density, rounded to 10, at least 10. */
export function estimatePhotos(radius, perKm2) {
  const km2 = (Math.PI * radius * radius) / 1e6
  return Math.max(10, roundTo(km2 * perKm2, 10))
}

/** "48.2085° N, 16.3721° E" */
export function formatCoords({ lat, lon }) {
  const ns = lat >= 0 ? 'N' : 'S'
  const ew = lon >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lon).toFixed(4)}° ${ew}`
}
