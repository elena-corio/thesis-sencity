// Calls to the SenCity API. The browser talks only to our backend (brief §10), with the Clerk session token
// (lib/auth.js): the server checks it on every call.
import config from '../config.js'
import { authFetch } from './auth.js'

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
  const res = await authFetch(`${config.apiBase}/api/search`, {
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
    const res = await authFetch(`${config.apiBase}/api/reverse`, {
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

async function streamEvents(path, body, onEvent, signal) {
  const res = await authFetch(`${config.apiBase}${path}`, {
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
 * The model's predictions for a list of Mapillary photos, nearest first (POST /api/senses/rate): the photos the app shows.
 * With `profile` (your answers and language, lib/profile.js requestProfile) they are personal, else general.
 * Events: {type: "start", model, cached, to_rate, remaining, personal} · {type: "photo", id, heading,
 * status: "ok"|"failed", cached, result|error, cost_usd} · {type: "done", seconds, failed, remaining, estimate_usd} or
 * {type: "error", message}. Abort the signal to stop.
 * @param {{id:string, heading:number}[]} photos
 * @param {(event: object) => void} onEvent
 * @param {AbortSignal} [signal]
 * @param {object|null} [profile]
 */
export function rateSenses(photos, onEvent, signal, profile = null) {
  return streamEvents('/api/senses/rate', profile ? { photos, profile } : { photos }, onEvent, signal)
}

/** The onboarding questions and the profile template (GET /api/profile/survey), from model/app_v9/. Nothing personal. */
export async function loadSurvey(signal) {
  const res = await authFetch(`${config.apiBase}/api/profile/survey`, { signal })
  if (!res.ok) throw new ApiError(res.status, await errorText(res))
  return res.json()
}

/**
 * One chat message → its intent (backend app/chat.py). Only the message text is sent: never the profile or ratings.
 * @param {string} message
 * @param {AbortSignal} [signal]
 */
export async function askChat(message, signal) {
  const res = await authFetch(`${config.apiBase}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
    signal,
  })
  if (!res.ok) throw new ApiError(res.status, await errorText(res))
  return (await res.json()).intent
}

async function json(method, path, body) {
  const res = await authFetch(`${config.apiBase}${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new ApiError(res.status, await errorText(res))
  return res.json()
}
/** Your account: { consented }. */
export const getAccount = () => json('GET', '/api/account')
/** The privacy notice agreed (before anything is saved). */
export const agreeConsent = () => json('POST', '/api/account/consent', { agreed: true })
/** "Delete my account and data": our rows, then the Clerk user. */
export const deleteAccount = () => json('DELETE', '/api/account')
/** Your saved profile, or null: { profile, consented }. */
export const getProfile = () => json('GET', '/api/profile')
export const putProfile = (profile) => json('PUT', '/api/profile', profile)
export const deleteProfileData = () => json('DELETE', '/api/profile')
/** Your own photo ratings (the whole list). */
export const getOwnRatings = async () => (await json('GET', '/api/ratings/own')).ratings ?? []
export const putOwnRatings = (list) => json('PUT', '/api/ratings/own', list)
