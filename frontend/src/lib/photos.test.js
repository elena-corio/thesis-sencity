import { describe, expect, it } from 'vitest'
import { countShown, isPaid, panoShift, photoAlong, photoCredit, photoLink, shownPhotoUrl, sourceOf, sourcesName, streetViewShown } from './photos.js'

const STREET_VIEW = { id: 'sv:panoAAAAAAAAAA', source: 'streetview', pano_id: 'panoAAAAAAAAAA', heading: 90, date: '2024-06', year: 2024 }
const MAPILLARY = { id: '1', source: 'mapillary', thumb_url: 'https://t/1', creator: 'anna', year: 2024, link: 'https://www.mapillary.com/app/?pKey=1' }

describe('the source of each photo', () => {
  it('Street View comes through our API, credited "© Google", with no link', () => {
    expect(shownPhotoUrl(STREET_VIEW)).toBe('/api/photo/panoAAAAAAAAAA?heading=90')
    expect(photoCredit(STREET_VIEW)).toBe('© Google')
    expect(photoLink(STREET_VIEW)).toBeNull()
    expect(isPaid(STREET_VIEW)).toBe(true)
  })
  it('a contributor photosphere is credited to its author', () => {
    expect(photoCredit({ ...STREET_VIEW, contributor: true, copyright: '© Anna' })).toBe('© Anna')
  })
  it('Mapillary, with the photographer, the year and the licence, linked to the image page', () => {
    expect(shownPhotoUrl(MAPILLARY)).toBe('https://t/1')
    expect(photoCredit(MAPILLARY)).toBe('anna · 2024 · CC BY-SA 4.0')
    expect(photoLink(MAPILLARY)).toBe('https://www.mapillary.com/app/?pKey=1')
    expect(isPaid(MAPILLARY)).toBe(false)
  })
  it('a photo of an older area, with no source, is Mapillary', () => {
    const { source, ...old } = MAPILLARY
    expect(source).toBe('mapillary')
    expect(sourceOf(old).name).toBe('Mapillary')
  })
  it('the map credits name the shown photo, or the sources of the build', () => {
    expect(sourcesName(STREET_VIEW)).toBe('Google')
    expect(sourcesName(MAPILLARY)).toBe('Mapillary')
    expect(sourcesName()).toBe('Google, Mapillary') // the tests run with the default, streetview
  })
  it('counts the Street View images shown, for the cost counter (Mapillary is free)', () => {
    const before = streetViewShown.value
    countShown(STREET_VIEW)
    countShown(MAPILLARY)
    expect(streetViewShown.value).toBe(before + 1)
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
