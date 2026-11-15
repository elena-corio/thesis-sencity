import { afterEach, describe, expect, it } from 'vitest'
import { overallOf, overallReason, overallShares, withOverall } from './overall.js'
import { personalLimits, setPersonalLimits, thermalState } from './thermal.js'

const L = ['easy', 'mixed', 'hard']
const M = [...L, null] // null: missing (no photo, or no thermal data)

describe('Overall: the worse of Senses and Thermal', () => {
  // The whole truth table: every senses level × every thermal level, missing parts included.
  const expected = {
    'easy|easy': ['easy', 'both', false], 'easy|mixed': ['mixed', 'thermal', false], 'easy|hard': ['hard', 'thermal', false],
    'mixed|easy': ['mixed', 'senses', false], 'mixed|mixed': ['mixed', 'both', false], 'mixed|hard': ['hard', 'thermal', false],
    'hard|easy': ['hard', 'senses', false], 'hard|mixed': ['hard', 'senses', false], 'hard|hard': ['hard', 'both', false],
    'easy|null': ['easy', 'senses', true], 'mixed|null': ['mixed', 'senses', true], 'hard|null': ['hard', 'senses', true],
    'null|easy': ['easy', 'thermal', true], 'null|mixed': ['mixed', 'thermal', true], 'null|hard': ['hard', 'thermal', true],
    'null|null': [null, null, false],
  }
  for (const s of M) {
    for (const t of M) {
      it(`senses ${s ?? 'missing'} × thermal ${t ?? 'missing'}`, () => {
        const o = overallOf(s, t)
        const [state, decider, partial] = expected[`${s}|${t}`]
        expect(o.state).toBe(state)
        expect(o.decider).toBe(decider)
        expect(o.partial).toBe(partial)
        if (s && t) expect(o.basis).toBe('both')
        else if (s || t) expect(o.basis).toBe(s ? 'senses' : 'thermal')
        else expect(o.basis).toBe(null)
      })
    }
  }

  it('treats a photo that could not be rated, or still pending, as missing', () => {
    expect(overallOf('failed', 'mixed')).toMatchObject({ state: 'mixed', partial: true, basis: 'thermal' })
    expect(overallOf(undefined, undefined).state).toBe(null)
  })

  it('sets overall_state and overall_partial on the streets, and nothing when there is no data', () => {
    const fc = { type: 'FeatureCollection', features: [
      { properties: { id: 'a', senses_state: 'easy', thermal_state: 'hard' } },
      { properties: { id: 'b', thermal_state: 'mixed' } },
      { properties: { id: 'c', overall_state: 'easy' } }, // an old value goes
    ] }
    const out = withOverall(fc).features.map((f) => f.properties)
    expect(out[0]).toMatchObject({ overall_state: 'hard', overall_partial: false })
    expect(out[1]).toMatchObject({ overall_state: 'mixed', overall_partial: true })
    expect(out[2]).toEqual({ id: 'c' })
  })
})

describe('the deciding layer in plain words', () => {
  const place = { bothers: [{ en: 'Traffic, trams' }, { en: 'Signs, ads' }, { en: 'Crowds' }] }
  it('names what decides', () => {
    expect(overallReason(overallOf('mixed', 'hard'), { utci: 34, hot: true })).toBe('Hard because of heat: feels like 34 °C')
    expect(overallReason(overallOf('easy', 'mixed'), { utci: 4.2, hot: false })).toBe('Mixed because of cold: feels like 4 °C')
    expect(overallReason(overallOf('mixed', 'easy'), { place })).toBe('Mixed because of your senses: traffic, trams; signs, ads')
    expect(overallReason(overallOf('hard', 'easy'), { place: { bothers: [] }, comfort: 2 })).toBe('Hard because of your senses: rated 2 of 5')
  })
  it('names both when they are the same, and says so when one is missing', () => {
    expect(overallReason(overallOf('hard', 'hard'), { hot: true })).toBe('Hard because of heat and your senses')
    expect(overallReason(overallOf('easy', 'easy'))).toBe('Easy for your senses and the temperature')
    expect(overallReason(overallOf(null, 'mixed'))).toBe('Mixed · based on thermal only')
    expect(overallReason(overallOf('hard', null))).toBe('Hard · based on senses only')
    expect(overallReason(overallOf(null, null))).toBe('No data: no photo and no thermal comfort here.')
  })
  it('does not say "your senses" while the senses part is general', () => {
    expect(overallReason(overallOf('hard', 'easy'), { place, personal: false })).toBe('Hard because of the senses: traffic, trams; signs, ads')
  })
})

describe('personal limits shift the thermal part', () => {
  afterEach(() => setPersonalLimits(null))
  it('hot 1 lowers the heat limits by 3 °C, so a street at 24 °C turns mixed and Overall follows', () => {
    expect(thermalState(24)).toBe('easy')
    expect(overallOf('easy', thermalState(24)).state).toBe('easy')
    setPersonalLimits(personalLimits({ hot: 1 }))
    expect(thermalState(24)).toBe('mixed')
    expect(overallOf('easy', thermalState(24))).toMatchObject({ state: 'mixed', decider: 'thermal' })
    expect(thermalState(29.5)).toBe('hard') // above 29 (32 − 3)
  })
  it('cold 1 raises the cold limits by 3 °C', () => {
    setPersonalLimits(personalLimits({ cold: 1 }))
    expect(thermalState(10)).toBe('mixed') // below 12 (9 + 3)
    expect(thermalState(2)).toBe('hard') // below 3 (0 + 3)
  })
})

describe('a route on Overall', () => {
  it('shares easy, mixed and hard by length', () => {
    const s = overallShares([{ state: 'easy', length: 300 }, { state: 'hard', length: 100 }, { state: null, length: 100 }])
    expect(s).toEqual({ easy: 0.6, mixed: 0, hard: 0.2, none: 0.2 })
  })
})

it('levels are exactly easy, mixed and hard', () => {
  expect(L.map((l) => overallOf(l, l).state)).toEqual(L)
})
