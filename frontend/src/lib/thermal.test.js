import { describe, expect, it } from 'vitest'
import {
  comfortKey, comfortTarget, compareComfort, easyRange, formatDegrees, isCold, isHot,
  barLabel, barPosition, thermalBar, thermalLegend, thermalLimits, thermalSide, thermalState, thermalVerdict, walkMinutes, withThermal,
} from './thermal.js'

describe('bands (standard limits)', () => {
  it('easy from 9 to 26, both ends included', () => {
    for (const t of [9, 15, 20, 26]) expect(thermalState(t)).toBe('easy')
  })
  it('0 to 9 °C is mixed (slight cold), not easy', () => {
    for (const t of [8.9, 5, 0, -0.1]) expect(thermalState(t)).toBe('mixed')
  })
  it('mixed for moderate heat (26–32) and moderate cold (−13–9)', () => {
    for (const t of [26.1, 29, 32, -5, -13]) expect(thermalState(t)).toBe('mixed')
  })
  it('hard above 32 and below −13', () => {
    for (const t of [32.1, 36, 40, -13.1, -20, -30]) expect(thermalState(t)).toBe('hard')
  })

})

describe('limits in use', () => {
  it('are the standard ones from config, for everyone', () => {
    expect(thermalLimits()).toEqual({ heat: [26, 32], cold: [9, -13] })
  })
})

describe('comfort distance', () => {
  it('target is the middle of the easy range in use: 17.5 standard', () => {
    expect(easyRange()).toEqual([9, 26])
    expect(comfortTarget()).toBe(17.5)
    expect(comfortTarget({ heat: [23, 29], cold: [9, -13] })).toBe(16) // follows the limits passed
  })
  it('is 0 inside the range, otherwise the degrees outside it', () => {
    expect(comfortKey(30)).toEqual([4, 0])
    expect(comfortKey(5)).toEqual([4, 0])
    expect(comfortKey(20)).toEqual([0, 2.5])
    expect(comfortKey(10)).toEqual([0, 7.5])
  })
  it('ranks by distance outside, then (inside) by closeness to the target', () => {
    const order = [30, 20, 26, 5, 17].sort((a, b) => compareComfort(comfortKey(a), comfortKey(b)))
    expect(order).toEqual([17, 20, 26, 30, 5])
  })
})

describe('legend', () => {
  const lines = (side, limits) => thermalLegend(limits, side).map((r) => [r.label, ...r.lines])
  it('picks the side the values reach', () => {
    expect(thermalSide([12, 20, 30])).toBe('heat') // none below 9
    expect(thermalSide([20, 22])).toBe('heat')
    expect(thermalSide([-5, 3, 15])).toBe('cold') // some below 9, none above 26
    expect(thermalSide([5, 30])).toBe('both')
  })
  it('Easy always with its range; Mixed and Hard only for the side shown', () => {
    expect(lines('heat')).toEqual([['Easy', '9 to 26'], ['Mixed', '26 to 32'], ['Hard', 'above 32']])
    expect(lines('cold')).toEqual([['Easy', '9 to 26'], ['Mixed', '−13 to 9'], ['Hard', 'below −13']])
    expect(lines('both')).toEqual([['Easy', '9 to 26'], ['Mixed', '26 to 32', '−13 to 9'], ['Hard', 'above 32', 'below −13']])
  })
})

describe('card line', () => {
  it('names only the side that applies', () => {
    expect(thermalVerdict(34).text).toBe('Hard: above 32 °C')
    expect(thermalVerdict(-20).text).toBe('Hard: below −13 °C')
    expect(thermalVerdict(29).text).toBe('Mixed: above 26 °C')
    expect(thermalVerdict(5).text).toBe('Mixed: below 9 °C') // 0–9 °C is mixed
    expect(thermalVerdict(20).text).toBe('Easy: 9 to 26 °C')
  })
  it('knows too hot, too cold, and the walking time', () => {
    expect(isHot(27)).toBe(true)
    expect(isCold(5)).toBe(true) // 0–9 counts as too cold now
    expect(isCold(20) || isHot(20)).toBe(false)
    expect(formatDegrees(-3.2)).toBe('−3 °C')
    expect(walkMinutes(30)).toBe(1)
    expect(walkMinutes(170)).toBe(2)
  })
})

describe('withThermal', () => {
  it('adds the value, score and state, and leaves streets with no value as they are', () => {
    const fc = { type: 'FeatureCollection', features: [{ properties: { id: 'a' } }, { properties: { id: 'b' } }, { properties: { id: 'c' } }] }
    const out = withThermal(fc, { a: 31.2, b: null, c: 4 })
    expect(out.features[0].properties).toEqual({ id: 'a', utci: 31.2, thermal_state: 'mixed' })
    expect(out.features[1].properties).toEqual({ id: 'b' })
    expect(out.features[2].properties.thermal_state).toBe('mixed')
  })
  it('drops the old values of a street that has none now', () => {
    const fc = { type: 'FeatureCollection', features: [{ properties: { id: 'a', utci: 31, thermal_score: 3, thermal_state: 'mixed' } }] }
    expect(withThermal(fc, { a: null }).features[0].properties).toEqual({ id: 'a' })
  })
})

