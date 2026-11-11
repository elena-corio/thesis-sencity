import { describe, expect, it } from 'vitest'
import { photoAlong, photoProvider } from './photos.js'

describe('photoProvider', () => {
  it('shows no photo by default and for an unknown name', () => {
    expect(photoProvider().shows).toBe(false)
    expect(photoProvider('nope').url({ pano_id: 'x', heading: 1 })).toBeNull()
  })
  it('Street View goes through our API, with Google credited', () => {
    const sv = photoProvider('streetview')
    expect(sv.url({ pano_id: 'abc', heading: 90 })).toContain('/api/photo/abc?heading=90')
    expect(sv.credit({ contributor: false })).toBe('© Google')
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
