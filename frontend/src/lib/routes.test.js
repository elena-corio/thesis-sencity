import { describe, expect, it } from 'vitest'
import { formatKm, formatLength, runsOf, stretchesOf, stretchFeature, stretchMiddle } from './routes.js'

const seg = (id, state, extra = {}) => [id, {
  properties: { id, name: id, named: true, length_m: 100, photos: [], thermal_state: state, thermal_score: state === 'hard' ? 2 : 5, utci: state === 'hard' ? 35 : 20, ...extra },
}]
const part = (id, from, to, length = 100) => ({ segment_id: id, length_m: length, coordinates: [[from, 48], [to, 48]] })

describe('stretches', () => {
  const byId = new Map([seg('a', 'easy'), seg('b', 'easy'), seg('c', 'hard'), seg('d', 'easy')])

  it('every segment is its own stretch, also when its neighbour has the same state', () => {
    const s = stretchesOf({ id: 'A', parts: [part('a', 0, 1), part('b', 1, 2), part('c', 2, 3)] }, byId, 'thermal')
    expect(s.map((x) => [x.key, x.index, x.state, x.segmentId, x.length_m])).toEqual([
      ['A-0', 0, 'easy', 'a', 100],
      ['A-1', 1, 'easy', 'b', 100],
      ['A-2', 2, 'hard', 'c', 100],
    ])
  })

  it('a segment with no value has the state none', () => {
    const m = new Map([['x', { properties: { id: 'x', name: 'x' } }]])
    expect(stretchesOf({ id: 'B', parts: [part('x', 1, 2)] }, m, 'thermal')[0].state).toBe('none')
  })

  it('a connector joins the stretch before it, or the first one at the start', () => {
    const s = stretchesOf({ id: 'A', parts: [part(null, 0, 1, 5), part('a', 1, 2), part(null, 2, 3, 8), part('c', 3, 4)] }, byId, 'thermal')
    expect(s.map((x) => [x.segmentId, x.length_m])).toEqual([['a', 113], ['c', 100]])
    expect(s[0].coordinates).toEqual([[0, 48], [1, 48], [2, 48], [3, 48]])
    expect(s[1].coordinates).toEqual([[3, 48], [4, 48]])
  })

  it('reads the state of the chosen layer', () => {
    const m = new Map([['a', { properties: { id: 'a', thermal_state: 'easy', senses_state: 'hard' } }]])
    expect(stretchesOf({ id: 'A', parts: [part('a', 0, 1)] }, m, 'senses')[0].state).toBe('hard')
  })

  it('runs join consecutive stretches with the same state, for the dashes', () => {
    const s = stretchesOf({ id: 'B', parts: [part('a', 0, 1), part('b', 1, 2), part('c', 2, 3), part('d', 3, 4)] }, byId, 'thermal')
    expect(runsOf(s)).toEqual([
      { state: 'easy', coordinates: [[0, 48], [1, 48], [2, 48]] },
      { state: 'hard', coordinates: [[2, 48], [3, 48]] },
      { state: 'easy', coordinates: [[3, 48], [4, 48]] },
    ])
  })
})

describe('the stretch as a place', () => {
  it('is its segment, with the length walked (a snapped start walks only part of it)', () => {
    const photos = [{ pano_id: 'a', heading: 10 }]
    const byId = new Map([seg('Graben', 'hard', { length_m: 80, utci: 33, thermal_score: 2, photos })])
    const f = stretchFeature({ key: 'A-0', segmentId: 'Graben', length_m: 30, coordinates: [[0, 48], [1, 48]] }, byId)
    expect(f.properties).toMatchObject({ id: 'A-0', name: 'Graben', length_m: 30, utci: 33, thermal_score: 2, photos })
  })

  it('has no thermal value when its segment has none', () => {
    const byId = new Map([['x', { properties: { id: 'x', name: 'Footway', named: false, length_m: 40, photos: null } }]])
    const f = stretchFeature({ key: 'A-0', segmentId: 'x', length_m: 40, coordinates: [[0, 48], [1, 48]] }, byId)
    expect(f.properties.utci).toBeUndefined()
    expect(f.properties.name).toBe('Footway')
  })

  it('the middle is halfway along the walk', () => {
    expect(stretchMiddle({ coordinates: [[0, 48], [1, 48], [3, 48]] }).lon).toBeCloseTo(1.5)
  })
})

describe('words', () => {
  it('formats distances', () => {
    expect(formatKm(1430)).toBe('1.4 km')
    expect(formatLength(214)).toBe('210 m')
    expect(formatLength(3)).toBe('10 m')
    expect(formatLength(1430)).toBe('1.4 km')
  })
})
