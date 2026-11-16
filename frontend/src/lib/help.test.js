import { describe, expect, it } from 'vitest'
import { ABOUT_SECTIONS, TIPS, TIP_GROUPS, TIP_IDS, TIPS_KEY, currentTip, groupOf, readSeen, writeSeen } from './help.js'

function memory() {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }
}

describe('first-time tips', () => {
  it('one per main view, with click on a desktop and tap on a phone', () => {
    expect(TIP_IDS).toEqual(['area', 'layer', 'season', 'places', 'results', 'place', 'route-points', 'route-layer', 'route-season', 'walk', 'profile'])
    expect(TIPS.area('Click')).toMatch(/^Click the map/)
    expect(TIPS.area('Tap')).toMatch(/^Tap the map/)
    expect(TIPS.results('Tap')).toMatch(/^Tap a street/)
    for (const id of TIP_IDS) expect(TIPS[id]('Click')).not.toMatch(/persona/i)
  })

  it('seen tips are kept, once each, and unknown ids are dropped', () => {
    const s = memory()
    expect(readSeen(s)).toEqual([])
    writeSeen(['area', 'area', 'nope', 'walk'], s)
    expect(JSON.parse(s.getItem(TIPS_KEY))).toEqual(['area', 'walk'])
    expect(readSeen(s)).toEqual(['area', 'walk'])
    writeSeen([], s)
    expect(s.getItem(TIPS_KEY)).toBeNull()
  })

  it('a broken or blocked store reads as none', () => {
    const s = memory()
    s.setItem(TIPS_KEY, '{oops')
    expect(readSeen(s)).toEqual([])
    const blocked = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => {} }
    expect(readSeen(blocked)).toEqual([])
    expect(() => writeSeen(['area'], blocked)).not.toThrow()
  })

  it('the settings tips play in order, one at a time, passing over a part not on screen', () => {
    const all = TIP_GROUPS.area
    expect(groupOf('season')).toBe('area')
    expect(groupOf('place')).toBeNull()
    expect(currentTip('area', [], all)).toBe('area')
    expect(currentTip('area', ['area'], all)).toBe('layer')
    expect(currentTip('area', ['area', 'layer'], ['area', 'layer', 'places'])).toBe('places') // Senses: no season
    expect(currentTip('area', ['area', 'layer', 'places'], all)).toBe('season') // it shows when its part appears
    expect(currentTip('area', all, all)).toBeNull()
  })

  it('About has the seven sections, in order', () => {
    expect(ABOUT_SECTIONS).toEqual(['what', 'colours', 'ratings', 'data', 'weather', 'photos', 'limits'])
  })
})
