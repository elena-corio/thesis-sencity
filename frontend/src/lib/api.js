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

/** "subway_entrance" → "Subway entrance" */
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
 * @param {{lat:number, lon:number, radius:number, season?:string, time?:string}} area
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

/** URL of one Street View image, streamed through the API (the key stays on the server). */
export function photoUrl(photo) {
  return `${config.apiBase}/api/photo/${encodeURIComponent(photo.pano_id)}?heading=${photo.heading}`
}
