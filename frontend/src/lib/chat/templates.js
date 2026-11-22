// The chat's replies, built from the results of lib/chat/execute.js with fixed words (Elena, 2026-11-21): the model
// never writes them. A reply may carry `links`: [{ text, id }], the names in its text of places of the area, in order,
// which the panel shows as buttons that open the place. English only for now; an Italian message gets ITALIAN_NOTE first. Never the word "persona".

import { LAYER_NAMES } from './intent.js'

export const ITALIAN_NOTE = 'I understood your request; replies are in English for now.'
export const INTRO = 'Ask about places on the map or your profile: find easy or quiet places, ask why a place is hard, plan a calmer route, change the view, or get tips that follow your answers.'

/** Element words, lowercased in a sentence: "traffic, trams; crowds". */
const list = (codes, name) => codes.map((c) => name(c).toLowerCase()).join('; ')
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const LEVEL_WORD = { easy: 'easy', mixed: 'mixed', hard: 'hard' }

/** The examples of "What can I ask?", by task. */
export const EXAMPLES = [
  { task: 'Find places', items: ['Easy streets with shade near Karlsplatz', 'Places with seats and fewer people', 'Quiet streets within 300 m'] },
  { task: 'Why a place is rated so', items: ['Why is this street hard?', 'What makes Graben mixed for me?'] },
  { task: 'Plan a route', items: ['A calmer way to the Naschmarkt', 'Compare routes from Stephansplatz to Karlsplatz'] },
  { task: 'Change the view', items: ['Show thermal in summer at 15:00', 'Switch to the overall layer'] },
  { task: 'Your profile', items: ['What bothers me most?', 'What feels good to me?'] },
  { task: 'Prepare and cope', items: ['How can I prepare for the Naschmarkt?', 'What could help me on this street?'] },
]
/** The rotating example in the input field. */
export const PLACEHOLDERS = EXAMPLES.flatMap((e) => e.items.slice(0, 1))

export const outOfScope = () => ({
  text: 'I can only help with places on the SenCity map and with your profile.',
  suggestions: ['Easy streets with shade near Karlsplatz', 'What bothers me most?'],
})

/** No area to look in. */
export const needArea = () => ({ text: 'Choose an area first: type a place in the search, or ask for places near one, such as “easy streets near Karlsplatz”.' })
export const notFound = (q) => ({ text: `I could not find “${q}”. Try another name.` })
export const needPlace = () => ({ text: 'Open a place on the map first, or name one: “why is Graben hard?”.' })
export const needProfile = () => ({ text: 'You have no profile yet. Create one under Profile, and I can tell you what it says.' })
export const failed = () => ({ text: 'Could not send. Try again.' })

/**
 * filter_places. r: execute.filterPlaces; pills: the pills shown; layer: the layer the level follows; rating: the area
 * is still being rated; shown: how many are marked on the map.
 */
export function filterReply(r, { pills, layer, level, rating = false, shown = 0 }) {
  const still = rating ? ' The photos are still being rated, so more may match.' : ''
  if (!r.total) return needArea()
  if (!r.matches.length) {
    const last = pills.at(-1)
    return { text: `No places match${pills.length ? ` ${pills.map((p) => `“${p.label}”`).join(', ')}` : ''}.${last ? ` Try removing “${last.label}”.` : ''}${still}` }
  }
  const n = r.matches.length
  const on = LAYER_NAMES[layer]
  let text
  if (level) text = `${plural(n, 'place is', 'places are')} ${LEVEL_WORD[level]} for you on ${on}.`
  else {
    const easy = r.counts.easy
    text = `${plural(n, 'place matches', 'places match')}; ${easy} ${easy === 1 ? 'is' : 'are'} easy for you on ${on}.`
  }
  if (shown) text += ` The first ${shown === 1 ? '' : `${shown} `}${shown === 1 ? 'is' : 'are'} marked on the map.`
  return { text: text + still }
}

