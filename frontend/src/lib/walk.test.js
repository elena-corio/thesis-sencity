import { describe, expect, it } from 'vitest'
import { chipText, comfortLine, fixedLine, progressAt, progressLine, ratedPhotoOf, routeKind, stretchBearing } from './walk.js'

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
})

describe('progressLine', () => {
  it('reads as on the board', () => {
    expect(progressLine({ doneM: 350, totalM: 1600 }, 21)).toBe('0.35 of 1.6 km, 4 of 21 min')
  })
  it('never passes the route time', () => {
    expect(progressLine({ doneM: 1600, totalM: 1600 }, 19)).toBe('1.60 of 1.6 km, 19 of 19 min')
  })
})

describe('stretchBearing', () => {
  it('looks along the stretch', () => {
    expect(stretchBearing({ coordinates: [[16.37, 48.2], [16.37, 48.21]] })).toBeCloseTo(0, 5)
    expect(stretchBearing({ coordinates: [[16.37, 48.2], [16.38, 48.2]] })).toBeCloseTo(90, 0)
    expect(stretchBearing({ coordinates: [[16.37, 48.21], [16.36, 48.21]] })).toBeCloseTo(270, 0)
  })
})

describe('chipText', () => {
  it('names the route, its kind, the layer and the window', () => {
    expect(chipText({ id: 'B', kind: 'easiest' }, 'overall', { season: 'summer', time: '15:00' }))
      .toEqual({ title: 'Walking route B', detail: 'easiest overall, summer 15:00' })
  })
  it('has no window on a route found on Senses', () => {
    expect(chipText({ id: 'A', kind: 'shortest' }, 'senses', null)).toEqual({ title: 'Walking route A', detail: 'shortest senses' })
    expect(routeKind({ id: 'B', kind: 'second' })).toBe('alternative')
  })
  it('says the settings are fixed', () => {
    // The season and time are in the key above it (Elena, 2026-11-11).
    expect(fixedLine()).toBe('To change the layer, season or time, exit the walk.')
  })
})

describe('comfortLine', () => {
  const place = (level, codes) => ({
    status: 'ok', level, comfort: level === 'easy' ? 4 : 2, anchors: { 1: 'very uncomfortable', 5: 'very comfortable' },
    bothers: codes.map((en) => ({ en, code: en, icon_key: 'sight' })),
  })
  it('gives the reason on Senses from what might bother', () => {
    expect(comfortLine('senses', { photos: [{}] }, place('hard', ['Crowds', 'Signs, ads'])))
      .toEqual({ state: 'hard', label: 'Hard', reason: 'senses, because of crowds and signs, ads' })
  })
  it('gives the comfort when nothing bothers', () => {
    expect(comfortLine('senses', { photos: [{}] }, place('easy', [])).reason).toBe('senses, 4 · fairly comfortable')
  })
  it('says when there is no photo or no rating yet', () => {
    expect(comfortLine('senses', { photos: [] }, null).label).toBe('No photo')
    expect(comfortLine('senses', { photos: [{}] }, { status: 'pending' }).label).toBe('Not rated yet')
  })
  it('gives the feels-like value on Thermal', () => {
    expect(comfortLine('thermal', { utci: 33.4, thermal_state: 'hard' }, null))
      .toEqual({ state: 'hard', label: 'Hard', reason: 'thermal, feels like 33 °C' })
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
    expect(comfortLine('senses', {}, { status: 'unloaded' })).toEqual({ state: 'none', label: 'No photo', reason: 'the photo could not be loaded, so no rating' })
  })
})
