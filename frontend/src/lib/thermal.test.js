import { describe, expect, it } from 'vitest'
import { formatDegrees, isCold, scoreState, thermalLegend, thermalReason, thermalScore, walkMinutes, withThermal } from './thermal.js'

describe('thermalScore (brief §4, standard limits)', () => {
  it('follows the heat side', () => {
    expect(thermalScore(39)).toBe(1)
    expect(thermalScore(35)).toBe(2)
    expect(thermalScore(31)).toBe(3)
    expect(thermalScore(26)).toBe(5) // 26 itself is still no stress
  })
  it('gives 5 with no thermal stress and 4 when a little cool', () => {
    expect(thermalScore(20)).toBe(5)
    expect(thermalScore(9)).toBe(5)
    expect(thermalScore(5)).toBe(4)
  })
  it('follows the cold side', () => {
    expect(thermalScore(-5)).toBe(3)
    expect(thermalScore(-20)).toBe(2)
    expect(thermalScore(-30)).toBe(1)
  })
})

describe('scoreState', () => {
  it('is easy for 4–5, mixed for 3, hard for 1–2', () => {
    expect([5, 4, 3, 2, 1].map(scoreState)).toEqual(['easy', 'easy', 'mixed', 'hard', 'hard'])
  })
})

describe('labels', () => {
  it('rounds and uses a real minus sign', () => {
    expect(formatDegrees(30.6)).toBe('31 °C')
    expect(formatDegrees(-3.2)).toBe('−3 °C')
  })
  it('names both sides in the legend', () => {
    expect(thermalLegend().map((l) => l.label)).toEqual([
      'Easy, 0 to 26 °C', 'Mixed, 26 to 32 °C or −13 to 0 °C', 'Hard, above 32 °C or below −13 °C',
    ])
  })
})

describe('withThermal', () => {
  it('adds the value, score and state, and leaves streets with no value as they are', () => {
    const fc = { type: 'FeatureCollection', features: [{ properties: { id: 'a' } }, { properties: { id: 'b' } }] }
    const out = withThermal(fc, { a: 31.2, b: null })
    expect(out.features[0].properties).toEqual({ id: 'a', utci: 31.2, thermal_score: 3, thermal_state: 'mixed' })
    expect(out.features[1].properties).toEqual({ id: 'b' })
  })
})

describe('card lines', () => {
  it('gives the reason for the state on both sides', () => {
    expect(thermalReason(34)).toBe('above 32 °C')
    expect(thermalReason(29)).toBe('26 to 32 °C')
    expect(thermalReason(20)).toBe('0 to 26 °C')
    expect(thermalReason(-5)).toBe('−13 to 0 °C')
    expect(thermalReason(-20)).toBe('below −13 °C')
  })
  it('knows the cold side and the walking time', () => {
    expect(isCold(-2)).toBe(true)
    expect(isCold(20)).toBe(false)
    expect(walkMinutes(30)).toBe(1)
    expect(walkMinutes(170)).toBe(2)
  })
})
