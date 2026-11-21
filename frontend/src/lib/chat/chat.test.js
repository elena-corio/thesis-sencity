// The chat in the browser: intents and pills, each action carried out on made-up data, and the reply templates.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { explainPlace, filterPlaces, levelOn, prepareCope, summariseProfile } from './execute.js'
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
  const prepare = { Q1: 3, Q2: { ticked: ['check_busy', 'rest_places'], other: '' }, Q3: 4, Q4: { ticked: ['sit_rest', 'headphones_earplugs', 'quieter_spot'], other: '' } }
  it('only what the person ticked, with the facts the photos give', () => {
    const p = prepareCope({ prepare, listed: ['traffic_trams', 'crowds'], easier: { name: 'Quiet Lane', d: 140 }, name: 'Graben' })
    expect(p.answered).toBe(true)
    expect(p.tips.map((t) => t.code)).toEqual(['quieter_spot', 'sit_rest', 'headphones_earplugs', 'check_busy', 'rest_places'])
    expect(p.tips.find((t) => t.code === 'sit_rest').facts).toEqual({ found: [], looked: true })
    expect(p.tips.find((t) => t.code === 'headphones_earplugs').facts.found).toEqual(['traffic_trams', 'crowds'])
  })
  it('nothing ticked: nothing to say', () => {
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

  it('cope reply: only what the person said helps, facts from the photos, nothing medical', () => {
    const prepare = { Q2: { ticked: [] }, Q4: { ticked: ['sit_rest', 'quieter_spot', 'leave_earlier'], other: '' } }
    const t = T.copeReply(prepareCope({ prepare, listed: ['seats'], easier: null, name: 'Graben' }), { name }).text
    expect(t).toBe('You said stepping away to a quieter spot helps; the map shows no easier street close by. You said sitting down to rest helps: the photos at Graben show seats. You said leaving earlier than planned helps.')
    expect(t).not.toMatch(/medic|doctor|therap|diagnos|persona/i)
    expect(T.copeReply(prepareCope({ prepare: null }), { name }).text).toMatch(/^Answer “How you prepare for new places”/)
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
    expect(T.EXAMPLES).toHaveLength(6)
  })
})