/** explain_place. e: execute.explainPlace; name(code): an element's words. */
export function explainReply(e, { name, personal }) {
  const who = personal ? 'for you' : 'in general (not personalised yet)'
  const title = e.name || 'This place'
  if (e.status !== 'rated' && !e.level) return { text: `${title} has no rating yet${e.status === 'pending' ? ': it is still being rated' : ''}.` }
  const parts = []
  if (e.layer !== 'senses' && e.level) parts.push(`${title} is ${e.level} ${who} on ${LAYER_NAMES[e.layer]}.`)
  if (e.comfort != null) parts.push(`${e.layer !== 'senses' ? 'From the photos' : title} ${e.layer !== 'senses' ? 'it is' : 'is'} ${e.sensesLevel} ${who}: ${e.comfort} of 5.`)
  if (e.layer !== 'senses' && e.thermal && e.utci != null) parts.push(`Thermal: ${e.thermal}, feels like ${Math.round(e.utci)} °C.`)
  if (e.inPhotos.length) parts.push(`The photos show: ${list(e.inPhotos, name)}.`)
  if (e.bothersYou.length) parts.push(`You said ${e.bothersYou.length === 1 ? 'this bothers' : 'these bother'} you: ${list(e.bothersYou, name)}.`)
  if (e.goodForYou.length) parts.push(`You said ${e.goodForYou.length === 1 ? 'this feels' : 'these feel'} good: ${list(e.goodForYou, name)}.`)
  return { text: parts.join(' '), quote: e.reason ? { label: 'The model’s words, a prediction, not a reason:', text: e.reason } : null,
    links: e.name && e.id != null ? [{ text: e.name, id: e.id }] : [] }
}

/** summarise_profile. s: execute.summariseProfile; words(n): the A11 words. */
export function profileReply(s, topic, { name, a11Words }) {
  const fmt = (rows) => rows.map((r) => `${name(r.code)} (${r.score})`).join(', ')
  const bothers = s.bothers.length ? `Bothers you most: ${fmt(s.bothers)}.` : 'Nothing in your answers bothers you much (no element at 1 or 2).'
  const good = s.good.length ? `Feels good: ${fmt(s.good)}.` : 'No element feels very good in your answers (none at 4 or 5).'
  if (topic === 'bothers') return { text: s.bothers.length ? `What bothers you most, from your answers: ${fmt(s.bothers)}.` : bothers }
  if (topic === 'feels_good') return { text: s.good.length ? `What feels good to you, from your answers: ${fmt(s.good)}.` : good }
  const overall = s.overall != null ? `In general you feel ${a11Words(s.overall)} in outdoor public spaces (${s.overall} of 5). ` : ''
  return { text: `${overall}${bothers} ${good}` }
}

/** plan_route: what was opened. */
export const routeReply = ({ from, to, layer }) => ({ text: `Comparing two routes from ${from} to ${to} on ${LAYER_NAMES[layer]}.` })

/** set_view: what the map shows now. */
export function viewReply({ layer, season, time }) {
  const when = season || time ? ` (${[season, time].filter(Boolean).join(' at ')})` : ''
  return { text: `Showing ${LAYER_NAMES[layer]}${when}.` }
}

const places = (n) => `${n} ${n === 1 ? 'place' : 'places'}`
const degrees = (t) => `${Math.round(t).toString().replace('-', '−')} °C`

/** What the app knows about the area or the place: photo ratings, thermal comfort and why. f: execute.placeFacts. */
export function factsText(f, { name, personal, when }) {
  const who = personal ? ' for you' : ''
  const out = []
  if (f.scope === 'place') {
    const title = name || 'This place'
    if (f.comfort) out.push(`${title} is ${f.comfort[0]} of 5 for your senses${personal ? '' : ' (not personalised yet)'}.`)
    else out.push(`${title} has no photo rating yet.`)
  } else if (f.comfort) {
    out.push(f.comfort[0] === f.comfort[1]
      ? `Every rated place in this area is ${f.comfort[0]} of 5 for your senses${personal ? '' : ' (not personalised yet)'}.`
      : `This area has a mix of sensory comfort, from ${f.comfort[0]} to ${f.comfort[1]} of 5${who}.`)
  } else out.push('The photos of this area are not rated yet.')
  const t = f.thermal
  if (t) {
    const range = t.levels.length > 1 ? `${t.levels[0]} to ${t.levels.at(-1)}` : t.levels[0]
    const cause = t.heat && t.cold ? ', with both heat and cold'
      : t.heat ? `, because of high temperatures (feels like up to ${degrees(t.max)})`
        : t.cold ? `, because of low temperatures (feels like down to ${degrees(t.min)})` : ''
    out.push(`Thermal comfort ${f.scope === 'place' ? 'there ' : ''}is ${range}${who}${cause}${when ? `, ${when}` : ''}.`)
  }
  return out.join(' ')
}

/**
 * prepare_cope: the facts, then tips that follow only what the person said helps (Q4) or how they prepare (Q2), each
 * with what the photos show. Never medical; nothing the app does not know. p: execute.prepareCope.
 */
