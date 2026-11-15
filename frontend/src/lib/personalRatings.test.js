import { describe, expect, it } from 'vitest'
import { MAX_ENTRIES, RATINGS_KEY, clearAll, count, find, keep, keepOnly } from './personalRatings.js'

function fakeStorage() {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }
}
const PHOTO = { id: '123', heading: 90 }
const STAMP = { listed: ['shade', 'traffic_trams'], model: 'google/m', commit: 'ed963d2' }
const RESULT = { comfort: 2, personal: true }

describe('personal ratings in this browser', () => {
  it('are found by photo and profile version, with their stamp', () => {
    const s = fakeStorage()
    keep(PHOTO, 'aaa', STAMP, RESULT, s)
    expect(find(PHOTO, 'aaa', s)).toMatchObject({ stamp: STAMP, result: RESULT })
    expect(find(PHOTO, 'bbb', s)).toBe(null) // another profile
    expect(find({ id: '123', heading: 91 }, 'aaa', s)).toBe(null) // another view of the photo
    expect(find({ id: '123', heading: 90.04 }, 'aaa', s)).not.toBe(null) // the heading as the API rounds it
  })

  it('keep only the current profile\'s, and all go with Delete my profile', () => {
    const s = fakeStorage()
    keep(PHOTO, 'aaa', STAMP, RESULT, s)
    keep({ id: '9', heading: 0 }, 'bbb', STAMP, RESULT, s)
    keepOnly('bbb', s)
    expect(count(s)).toBe(1)
    expect(find(PHOTO, 'aaa', s)).toBe(null)
    clearAll(s)
    expect(count(s)).toBe(0)
    expect(s.m.has(RATINGS_KEY)).toBe(false)
  })

  it('drop the oldest beyond the limit, and survive broken or blocked storage', () => {
    const s = fakeStorage()
    const full = Object.fromEntries(Array.from({ length: MAX_ENTRIES }, (_, i) => [`${i}|0|v`, { stamp: STAMP, result: RESULT, saved: i }]))
    s.setItem(RATINGS_KEY, JSON.stringify(full))
    keep({ id: 'new1', heading: 0 }, 'v', STAMP, RESULT, s)
    keep({ id: 'new2', heading: 0 }, 'v', STAMP, RESULT, s)
    expect(count(s)).toBe(MAX_ENTRIES)
    expect(find({ id: '0', heading: 0 }, 'v', s)).toBe(null)
    expect(find({ id: 'new2', heading: 0 }, 'v', s)).not.toBe(null)
    s.setItem(RATINGS_KEY, '{broken')
    expect(find(PHOTO, 'v', s)).toBe(null)
    const blocked = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => {} }
    expect(() => keep(PHOTO, 'v', STAMP, RESULT, blocked)).not.toThrow()
    expect(find(PHOTO, 'v', blocked)).toBe(null)
  })
})
