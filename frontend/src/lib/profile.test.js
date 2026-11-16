import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import cases from '../dev/test-profiles.json'
import {
  answered, buildProfile, clean, complete, emptyAnswers, exportFile, profileVersion, readFile, requestProfile, senseOrder,
  senseScores, strongest,
} from './profile.js'

// The survey as GET /api/profile/survey sends it (backend/app/profile.py survey), read from model/app_v9/.
const dir = new URL('../../../model/app_v9/', import.meta.url)
const partA = JSON.parse(readFileSync(new URL('part_a.json', dir), 'utf-8'))
const rules = JSON.parse(readFileSync(new URL('profile_rules.json', dir), 'utf-8'))
const survey = {
  ...partA,
  profile: {
    template: readFileSync(new URL('profile_template.txt', dir), 'utf-8'),
    constants: Object.fromEntries(['{A11_LOW}', '{A11_HIGH}', '{SCALE_1}', '{SCALE_5}'].map((k) => [k, rules.placeholders[k]])),
    scale_words_en: rules.scale_words_en,
    languages: { en: 'English', it: 'Italian' },
  },
}
const DEV = cases[0]
const ICONS = Object.fromEntries(JSON.parse(readFileSync(new URL('elements.json', dir), 'utf-8')).map((e) => [e.code, e.icon_key]))
for (const q of survey.questions) for (const r of q.rows ?? []) r.icon_key = ICONS[r.code]
// The versions the server gives the same texts (backend/app/profile.py version).
const PYTHON_VERSIONS = ['386e888b8867', '021e74c47d3a', 'a5d4b902e8e6', '3238c5509b77']

describe('the profile text', () => {
  it.each(cases.map((c) => [c.name, c]))('is the study\'s word for word: %s', (_name, c) => {
    expect(buildProfile(survey, c.answers, c.language)).toBe(c.expected)
  })

  it('has the same version as on the server', async () => {
    expect(await Promise.all(cases.map((c) => profileVersion(buildProfile(survey, c.answers, c.language))))).toEqual(PYTHON_VERSIONS)
  })

  it('keeps an open answer with $ patterns verbatim', () => {
    const text = buildProfile(survey, { ...DEV.answers, A16: "it costs $& and $1, isn't it" }, 'en')
    expect(text).toContain('"it costs $& and $1, isn\'t it"')
  })

  it('never says persona', () => {
    expect(buildProfile(survey, DEV.answers, 'en').toLowerCase()).not.toContain('persona')
  })
})

describe('the answers', () => {
  it('are complete only with A11 and every grid row', () => {
    const a = emptyAnswers()
    expect(complete(survey, a)).toBe(false)
    expect(answered(survey, a, 'A16')).toBe(true) // optional
    expect(complete(survey, DEV.answers)).toBe(true)
    const missingOne = { ...DEV.answers, A13: { ...DEV.answers.A13 } }
    delete missingOne.A13.crowds
    expect(answered(survey, missingOne, 'A13')).toBe(false)
  })

  it('are cleaned: unknown rows and bad scores dropped, A16 trimmed', () => {
    const a = clean(survey, { A11: 9, A12: { greenery_trees: 4, nope: 3, signs_ads: 0 }, A13: null, A16: '  hi  ' })
    expect(a).toEqual({ A11: null, A12: { greenery_trees: 4 }, A13: {}, A16: 'hi' })
  })

  it('go to the server with the language, never the text', () => {
    const p = { language: 'en', answers: DEV.answers, text: DEV.expected, version: 'x' }
    expect(requestProfile(p)).toEqual({ language: 'en', ...DEV.answers })
    expect(requestProfile(null)).toBe(null)
  })

  it('name the strongest elements, bothers and feels good in turn', () => {
    const top = strongest(survey, DEV.answers, 4)
    expect(top.map((t) => [t.row.code, t.kind, t.score])).toEqual([
      ['traffic_trams', 'bothers', 1], ['greenery_trees', 'good', 5], ['direct_sun', 'bothers', 1], ['fountains_water', 'good', 5],
    ])
  })
})

describe('the export file', () => {
  const profile = { language: 'en', answers: DEV.answers, text: DEV.expected, version: '386e888b8867', saved: '2026-11-15T10:00:00Z' }

  it('round-trips', () => {
    const file = JSON.parse(JSON.stringify(exportFile(profile)))
    expect(file.profile).toBe(DEV.expected)
    expect(readFile(survey, file)).toEqual({ answers: clean(survey, DEV.answers), language: 'en', weather: {}, thermal: null, myRatings: [] })
  })

  it('refuses other files and incomplete answers', () => {
    expect(readFile(survey, { kind: 'something else' }).error).toMatch(/not a SenCity profile/)
    expect(readFile(survey, { ...exportFile(profile), language: 'de' }).error).toMatch(/language/)
    expect(readFile(survey, { ...exportFile(profile), answers: { A11: 3 } }).error).toMatch(/every question/)
  })
})

describe('the radar', () => {
  it('has the eight senses in the onboarding order', () => {
    expect(senseOrder(survey)).toEqual(['sight', 'hearing', 'smell', 'touch', 'thermal', 'balance_movement', 'body_awareness', 'inner_sensations'])
  })

  it('gives each sense what bothers (6 − lowest) and what feels good (highest), 1–5, on the made-up profile', () => {
    const s = senseScores(survey, DEV.answers)
    expect(s.map((x) => [x.sense, x.bothers, x.good])).toEqual([
      ['sight', 4, 5], // greenery 5, buildings 4, signs 2
      ['hearing', 5, 5], // fountains 5, traffic 1
      ['smell', 4, 5], // plants 5, bins 2, food 3
      ['touch', 4, 4], // grass 4, asphalt 2
      ['thermal', 5, 5], // shade 5, direct sun 1
      ['balance_movement', 3, 4], // open space 4, heights 3
      ['body_awareness', 5, 5], // car-free 5, crowds 1, narrow 2
      ['inner_sensations', 3, 5], // seats 5, toilets 4, steps 3
    ])
    expect(s[1].elements).toEqual([
      { code: 'fountains_water', en: 'Fountains, water', it: 'Fontane, acqua', value: 5 },
      { code: 'traffic_trams', en: 'Traffic, trams', it: 'Traffico, tram', value: 1 },
    ])
  })

  it('counts each element only for its main sense, puts all "neither" at 3 and 3, and leaves a sense with no answers as a gap', () => {
    const only = { A12: { greenery_trees: 1, fountains_water: 4 }, A13: {} } // greenery also touches hearing; not counted there
    const s = senseScores(survey, only)
    expect(s.find((x) => x.sense === 'sight')).toMatchObject({ bothers: 5, good: 1 })
    expect(s.find((x) => x.sense === 'hearing')).toMatchObject({ bothers: 2, good: 4 })
    expect(s.find((x) => x.sense === 'touch')).toEqual({ sense: 'touch', elements: [], bothers: null, good: null })
    const neutral = Object.fromEntries(['A12', 'A13'].map((g) => [g, Object.fromEntries(survey.questions.find((q) => q.code === g).rows.map((r) => [r.code, 3]))]))
    expect(senseScores(survey, neutral).every((x) => x.bothers === 3 && x.good === 3)).toBe(true)
  })

  it('updates with the answers', () => {
    const edited = { ...DEV.answers, A12: { ...DEV.answers.A12, traffic_trams: 3 } }
    expect(senseScores(survey, edited)[1]).toMatchObject({ bothers: 3, good: 5 })
  })
})
