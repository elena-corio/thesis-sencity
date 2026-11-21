// The chat's intents (Elena, 2026-11-21): what POST /api/chat returns (backend/app/chat.py), what the ready-made
// prompts build without a model call, and the pills that show how a request was read. Removing a pill runs the same
// intent again without that part, with no model call.

export const ACTIONS = ['filter_places', 'explain_place', 'plan_route', 'set_view', 'summarise_profile', 'prepare_cope', 'out_of_scope']
const LEVELS = ['easy', 'mixed', 'hard']
const LAYERS = ['senses', 'thermal', 'overall']
const SEASONS = ['spring', 'summer', 'autumn', 'winter']
const TOPICS = ['bothers', 'feels_good', 'overall']
export const LAYER_NAMES = { senses: 'Senses', thermal: 'Thermal', overall: 'Overall' }

/** An intent with every field, as the API sends it. */
export const blank = (action, over = {}) => ({
  action, language: 'en', level: null, with: [], without: [], near: null, radius_m: null, start: null, end: null,
  calmer: false, layer: null, season: null, time: null, topic: null, ...over,
})

// "This street", "questo posto", "here"…: the place already open, whatever words the parser kept.
const THIS = /^(this|that|here|questo|questa|qui|qua)\b|^the (place|street|square) i opened$|^(il|lo) (posto|luogo) aperto$/i
/** The message points at the open place card. */
export const isThis = (near) => typeof near === 'string' && THIS.test(near.trim())

/** The intent as the app uses it: known values only (the API checks them too; a preset or an old reply may not). */
export function clean(i) {
  if (!i || !ACTIONS.includes(i.action)) return null
  const pick = (v, list) => (list.includes(v) ? v : null)
  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const codes = (v) => (Array.isArray(v) ? [...new Set(v.filter((c) => typeof c === 'string'))] : [])
  return blank(i.action, {
    language: i.language === 'it' ? 'it' : 'en',
    level: pick(i.level, LEVELS), with: codes(i.with), without: codes(i.without), near: str(i.near),
    radius_m: Number.isInteger(i.radius_m) && i.radius_m >= 50 && i.radius_m <= 500 ? i.radius_m : null,
    start: str(i.start), end: str(i.end), calmer: i.calmer === true, layer: pick(i.layer, LAYERS),
    season: pick(i.season, SEASONS), time: typeof i.time === 'string' && /^\d{2}:00$/.test(i.time) ? i.time : null,
    topic: pick(i.topic, TOPICS),
  })
}

// The ready-made prompts (no model call). "Why is this hard?" sits on a place card.
export const PRESETS = [
  { id: 'easy', label: 'Easy for me', intent: blank('filter_places', { level: 'easy' }) },
  { id: 'shade', label: 'Shade', intent: blank('filter_places', { with: ['shade'] }) },
  { id: 'people', label: 'Fewer people', intent: blank('filter_places', { without: ['crowds'] }) },
  { id: 'quiet', label: 'Quiet streets', intent: blank('filter_places', { without: ['traffic_trams'] }) },
  { id: 'sit', label: 'Places to sit', intent: blank('filter_places', { with: ['seats'] }) },
]
export const WHY_PRESET = { id: 'why', label: 'Why is this hard?', intent: blank('explain_place', { near: 'this' }) }

const LEVEL_WORDS = { easy: 'easy for you', mixed: 'mixed for you', hard: 'hard for you' }

/**
 * The pills of an intent: [{ key, label }]. `layer` is the layer the level follows (the named one, else the map's), so
 * the level pill names it: "easy · Overall". `name(code)` gives an element's words.
 */
export function pillsOf(i, { layer, name = (c) => c } = {}) {
  if (!i) return []
  const out = []
  const shownLayer = i.layer ?? layer
  if (i.action === 'filter_places') {
    if (i.level) out.push({ key: 'level', label: `${i.level} · ${LAYER_NAMES[shownLayer] ?? ''}`.replace(/ · $/, '') })
    for (const c of i.with) out.push({ key: `with:${c}`, label: name(c).toLowerCase() })
    for (const c of i.without) out.push({ key: `without:${c}`, label: `no ${name(c).toLowerCase()}` })
    if (i.near && !isThis(i.near)) out.push({ key: 'near', label: `near ${i.near}` })
    if (i.radius_m) out.push({ key: 'radius_m', label: `${i.radius_m} m` })
  }
  if (i.action === 'plan_route') {
    if (i.start) out.push({ key: 'start', label: `from ${i.start}` })
    if (i.end) out.push({ key: 'end', label: `to ${i.end}` })
    if (i.calmer) out.push({ key: 'calmer', label: 'calmer' })
  }
  if (['explain_place', 'prepare_cope'].includes(i.action) && i.near && !isThis(i.near)) out.push({ key: 'near', label: i.near })
  if (['filter_places', 'set_view'].includes(i.action)) {
    if (i.layer && !(i.action === 'filter_places' && i.level)) out.push({ key: 'layer', label: LAYER_NAMES[i.layer] })
    if (i.season) out.push({ key: 'season', label: i.season })
    if (i.time) out.push({ key: 'time', label: i.time })
  }
  if (i.action === 'summarise_profile' && i.topic) out.push({ key: 'topic', label: { bothers: 'what bothers you', feels_good: 'what feels good', overall: 'your profile' }[i.topic] })
  return out
}
export { LEVEL_WORDS }

/** The intent without one pill's part. */
export function withoutPill(i, key) {
  const [field, code] = key.split(':')
  if (code) return { ...i, [field]: i[field].filter((c) => c !== code) }
  if (field === 'calmer') return { ...i, calmer: false }
  return { ...i, [field]: null }
}
