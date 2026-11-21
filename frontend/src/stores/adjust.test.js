// "Adjust to my own ratings" through the stores: off by default, the gap only when on and with enough personal
// ratings, and gone with "Delete my profile". The feature is disabled in config.js (ENABLE_ADJUST = false); these tests
// switch it on to check the code as built, and off to check that nothing shows or shifts. Local storage is in memory.
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MY_RATINGS_KEY } from '../lib/myRatings.js'
import { ADJUST_KEY, useAdjustStore } from './adjust.js'
import { useProfileStore } from './profile.js'

vi.mock('../lib/api.js', () => ({ loadSurvey: async () => null }))
const flag = vi.hoisted(() => ({ on: true }))
vi.mock('../config.js', async (original) => {
  const real = await original()
  return { ...real, get ENABLE_ADJUST() { return flag.on } }
})

class MemoryStorage {
  constructor() { this.m = new Map() }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null }
  setItem(k, v) { this.m.set(k, String(v)) }
  removeItem(k) { this.m.delete(k) }
  clear() { this.m.clear() }
  key(i) { return [...this.m.keys()][i] ?? null }
  get length() { return this.m.size }
}
const entry = (own, pred, version = 'V2') => ({ id: `${Math.random()}`, photo: { id: 'p', heading: 0, source: 'streetview' },
  rating: { B1: own, B2: null, B2_other: null }, prediction: { B1: pred, version, level: 'mixed' }, at: '2026-11-21', from: 'map' })
const keep = (list) => globalThis.localStorage.setItem(MY_RATINGS_KEY, JSON.stringify(list))
const fresh = () => { setActivePinia(createPinia()); return useAdjustStore() }

beforeEach(() => {
  globalThis.localStorage = new MemoryStorage()
  flag.on = true
})

describe('adjust to my own ratings', () => {
  it('is off by default: no gap, even with enough ratings', () => {
    keep([entry(4, 3), entry(5, 3), entry(3, 3), entry(4, 2)])
    const s = fresh()
    expect(s.on).toBe(false)
    expect(s.available).toBe(true)
    expect(s.gap).toBe(null)
  })

  it('gives the gap when on, from personal ratings only; kept for the next visit', () => {
    keep([entry(4, 3), entry(5, 3), entry(3, 3), entry(4, 2), entry(1, 5, 'V0')])
    const s = fresh()
    s.setOn(true)
    expect(s.gap).toBe(1.25)
    expect(s.count).toBe(4)
    expect(fresh().gap).toBe(1.25)
  })

  it('is not available, and has no gap, under 4 personal ratings', () => {
    keep([entry(4, 3), entry(5, 3), entry(3, 3), entry(1, 5, 'V0')])
    const s = fresh()
    s.setOn(true)
    expect(s.available).toBe(false)
    expect(s.gap).toBe(null)
    keep([entry(4, 3), entry(5, 3), entry(3, 3), entry(4, 2)])
    s.refresh() // a new rating
    expect(s.gap).toBe(1.25)
  })

  it('is disabled by the flag: no gap even when kept on with enough ratings', () => {
    flag.on = false
    keep([entry(4, 3), entry(5, 3), entry(3, 3), entry(4, 2)])
    globalThis.localStorage.setItem(ADJUST_KEY, '{"on":true}')
    const s = fresh()
    expect(s.enabled).toBe(false)
    expect(s.gap).toBe(null)
  })

  it('goes with "Delete my profile": off, and nothing left to shift by', () => {
    keep([entry(4, 3), entry(5, 3), entry(3, 3), entry(4, 2)])
    const s = fresh()
    s.setOn(true)
    useProfileStore().deleteAll()
    expect(s.on).toBe(false)
    expect(s.gap).toBe(null)
    expect(s.count).toBe(0)
    expect(globalThis.localStorage.getItem(ADJUST_KEY)).toBe(null)
    expect(globalThis.localStorage.length).toBe(0)
  })
})
