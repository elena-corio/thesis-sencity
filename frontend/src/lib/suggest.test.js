import { describe, expect, it } from 'vitest'
import { pickSuggestions, thermalSuggestions } from './suggest.js'

const M = 111195 // metres per degree of latitude
// A short street (or, with area, a small square polygon) whose middle is `north` m north of 48.2.
const place = (id, north, utci, { area = null, east = 0 } = {}) => {
  const lat = 48.2 + north / M
  const lon = 16.37 + east / (M * Math.cos((48.2 * Math.PI) / 180))
  const d = 0.0001
  const geometry = area
    ? { type: 'Polygon', coordinates: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]] }
    : { type: 'LineString', coordinates: [[lon - d, lat], [lon + d, lat]] }
  return { type: 'Feature', properties: { id, name: id, utci, place_type: area ?? 'street' }, geometry }
}
const ids = (list) => list.map((s) => s.f.properties.id)
const CENTRE = { lat: 48.2, lon: 16.37 }
const pick = (fs, opts = {}) => ids(thermalSuggestions(fs, { centre: CENTRE, ...opts }))

describe('thermalSuggestions', () => {
  it('keeps only easy places, closest to the middle of the range (17.5 °C) first, at most 3', () => {
    const fs = [place('hot', 0, 36), place('mixed', 200, 29), place('a', 400, 24), place('b', 600, 20),
      place('c', 800, 10), place('d', 1000, 16)]
    expect(pick(fs)).toEqual(['d', 'b', 'a'])
  })
  it('0–9 °C is not easy, so not suggested', () => {
    expect(pick([place('chilly', 0, 5), place('mild', 400, 20)])).toEqual(['mild'])
  })
  it('keeps each pick at least 150 m from the others', () => {
    const fs = [place('a', 0, 17.5), place('near-a', 100, 18), place('far', 400, 19)]
    expect(pick(fs)).toEqual(['a', 'far'])
    expect(pick(fs, { minApartM: 50 })).toEqual(['a', 'near-a', 'far'])
  })
  it('within the margin, prefers a type not picked yet', () => {
    const fs = [place('s1', 0, 17.5), place('s2', 400, 18), place('park', 800, 18.8, { area: 'park' }),
      place('square', -400, 21, { area: 'square' })]
    // s2 and the park are both within 1 °C of each other: the park goes first, being a new type.
    expect(pick(fs)).toEqual(['s1', 'park', 's2'])
  })
  it('outside the margin, the one closer to comfort wins even of the same type', () => {
    const fs = [place('s1', 0, 17.5), place('s2', 400, 18.5), place('park', 800, 20, { area: 'park' })]
    expect(pick(fs)).toEqual(['s1', 's2', 'park'])
  })
  it('a tie goes to the place nearer the area centre', () => {
    const fs = [place('far', 600, 20), place('near', 200, 20), place('mid', -400, 20)]
    expect(pick(fs)).toEqual(['near', 'mid', 'far'])
  })
  it('respects the Places filter', () => {
    const fs = [place('street', 0, 18), place('park', 400, 20, { area: 'park' }),
      place('ped-area', 800, 21, { area: 'pedestrian' }), place('square', -400, 22, { area: 'square' })]
    expect(pick(fs, { filter: 'streets' })).toEqual(['street'])
    expect(pick(fs, { filter: 'parks' })).toEqual(['park'])
    expect(pick(fs, { filter: 'squares' })).toEqual(['ped-area', 'square'])
  })
  it('returns fewer when fewer qualify, and none when nothing is easy', () => {
    expect(pick([place('a', 0, 20), place('hot', 400, 35)])).toEqual(['a'])
    expect(pick([place('hot', 0, 35), place('cold', 400, -20)])).toEqual([])
  })
  it('numbers the picks and gives their level', () => {
    const [s] = thermalSuggestions([place('a', 0, 20)], { centre: CENTRE })
    expect(s.n).toBe(1)
    expect(s.level).toBe('easy')
  })
  it('uses the limits it is given', () => {
    const strict = { heat: [19, 25], cold: [9, -13] }
    expect(pick([place('a', 0, 20), place('b', 400, 18)], { limits: strict })).toEqual(['b'])
  })
})

describe('pickSuggestions (any layer)', () => {
  it('uses the keep and value it is given', () => {
    const fs = [place('x', 0), place('y', 400), place('z', 800)]
    const value = { x: 1, y: 3, z: 2 }
    expect(ids(pickSuggestions(fs, { keep: (f) => f.properties.id !== 'z', value: (f) => value[f.properties.id] })))
      .toEqual(['y', 'x'])
  })
})
