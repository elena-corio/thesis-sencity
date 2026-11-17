import { describe, expect, it } from 'vitest'
import { GROUP, MY_RATINGS_KEY, OTHER_MAX, addRating, allRatings, b2From, clearRatings, closeness, latestFor, nextTick, predictionOf, setRatings, tickOf, updateRating } from './myRatings.js'

function fakeStorage() {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }
}
const RESULT = { comfort: 3, personal: true, listed: ['traffic_trams', 'shade'], model: 'google/m', commit: 'abc1234', prompt: '2' }
const PHOTO = { id: 'sv:pano1', heading: 90, source: 'streetview' }

describe('your photo ratings', () => {
  it('keep the prediction that was shown: level, B1, V2 or V0, profile hash, elements, prompt and model', () => {
    expect(predictionOf(RESULT, '386e888b8867')).toEqual({ level: 'mixed', B1: 3, version: 'V2', profileHash: '386e888b8867',
      elements: ['traffic_trams', 'shade'], prompt: '2', model: 'google/m', commit: 'abc1234' })
    expect(predictionOf({ ...RESULT, personal: false }, '386e888b8867')).toMatchObject({ version: 'V0', profileHash: null })
    expect(predictionOf(null)).toBe(null) // not rated yet, or could not be rated
  })

  it('append: rating a photo again adds an entry, the history is kept', () => {
    const s = fakeStorage()
    addRating({ photo: PHOTO, B1: 2, prediction: predictionOf(RESULT), from: 'map', at: '2026-11-16T10:00:00Z' }, s)
    addRating({ photo: PHOTO, B1: 4, prediction: predictionOf(RESULT), from: 'walk', at: '2026-11-16T10:05:00Z' }, s)
    expect(allRatings(s).map((e) => e.rating.B1)).toEqual([2, 4])
    expect(latestFor('sv:pano1', s).rating.B1).toBe(4)
    expect(Object.keys(allRatings(s)[0].photo)).toEqual(['id', 'heading', 'source']) // the ID, never the image
  })

  it('keep a rating with no prediction shown as prediction: null', () => {
    const s = fakeStorage()
    const e = addRating({ photo: PHOTO, B1: 5, prediction: null, from: 'photo' }, s)
    expect(e.prediction).toBe(null)
    expect(allRatings(s)).toHaveLength(1)
  })

  it('refuse what is not a rating, and drop broken entries on import', () => {
    const s = fakeStorage()
    expect(() => addRating({ photo: PHOTO, B1: 7, from: 'map' }, s)).toThrow()
    expect(() => addRating({ photo: PHOTO, B1: 3, from: 'somewhere' }, s)).toThrow()
    setRatings([{ photo: { id: 'x' }, rating: { B1: 3 }, prediction: null, at: '2026-11-16', from: 'map' }, { nope: 1 }], s)
    expect(allRatings(s)).toHaveLength(1)
    clearRatings(s)
    expect(s.m.has(MY_RATINGS_KEY)).toBe(false)
  })
})

describe('how close SenCity is to you', () => {
  // A fixture: 13 ratings, 12 with a prediction (8 V2, 4 V0) and one with none.
  const at = (i) => `2026-11-16T10:${String(i).padStart(2, '0')}:00Z`
  const r = (i, you, pred, version) => ({ photo: { id: `p${i}` }, rating: { B1: you }, from: 'map', at: at(i),
    prediction: pred == null ? null : { B1: pred, version } })
  const FIXTURE = [
    r(1, 2, 3, 'V2'), r(2, 4, 4, 'V2'), r(3, 1, 4, 'V2'), r(4, 5, 4, 'V2'), // V2 gaps 1, 0, 3, 1 → 1.25
    r(5, 3, 3, 'V2'), r(6, 2, 2, 'V2'), r(7, 4, 2, 'V2'), r(8, 3, 3, 'V2'), // V2 gaps 0, 0, 2, 0 → 0.5
    r(9, 4, 2, 'V0'), r(10, 5, 3, 'V0'), r(11, 1, 1, 'V0'), r(12, 3, 4, 'V0'), // V0 gaps 2, 2, 0, 1 → 1.25
    r(13, 3, null), // no prediction shown: not counted
  ]
  it('counts only ratings with a prediction: number, mean gap, share within 1 point', () => {
    const c = closeness(FIXTURE)
    expect(c.n).toBe(12)
    expect(c.gap).toBeCloseTo(12 / 12) // gaps: 1,0,3,1, 0,0,2,0, 2,2,0,1 = 12
    expect(c.within1).toBeCloseTo(8 / 12) // gaps within 1: 1,0,1, 0,0,0, 0,1 (not 3, 2, 2, 2)
    expect(c.enough).toBe(true)
  })
  it('says not enough under 4 ratings with a prediction', () => {
    expect(GROUP).toBe(4)
    expect(closeness(FIXTURE.slice(0, 3)).enough).toBe(false)
    expect(closeness([]).gap).toBe(null)
  })
})

describe('what made the difference (after rating)', () => {
  it('one tap +, two taps −, a third clears; stored as B2 the way the study does', () => {
    expect([nextTick(''), nextTick('+'), nextTick('−')]).toEqual(['+', '−', ''])
    expect(b2From({ traffic_trams: '−', shade: '+', crowds: '' })).toEqual({ traffic_trams: ['unpleasant'], shade: ['pleasant'] })
    expect(b2From({ shade: '' })).toBe(null) // nothing ticked: not said (optional), not the study's "none"
    expect(tickOf({ shade: ['pleasant'] }, 'shade')).toBe('+')
    expect(tickOf({ shade: ['unpleasant'] }, 'shade')).toBe('−')
    expect(tickOf(null, 'shade')).toBe('')
  })

  it('updates the same rating, B2 and "Something else?" (at most 150 characters), and keeps them on import', () => {
    const s = fakeStorage()
    const e = addRating({ photo: PHOTO, B1: 2, prediction: predictionOf(RESULT), from: 'map' }, s)
    expect(e.rating).toEqual({ B1: 2, B2: null, B2_other: null })
    updateRating(e.id, { B2: { shade: ['pleasant'] } }, s)
    updateRating(e.id, { B2_other: `  ${'x'.repeat(200)}  ` }, s)
    const [kept] = allRatings(s)
    expect(allRatings(s)).toHaveLength(1) // the same entry
    expect(kept.rating.B2).toEqual({ shade: ['pleasant'] })
    expect(kept.rating.B2_other).toHaveLength(OTHER_MAX)
    const other = fakeStorage()
    setRatings(JSON.parse(JSON.stringify(allRatings(s))), other)
    expect(allRatings(other)[0].rating).toEqual(kept.rating)
    setRatings([{ ...kept, rating: { ...kept.rating, B2: { shade: ['great'] } } }], other) // not the study's answers: dropped
    expect(allRatings(other)).toHaveLength(0)
  })
})
