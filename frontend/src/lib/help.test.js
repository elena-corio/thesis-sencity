import { describe, expect, it } from 'vitest'
import { ABOUT_SECTIONS, TIPS, TIP_IDS, TIPS_KEY, readSeen, writeSeen } from './help.js'

function memory() {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }
}

describe('first-time tips', () => {
  it('one per main view, with click on a desktop and tap on a phone', () => {
    expect(TIP_IDS).toEqual(['map', 'place', 'routes', 'walk', 'profile'])
    expect(TIPS.map('Click')).toMatch(/^Click the map/)
    expect(TIPS.map('Tap')).toMatch(/^Tap the map.*Tap a street to see why/)
    for (const id of TIP_IDS) expect(TIPS[id]('Click')).not.toMatch(/persona/i)
  })

  it('seen tips are kept, once each, and unknown ids are dropped', () => {
    const s = memory()
    expect(readSeen(s)).toEqual([])
    writeSeen(['map', 'map', 'nope', 'walk'], s)
    expect(JSON.parse(s.getItem(TIPS_KEY))).toEqual(['map', 'walk'])
    expect(readSeen(s)).toEqual(['map', 'walk'])
    writeSeen([], s)
    expect(s.getItem(TIPS_KEY)).toBeNull()
  })

  it('a broken or blocked store reads as none', () => {
    const s = memory()
    s.setItem(TIPS_KEY, '{oops')
    expect(readSeen(s)).toEqual([])
    const blocked = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => {} }
    expect(readSeen(blocked)).toEqual([])
    expect(() => writeSeen(['map'], blocked)).not.toThrow()
  })

  it('About has the seven sections, in order', () => {
    expect(ABOUT_SECTIONS).toEqual(['what', 'colours', 'ratings', 'data', 'weather', 'photos', 'limits'])
  })
})
