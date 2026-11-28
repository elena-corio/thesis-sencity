// The chat in the browser: intents and pills, each action carried out on made-up data, and the reply templates.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compareSeasons, explainPlace, filterPlaces, levelOn, placeFacts, prepareCope, summariseProfile } from './execute.js'
import { PRESETS, WHY_PRESET, blank, clean, isThis, pillsOf, withoutPill } from './intent.js'
import * as T from './templates.js'

const survey = JSON.parse(readFileSync(new URL('../../../../model/app_v9/part_a.json', import.meta.url), 'utf-8'))
const NAMES = Object.fromEntries(survey.questions.flatMap((q) => q.rows ?? []).map((r) => [r.code, r.en]))
const name = (c) => NAMES[c] ?? c

/** A street: a short line, its levels and comfort, and the elements its photos list. */
const street = (id, { senses = null, thermal = null, comfort = null, listed = null, at = [16.37, 48.2085], nameOf = id } = {}) => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: [at, [at[0] + 0.0005, at[1]]] },
  properties: { id, name: nameOf, senses_state: senses, thermal_state: thermal, senses_comfort: comfort, utci: 24, photos: [{ id: `p-${id}` }], listed },
})
const FEATURES = [
  street('a', { senses: 'easy', thermal: 'mixed', comfort: 5, listed: ['shade', 'seats', 'greenery_trees'] }),
  street('b', { senses: 'easy', thermal: 'easy', comfort: 4, listed: ['shade', 'crowds'] }),
  street('c', { senses: 'mixed', thermal: 'hard', comfort: 3, listed: ['traffic_trams', 'shade'] }),
  street('d', { senses: 'hard', thermal: 'easy', comfort: 2, listed: ['traffic_trams', 'crowds', 'signs_ads'] }),
  street('e', { senses: null, thermal: 'easy', comfort: null, listed: null }), // not rated yet
  street('far', { senses: 'easy', thermal: 'easy', comfort: 5, listed: ['shade'], at: [16.40, 48.2085] }), // ~2 km east
]
const listedOf = (f) => f.properties.listed
const run = (intent, opts = {}) => filterPlaces(intent, { features: FEATURES, layer: 'senses', listedOf, ...opts })

describe('intents', () => {
  it('clean keeps known values only', () => {
    const i = clean({ action: 'filter_places', level: 'easiest', with: ['shade', 'shade', 3], radius_m: 9000, time: '7', layer: 'heat', language: 'it' })
    expect(i).toMatchObject({ level: null, with: ['shade'], radius_m: null, time: null, layer: null, language: 'it' })
    expect(clean({ action: 'chat' })).toBe(null)
    expect(clean(null)).toBe(null)
  })

  it('"this" means the open place, in English or Italian', () => {
    for (const s of ['this', 'this street', 'questo posto', 'questa strada', 'here', 'the place I opened']) expect(isThis(s)).toBe(true)
    for (const s of ['Graben', 'Theresianum', null]) expect(isThis(s)).toBe(false)
  })

  it('ready-made prompts are intents, no model call', () => {
    expect(PRESETS.map((p) => p.label)).toEqual(['Easy for me', 'Shade', 'Fewer people', 'Quiet streets', 'Places to sit'])
    expect(PRESETS.find((p) => p.id === 'people').intent.without).toEqual(['crowds'])
    expect(PRESETS.find((p) => p.id === 'quiet').intent.without).toEqual(['traffic_trams'])
    expect(PRESETS.find((p) => p.id === 'sit').intent.with).toEqual(['seats'])
    expect(WHY_PRESET.intent).toMatchObject({ action: 'explain_place', near: 'this' })
  })

  it('pills name the layer the level follows, and a removed pill drops just that part', () => {
    const i = blank('filter_places', { level: 'easy', with: ['shade'], without: ['crowds'], near: 'Karlsplatz', radius_m: 500 })
    const pills = pillsOf(i, { layer: 'overall', name })
    expect(pills.map((p) => p.label)).toEqual(['easy · Overall', 'shade from trees or buildings', 'no crowds', 'near Karlsplatz', '500 m'])
    expect(pillsOf({ ...i, layer: 'thermal' }, { layer: 'overall', name })[0].label).toBe('easy · Thermal') // a named layer wins
    expect(withoutPill(i, 'with:shade').with).toEqual([])
    expect(withoutPill(i, 'level').level).toBe(null)
    expect(withoutPill(i, 'near').near).toBe(null)
    expect(withoutPill(blank('plan_route', { calmer: true }), 'calmer').calmer).toBe(false)
  })
})

