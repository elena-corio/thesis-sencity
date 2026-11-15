import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import cases from '../dev/test-profiles.json'
import {
  answered, buildProfile, clean, complete, emptyAnswers, exportFile, profileVersion, readFile, requestProfile, strongest,
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
    expect(readFile(survey, file)).toEqual({ answers: clean(survey, DEV.answers), language: 'en' })
  })

  it('refuses other files and incomplete answers', () => {
    expect(readFile(survey, { kind: 'something else' }).error).toMatch(/not a SenCity profile/)
    expect(readFile(survey, { ...exportFile(profile), language: 'de' }).error).toMatch(/language/)
    expect(readFile(survey, { ...exportFile(profile), answers: { A11: 3 } }).error).toMatch(/every question/)
  })
})
