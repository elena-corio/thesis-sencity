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

/** All [lon, lat] positions of a LineString, Polygon or Multi* geometry. */
function positions(geometry) {
  const c = geometry.coordinates
  switch (geometry.type) {
    case 'LineString': return c
    case 'Polygon': return c[0]
    case 'MultiLineString': return c.flat()
    case 'MultiPolygon': return c.map((p) => p[0]).flat()
    default: return [c]
  }
}

/** [[west, south], [east, north]] of a geometry. */
export function bounds(geometry) {
  const ps = positions(geometry)
  const lons = ps.map((p) => p[0])
  const lats = ps.map((p) => p[1])
  return [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]]
}

/** The middle of a segment: half way along a line; the average of a polygon's outline. */
export function midpoint(geometry) {
  const ps = positions(geometry)
  if (geometry.type === 'LineString' && ps.length > 1) {
    const pt = (p) => ({ lat: p[1], lon: p[0] })
    const legs = ps.slice(1).map((p, i) => haversine(pt(ps[i]), pt(p)))
    let half = legs.reduce((a, b) => a + b, 0) / 2
    for (let i = 0; i < legs.length; i++) {
      if (half <= legs[i] || i === legs.length - 1) {
        const t = legs[i] ? Math.min(1, half / legs[i]) : 0
        return { lat: ps[i][1] + t * (ps[i + 1][1] - ps[i][1]), lon: ps[i][0] + t * (ps[i + 1][0] - ps[i][0]) }
      }
      half -= legs[i]
    }
  }
  const ring = geometry.type === 'Polygon' ? ps.slice(0, -1) : ps
  return {
    lat: ring.reduce((a, p) => a + p[1], 0) / ring.length,
    lon: ring.reduce((a, p) => a + p[0], 0) / ring.length,
  }
}

const WINDS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']

/** Compass word for a heading: 63° → "north-east". */
export function compassWord(heading) {
  return WINDS[Math.round((((heading % 360) + 360) % 360) / 45) % 8]
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December']

/** Street View capture date "2024-07" → "July 2024". */
export function formatMonth(ym) {
  if (!ym) return 'date unknown'
  const [y, m] = ym.split('-').map(Number)
  return m ? `${MONTHS[m - 1]} ${y}` : String(y)
}
