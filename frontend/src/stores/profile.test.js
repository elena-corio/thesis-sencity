// Your profile on this device: save, load, edit and delete through the store, and what a prediction gets from it.
// Local storage is an in-memory stand-in; the survey is read from model/app_v9/ as GET /api/profile/survey sends it.
import { readFileSync } from 'node:fs'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import cases from '../dev/test-profiles.json'
import { PROMPT_CODES, requestProfile } from '../lib/profile.js'
import { isAnswered } from '../lib/prepare.js'
import { DRAFT_KEY, SAVED_KEY, STEPS, useProfileStore } from './profile.js'

const dir = new URL('../../../model/app_v9/', import.meta.url)
const read = (name) => readFileSync(new URL(name, dir), 'utf-8')
const rules = JSON.parse(read('profile_rules.json'))
const SURVEY = {
  ...JSON.parse(read('part_a.json')),
  profile: {
    template: read('profile_template.txt'),
    constants: Object.fromEntries(['{A11_LOW}', '{A11_HIGH}', '{SCALE_1}', '{SCALE_5}'].map((k) => [k, rules.placeholders[k]])),
    scale_words_en: rules.scale_words_en,
    languages: { en: 'English', it: 'Italian' },
  },
  prepare: JSON.parse(readFileSync(new URL('../../../config/prepare.json', import.meta.url), 'utf-8')),
}
vi.mock('../lib/api.js', () => ({ loadSurvey: async () => SURVEY }))

const DEV = cases[0]
const DEV_VERSION = '386e888b8867' // the server's version of DEV.expected (backend/tests/test_profile.py)

class MemoryStorage {
  constructor() { this.m = new Map() }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null }
  setItem(k, v) { this.m.set(k, String(v)) }
  removeItem(k) { this.m.delete(k) }
  clear() { this.m.clear() }
  key(i) { return [...this.m.keys()][i] ?? null }
  get length() { return this.m.size }
}

const fresh = () => {
  setActivePinia(createPinia())
  return useProfileStore()
}
/** The onboarding as the screens do it: one answer at a time, then Save. */
async function onboard(store, answers, weather = {}) {
  store.agree()
  store.begin()
  for (const [code, v] of Object.entries(answers)) {
    if (v && typeof v === 'object') for (const [row, x] of Object.entries(v)) store.answer(code, x, row)
    else store.answer(code, v)
  }
  for (const [row, x] of Object.entries(weather)) store.answer('weather', x, row)
  return store.finish()
}
const stored = (key) => JSON.parse(globalThis.localStorage.getItem(key) ?? 'null')

beforeEach(() => {
  globalThis.localStorage = new MemoryStorage()
})

describe('your profile on this device', () => {
  it('saves: the answers, the study\'s text and its version, in local storage only', async () => {
    const store = fresh()
    expect(store.profile).toBe(null)
    expect(await onboard(store, DEV.answers)).toBe(true)
    expect(store.profile.text).toBe(DEV.expected)
    expect(store.version).toBe(DEV_VERSION)
    const kept = stored(SAVED_KEY)
    expect(kept.answers).toEqual(DEV.answers)
    expect(kept.text).toBe(DEV.expected)
  })

  it('is not saved while incomplete', async () => {
    const store = fresh()
    const { A12: _skipped, ...partial } = DEV.answers
    expect(await onboard(store, partial)).toBe(false)
    expect(stored(SAVED_KEY)).toBe(null)
    expect(stored(DRAFT_KEY).answers.A11).toBe(DEV.answers.A11) // kept as you go: leaving halfway loses nothing
  })

  it('loads again on the next visit', async () => {
    await onboard(fresh(), DEV.answers)
    const next = fresh()
    expect(next.personal).toBe(true)
    expect(next.version).toBe(DEV_VERSION)
    expect(next.profile.answers).toEqual(DEV.answers)
  })

  it('edits: a changed answer builds the text again, with a new version for the next predictions', async () => {
    const store = fresh()
    await onboard(store, DEV.answers)
    store.begin(2) // the A12 grid, with your answers
    expect(store.draft.editing).toBe(true)
    store.answer('A12', 1, 'greenery_trees')
    expect(stored(DRAFT_KEY).answers.A12.greenery_trees).toBe(1)
    expect(await store.finish()).toBe(true)
    expect(store.profile.answers.A12.greenery_trees).toBe(1)
    expect(store.profile.text).toContain('Greenery, trees: 1, very unpleasant')
    expect(store.version).not.toBe(DEV_VERSION)
    expect(store.draft).toBe(null)
    expect(stored(SAVED_KEY).version).toBe(store.version)
  })

  it('deletes everything it kept: profile, draft, consent and your ratings', async () => {
    const store = fresh()
    await onboard(store, DEV.answers)
    store.begin(1)
    globalThis.localStorage.setItem('sencity-my-ratings', '[{"id":"x"}]')
    globalThis.localStorage.setItem('sencity-ratings', '{"x":{}}')
    store.deleteAll()
    expect(store.profile).toBe(null)
    expect(store.personal).toBe(false)
    expect(globalThis.localStorage.length).toBe(0)
    expect(fresh().profile).toBe(null)
  })
})

