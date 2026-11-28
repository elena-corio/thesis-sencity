// The profile questions' layout (config/profile_questions.json, served as survey.layout): shown steps in their order,
// and the words on screen; without a layout, the usual order and the export's words.
import { describe, expect, it } from 'vitest'
import { PREPARE_KEYS, PROFILE_KEYS, rowText, stepsOf, textOf } from './questions.js'

const survey = {
  layout: {
    profile: [{ key: 'intro', shown: false }, { key: 'A11', title: { en: 'Overall?' } }, { key: 'A13' },
      { key: 'A12', rows: { traffic_trams: { en: 'Cars and trams' } } }, { key: 'weather', shown: false }, { key: 'A16' }],
    prepare: [{ key: 'Q2' }, { key: 'Q1' }, { key: 'Q3' }, { key: 'Q4', shown: false }],
  },
}

describe('profile questions layout', () => {
  it('gives the shown steps in the layout\'s order', () => {
    expect(stepsOf(survey, 'profile')).toEqual(['A11', 'A13', 'A12', 'A16'])
    expect(stepsOf(survey, 'prepare')).toEqual(['Q2', 'Q1', 'Q3'])
  })
  it('falls back to the usual order without a layout', () => {
    expect(stepsOf({}, 'profile')).toEqual(PROFILE_KEYS)
    expect(stepsOf(null, 'prepare')).toEqual(PREPARE_KEYS)
  })
  it('changes only the words on screen', () => {
    expect(textOf(survey, 'A11', 'title', 'From the export', 'en')).toBe('Overall?')
    expect(textOf(survey, 'A11', 'title', 'From the export', 'it')).toBe('Overall?') // English when there is no Italian
    expect(textOf(survey, 'A13', 'title', 'From the export', 'en')).toBe('From the export')
    expect(rowText(survey, 'A12', 'traffic_trams', 'Traffic, trams', 'en')).toBe('Cars and trams')
    expect(rowText(survey, 'A12', 'crowds', 'Crowds', 'en')).toBe('Crowds')
  })
})
