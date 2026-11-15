import { describe, expect, it } from 'vitest'
import { keyRows, keyTitle, layerNote, lengthShares } from './legend.js'

describe('the key', () => {
  it('names the layer and the window, except for Senses', () => {
    expect(keyTitle('overall', { season: 'summer', time: '15:00' })).toEqual({ name: 'Overall', when: 'summer, 15:00' })
    expect(keyTitle('senses', { season: 'summer', time: '15:00' })).toEqual({ name: 'Sensory comfort', when: '' })
  })
  it('ends with No photo, or No value on Thermal', () => {
    expect(keyRows('senses').map((r) => r.label)).toEqual(['Easy', 'Mixed', 'Hard', 'No photo'])
    expect(keyRows('thermal').at(-1).label).toBe('No value')
  })
})

describe('the layer note', () => {
  const w = { season: 'summer', time: '15:00' }
  it('says what the colours mean', () => {
    expect(layerNote('overall', w)).toBe('Each street stretch shows the worse of thermal comfort (summer, 15:00) and the rating of its photo.')
    expect(layerNote('senses', w)).toBe('Each street stretch is rated from its photo.')
    expect(layerNote('thermal', w)).toBe('Each street stretch shows its simulated feels-like temperature (summer, 15:00).')
  })
})

describe('lengthShares', () => {
  const line = (state, length_m) => ({ geometry: { type: 'LineString' }, properties: { state, length_m } })
  const park = (state) => ({ geometry: { type: 'Polygon' }, properties: { state } })
  it('shares the street length by state; places count but have no length', () => {
    const r = lengthShares([line('easy', 300), line('hard', 100), line(null, 100), park('hard')], (f) => f.properties.state)
    expect(r.total).toBe(500)
    expect(r.hard).toBeCloseTo(0.2)
    expect(r.counts).toEqual({ easy: 1, mixed: 0, hard: 2, none: 1 })
  })
})
