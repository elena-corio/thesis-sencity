// Routes in the app: a route's parts as stretches, and a stretch as one place for the card.
// A stretch is one street segment of the route, the same unit as a street in Area (Elena, 2026-11-05).
import { formatDegrees, walkMinutes } from './thermal.js'

/** The state of a segment on a layer; 'none' when it has no value (never a guess between values). */
export function stateOn(feature, layer) {
  return feature?.properties[`${layer}_state`] ?? 'none'
}

/** "1.4 km" */
export function formatKm(metres) {
  return `${(metres / 1000).toFixed(1)} km`
}

/** "210 m", rounded to 10 m (at least 10 m). */
export function formatLength(metres) {
  return metres >= 1000 ? formatKm(metres) : `${Math.max(10, Math.round(metres / 10) * 10)} m`
}

/**
 * One stretch per segment of the route. A connector (a few metres with no segment) is not selectable:
 * it joins the stretch before it, or the next one at the very start of the route.
 * @param {{id:string, parts:Array<{segment_id:string|null, length_m:number, coordinates:number[][]}>}} route
 * @param {Map<string, object>} byId segments by id
 * @param {string} layer
 * @returns {Array<{key:string, routeId:string, index:number, state:string, segmentId:string, length_m:number, coordinates:number[][]}>}
 */
export function stretchesOf(route, byId, layer) {
  const out = []
  let waiting = null // connectors at the very start of the route
  for (const part of route.parts) {
    if (!part.segment_id) {
      const last = out[out.length - 1]
      if (last) {
        last.length_m += part.length_m
        last.coordinates.push(...part.coordinates.slice(1))
      } else {
        waiting = waiting
          ? { length_m: waiting.length_m + part.length_m, coordinates: [...waiting.coordinates, ...part.coordinates.slice(1)] }
          : part
      }
      continue
    }
    out.push({
      key: `${route.id}-${out.length}`,
      routeId: route.id,
      index: out.length,
      state: stateOn(byId.get(part.segment_id), layer),
      segmentId: part.segment_id,
      length_m: part.length_m + (waiting?.length_m ?? 0),
      coordinates: waiting ? [...waiting.coordinates, ...part.coordinates.slice(1)] : [...part.coordinates],
    })
    waiting = null
  }
  return out
}

/** Consecutive stretches with the same state, joined: { state, coordinates }. For the bar's gaps and route B's dashes. */
export function runsOf(stretches) {
  const runs = []
  for (const s of stretches) {
    const last = runs[runs.length - 1]
    if (last?.state === s.state) last.coordinates.push(...s.coordinates.slice(1))
    else runs.push({ state: s.state, coordinates: [...s.coordinates] })
  }
  return runs
}

/** The stretch's middle point, by walking distance (where the selection ring sits). */
export function stretchMiddle(stretch) {
  const c = stretch.coordinates
  let total = 0
  const seg = c.slice(1).map((p, i) => {
    const d = Math.hypot((p[0] - c[i][0]) * Math.cos((p[1] * Math.PI) / 180), p[1] - c[i][1])
    total += d
    return d
  })
  let left = total / 2
  for (let i = 0; i < seg.length; i++) {
    if (left <= seg[i] && seg[i] > 0) {
      const t = left / seg[i]
      return { lon: c[i][0] + t * (c[i + 1][0] - c[i][0]), lat: c[i][1] + t * (c[i + 1][1] - c[i][1]) }
    }
    left -= seg[i]
  }
  return { lon: c[0][0], lat: c[0][1] }
}

/** The stretch as one feature, in the shape the place card reads: its segment, with the length walked. */
export function stretchFeature(stretch, byId) {
  const segment = byId.get(stretch.segmentId)
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: stretch.coordinates },
    properties: { ...segment?.properties, id: stretch.key, name: segment?.properties.name ?? 'Street', length_m: stretch.length_m },
  }
}

/** "210 m · about 3 min" */
export function stretchLine(stretch) {
  return `${formatLength(stretch.length_m)} · about ${walkMinutes(stretch.length_m)} min`
}

/** Screen-reader label of a bar section. */
export function sectionLabel(stretch, total, name, value) {
  const state = { easy: 'Easy', mixed: 'Mixed', hard: 'Hard', none: 'No value' }[stretch.state]
  const felt = value != null ? `, feels like ${formatDegrees(value)}` : ''
  return `Route ${stretch.routeId}, stretch ${stretch.index + 1} of ${total}: ${state}${felt}, ${name}, ${formatLength(stretch.length_m)}`
}

/** Bounds [[west, south], [east, north]] of many points [lon, lat]. */
export function boundsOf(points) {
  const lons = points.map((p) => p[0])
  const lats = points.map((p) => p[1])
  return [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]]
}
