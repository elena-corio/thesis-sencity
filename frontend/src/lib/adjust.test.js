import { describe, expect, it } from 'vitest'
import { adjust, adjustNote, adjustRating, adjustedCloseness, meanGap, modelComfort, personalEntries } from './adjust.js'
import { MIN_RATINGS, predictionOf } from './myRatings.js'
import { combinePlace } from './senses.js'
import { ENABLE_ADJUST } from '../config.js'

it('is built but disabled for now (config.js ENABLE_ADJUST; Elena, 2026-11-21: untested)', () => {
  expect(ENABLE_ADJUST).toBe(false)
})

/** One of your ratings: your B1, and the prediction on screen (V2 personal, V0 general, or none). */
const r = (own, pred, version = 'V2') => ({
  photo: { id: `p${Math.random()}` }, rating: { B1: own }, from: 'map', at: '2026-11-21',
  prediction: pred == null ? null : { B1: pred, version, level: 'mixed' },
})
// Hand-worked: gaps (you − prediction) 1, 2, 0, 2 → mean 1.25.
const FOUR = [r(4, 3), r(5, 3), r(3, 3), r(4, 2)]

describe('the gap', () => {
  it('is the mean of your rating minus the prediction, from personal predictions only', () => {
    expect(meanGap(FOUR)).toBe(1.25)
    // General predictions and ratings without one never count, however many.
    expect(meanGap([...FOUR, r(1, 5, 'V0'), r(1, 5, 'V0'), r(2, null)])).toBe(1.25)
    expect(personalEntries([r(1, 5, 'V0'), r(2, null)])).toEqual([])
  })

  it('needs MIN_RATINGS personal ratings', () => {
    expect(MIN_RATINGS).toBe(4)
    expect(meanGap(FOUR.slice(0, 3))).toBe(null)
    expect(meanGap([...FOUR.slice(0, 3), r(1, 5, 'V0')])).toBe(null) // a general one does not make up the number
    expect(meanGap([])).toBe(null)
  })

  it('can be negative: you rate lower than SenCity', () => {
    expect(meanGap([r(1, 3), r(2, 3), r(2, 4), r(3, 4)])).toBe(-1.5)
  })
})

describe('the correction', () => {
  it('shifts by whole points, half a point the same way up and down', () => {
    expect(adjust(3, 1.25)).toBe(4)
    expect(adjust(3, 0.5)).toBe(4)
    expect(adjust(3, -0.5)).toBe(2)
    expect(adjust(3, 0.4)).toBe(3)
    expect(adjust(3, -0.4)).toBe(3)
    expect(adjust(2, -1.6)).toBe(1)
  })

  it('stays between 1 and 5', () => {
    expect(adjust(5, 1.5)).toBe(5)
    expect(adjust(1, -2)).toBe(1)
    expect(adjust(4, 3)).toBe(5)
  })

  it('without a gap is the prediction itself', () => {
    expect(adjust(3, null)).toBe(3)
    expect(adjust(3, NaN)).toBe(3)
  })

  it('applies to personal predictions only, and keeps the model\'s value', () => {
    const personal = { status: 'ok', result: { comfort: 3, personal: true, anchors: ['a', 'b'] } }
    const shown = adjustRating(personal, 1.25)
    expect(shown.result.comfort).toBe(4)
    expect(shown.result.adjusted).toEqual({ from: 3, gap: 1.25 })
    expect(modelComfort(shown.result)).toBe(3)
    expect(personal.result.comfort).toBe(3) // the stored rating is not changed
    const general = { status: 'ok', result: { comfort: 3, personal: false } }
    expect(adjustRating(general, 1.25)).toBe(general) // "not personalised yet": never adjusted
    const failed = { status: 'failed', error: 'x' }
    expect(adjustRating(failed, 1.25)).toBe(failed)
    expect(adjustRating(personal, null)).toBe(personal) // off, or not enough ratings
    expect(adjustRating(undefined, 1)).toBe(undefined)
  })

  it('moves a place and its level (the median of its adjusted photos)', () => {
    const photos = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const by = { a: 2, b: 3, c: 3 }
    const ratingOf = (gap) => (ph) => adjustRating({ status: 'ok', result: { comfort: by[ph.id], personal: true, anchors: ['x', 'y'], bothers: [], feels_good: [] } }, gap)
    expect(combinePlace(photos, ratingOf(null))).toMatchObject({ comfort: 3, level: 'mixed' })
    expect(combinePlace(photos, ratingOf(1.25))).toMatchObject({ comfort: 4, level: 'easy' })
    expect(combinePlace(photos, ratingOf(-1))).toMatchObject({ comfort: 2, level: 'hard' })
  })

  it('a rating made while adjusted keeps the model\'s prediction, and the shown value beside it', () => {
    const shown = adjustRating({ status: 'ok', result: { comfort: 3, personal: true, listed: [] } }, 1.25).result
    expect(predictionOf(shown, 'v1')).toMatchObject({ B1: 3, level: 'mixed', shown: 4, version: 'V2' })
    expect(predictionOf({ comfort: 3, personal: true, listed: [] }, 'v1')).not.toHaveProperty('shown')
    // Too small to move it: nothing to keep beside the model's value.
    const same = adjustRating({ status: 'ok', result: { comfort: 3, personal: true, listed: [] } }, 0.3).result
    expect(predictionOf(same, 'v1')).not.toHaveProperty('shown')
  })
})

describe('the note', () => {
  it('names the shift, and says when it is too small to change the level', () => {
    expect(adjustNote(0.6)).toBe('Adjusted to your own ratings (+0.6)')
    expect(adjustNote(-1.25)).toBe('Adjusted to your own ratings (−1.3)')
    expect(adjustNote(0.3)).toBe('Adjusted to your own ratings (+0.3, too small to change the level)')
    expect(adjustNote(-0.49)).toBe('Adjusted to your own ratings (−0.4, too small to change the level)') // never "0.5"
    expect(adjustNote(0.5)).toBe('Adjusted to your own ratings (+0.5)')
    expect(adjustNote(null)).toBe('')
  })
})

describe('how close, as predicted and adjusted', () => {
  it('the adjusted gap shifts each rating by the gap of the others (hand-worked)', () => {
    // Raw |gaps| 1, 2, 0, 2 → 1.25; within 1: 2 of 4. Leave one out: the others' gaps 4/3, 1, 5/3, 1 → shifts 1, 1, 2, 1
    // → shown 4, 4, 5, 3 against you 4, 5, 3, 4 → |gaps| 0, 1, 2, 1 → 1.0; within 1: 3 of 4.
    expect(adjustedCloseness(FOUR)).toEqual({ n: 4, raw: 1.25, adjusted: 1, within1Raw: 0.5, within1Adjusted: 0.75 })
  })

  it('counts personal predictions only, and needs MIN_RATINGS of them', () => {
    expect(adjustedCloseness([...FOUR, r(1, 5, 'V0'), r(3, null)]).n).toBe(4)
    expect(adjustedCloseness(FOUR.slice(0, 3))).toBe(null)
  })

  it('is not flattered: a steady gap is fixed, noise is not', () => {
    const steady = [r(4, 3), r(4, 3), r(5, 4), r(3, 2)]
    expect(adjustedCloseness(steady)).toMatchObject({ raw: 1, adjusted: 0 })
    const noisy = [r(5, 3), r(1, 3), r(5, 3), r(1, 3)] // mean gap 0, each 2 off
    expect(adjustedCloseness(noisy).adjusted).toBeGreaterThanOrEqual(adjustedCloseness(noisy).raw)
  })
})
