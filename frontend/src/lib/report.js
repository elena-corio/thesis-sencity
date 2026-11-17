// The printable report (boards 8, 8b; brief §7): which sections appear, how they share the A4 pages, and their words
// and numbers. Pure: everything comes from what is already on this device (the profile, the area, the routes, the
// ratings); nothing is fetched, sent or stored.
import { overallOf, overallShares, overallVerdict } from './overall.js'
import { hardShare, sensesVerdict } from './senses.js'
import { isCold } from './thermal.js'
import { PLACE_FILTERS, placeGroup } from './place.js'

export const STATES = ['easy', 'mixed', 'hard']
const WORD = { easy: 'Easy', mixed: 'Mixed', hard: 'Hard' }
const pct = (x) => `${Math.round(x * 100)}%`

/**
 * Which sections the report has. A section needs its data: the profile (else a one-line note), an analysed area, a
 * route comparison, a selected place. "In short" needs an area or a route. "How this was made" is always there.
 * @param {{profile:boolean, area:boolean, route:boolean, place:boolean}} has
 */
export function reportSections(has) {
  return {
    inShort: !!(has.area || has.route),
    profile: !!has.profile,
    noProfile: !has.profile,
    area: !!has.area,
    route: !!has.route,
    place: !!has.place,
    made: true,
  }
}

/** Heights in mm on an A4 page (13 mm margins, so 271 mm inside), measured on the rendered blocks (2026-11-17) with the
 *  5 mm gap after each and about 2 mm to spare: e2e/report.spec.js checks that nothing spills over a page. */
export const PAGE_MM = 271
export const BLOCK_MM = {
  head: 19, // logo, title and subtitle (page 1)
  headSmall: 12, // the smaller head of the next pages (board 8b)
  foot: 11,
  inShort: 28,
  profile: 75,
  noProfile: 18,
  area: 131,
  route: 128,
  place: 64,
  made: 37,
}

/**
 * The pages, in the boards' order (profile, area, route, place, how this was made): each block goes on the current
 * page if it fits, else starts the next one. Returns [['inShort', 'profile', 'area'], ['route', 'place', 'made']].
 * @param {ReturnType<typeof reportSections>} s
 */
export function reportPages(s) {
  const order = ['inShort', 'profile', 'noProfile', 'area', 'route', 'place', 'made'].filter((id) => s[id])
  const pages = [[]]
  let used = BLOCK_MM.head + BLOCK_MM.foot
  for (const id of order) {
    if (used + BLOCK_MM[id] > PAGE_MM && pages.at(-1).length) {
      pages.push([])
      used = BLOCK_MM.headSmall + BLOCK_MM.foot
    }
    pages.at(-1).push(id)
    used += BLOCK_MM[id]
  }
  // "How this was made" never sits alone on a page: the block before it comes along.
  const prev = pages.at(-2)
  if (pages.at(-1).length === 1 && pages.at(-1)[0] === 'made' && prev?.length > 1) pages.at(-1).unshift(prev.pop())
  return pages
}

/** "17 November 2026" */
export const reportDate = (d = new Date()) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

/**
 * The area in numbers, on its layer (`${layer}_state` on each street): counts and shares of easy, mixed, hard and
 * none (no photo, value or data), by number of streets as on board 8 ("21 easy, 36%").
 */
export function areaCounts(features, layer) {
  const key = `${layer}_state`
  const counts = { easy: 0, mixed: 0, hard: 0, none: 0 }
  for (const f of features) counts[STATES.includes(f.properties[key]) ? f.properties[key] : 'none']++
  const all = features.length
  return { all, counts, share: Object.fromEntries(Object.entries(counts).map(([k, n]) => [k, all ? n / all : 0])) }
}

/**
 * "Why hard" on Overall (board 8): of the hard streets, how many are hard because of the temperature and how many
 * because of the senses (both when equal, so a street can count twice), with what most often bothers on the senses
 * side. Only on Overall: the other layers rest on one thing. null when nothing is hard.
 * @param {(f:object) => string[]} bothersOf the names of what might bother on that street (from its photo ratings)
 */
export function whyHard(features, layer, bothersOf = () => [], limits = undefined) {
  if (layer !== 'overall') return null
  const hard = features.filter((f) => f.properties.overall_state === 'hard')
  if (!hard.length) return null
  const decider = (f) => overallOf(f.properties.senses_state, f.properties.thermal_state).decider
  const thermal = hard.filter((f) => ['thermal', 'both'].includes(decider(f)))
  const senses = hard.filter((f) => ['senses', 'both'].includes(decider(f)))
  const cold = thermal.filter((f) => f.properties.utci != null && isCold(f.properties.utci, limits)).length
  const tally = new Map()
  for (const f of senses) for (const name of bothersOf(f)) tally.set(name, (tally.get(name) ?? 0) + 1)
  const top = [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 2).map(([n]) => n.toLowerCase())
  return {
    of: hard.length,
    thermal: thermal.length,
    senses: senses.length,
    weather: cold > thermal.length / 2 ? 'cold' : 'heat',
    sensesWhat: top,
  }
}

