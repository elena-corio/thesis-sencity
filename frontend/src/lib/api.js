// Calls to the SenCity API. The browser talks only to our backend (brief §10).
import config from '../config.js'

export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
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
    let detail = ''
    try { detail = (await res.json()).detail ?? '' } catch { /* not JSON */ }
    throw new ApiError(res.status, detail)
  }
  return (await res.json()).results
}

/** "subway_entrance" → "Subway entrance" */
export function kindLabel(kind) {
  if (!kind) return ''
  const s = kind.replace(/_/g, ' ')
  return s[0].toUpperCase() + s.slice(1)
}