describe('one save at the end of the onboarding', () => {
  /** A new profile's onboarding up to its last question (Q4), nothing saved yet. */
  function walk(store) {
    store.agree()
    store.begin()
    for (const [code, v] of Object.entries(DEV.answers)) {
      if (v && typeof v === 'object') for (const [row, x] of Object.entries(v)) store.answer(code, x, row)
      else store.answer(code, v)
    }
    store.setStep(STEPS.indexOf('Q1'))
  }

  it('keeps every answer as a draft, back and forth, and saves nothing before the last button', async () => {
    const store = fresh()
    walk(store)
    expect(store.inPrepare).toBe(true)
    store.setPrepare('Q1', 2)
    store.setPrepare('Q3', 4)
    store.setStep(STEPS.indexOf('A12')) // back into the profile part
    expect(store.inPrepare).toBe(false)
    store.setStep(STEPS.indexOf('Q4'))
    expect(store.draft.prepare).toMatchObject({ Q1: 2, Q3: 4 })
    expect(store.draft.answers.A11).toBe(DEV.answers.A11)
    expect(stored(SAVED_KEY)).toBe(null)
    expect(store.profile).toBe(null)
    expect(fresh().draft.prepare.Q3).toBe(4) // the draft is kept for the next visit
    expect(await store.finish()).toBe(true)
    expect(stored(SAVED_KEY).prepare).toMatchObject({ Q1: 2, Q3: 4 })
    expect(store.profile.text).toBe(DEV.expected) // not part of the profile text
    expect(stored(DRAFT_KEY)).toBe(null)
  })

  it('edits the same way: nothing changes until the save, Cancel keeps the saved profile', async () => {
    const store = fresh()
    walk(store)
    store.setPrepare('Q1', 4)
    await store.finish()
    store.begin(STEPS.indexOf('A12'))
    store.answer('A12', 1, 'greenery_trees')
    store.setStep(STEPS.indexOf('Q3'))
    store.setPrepare('Q3', 5)
    expect(store.profile.answers.A12.greenery_trees).toBe(DEV.answers.A12.greenery_trees)
    expect(store.profile.prepare.Q3).toBe(null)
    store.discardDraft()
    expect(store.profile.prepare).toMatchObject({ Q1: 4, Q3: null })
    store.begin(STEPS.indexOf('Q3'))
    expect(store.draft.prepare.Q1).toBe(4) // an edit starts from the saved answers
    store.setPrepare('Q3', 5)
    await store.finish()
    expect(store.profile.prepare).toMatchObject({ Q1: 4, Q3: 5 })
  })

  it('asks again a Q3 saved in the old form (a word), without converting it', async () => {
    const store = fresh()
    walk(store)
    await store.finish()
    globalThis.localStorage.setItem(SAVED_KEY, JSON.stringify({ ...store.profile, prepare: { ...store.profile.prepare, Q1: 3, Q3: 'often' } }))
    const again = fresh()
    await again.ensureSurvey()
    expect(isAnswered(SURVEY.prepare, again.profile.prepare, 'Q3')).toBe(false)
    expect(isAnswered(SURVEY.prepare, again.profile.prepare, 'Q1')).toBe(true)
    again.begin(STEPS.indexOf('Q3'))
    await again.finish()
    expect(again.profile.prepare).toMatchObject({ Q1: 3, Q3: null })
  })

  it('goes with download and import, and with delete', async () => {
    const store = fresh()
    walk(store)
    store.setPrepare('Q2', { ticked: ['calmer_route'], other: '' })
    await store.finish()
    const file = JSON.parse(JSON.stringify(store.fileData()))
    expect(file.prepare.Q2.ticked).toEqual(['calmer_route'])
    store.deleteAll()
    expect(globalThis.localStorage.length).toBe(0)
    expect(await store.importData(file)).toBe('')
    expect(store.profile.prepare.Q2.ticked).toEqual(['calmer_route'])
  })

  it('never puts how you prepare into a prediction', async () => {
    const store = fresh()
    walk(store)
    store.setPrepare('Q1', 1)
    store.setPrepare('Q3', 5)
    store.setPrepare('Q4', { ticked: ['leave_earlier'], other: '' })
    await store.finish()
    const sent = JSON.stringify(requestProfile(store.profile))
    expect(sent).not.toMatch(/Q1|Q3|Q4|prepare|leave_earlier/)
  })
})

describe('what a prediction gets from your profile', () => {
  it('the four profile questions and the language, never the text', async () => {
    const store = fresh()
    await onboard(store, DEV.answers)
    const sent = requestProfile(store.profile)
    expect(sent).toEqual({ language: 'en', ...DEV.answers })
    expect(Object.keys(sent).sort()).toEqual(['language', ...PROMPT_CODES].sort())
    expect(JSON.stringify(sent)).not.toContain(store.profile.text)
  })

  it('never A15, the weather or anything else kept with the profile', async () => {
    const store = fresh()
    await onboard(store, { ...DEV.answers, A15: 4 }, { hot: 2, cold: 4 })
    expect(store.profile.weather).toEqual({ hot: 2, cold: 4 })
    expect(store.profile.answers).not.toHaveProperty('A15') // only Part A's profile questions are kept as answers
    expect(store.profile.text).toBe(DEV.expected)
    const extra = { ...store.profile, answers: { ...store.profile.answers, A15: 4, prepare: { rest: 5 } } }
    const sent = requestProfile(extra)
    expect(sent).not.toHaveProperty('A15')
    expect(sent).not.toHaveProperty('prepare')
    expect(sent).not.toHaveProperty('weather')
  })
})
