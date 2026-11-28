// The app test's pure parts (D197): the survey's B1 wording, the estimate as shown, the answer as saved.
import { describe, expect, it } from 'vitest'
import { answerOf, B1, estimateOf, nextIndex, SCENARIO } from './appTest.js'

const photo = { id: 'sv:AAAAAAAAAAAA', order: 2 }
const result = { comfort: 3, bothers: [{ code: 'crowds' }], feels_good: [{ code: 'seats' }], model: 'm', personal: true }
const stamp = { model: 'm', commit: 'abcdef1', prompt: 'p3' }

describe('app test', () => {
  it('keeps the survey\'s exact words for B1 and the scenario', () => {
    expect(B1.title).toBe('How sensory-comfortable would you be walking through here?')
    expect(B1.help).toBe('Think of what you can see in the photo.')
    expect(B1.ends).toEqual(['Not at all, too much for my senses', 'Very much'])
    expect(SCENARIO).toBe('Imagine walking through this place as it is in the photo, at that time of day and in the weather you see.')
  })

  it('records the estimate as shown', () => {
    expect(estimateOf(result, stamp, 'v1')).toEqual({ comfort: 3, level: 'mixed', bothers: ['crowds'], feels_good: ['seats'],
      model: 'm', commit: 'abcdef1', prompt: 'p3', profile_version: 'v1', personal: true })
    expect(estimateOf(null, stamp, 'v1')).toBe(null)
    expect(estimateOf(result, null, 'v1')).toBe(null)
  })

  it('never turns a missing rating into 0', () => {
    for (const rating of [null, undefined, 0, 6, 2.5, '3']) {
      expect(answerOf({ photo, estimate: null, rating, shownAt: 't' }).rating).toBe(null)
    }
    expect(answerOf({ photo, estimate: null, rating: 5, shownAt: 't' }).rating).toBe(5)
  })

  it('sends the reasons answer only with an estimate, and the photo\'s fixed order', () => {
    const est = estimateOf(result, stamp, 'v1')
    expect(answerOf({ photo, estimate: est, rating: 2, reasonsRight: 'no', freeText: '  x ', shownAt: 't' }))
      .toMatchObject({ photo_id: photo.id, order: 2, reasons_right: 'no', free_text: 'x' })
    expect(answerOf({ photo, estimate: null, rating: 2, reasonsRight: 'no', shownAt: 't' }).reasons_right).toBe(null)
    expect(answerOf({ photo, estimate: est, rating: 2, reasonsRight: 'maybe', shownAt: 't' }).reasons_right).toBe(null)
  })

  it('goes on at the first photo without an answer, in the fixed order', () => {
    const photos = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(nextIndex(photos, [])).toBe(0)
    expect(nextIndex(photos, ['a', 'c'])).toBe(1)
    expect(nextIndex(photos, ['a', 'b', 'c'])).toBe(3)
  })
})