describe('filter_places', () => {
  it('by level on the current layer, easiest first, then the best comfort', () => {
    const r = run(blank('filter_places', { level: 'easy' }))
    expect(r.matches.map((m) => m.f.properties.id)).toEqual(['a', 'far', 'b'])
    expect(r.unknown).toBe(1) // e: not rated on Senses
    expect(run(blank('filter_places', { level: 'easy' }), { layer: 'thermal' }).matches.map((m) => m.f.properties.id).sort()).toEqual(['b', 'd', 'e', 'far'])
  })

  it('on Overall the level is the worse of the two', () => {
    expect(levelOn(FEATURES[0], 'overall')).toBe('mixed')
    // e has no photo rating: its overall level is its thermal one, partial (lib/overall.js), as on the map.
    expect(run(blank('filter_places', { level: 'easy' }), { layer: 'overall' }).matches.map((m) => m.f.properties.id).sort()).toEqual(['b', 'e', 'far'])
  })

  it('by elements there and not there; places without listed elements cannot match', () => {
    const r = run(blank('filter_places', { with: ['shade'], without: ['crowds'] }))
    expect(r.matches.map((m) => m.f.properties.id)).toEqual(['a', 'far', 'c'])
    expect(r.unknown).toBe(1)
  })

  it('within a radius of a point', () => {
    const r = run(blank('filter_places', { with: ['shade'] }), { around: { lat: 48.2085, lon: 16.37 }, radius: 300 })
    expect(r.matches.map((m) => m.f.properties.id)).not.toContain('far')
    expect(r.total).toBe(5)
  })

  it('counts the levels of what matches', () => {
    expect(run(blank('filter_places', { with: ['shade'] })).counts).toEqual({ easy: 3, mixed: 1, hard: 0 })
  })
})

describe('explain_place', () => {
  it('from the stored rating, the photos\' elements and your answers', () => {
    const answers = { A11: 2, A12: { traffic_trams: 1, signs_ads: 2, greenery_trees: 5 }, A13: { crowds: 1, seats: 4 } }
    const place = { status: 'rated', level: 'hard', comfort: 2, listed: ['traffic_trams', 'crowds', 'signs_ads', 'seats'], reason: 'Busy road.' }
    const e = explainPlace({ f: FEATURES[3], place, layer: 'senses', answers })
    expect(e).toMatchObject({ name: 'd', level: 'hard', comfort: 2, bothersYou: ['traffic_trams', 'crowds', 'signs_ads'], goodForYou: ['seats'], reason: 'Busy road.' })
    expect(explainPlace({ f: FEATURES[3], place, layer: 'senses', answers: null }).bothersYou).toEqual([]) // no profile: nothing said about you
  })
})

describe('summarise_profile', () => {
  it('the strongest answers each way, as the radar has them', () => {
    const answers = { A11: 2, A12: { traffic_trams: 1, signs_ads: 2, greenery_trees: 5, nice_buildings: 3 }, A13: { crowds: 1, seats: 4, shade: 5 } }
    const s = summariseProfile(survey, answers)
    expect(s.overall).toBe(2)
    expect(s.bothers.map((r) => r.code)).toEqual(['traffic_trams', 'crowds', 'signs_ads'])
    expect(s.good.map((r) => r.code)).toEqual(['greenery_trees', 'shade', 'seats'])
  })
})

