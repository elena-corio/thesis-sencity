import { describe, expect, it } from 'vitest'
import { combinePlace, comfortLabel, comfortLevel, elementLabel, recommendations, routeSummary, runStatusLine, withSenses } from './senses.js'

const anchors = ['not at all, too much for my senses', 'very much']
const el = (code) => ({ code, en: code, it: code, sense: 'sight' })
const ok = (comfort, bothers = ['a'], good = ['b'], reason = `r${comfort}`) =>
  ({ status: 'ok', result: { comfort, anchors, bothers: bothers.map(el), feels_good: good.map(el), reason } })
const photos = (n) => Array.from({ length: n }, (_, i) => ({ pano_id: `p${i}`, heading: 0, date: `2024-0${i + 1}` }))
const place =(...states) => {
  const list = photos(states.length)
  return combinePlace(list, (p) => states[list.indexOf(p)])
}

describe('Senses words', () => {
  it('uses the survey words for 1 and 5, and our own for 2 to 4', () => {
    expect(comfortLabel({ comfort: 1, anchors })).toBe('1 · not at all, too much for my senses')
    expect(comfortLabel({ comfort: 4, anchors })).toBe('4 · fairly comfortable')
    expect(comfortLabel({ comfort: 5, anchors })).toBe('5 · very much')
  })

  it('maps a rating to its state', () => {
    expect([1, 2, 3, 4, 5].map(comfortLevel)).toEqual(['hard', 'hard', 'mixed', 'easy', 'easy'])
  })

  it('splits the sense from the label, and leaves "Nothing" alone', () => {
    expect(elementLabel({ en: 'Signs, ads (sight)' })).toEqual({ text: 'Signs, ads', sense: 'sight' })
    expect(elementLabel({ en: 'Nothing' })).toEqual({ text: 'Nothing', sense: '' })
  })
})

describe('one place from its photos', () => {
  it('takes the median of three and the elements named in at least two', () => {
    const p = place(ok(2, ['a', 'c']), ok(4, ['a']), ok(5, ['d']))
    expect(p.comfort).toBe(4)
    expect(p.level).toBe('easy')
    expect(p.bothers.map((e) => e.code)).toEqual(['a'])
  })

  it('takes the lower of two, and elements named in both', () => {
    const p = place(ok(3, ['a', 'c']), ok(4, ['a']))
    expect(p.comfort).toBe(3)
    expect(p.bothers.map((e) => e.code)).toEqual(['a'])
  })

  it('uses one photo as it is', () => {
    expect(place(ok(2, ['a', 'c'])).bothers.map((e) => e.code)).toEqual(['a', 'c'])
  })

  it('opens on the photo closest to the median, then the most recent', () => {
    expect(place(ok(1), ok(4), ok(5)).rep).toBe(1)
    expect(place(ok(4), ok(4)).rep).toBe(1)
  })

  it('counts what is failed or still pending, and never hides a failure', () => {
    const some = place(ok(4), { status: 'failed', error: 'x' }, undefined)
    expect(some).toMatchObject({ status: 'rated', nRated: 1, nFailed: 1, nPending: 1 })
    expect(place({ status: 'failed', error: 'bad' })).toMatchObject({ status: 'failed', error: 'bad' })
    expect(place(undefined).status).toBe('pending')
  })

  it('leaves "nothing" out of the main bothering elements', () => {
    expect(place(ok(4, ['nothing'])).mainBothers).toEqual([])
  })
})

const at = (id, lon, comfort) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[lon, 48.2], [lon, 48.2001]] },
  properties: { id, place_type: 'street', comfort } })

describe('recommendations', () => {
  const placeOf = (f) => (f.properties.comfort ? { status: 'rated', comfort: f.properties.comfort } : { status: 'pending' })
  const centre = { lat: 48.2, lon: 16.37 }

  it('lists the best first, the worst to avoid, and never a hard place as comfortable', () => {
    const fs = [at('a', 16.37, 3), at('b', 16.372, 5), at('c', 16.374, 1), at('d', 16.376, 2), at('e', 16.378, 4), at('f', 16.38, null)]
    const { best, avoid } = recommendations(fs, placeOf, centre)
    expect(best.map((x) => x.f.properties.id)).toEqual(['b', 'e', 'a'])
    expect(avoid.map((x) => x.f.properties.id)).toEqual(['c', 'd'])
  })

  it('keeps picks apart, so one street does not fill the list', () => {
    const { best } = recommendations([at('a', 16.37, 5), at('b', 16.3701, 5), at('c', 16.375, 4)], placeOf, centre)
    expect(best.map((x) => x.f.properties.id)).toEqual(['a', 'c'])
  })
})

describe('a route', () => {
  const s = (key, length_m, comfort) => ({ key, length_m, comfort })
  const placeOf = (x) => (x.comfort ? { status: 'rated', comfort: x.comfort, anchors } : { status: 'pending' })

  it('weights the median by length and finds the hardest stretch', () => {
    const r = routeSummary([s('a', 100, 4), s('b', 300, 3), s('c', 50, 2), s('d', 50, null)], placeOf)
    expect(r.comfort).toBe(3)
    expect(r.level).toBe('mixed')
    expect(r.hardest.stretch.key).toBe('c')
    expect(r.share).toBeCloseTo(0.9)
  })

  it('is empty before any stretch is rated', () => {
    expect(routeSummary([s('a', 100, null)], placeOf)).toBeNull()
  })
})

it('puts the state on the segments, and changes nothing when it is already there', () => {
  const fc = { features: [{ properties: { id: 'a' } }] }
  const next = withSenses(fc, new Map([['a', 'easy']]))
  expect(next.features[0].properties.senses_state).toBe('easy')
  expect(withSenses(next, new Map([['a', 'easy']]))).toBe(next)
})

it('writes the status line', () => {
  const run = { model: 'm', cachedCount: 12, newCount: 96, costUsd: 0.0512, streetviewUsd: 0.672, seconds: 38.2 }
  expect(runStatusLine(run, 40)).toBe('m · 40 places rated · 12 cached, 96 new · $0.0512 model, about $0.67 Street View · 38 s')
})
