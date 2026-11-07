import { describe, expect, it } from 'vitest'
import { PLACE_FILTERS, placeGroup } from './place.js'

describe('place filter', () => {
  it('offers All, Streets, Parks, Squares in that order', () => {
    expect(PLACE_FILTERS.map((p) => p.label)).toEqual(['All', 'Streets', 'Parks', 'Squares'])
  })
  it('puts every highway way under Streets, pedestrian streets included', () => {
    expect(placeGroup({ place_type: 'street' }, 'LineString')).toBe('streets')
    expect(placeGroup({ place_type: 'pedestrian' }, 'LineString')).toBe('streets')
  })
  it('puts leisure=park under Parks', () => {
    expect(placeGroup({ place_type: 'park' }, 'Polygon')).toBe('parks')
  })
  it('puts place=square and pedestrian areas under Squares', () => {
    expect(placeGroup({ place_type: 'square' }, 'Polygon')).toBe('squares')
    expect(placeGroup({ place_type: 'pedestrian' }, 'Polygon')).toBe('squares')
  })
})