export function copeReply(f, p, { name, personal, when, place = null, placeId = null }) {
  const facts = factsText(f, { name: place, personal, when })
  const links = place && placeId != null ? [{ text: place, id: placeId }] : []
  if (!p.answered) return { text: `${facts} Answer “How you prepare for new places” in your profile, and the tips will follow what helps you.`, links }
  const here = f.scope === 'place' ? ' there' : ' in this area'
  const at = (n) => (f.scope === 'place' ? 'in its photos' : `in the photos of ${places(n)}`)
  const n = (code) => f.elements[code] ?? 0
  const blind = f.looked === 0 // no photo of it is rated yet: the app cannot say what is there
  const tips = []
  const has = (c) => p.helps.includes(c)
  if (has('drink_eat') || (p.prepares.includes('rest_places') && !has('sit_rest'))) {
    if (blind) tips.push('Bring water with you: the photos are not rated yet, so the app cannot tell whether there are drinking fountains.')
    else if (n('drinking_fountains_toilets')) tips.push(`Drinking fountains or toilets show ${at(n('drinking_fountains_toilets'))}.`)
    else tips.push(`Bring water with you: no drinking fountain shows in the photos${here}${n('food_stalls_cafes') ? ', though there are cafés or food stalls' : ''}.`)
  }
  if (has('sit_rest') || p.prepares.includes('rest_places')) {
    if (blind || !n('seats')) tips.push(`Plan time to rest${blind ? '' : `: no seats show in the photos${here}`}.`)
    else tips.push(`Seats show ${at(n('seats'))}: plan time to rest there.`)
  }
  if (has('quieter_spot')) {
    if (f.scope === 'place') {
      tips.push(f.easier ? `If it gets too much, ${f.easier.name || 'a street'} about ${Math.round(f.easier.d / 10) * 10} m away may be easier for you.` : 'The map shows no easier street close by to step away to.')
      if (f.easier?.name && f.easier.id != null) links.push({ text: f.easier.name, id: f.easier.id })
    } else if (f.easy.length) {
      const shown = f.easy.slice(0, 2)
      tips.push(`If it gets too much, ${places(f.easy.length)} here ${f.easy.length === 1 ? 'is' : 'are'} easy for you, such as ${shown.map((x) => x.name).join(' and ')}.`)
      links.push(...shown.map((x) => ({ text: x.name, id: x.id })))
    }
    else tips.push('The map shows no easy place here to step away to.')
  }
  if (has('headphones_earplugs') && !blind) {
    const parts = [n('traffic_trams') && `traffic${f.scope === 'area' ? ` at ${places(n('traffic_trams'))}` : ''}`, n('crowds') && `crowds${f.scope === 'area' ? ` at ${places(n('crowds'))}` : ''}`].filter(Boolean)
    if (parts.length) tips.push(`Bring headphones or earplugs: the photos show ${parts.join(' and ')}.`)
  }
  if (has('sunglasses_hat') && (f.thermal?.heat || n('direct_sun'))) {
    tips.push(`Bring sunglasses or a hat${n('direct_sun') ? `: direct sun shows ${at(n('direct_sun'))}` : ': it may feel hot'}.`)
  }
  if (p.prepares.includes('check_busy') && !blind) tips.push(n('crowds') ? `Crowds show ${at(n('crowds'))}; the app does not know the busy hours.` : `No crowds show in the photos${here}; the app does not know the busy hours.`)
  if (has('leave_earlier')) tips.push('Plan when you could leave early, as you said that helps.')
  if (has('trusted_person')) tips.push('You said being with someone you trust helps.')
  if (p.prepares.includes('calmer_route')) tips.push(`To get there, ask for “a calmer way to ${place || 'this area'}”.`)
  if (p.prepares.includes('look_at_photos')) tips.push(f.scope === 'place' ? 'Its photos are on its card.' : 'Open the places on the map to see their photos.')
  if (has('nothing_helps')) tips.push('You said nothing really helps: the place cards show what might bother you, so you can decide before you go.')
  if (p.other) tips.push(`You also wrote: “${p.other}”.`)
  return { text: [facts, ...tips].join(' '), links }
}

/**
 * A reply's text cut into plain parts and links, in order: [{ text }, { text, id }, …]. A link is found after the
 * previous one; a name not found in the text stays out (never a link to the wrong words).
 */
export function linkParts(text, links = []) {
  const out = []
  let at = 0
  for (const l of links ?? []) {
    const i = l.text ? text.indexOf(l.text, at) : -1
    if (i < 0) continue
    if (i > at) out.push({ text: text.slice(at, i) })
    out.push({ text: l.text, id: l.id })
    at = i + l.text.length
  }
  if (at < text.length) out.push({ text: text.slice(at) })
  return out
}
