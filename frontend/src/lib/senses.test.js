import { describe, expect, it } from 'vitest'
import { comfortColor, comfortLabel, elementLabel, statusLine } from './senses.js'

describe('Senses words', () => {
  it('names a rating with its number and words', () => {
    expect(comfortLabel(4)).toBe('4 · fairly comfortable')
  })

  it('runs the colour from low to high', () => {
    expect(comfortColor(1)).toContain('var(--senses-high) 0%')
    expect(comfortColor(5)).toContain('var(--senses-high) 100%')
  })

  it('splits the sense from the label, and leaves "Nothing" alone', () => {
    expect(elementLabel({ en: 'Signs, ads (sight)' })).toEqual({ text: 'Signs, ads', sense: 'sight' })
    expect(elementLabel({ en: 'Nothing' })).toEqual({ text: 'Nothing', sense: '' })
  })

  it('writes the status line', () => {
    expect(statusLine({ model: 'm', latency_ms: 1400, cost_usd: 0.00051, cached: true })).toBe('m · 1.4 s · $0.0005 · cached')
    expect(statusLine({ model: 'm', latency_ms: 900, cost_usd: null, cached: false })).toBe('m · 0.9 s · cost not reported')
  })
})
