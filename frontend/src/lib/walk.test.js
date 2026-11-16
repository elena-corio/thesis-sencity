import { describe, expect, it } from 'vitest'
import { chipText, comfortLine, photosInOrder, progressAt, progressLine, ratedPhotoOf, routeKind } from './walk.js'

const stretches = [{ length_m: 400 }, { length_m: 200 }, { length_m: 1000 }]

describe('progressAt', () => {
  it('stands at the middle of the current stretch', () => {
    expect(progressAt(stretches, 0)).toEqual({ doneM: 200, totalM: 1600, share: 0.125 })
    expect(progressAt(stretches, 1).doneM).toBe(500)
    expect(progressAt(stretches, 2).doneM).toBe(1100)
  })
  it('is zero on an empty route', () => {
    expect(progressAt([], 0)).toEqual({ doneM: 0, totalM: 0, share: 0 })
  })
  it('moves along a stretch with several photos', () => {
    expect(progressAt(stretches, 0, 0, 4).doneM).toBe(50)
    expect(progressAt(stretches, 0, 3, 4).doneM).toBe(350)
  })
})

describe('photosInOrder', () => {
  it('puts a stretch’s photos in the order they are walked past', () => {
    const coords = [[16.37, 48.2], [16.371, 48.2]] // walking east
    const far = { id: 'far', lon: 16.3708, lat: 48.2 }
    const near = { id: 'near', lon: 16.3701, lat: 48.2 }
    const mid = { id: 'mid', lon: 16.3704, lat: 48.2 }
    expect(photosInOrder([far, near, mid], coords).map((p) => p.id)).toEqual(['near', 'mid', 'far'])
    expect(photosInOrder([far, near, mid], [...coords].reverse()).map((p) => p.id)).toEqual(['far', 'mid', 'near'])
  })
  it('leaves out the photos behind the start and past the end of the walked part (Elena, 2026-11-16)', () => {
    const street = [[16.37, 48.2], [16.372, 48.2]] // the whole street
    const part = [[16.3705, 48.2], [16.3715, 48.2]] // the route walks its middle, east
    const photos = ['behind:16.3701', 'in1:16.3712', 'in0:16.3707', 'past:16.3719'].map((s) => {
      const [id, lon] = s.split(':')
      return { id, lon: Number(lon), lat: 48.2 }
    })
    expect(photosInOrder(photos, part, street).map((p) => p.id)).toEqual(['in0', 'in1'])
    // A photo a little to the side of the walked part stays.
    expect(photosInOrder([{ id: 'side', lon: 16.371, lat: 48.20008 }], part, street).map((p) => p.id)).toEqual(['side'])
  })
})

describe('progressLine', () => {
  it('reads as on the board', () => {
    expect(progressLine({ doneM: 350, totalM: 1600 }, 21)).toBe('0.35 of 1.6 km · 17 min left')
  })
  it('never passes the route time', () => {
    expect(progressLine({ doneM: 1600, totalM: 1600 }, 19)).toBe('1.60 of 1.6 km · 0 min left')
  })
})


describe('chipText', () => {
  it('says what the easiest way is easiest for; shortest is just shortest', () => {
    expect(chipText({ id: 'B', kind: 'easiest' }, 'senses')).toEqual({ title: 'Walking route B', detail: 'easiest for your senses' })
    expect(chipText({ id: 'B', kind: 'easiest' }, 'thermal').detail).toBe('easiest for thermal comfort')
    expect(chipText({ id: 'A', kind: 'shortest' }, 'senses')).toEqual({ title: 'Walking route A', detail: 'shortest' })
    expect(chipText({ id: 'B', kind: 'second' }, 'thermal').detail).toBe('alternative')
    expect(routeKind({ id: 'B', kind: 'second' })).toBe('alternative')
  })
})

describe('comfortLine', () => {
  const place = (level, codes) => ({
    status: 'ok', level, comfort: level === 'easy' ? 4 : 2, anchors: { 1: 'very uncomfortable', 5: 'very comfortable' },
    bothers: codes.map((en) => ({ en, code: en, icon_key: 'sight' })),
  })
  it('gives the reason on Senses from what might bother', () => {
    // Names with commas of their own are parted by a semicolon, so the sentence still reads as a list.
    expect(comfortLine('senses', { photos: [{}] }, place('hard', ['Asphalt, stone, concrete', 'Direct sun, little shade'])))
      .toEqual({ state: 'hard', label: 'Hard', context: 'for your senses',
        detail: 'The model points to: asphalt, stone, concrete; direct sun, little shade.' })
  })
  it('gives the comfort when nothing bothers', () => {
    expect(comfortLine('senses', { photos: [{}] }, place('easy', [])).detail).toBe('4 · fairly comfortable.')
  })
  it('says when there is no photo or no rating yet', () => {
    expect(comfortLine('senses', { photos: [] }, null).label).toBe('No photo')
    expect(comfortLine('senses', { photos: [{}] }, { status: 'pending' }).label).toBe('Not rated yet')
  })
  it('gives the feels-like value on Thermal', () => {
    expect(comfortLine('thermal', { utci: 33.4, thermal_state: 'hard' }, null))
      .toEqual({ state: 'hard', label: 'Hard', context: 'for thermal comfort', detail: 'Feels like 33 °C.' })
    expect(comfortLine('thermal', { utci: null }, null).state).toBe('none')
  })
})

describe('a stretch of the walk: the same photo and rating as the Routes view', () => {
  const a = { id: '1', heading: 90 }
  const b = { id: '2', heading: 270 }
  const segments = new Map([['s1', { properties: { photos: [a, b] } }], ['s2', { properties: { photos: [] } }]])
  it("is its street's photos and their rating, showing the photo the card opens on", () => {
    const place = { status: 'rated', level: 'hard', rep: 1 }
    const placeFor = (photos) => (photos.length ? place : null)
    expect(ratedPhotoOf({ key: 'A-0', segmentId: 's1' }, segments, placeFor)).toEqual({ photo: b, photos: [a, b], place })
    expect(ratedPhotoOf({ key: 'A-1', segmentId: 's2' }, segments, placeFor)).toBeNull() // no photo, no rating
    expect(ratedPhotoOf({ key: 'A-2', segmentId: 'gone' }, segments, placeFor)).toBeNull()
  })
  it('says so on the card when the photo did not load', () => {
    expect(comfortLine('senses', {}, { status: 'unloaded' })).toEqual({ state: 'none', label: 'No photo', context: '', detail: 'The photo could not be loaded, so no rating.' })
  })
})