/** "Parks: 2 of 3 easy" per place type, the most common state (a tie goes to the worse), as on the area card. */
export function placesHere(features, layer) {
  const key = `${layer}_state`
  return PLACE_FILTERS.filter((g) => g.id === 'parks' || g.id === 'squares').map((g) => {
    const fs = features.filter((f) => placeGroup(f.properties, f.geometry.type) === g.id && STATES.includes(f.properties[key]))
    if (!fs.length) return null
    const count = (st) => fs.filter((f) => f.properties[key] === st).length
    const state = ['hard', 'mixed', 'easy'].reduce((best, st) => (count(st) > count(best) ? st : best))
    return { label: g.label, state, text: `${count(state)} of ${fs.length} ${state}` }
  }).filter(Boolean)
}

/** The routes' verdict as on the route card, for its layer (Thermal's comes with the routes). */
export function routeVerdict(layer, shown, thermalText = '') {
  if (layer === 'senses') return sensesVerdict(shown)
  if (layer === 'overall') return overallVerdict(shown)
  return thermalText
}

/** "Based on photos along 80% of A and 92% of B.": what each layer rests on, as on the route card. */
export function routeCoverage(layer, [a, b]) {
  const each = (key) => {
    if (!b) return `${pct(a[key])} of A`
    return pct(a[key]) === pct(b[key]) ? `${pct(a[key])} of A and B` : `${pct(a[key])} of A and ${pct(b[key])} of B`
  }
  if (layer === 'thermal') return `Thermal along ${each('thermal_share')}.`
  if (layer === 'senses') return `Based on photos along ${each('photo_share')}.`
  return `Thermal along ${each('thermal_share')}, photos along ${each('photo_share')}.`
}

/** A route's share of hard walking on its layer, as on the route card. */
export const routeHard = (layer, r) => (layer === 'thermal' ? r.hard_share ?? 0 : layer === 'overall' ? overallShares(r.stretches).hard : hardShare(r.stretches))

/** One row of the comparison (board 8b): name, km and minutes come from the card; plus the hard and mixed stretches. */
export function routeRow(layer, r) {
  const n = (st) => r.stretches.filter((s) => s.state === st).length
  return {
    id: r.id,
    name: r.id === 'A' ? 'shortest' : r.kind === 'easiest' ? 'easiest' : 'alternative',
    hard: routeHard(layer, r),
    hardCount: n('hard'),
    mixedCount: n('mixed'),
    sections: r.stretches.map((s) => ({ key: s.key, state: STATES.includes(s.state) ? s.state : 'none', partial: !!s.partial, length: s.length_m })),
  }
}

/** "3 hard, 5 mixed stretches", "No hard or mixed stretches". */
export function stretchCounts({ hardCount, mixedCount }) {
  if (!hardCount && !mixedCount) return 'No hard or mixed stretches'
  const st = (n) => `${n} stretch${n === 1 ? '' : 'es'}`
  if (!mixedCount) return `${st(hardCount)} hard`
  if (!hardCount) return `${st(mixedCount)} mixed`
  return `${hardCount} hard, ${mixedCount} mixed stretches`
}

/**
 * "In short" (board 8): the area in one sentence, then the route's verdict.
 * @param {{area?:{name:string|null, counts:ReturnType<typeof areaCounts>, why:ReturnType<typeof whyHard>}, route?:string, personal:boolean}} o
 */
export function inShort({ area = null, route = '', personal = false }) {
  const parts = []
  if (area) {
    const { counts: c } = area
    const where = area.name ? `Around ${area.name}` : 'Around the point you chose'
    const forYou = personal ? ' for you' : ''
    let why = ''
    if (area.why) {
      const w = area.why
      why = w.thermal > w.senses ? `, mostly because of ${w.weather}` : w.senses > w.thermal ? `, mostly because of ${personal ? 'your senses' : 'the senses'}` : ''
    }
    parts.push(`${where}, ${c.counts.easy} of ${c.all} streets may feel easy${forYou} and ${c.counts.hard} hard${why}.`)
  }
  if (route) parts.push(route)
  return parts.join(' ')
}

/** The place's overall line (board 8b "Overall hard, because of heat"): { state, word } or null. */
export function placeLevel(props) {
  const o = overallOf(props.senses_state, props.thermal_state)
  return o.state ? { state: o.state, word: WORD[o.state], partial: o.partial, decider: o.decider } : null
}

/** "Easy", "Mixed", "Hard", or null. */
export const stateWord = (s) => WORD[s] ?? null
