// The chat's replies, built from the results of lib/chat/execute.js with fixed words (Elena, 2026-11-21): the model
// never writes them. English only for now; an Italian message gets ITALIAN_NOTE first. Never the word "persona".

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
  return { text: parts.join(' '), quote: e.reason ? { label: 'The model’s words, a prediction, not a reason:', text: e.reason } : null }
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

// What helps, as the person ticked it (config/prepare.json Q4), with its verb.
const HELP_WORDS = {
  quieter_spot: 'stepping away to a quieter spot helps', sit_rest: 'sitting down to rest helps',
  drink_eat: 'drinking or eating something helps', headphones_earplugs: 'headphones or earplugs help',
  sunglasses_hat: 'sunglasses or a hat help', leave_earlier: 'leaving earlier than planned helps',
  trusted_person: 'being with someone you trust helps',
}

/** prepare_cope. p: execute.prepareCope. Only what the person said helps, with facts the app has; nothing else. */
export function copeReply(p, { name }) {
  if (!p.answered) return { text: 'Answer “How you prepare for new places” in your profile, and the tips will follow what you said helps.' }
  const at = p.place ? ` at ${p.place}` : ' here'
  const photos = (f) => (f.found?.length ? `the photos${at} show ${list(f.found, name)}` : f.looked ? `the photos${at} show none` : 'open the place to see what its photos show')
  const tips = []
  for (const t of p.tips) {
    const f = t.facts
    if (t.kind === 'helps') {
      if (t.code === 'nothing_helps') tips.push('You said nothing really helps. The place card shows what might bother you, so you can decide before you go.')
      else if (t.code === 'other') { if (f.text) tips.push(`You also wrote what helps: “${f.text}”.`) }
      else if (t.code === 'quieter_spot') tips.push(f.easier ? `You said ${HELP_WORDS.quieter_spot}: ${f.easier.name || 'a street'} about ${Math.round(f.easier.d / 10) * 10} m away may be easier for you.` : `You said ${HELP_WORDS.quieter_spot}; the map shows no easier street close by.`)
      else if (['leave_earlier', 'trusted_person'].includes(t.code)) tips.push(`You said ${HELP_WORDS[t.code]}.`)
      else tips.push(`You said ${HELP_WORDS[t.code]}: ${photos(f)}.`)
    } else {
      if (t.code === 'look_at_photos') tips.push('You like to look at photos first: the place card shows the photos of each street.')
      if (t.code === 'check_busy') tips.push(`You check how busy a place is: ${f.found?.length ? `the photos${at} show crowds` : f.looked ? `the photos${at} show no crowds` : 'open the place to see its photos'}. The app does not know the busy hours.`)
      if (t.code === 'calmer_route') tips.push(`You plan calmer routes: ask “a calmer way to ${p.place || 'this place'}”.`)
      if (t.code === 'rest_places') tips.push(`You like to know where to rest: ${photos(f)}.`)
    }
  }
  return { text: tips.length ? tips.join(' ') : 'Your answers name nothing the map can show here.' }
}
