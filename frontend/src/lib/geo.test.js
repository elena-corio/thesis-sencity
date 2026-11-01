import { describe, expect, it } from 'vitest'
import { circleRing, destination, estimatePhotos, formatCoords, haversine, limitRadius, roundTo, worldMask } from './geo.js'

const LIMITS = { min: 50, max: 500, rounding: 10 }
const STEPHANSPLATZ = { lat: 48.2085, lon: 16.3721 }

describe('haversine', () => {
  it('is zero for the same point', () => {
    expect(haversine(STEPHANSPLATZ, STEPHANSPLATZ)).toBe(0)
  })
  it('gives about 111.2 km for one degree of latitude', () => {
    expect(haversine({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(111195, -1)
  })
  it('shrinks a degree of longitude with latitude (Vienna)', () => {
    const d = haversine(STEPHANSPLATZ, { lat: 48.2085, lon: 17.3721 })
    expect(d).toBeGreaterThan(74000)
    expect(d).toBeLessThan(74300)
  })
  it('round-trips with destination', () => {
    const p = destination(STEPHANSPLATZ, 63, 180)
    expect(haversine(STEPHANSPLATZ, p)).toBeCloseTo(180, 6)
  })
})

describe('limitRadius', () => {
  it('rounds to 10 m', () => {
    expect(limitRadius(184, LIMITS)).toEqual({ radius: 180, capped: false })
    expect(limitRadius(185, LIMITS)).toEqual({ radius: 190, capped: false })
  })
  it('snaps below 50 m to 50 m', () => {
    expect(limitRadius(0, LIMITS)).toEqual({ radius: 50, capped: false })
    expect(limitRadius(12, LIMITS)).toEqual({ radius: 50, capped: false })
    expect(limitRadius(49.9, LIMITS)).toEqual({ radius: 50, capped: false })
  })
  it('stops at 500 m and reports the cap', () => {
    expect(limitRadius(500, LIMITS)).toEqual({ radius: 500, capped: false })
    expect(limitRadius(500.1, LIMITS)).toEqual({ radius: 500, capped: true })
    expect(limitRadius(2000, LIMITS)).toEqual({ radius: 500, capped: true })
  })
  it('never rounds past the maximum', () => {
    expect(limitRadius(499, LIMITS).radius).toBe(500)
  })
})

describe('roundTo', () => {
  it('rounds to the nearest step', () => {
    expect(roundTo(176, 10)).toBe(180)
    expect(roundTo(174.9, 10)).toBe(170)
  })
})

describe('circle polygons', () => {
  it('has 64 points plus the closing point, all at the radius', () => {
    const ring = circleRing(STEPHANSPLATZ, 200, 64)
    expect(ring).toHaveLength(65)
    expect(ring[0]).toEqual(ring[64])
    for (const [lon, lat] of ring) expect(haversine(STEPHANSPLATZ, { lat, lon })).toBeCloseTo(200, 6)
  })
  it('mask is the world with the circle as a hole', () => {
    const mask = worldMask(STEPHANSPLATZ, 200, 64)
    expect(mask.coordinates).toHaveLength(2)
    expect(mask.coordinates[1]).toHaveLength(65)
  })
})

describe('labels', () => {
  it('estimates photos from the area, rounded to 10', () => {
    expect(estimatePhotos(200, 1860)).toBe(230)
    expect(estimatePhotos(50, 1860)).toBe(10)
  })
  it('formats coordinates with hemispheres', () => {
    expect(formatCoords(STEPHANSPLATZ)).toBe('48.2085° N, 16.3721° E')
    expect(formatCoords({ lat: -33.8688, lon: -70.1 })).toBe('33.8688° S, 70.1000° W')
  })
})