describe('prepare_cope', () => {
  it('facts about the whole area: photo ratings from–to, thermal levels and why, elements in the photos', () => {
    const f = placeFacts(FEATURES, { listedOf, layer: 'senses', coldOf: (t) => t < 0 })
    expect(f).toMatchObject({ scope: 'area', comfort: [2, 5], rated: 5, looked: 5 })
    expect(f.easy).toEqual([{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }, { id: 'far', name: 'far' }])
    expect(f.thermal).toMatchObject({ levels: ['easy', 'mixed', 'hard'], heat: true, cold: false })
    expect(f.elements).toMatchObject({ shade: 4, seats: 1, crowds: 2, traffic_trams: 2 })
  })

  it('facts about one place, with a calmer street nearby', () => {
    const f = placeFacts([FEATURES[3]], { listedOf, layer: 'senses', scope: 'place', easier: { name: 'Quiet Lane', d: 140 } })
    expect(f).toMatchObject({ scope: 'place', comfort: [2, 2], easy: [], easier: { name: 'Quiet Lane', d: 140 } })
  })

  it('only the answers the person ticked', () => {
    const p = prepareCope({ prepare: { Q2: { ticked: ['check_busy'] }, Q4: { ticked: ['sit_rest', 'other'], other: 'a quiet corner' } } })
    expect(p).toEqual({ answered: true, helps: ['sit_rest', 'other'], prepares: ['check_busy'], other: 'a quiet corner' })
    expect(prepareCope({ prepare: null }).answered).toBe(false)
  })
})

