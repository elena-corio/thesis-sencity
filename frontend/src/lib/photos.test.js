import { describe, expect, it } from 'vitest'
import { panoShift, photoAlong, photoProvider } from './photos.js'

describe('photoProvider', () => {
  it('shows no photo for none and for an unknown name', () => {
    expect(photoProvider('none').cards).toBe(false)
    expect(photoProvider('nope').walk).toBe(false)
    expect(photoProvider('nope').url({ pano_id: 'x', heading: 1 })).toBeNull()
  })
  it('Street View goes through our API, with Google credited', () => {
    const sv = photoProvider('streetview')
    expect(sv.url({ pano_id: 'abc', heading: 90 })).toContain('/api/photo/abc?heading=90')
    expect(sv.credit({ contributor: false })).toBe('© Google')
  })
  it('Mapillary is in the walk only, with the photographer, the year and the licence', () => {
    const m = photoProvider('mapillary')
    expect([m.cards, m.walk]).toEqual([false, true])
    const photo = { thumb_url: 'https://t/1', creator: 'anna', year: 2024, link: 'https://www.mapillary.com/app/?pKey=1' }
    expect(m.url(photo)).toBe('https://t/1')
    expect(m.credit(photo)).toBe('anna · 2024 · CC BY-SA 4.0')
    expect(m.link(photo)).toBe('https://www.mapillary.com/app/?pKey=1')
  })
})

describe('panoShift', () => {
  it('puts the walk bearing in the middle of the frame', () => {
    // Looking where the pano's middle looks: the image middle (at 2 frame widths) sits at the frame middle.
    expect(panoShift({ heading: 120, pano_heading: 120 })).toBeCloseTo(-1.5)
    // 90 degrees to the right: one frame width further left.
    expect(panoShift({ heading: 210, pano_heading: 120 })).toBeCloseTo(-2.5)
    // Across north: 10 to 350 is 20 degrees to the left.
    expect(panoShift({ heading: 350, pano_heading: 10 })).toBeCloseTo(-1.5 + 4 * (20 / 360))
  })
})

describe('photoAlong', () => {
  const photos = [{ heading: 10 }, { heading: 185 }, { heading: 350 }]
  it('takes the photo facing along the walk', () => {
    expect(photoAlong(photos, 0)).toBe(photos[0])
    expect(photoAlong(photos, 345)).toBe(photos[2])
    expect(photoAlong(photos, 170)).toBe(photos[1])
  })
  it('is null without photos', () => {
    expect(photoAlong([], 0)).toBeNull()
    expect(photoAlong(undefined, 0)).toBeNull()
  })
})