describe('temperature bar', () => {
  const ticks = (side) => thermalBar(undefined, side).ticks.map((t) => t.value)
  it('heat side: 9 to 40 °C, labelled at the ends and band borders', () => {
    const bar = thermalBar(undefined, 'heat')
    expect([bar.min, bar.max]).toEqual([9, 40])
    expect(ticks('heat')).toEqual([9, 26, 32, 40])
    expect(bar.ticks.map((t) => Math.round(t.at))).toEqual([0, 55, 74, 100])
  })
  it('cold side: −20 to 26 °C, hard on the left', () => {
    const bar = thermalBar(undefined, 'cold')
    expect([bar.min, bar.max]).toEqual([-20, 26])
    expect(ticks('cold')).toEqual([-20, -13, 9, 26])
    expect(bar.stops[0].state).toBe('hard')
    expect(bar.stops.at(-1).state).toBe('easy')
  })
  it('both sides: −20 to 40 °C, hard at both ends', () => {
    const bar = thermalBar(undefined, 'both')
    expect([bar.min, bar.max]).toEqual([-20, 40])
    expect(ticks('both')).toEqual([-20, -13, 9, 26, 32, 40])
    expect([bar.stops[0].state, bar.stops.at(-1).state]).toEqual(['hard', 'hard'])
  })
  it('the gradient is cyan through easy, amber mid-way through mixed, red from the hard border', () => {
    expect(thermalBar(undefined, 'heat').stops.map((s) => s.state)).toEqual(['easy', 'easy', 'mixed', 'hard', 'hard'])
    const at = thermalBar(undefined, 'heat').stops.map((s) => Math.round(s.at))
    expect(at).toEqual([0, 55, 65, 74, 100]) // 29 °C, the middle of 26–32, is amber
  })
  it('places the marker at the value, clamped at the ends', () => {
    const bar = thermalBar(undefined, 'heat')
    expect(barPosition(9, bar)).toBe(0)
    expect(Math.round(barPosition(31, bar))).toBe(71)
    expect(barPosition(45, bar)).toBe(100)
    expect(barPosition(-5, bar)).toBe(0)
  })
  it('reads out the value and the side', () => {
    expect(barLabel(31, 'heat')).toBe('Feels like 31 °C on the heat side of the scale')
    expect(barLabel(-4, 'cold')).toBe('Feels like −4 °C on the cold side of the scale')
    expect(barLabel(5, 'both')).toBe('Feels like 5 °C on the full scale, heat and cold')
  })
})

// Personal limits from the Weather step (Elena, 2026-11-15)
import { clampStart, startRange, comfortSummary, personalLimits, setPersonalLimits, startsFromAnswers, thermalLimits as inUse } from './thermal.js'
import { cleanWeather, windSensitive } from './weather.js'

describe('personal thermal limits', () => {
  it('shift the heat limits down for hot 1 and 2, the cold limits up for cold 1 and 2, and nothing for 3–5', () => {
    expect(personalLimits({ hot: 1, cold: 1 })).toEqual({ heat: [23, 29], cold: [12, -10] })
    expect(personalLimits({ hot: 2, cold: 2 })).toEqual({ heat: [24.5, 30.5], cold: [10.5, -11.5] })
    expect(personalLimits({ hot: 2 })).toEqual({ heat: [24.5, 30.5], cold: [9, -13] })
    for (const v of [3, 4, 5]) expect(personalLimits({ hot: v, cold: v, wind: 1 })).toBe(null)
    expect(personalLimits({})).toBe(null)
  })

  it('follow a start moved by hand, which moves its side\'s two limits together', () => {
    expect(personalLimits({ hot: 1 }, { heat: 28 })).toEqual({ heat: [28, 34], cold: [9, -13] })
    expect(personalLimits({}, { cold: 5 })).toEqual({ heat: [26, 32], cold: [5, -17] })
    expect(startsFromAnswers({ hot: 1, cold: 2 })).toEqual({ heat: 23, cold: 10.5 })
  })

  it('keep a moved start on the scale, in 0.5 °C steps, and the easy range at least 2 °C wide', () => {
    expect(clampStart('heat', 23.3, 9)).toBe(23.5)
    expect(clampStart('heat', 10, 9)).toBe(11)
    expect(clampStart('cold', 30, 26)).toBe(24)
    // The outer limits stay on the bar (−20 to 40): hot starts at most at 34, cold at least at 2.
    expect(clampStart('heat', 99, 9)).toBe(34)
    expect(clampStart('cold', -99, 26)).toBe(2)
  })

  it('give each start a range that keeps its outer limit on the bar', () => {
    expect(startRange('heat', 9)).toEqual({ min: 11, max: 34 })
    expect(startRange('cold', 26)).toEqual({ min: 2, max: 24 })
  })

  it('say the comfortable range in words, next to the standard one', () => {
    expect(comfortSummary({ heat: [23, 29], cold: [9, -13] })).toBe('Comfortable for you: about 9 to 23 °C (feels like). Standard: 9 to 26 °C.')
    expect(comfortSummary({ heat: [24.5, 30.5], cold: [10.5, -11.5] })).toBe('Comfortable for you: about 10.5 to 24.5 °C (feels like). Standard: 9 to 26 °C.')
  })

  it('are the ones in use while set, and the state of a street follows them', () => {
    setPersonalLimits(personalLimits({ hot: 1 }))
    expect(inUse()).toEqual({ heat: [23, 29], cold: [9, -13] })
    expect(thermalState(24)).toBe('mixed') // easy for the standard limits
    setPersonalLimits(null)
    expect(thermalState(24)).toBe('easy')
  })

  it('keep only hot, cold and wind answered 1–5; wind 1–2 flags wind', () => {
    expect(cleanWeather({ hot: 1, cold: 9, wind: 2, rain: 1 })).toEqual({ hot: 1, wind: 2 })
    expect(windSensitive({ wind: 2 })).toBe(true)
    expect(windSensitive({ wind: 3 })).toBe(false)
    expect(windSensitive({})).toBe(false)
  })
})
