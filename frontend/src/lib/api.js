// Calls to the SenCity API. The browser talks only to our backend (brief §10).
import config from '../config.js'

export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/** The API's own message from an error answer, or '' when there is none we can show: a request the
 *  API could not read sends `detail` as a list of field errors, which is not for people. */
async function errorText(res) {
  try {
    const { detail } = await res.json()
    return typeof detail === 'string' ? detail : ''
  } catch {
    return '' // not JSON
  }
}

/**
 * Places for a search text, ranked toward the map centre.
 * The text goes in the request body, never in the URL.
 * @param {string} q
 * @param {{lat:number, lon:number} | null} near
 * @param {AbortSignal} [signal]
 * @returns {Promise<Array<{name:string, detail:string, lat:number, lon:number, kind:string, bbox?:number[][]}>>}
 */
export async function searchPlaces(q, near, signal) {
  const res = await fetch(`${config.apiBase}/api/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q, lat: near?.lat ?? null, lon: near?.lon ?? null }),
    signal,
  })
  if (!res.ok) {
    throw new ApiError(res.status, await errorText(res))
  }
  return (await res.json()).results
}

/** The name of a point clicked on the map, or null (none near, or the lookup failed). Only the point is
 *  sent, in the body, and to our own API. */
export async function pointName({ lat, lon }) {
  try {
    const res = await fetch(`${config.apiBase}/api/reverse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lon }),
    })
    return res.ok ? (await res.json()).name : null
  } catch {
    return null
  }
}

/** "subway_entrance" → "Subway entrance" */
// Results that are areas, not points (a city, a district): picking one in a Centre, Start or End
// field only moves the map there. An address or a named place (a street, a square, a park) sets it.
const AREA_KINDS = new Set(['country', 'state', 'region', 'province', 'county', 'city', 'town', 'village', 'hamlet',
  'municipality', 'district', 'city_district', 'borough', 'suburb', 'quarter', 'neighbourhood', 'administrative', 'island'])
export function isAreaPlace(place) {
  return AREA_KINDS.has(place?.kind)
}

export function kindLabel(kind) {
  if (!kind) return ''
  const s = kind.replace(/_/g, ' ')
  return s[0].toUpperCase() + s.slice(1)
}

/**
 * Street segments and their chosen photos for one circle (POST /api/area).
 * The answer is a stream of JSON lines; onEvent gets each event:
 * {type: "stage"} · {type: "segments", features, total} · {type: "segment", feature, done, total}
 * · {type: "done", area} · {type: "error", message}; then {type: "stage", stage: "thermal"}
 * · {type: "thermal", season, time, station, values} or {type: "thermal_error", message}.
 * Abort the signal to cancel.
 * The photos always load; layer 'senses' skips thermal comfort.
 * @param {{lat:number, lon:number, radius:number, season?:string, time?:string, layer?:string}} area
 * @param {(event: object) => void} onEvent
 * @param {AbortSignal} [signal]
 */
export function loadArea(area, onEvent, signal) {
  return streamEvents('/api/area', area, onEvent, signal)
}

/**
 * Two walking routes between two points (POST /api/routes). Start and end travel in the body, never in
 * the URL. Events: {type: "stage", stage: "streets"|"thermal"|"routes"} · {type: "segments", total} ·
 * {type: "segment", done, total}, then {type: "routes", season, time, station, routes, verdict, segments,
 * values}, or {type: "error", message} or {type: "thermal_error", message}. Abort the signal to cancel.
 * @param {{start:{lat:number,lon:number}, end:{lat:number,lon:number}, limits:object, season:string, time:string}} request
 * @param {(event: object) => void} onEvent
 * @param {AbortSignal} [signal]
 */
export function loadRoutes(request, onEvent, signal) {
  return streamEvents('/api/routes', request, onEvent, signal)
}

/**
 * Footprints and heights of the buildings along a walked route, for the walk view (POST /api/buildings).
 * The line travels in the body. Answer: a FeatureCollection of Polygons with h (height) and b (base) in
 * metres, and `source` for the credits.
 * @param {number[][]} line [[lon, lat], …]
 * @param {AbortSignal} [signal]
 * @returns {Promise<{type:'FeatureCollection', features:object[], source:string}>}
 */
export async function loadBuildings(line, signal) {
  const res = await fetch(`${config.apiBase}/api/buildings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ line }),
    signal,
  })
  if (!res.ok) throw new ApiError(res.status, await errorText(res))
  return res.json()
}

async function streamEvents(path, body, onEvent, signal) {
  const res = await fetch(`${config.apiBase}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) {
    throw new ApiError(res.status, await errorText(res))
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let nl
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (line) onEvent(JSON.parse(line))
    }
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer))
}

/**
 * One Mapillary photo per stretch of a walk (POST /api/mapillary/along): the newest flat photo within 30 m facing along
 * it, or null. The stretches travel in the body; the token stays on the server. Answer: {photos: {key: photo | null}},
 * each photo {id, lon, lat, heading, year, date, creator, thumb_url, link}.
 * @param {{key:string, coordinates:number[][]}[]} stretches
 * @param {AbortSignal} [signal]
 */
export async function loadMapillaryAlong(stretches, signal) {
  const res = await fetch(`${config.apiBase}/api/mapillary/along`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stretches }),
    signal,
  })
  if (!res.ok) throw new ApiError(res.status, await errorText(res))
  return (await res.json()).photos
}

/** URL of one Street View image, streamed through the API (the key stays on the server). */
export function photoUrl(photo) {
  return `${config.apiBase}/api/photo/${encodeURIComponent(photo.pano_id)}?heading=${photo.heading}`
}

/**
 * The model's general predictions for a list of photos, nearest first (POST /api/senses/rate). Events:
 * {type: "start", model, cached, to_rate, remaining} · {type: "photo", pano_id, heading, status: "ok"|"failed", cached,
 * result|error, cost_usd, streetview_usd} · {type: "done", seconds, failed, remaining, estimate_usd,
 * estimate_streetview_usd} or {type: "error", message}. Abort the signal to stop.
 * @param {{pano_id:string, heading:number}[]} photos
 * @param {(event: object) => void} onEvent
 * @param {AbortSignal} [signal]
 */
export function rateSenses(photos, onEvent, signal) {
  return streamEvents('/api/senses/rate', { photos }, onEvent, signal)
}