describe('templates', () => {
  it('filter replies count what matches and how many are easy, naming the layer', () => {
    const r = run(blank('filter_places', { with: ['shade'] }))
    expect(T.filterReply(r, { pills: [], layer: 'senses', shown: 4 }).text).toBe('4 places match; 3 are easy for you on Senses. The first 4 are marked on the map.')
    const easy = run(blank('filter_places', { level: 'easy' }))
    expect(T.filterReply(easy, { pills: [], layer: 'overall', level: 'easy', shown: 3 }).text).toBe('3 places are easy for you on Overall. The first 3 are marked on the map.')
  })

  it('nothing matches: says so and suggests removing the last pill', () => {
    const r = run(blank('filter_places', { with: ['fountains_water'] }))
    const t = T.filterReply(r, { pills: [{ key: 'with:fountains_water', label: 'fountains, water' }], layer: 'senses' }).text
    expect(t).toBe('No places match “fountains, water”. Try removing “fountains, water”.')
    expect(T.filterReply({ total: 0, matches: [] }, { pills: [], layer: 'senses' }).text).toMatch(/^Choose an area first/)
  })

  it('explain reply: level, photos, your answers; the model\'s words quoted as a prediction', () => {
    const e = { name: 'Graben', layer: 'senses', level: 'hard', sensesLevel: 'hard', comfort: 2, inPhotos: ['traffic_trams', 'crowds'], bothersYou: ['crowds'], goodForYou: [], reason: 'Many people.', status: 'rated' }
    const r = T.explainReply(e, { name, personal: true })
    expect(r.text).toBe('Graben is hard for you: 2 of 5. The photos show: traffic, trams; crowds. You said this bothers you: crowds.')
    expect(r.quote).toEqual({ label: 'The model’s words, a prediction, not a reason:', text: 'Many people.' })
  })

  it('profile reply, by topic', () => {
    const s = { overall: 2, bothers: [{ code: 'crowds', score: 1 }], good: [{ code: 'shade', score: 5 }] }
    const words = { name, a11Words: () => 'not very comfortable' }
    expect(T.profileReply(s, 'bothers', words).text).toBe('What bothers you most, from your answers: Crowds (1).')
    expect(T.profileReply(s, 'overall', words).text).toBe('In general you feel not very comfortable in outdoor public spaces (2 of 5). Bothers you most: Crowds (1). Feels good: Shade from trees or buildings (5).')
  })

  it('cope reply for an area: the facts, then tips from what helps the person (Elena’s example)', () => {
    const facts = { scope: 'area', comfort: [2, 4], rated: 12, looked: 12, easy: [], easier: null,
      thermal: { levels: ['mixed', 'hard'], heat: true, cold: false, max: 36.2, min: 27 }, elements: { traffic_trams: 4 } }
    const p = prepareCope({ prepare: { Q2: { ticked: [] }, Q4: { ticked: ['drink_eat', 'sit_rest'] } } })
    const t = T.copeReply(facts, p, { name, personal: true, when: 'summer at 15:00' }).text
    expect(t).toBe('This area has a mix of sensory comfort, from 2 to 4 of 5 for you. Thermal comfort is mixed to hard for you, ' +
      'because of high temperatures (feels like up to 36 °C), summer at 15:00. Bring water with you: no drinking fountain shows in ' +
      'the photos in this area. Plan time to rest: no seats show in the photos in this area.')
    expect(t).not.toMatch(/medic|doctor|therap|diagnos|persona/i)
  })

  it('cope reply: facts the photos give, a calmer street, and nothing for answers not ticked', () => {
    const facts = { scope: 'place', comfort: [2, 2], rated: 1, looked: 1, easy: [], easier: { id: 'q', name: 'Quiet Lane', d: 137 },
      thermal: null, elements: { seats: 1, drinking_fountains_toilets: 1, crowds: 1 } }
    const p = prepareCope({ prepare: { Q2: { ticked: ['check_busy'] }, Q4: { ticked: ['quieter_spot', 'sit_rest', 'drink_eat'] } } })
    const r = T.copeReply(facts, p, { name, personal: true, when: '', place: 'Graben', placeId: 'g' })
    const t = r.text
    expect(r.links).toEqual([{ text: 'Graben', id: 'g' }, { text: 'Quiet Lane', id: 'q' }]) // both names open their place
    expect(t).toBe('Graben is 2 of 5 for your senses. Drinking fountains or toilets show in its photos. Seats show in its photos: plan ' +
      'time to rest there. If it gets too much, Quiet Lane about 140 m away may be easier for you. Crowds show in its photos; the app ' +
      'does not know the busy hours.')
    expect(t).not.toMatch(/headphones|sunglasses/) // not ticked: not said
  })

  it('cope reply when the photos are not rated yet, or nothing is answered', () => {
    const blind = { scope: 'area', comfort: null, rated: 0, looked: 0, easy: [], easier: null, thermal: null, elements: {} }
    const p = prepareCope({ prepare: { Q2: { ticked: [] }, Q4: { ticked: ['drink_eat'] } } })
    expect(T.copeReply(blind, p, { name, personal: true }).text).toBe('The photos of this area are not rated yet. Bring water with you: ' +
      'the photos are not rated yet, so the app cannot tell whether there are drinking fountains.')
    expect(T.copeReply(blind, prepareCope({ prepare: null }), { name, personal: true }).text).toMatch(/Answer “How you prepare for new places”/)
  })

  it('cope reply for an area names easy places as links', () => {
    const facts = { scope: 'area', comfort: [3, 5], rated: 3, looked: 3, easier: null, thermal: null, elements: {},
      easy: [{ id: 'a', name: 'Am Hof' }, { id: 'b', name: 'Freyung' }, { id: 'c', name: 'Graben' }] }
    const r = T.copeReply(facts, prepareCope({ prepare: { Q4: { ticked: ['quieter_spot'] } } }), { name, personal: true })
    expect(r.text).toContain('If it gets too much, 3 places here are easy for you, such as Am Hof and Freyung.')
    expect(r.links).toEqual([{ text: 'Am Hof', id: 'a' }, { text: 'Freyung', id: 'b' }])
  })

  it('explain reply links the place’s name', () => {
    const e = { id: 'g', name: 'Graben', layer: 'senses', level: 'hard', sensesLevel: 'hard', comfort: 2, inPhotos: [], bothersYou: [], goodForYou: [], reason: null, status: 'rated' }
    expect(T.explainReply(e, { name, personal: true }).links).toEqual([{ text: 'Graben', id: 'g' }])
  })

  it('linkParts cuts the text into words and links, in order; a name not in the text is no link', () => {
    expect(T.linkParts('Try Am Hof or Freyung.', [{ text: 'Am Hof', id: 'a' }, { text: 'Freyung', id: 'b' }, { text: 'Nowhere', id: 'n' }]))
      .toEqual([{ text: 'Try ' }, { text: 'Am Hof', id: 'a' }, { text: ' or ' }, { text: 'Freyung', id: 'b' }, { text: '.' }])
    expect(T.linkParts('Plain text.', [])).toEqual([{ text: 'Plain text.' }])
    // The same name twice in the links: each finds the next occurrence.
    expect(T.linkParts('Graben is hard. Graben has crowds.', [{ text: 'Graben', id: 'g' }]).filter((x) => x.id)).toHaveLength(1)
  })

  it('compares the two routes on the map from what is loaded, with the route card’s verdict', () => {
    const list = [{ id: 'A', length_m: 1240, minutes: 16, stretches: [] }, { id: 'B', length_m: 1480, minutes: 19, stretches: [] }]
    const hard = { A: 0.4, B: 0.05 }
    const t = T.compareReply(list, { layer: 'senses', verdict: 'B is easier for your senses.', hardOf: (r) => hard[r.id] }).text
    expect(t).toBe('The two routes on the map: Route A: 1.2 km, 16 min, 40% hard on Senses. Route B: 1.5 km, 19 min, 5% hard on Senses. B is easier for your senses.')
  })

  it('prepare for a route: the facts along it, then the tips', () => {
    const facts = placeFacts(FEATURES.slice(0, 4), { listedOf, layer: 'senses', scope: 'route', coldOf: () => false })
    expect(facts.easy.map((x) => x.id)).toEqual(['a', 'b'])
    const r = T.copeReply(facts, prepareCope({ prepare: { Q4: { ticked: ['sit_rest', 'quieter_spot'] } } }), { name, personal: true, when: 'summer at 15:00' })
    expect(r.text).toMatch(/^This route has a mix of sensory comfort, from 2 to 5 of 5 for you\. Thermal comfort along this route is easy to hard for you/)
    expect(r.text).toContain('Seats show in the photos of 1 place along it: plan time to rest there.')
    expect(r.text).toContain('If it gets too much, 2 places along it are easy for you, such as a and b.')
  })

  it('route, view and out-of-scope replies; the Italian note', () => {
    expect(T.routeReply({ from: 'Stephansplatz', to: 'Naschmarkt', layer: 'senses' }).text).toBe('Comparing two routes from Stephansplatz to Naschmarkt on Senses.')
    expect(T.viewReply({ layer: 'thermal', season: 'summer', time: '15:00' }).text).toBe('Showing Thermal (summer at 15:00).')
    expect(T.outOfScope().suggestions).toHaveLength(2)
    expect(T.ITALIAN_NOTE).toBe('I understood your request; replies are in English for now.')
  })

  it('never says "persona"', () => {
    const all = JSON.stringify([T.INTRO, T.EXAMPLES, T.outOfScope(), T.needArea(), T.needPlace(), T.needProfile(), PRESETS])
    expect(all).not.toMatch(/persona/i)
    expect(T.EXAMPLES).toHaveLength(7)
  })
})

