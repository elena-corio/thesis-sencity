import { describe, expect, it } from 'vitest'
import { LEVEL, easierNearby, easierThermalNearby, thermalLevel } from './nearby.js'

// A short east–west street whose middle is `north` metres north of the first one (1° lat ≈ 111 km).
const street = (id, north, utci) => {
  const lat = 48.2 + north / 111195
  return { type: 'Feature', properties: { id, name: id, utci },
    geometry: { type: 'LineString', coordinates: [[16.37, lat], [16.371, lat]] } }
}
const pick = (here, fs) => easierThermalNearby(here, fs)?.f.properties.id ?? null

describe('thermalLevel (standard limits)', () => {
  it('maps feels-like °C to hard, mixed, easy', () => {
    expect(thermalLevel(36)).toBe(LEVEL.hard)
    expect(thermalLevel(29)).toBe(LEVEL.mixed)
    expect(thermalLevel(22)).toBe(LEVEL.easy)
    expect(thermalLevel(null)).toBe(null)
  })
  it('maps 0–9 °C to mixed', () => {
    expect(thermalLevel(5)).toBe(LEVEL.mixed)
  })
  it('follows the limits it is given', () => {
    const strict = { heat: [20, 25], cold: [9, -13] }
    expect(thermalLevel(22, strict)).toBe(LEVEL.mixed)
  })
})

describe('easierThermalNearby', () => {
  const hard = street('here', 0, 36)
  it('needs at least one level better: hard → mixed or easy', () => {
    expect(pick(hard, [hard, street('hot', 50, 34)])).toBe(null) // still hard
    expect(pick(hard, [hard, street('mixed', 50, 29)])).toBe('mixed')
    expect(pick(hard, [hard, street('easy', 50, 22)])).toBe('easy')
  })
  it('mixed → only easy; easy → nothing', () => {
    const mixed = street('here', 0, 29)
    expect(pick(mixed, [mixed, street('m2', 50, 27)])).toBe(null)
    expect(pick(mixed, [mixed, street('easy', 50, 22)])).toBe('easy')
    const easy = street('here', 0, 22)
    expect(pick(easy, [easy, street('e2', 50, 20)])).toBe(null)
  })
  it('only within the short walk (300 m by default)', () => {
    expect(pick(hard, [hard, street('far', 320, 22)])).toBe(null)
    expect(pick(hard, [hard, street('near', 280, 22)])).toBe('near')
    expect(easierThermalNearby(hard, [hard, street('far', 320, 22)], undefined, 400)?.f.properties.id).toBe('far')
  })
  it('prefers the one closest to comfort, even if farther', () => {
    expect(pick(hard, [hard, street('far-easy', 200, 18), street('close-mixed', 60, 30)])).toBe('far-easy')
  })
  it('among easy ones, the closest to the middle of the range (17.5 °C), not the coolest', () => {
    expect(pick(hard, [hard, street('cool', 50, 10), street('middle', 200, 18)])).toBe('middle')
  })
  it('among mixed ones, the fewest degrees outside the range', () => {
    expect(pick(hard, [hard, street('m31', 50, 31), street('m27', 200, 27)])).toBe('m27')
  })
  it('the same comfort: the shorter walk wins', () => {
    expect(pick(hard, [hard, street('far', 200, 20), street('near', -100, 15)])).toBe('near')
  })
  it('on the cold side, a warmer street', () => {
    const cold = street('here', 0, -20)
    expect(pick(cold, [cold, street('cold-ish', 100, -5), street('mild', -100, 16)])).toBe('mild')
  })
  it('returns where to go and how far', () => {
    const near = easierThermalNearby(hard, [hard, street('easy', 100, 22)])
    expect(Math.round(near.d)).toBe(100)
    expect(near.mid.lat).toBeGreaterThan(48.2)
  })
})

describe('easierNearby (any layer)', () => {
  it('uses the level and rank it is given', () => {
    const levels = { here: LEVEL.hard, a: LEVEL.easy, b: LEVEL.easy }
    const here = street('here', 0)
    const near = easierNearby(here, [here, street('a', 100), street('b', -100)], {
      levelOf: (f) => levels[f.properties.id], rank: (x) => (x.properties.id === 'b' ? 0 : 1),
    })
    expect(near.f.properties.id).toBe('b')
  })
})
