import { describe, expect, it } from 'vitest'
import { BLOCK_MM, PAGE_MM, areaCounts, inShort, placesHere, reportPages, reportSections, routeRow, stretchCounts, whyHard } from './report.js'

const has = (o = {}) => ({ profile: false, area: false, route: false, place: false, ...o })
const line = (id, props) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: { id, ...props } })
const park = (id, props) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, properties: { id, place_type: 'park', ...props } })

describe('which sections the report has', () => {
  it('full: profile, area, route and place, with In short and How this was made', () => {
    expect(reportSections(has({ profile: true, area: true, route: true, place: true }))).toEqual({
      inShort: true, profile: true, noProfile: false, area: true, route: true, place: true, made: true,
    })
  })
  it('profile only: no In short, no area, route or place', () => {
    expect(reportSections(has({ profile: true }))).toEqual({
      inShort: false, profile: true, noProfile: false, area: false, route: false, place: false, made: true,
    })
  })
  it('no profile: a note instead of the profile page, the rest as it is', () => {
    const s = reportSections(has({ area: true }))
    expect(s.profile).toBe(false)
    expect(s.noProfile).toBe(true)
    expect(s.area && s.inShort).toBe(true)
    expect(reportSections(has()).noProfile).toBe(true)
  })
  it('a route alone gives In short too', () => {
    expect(reportSections(has({ route: true })).inShort).toBe(true)
  })
})

describe('the pages, in the boards’ order', () => {
  it('full: profile and area on page 1, route, place and How this was made on page 2 (boards 8, 8b)', () => {
    expect(reportPages(reportSections(has({ profile: true, area: true, route: true, place: true }))))
      .toEqual([['inShort', 'profile', 'area'], ['route', 'place', 'made']])
  })
  it('profile only, or no profile at all: one page', () => {
    expect(reportPages(reportSections(has({ profile: true })))).toEqual([['profile', 'made']])
    expect(reportPages(reportSections(has()))).toEqual([['noProfile', 'made']])
  })
  it('no profile, with an area and a place: How this was made never alone, the place comes along', () => {
    expect(reportPages(reportSections(has({ area: true, place: true })))).toEqual([['inShort', 'noProfile', 'area'], ['place', 'made']])
  })
  it('a route without an area follows the profile on page 1', () => {
    expect(reportPages(reportSections(has({ profile: true, route: true, place: true })))).toEqual([['inShort', 'profile', 'route'], ['place', 'made']])
  })
  it('no page is fuller than an A4 page', () => {
    for (const p of [0, 1]) for (const a of [0, 1]) for (const r of [0, 1]) for (const pl of [0, 1]) {
      reportPages(reportSections(has({ profile: !!p, area: !!a, route: !!r, place: !!pl }))).forEach((page, i) => {
        const head = i === 0 ? BLOCK_MM.head : BLOCK_MM.headSmall
        expect(head + BLOCK_MM.foot + page.reduce((n, id) => n + BLOCK_MM[id], 0)).toBeLessThanOrEqual(PAGE_MM)
      })
    }
  })
})

describe('the area in numbers', () => {
  const fs = [
    line('a', { overall_state: 'easy' }), line('b', { overall_state: 'easy' }), line('c', { overall_state: 'hard' }),
    line('d', {}), park('p', { overall_state: 'easy' }),
  ]
  it('counts and shares by number of streets, as on board 8', () => {
    const c = areaCounts(fs, 'overall')
    expect(c.all).toBe(5)
    expect(c.counts).toEqual({ easy: 3, mixed: 0, hard: 1, none: 1 })
    expect(c.share.easy).toBeCloseTo(0.6)
  })
  it('places here, as on the area card', () => {
    expect(placesHere(fs, 'overall')).toEqual([{ label: 'Parks', state: 'easy', text: '1 of 1 easy' }])
  })
  it('why hard: on Overall only, by what decides, with what most often bothers', () => {
    const hard = [
      line('t1', { overall_state: 'hard', thermal_state: 'hard', senses_state: 'easy', utci: 35 }),
      line('t2', { overall_state: 'hard', thermal_state: 'hard', senses_state: 'mixed', utci: 36 }),
      line('s1', { overall_state: 'hard', thermal_state: 'easy', senses_state: 'hard' }),
      line('b1', { overall_state: 'hard', thermal_state: 'hard', senses_state: 'hard', utci: 34 }),
    ]
    const bothers = { s1: ['Traffic noise', 'Crowds'], b1: ['Crowds'] }
    const w = whyHard(hard, 'overall', (f) => bothers[f.properties.id] ?? [], { heat: [26, 32], cold: [9, 0] })
    expect(w).toEqual({ of: 4, thermal: 3, senses: 2, weather: 'heat', sensesWhat: ['crowds', 'traffic noise'] })
    expect(whyHard(hard, 'thermal')).toBeNull()
    expect(whyHard([line('e', { overall_state: 'easy' })], 'overall')).toBeNull()
  })
})

describe('In short and the routes', () => {
  const counts = { all: 58, counts: { easy: 21, mixed: 18, hard: 13, none: 6 } }
  it('the area in one sentence, then the route verdict (board 8)', () => {
    expect(inShort({ area: { name: null, counts, why: { thermal: 8, senses: 5, weather: 'heat' } }, route: 'B is 3 minutes longer but has less hard walking.', personal: true }))
      .toBe('Around the point you chose, 21 of 58 streets may feel easy for you and 13 hard, mostly because of heat. B is 3 minutes longer but has less hard walking.')
  })
  it('without a profile it does not say "for you"; a named centre is used', () => {
    expect(inShort({ area: { name: 'Stephansplatz', counts, why: null }, personal: false }))
      .toBe('Around Stephansplatz, 21 of 58 streets may feel easy and 13 hard.')
  })
  it('a route row counts its hard and mixed stretches', () => {
    const r = { id: 'B', kind: 'easiest', hard_share: 0.2, stretches: [
      { key: 'B-0', state: 'hard', length_m: 10 }, { key: 'B-1', state: 'mixed', length_m: 30 }, { key: 'B-2', state: null, length_m: 10 }] }
    const row = routeRow('thermal', r)
    expect(row).toMatchObject({ id: 'B', name: 'easiest', hard: 0.2, hardCount: 1, mixedCount: 1 })
    expect(row.sections.map((s) => s.state)).toEqual(['hard', 'mixed', 'none'])
    expect(stretchCounts(row)).toBe('1 hard, 1 mixed stretches')
    expect(stretchCounts({ hardCount: 0, mixedCount: 0 })).toBe('No hard or mixed stretches')
    expect(stretchCounts({ hardCount: 2, mixedCount: 0 })).toBe('2 stretches hard')
  })
})