describe('compare_seasons (Elena, 2026-11-23: "which season is the best to go?")', () => {
  // The standard-like limits here: hard above 32 or below 0, mixed above 26 or below 9.
  const stateOf = (t) => (t > 32 || t < 0 ? 'hard' : t > 26 || t < 9 ? 'mixed' : 'easy')
  const coldOf = (t) => t < 9
  const three = [street('a', { senses: 'easy' }), street('b', { senses: 'easy' }), street('c', { senses: 'hard' })]
  const values = {
    spring: { a: 18, b: 20, c: 19 },
    summer: { a: 35, b: 30, c: 34 },
    autumn: { a: 17, b: 21, c: 18 },
    winter: { a: -3, b: 2, c: -1 },
  }

  it('counts each season on Overall (the worse of the photos and that season), and names the best', () => {
    const r = compareSeasons(three, values, { stateOf, coldOf })
    expect(r.rows.map((x) => [x.season, x.easy, x.mixed, x.hard])).toEqual([
      ['spring', 2, 0, 1], ['summer', 0, 1, 2], ['autumn', 2, 0, 1], ['winter', 0, 1, 2]])
    expect(r.best).toEqual(['spring', 'autumn']) // a tie is said as one
    expect(r.rows.find((x) => x.season === 'summer').why).toBe('heat')
    expect(r.rows.find((x) => x.season === 'winter').why).toBe('cold')
    expect(r.photos).toBe(true)
  })

  it('without photo ratings it rests on thermal comfort alone, and says so', () => {
    const bare = three.map((f) => ({ ...f, properties: { ...f.properties, senses_state: null } }))
    const r = compareSeasons(bare, { spring: values.spring, summer: values.summer }, { stateOf, coldOf })
    expect(r.best).toEqual(['spring'])
    expect(T.seasonsReply(r, { time: '15:00' }).text).toContain('From thermal comfort only: the photos are not rated yet.')
  })

  it('the reply: the best first with its numbers, then the others with heat or cold; a button to show it', () => {
    const r = compareSeasons(three, values, { stateOf, coldOf })
    const reply = T.seasonsReply(r, { time: '15:00', personal: true, current: 'summer', showing: true })
    expect(reply.text).toBe('For you, Spring and autumn look best here at 15:00: 2 of 3 streets may feel easy and 1 hard. '
      + 'Summer: 0 easy, 2 hard, mostly heat. Winter: 0 easy, 2 hard, mostly cold. '
      + 'Only thermal comfort changes with the season; the photo ratings stay the same.')
    expect(reply.actions).toEqual([{ id: 'season:spring', label: 'Show spring' }])
    // Already on the map: no button, it says so.
    const shown = T.seasonsReply(r, { time: '15:00', current: 'spring', showing: true })
    expect(shown.actions).toEqual([])
    expect(shown.text).toMatch(/^In general, .* The map already shows spring\.$/)
  })

  it('one place: its level and feels-like in each season', () => {
    const r = compareSeasons([three[0]], values, { stateOf, coldOf })
    expect(T.seasonsReply(r, { time: '15:00', place: 'Graben', personal: true }).text).toBe(
      'For you, Graben looks best in spring and autumn at 15:00: easy, feels like 18 °C. '
      + 'Summer: hard, feels like 35 °C. Winter: hard, feels like −3 °C. '
      + 'Only thermal comfort changes with the season; the photo ratings stay the same.')
  })

  it('asks before billed runs, with how many', () => {
    expect(T.seasonsAsk(3, { time: '15:00' })).toEqual({
      text: 'To compare the seasons for this area I need thermal comfort for each season at 15:00: up to 3 new simulations, '
        + 'billed by Infrared.city, a few minutes each (any already done are free). Run them?',
      actions: [{ id: 'run-seasons', label: 'Run them' }],
    })
    expect(T.seasonsAsk(1, { time: '15:00', place: 'Graben' }).actions[0].label).toBe('Run it')
  })

  it('no thermal values: says the seasons cannot be compared', () => {
    expect(T.seasonsReply(compareSeasons(three, {}, { stateOf }), { time: '15:00' }).text).toBe('There are no thermal values for this area, so the seasons cannot be compared.')
  })

  it('compare_seasons is a known action, and a named place is its pill', () => {
    expect(clean(blank('compare_seasons', { near: 'Graben' }))?.action).toBe('compare_seasons')
    expect(pillsOf(blank('compare_seasons', { near: 'Graben' }))).toEqual([{ key: 'near', label: 'Graben' }])
  })
})
