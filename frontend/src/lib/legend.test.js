import { describe, expect, it } from 'vitest'
import { keyRows, keyTitle, layerNote, lengthShares } from './legend.js'

describe('the key', () => {
  it('names the layer and the window, except for Senses', () => {
    expect(keyTitle('overall', { season: 'summer', time: '15:00' })).toEqual({ name: 'Overall comfort', when: 'summer, 15:00' })
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
    expect(layerNote('overall', w)).toBe('Each street stretch shows the worse of thermal comfort (summer, 15:00) and its photo rating. The photo rating is from when the photo was taken: season and time change only the thermal part.')
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

describe('the grey of nothing to show', () => {
  it('is Thermal\'s own on Thermal, and a neutral "No photo" grey on Senses and Overall', () => {
    const none = (l) => keyRows(l).find((r) => r.id === 'none')
    expect(none('thermal')).toMatchObject({ label: 'No value', color: 'var(--no-photo)' })
    expect(none('senses')).toMatchObject({ label: 'No photo', color: 'var(--no-photo-grey)' })
    expect(none('overall')).toMatchObject({ label: 'No data', color: 'var(--no-photo-grey)' })
    expect(keyRows('overall').find((r) => r.id === 'partial').label).toBe('Partial (one layer only)')
    expect(keyRows('thermal').some((r) => r.id === 'partial')).toBe(false)
  })
})
