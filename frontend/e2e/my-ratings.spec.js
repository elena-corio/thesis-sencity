import { expect, test } from '@playwright/test'
import { TEST_PROFILES, WITH_3, analyseCentre, markRatingMocked, mockArea, mockRoutes, mockSurvey, openMap, openRoutes, openSegment, routeClicks, withSavedProfile } from './helpers.js'

// Your photo ratings (Elena, 2026-11-16): kept in this browser with the prediction that was on screen before you rated.
// The model is mocked; every rating of the mock is 3 (V0), made from the export ed963d2 with prompt 2.
const result = { comfort: 3, anchors: ['not at all', 'very much'], bothers: [], feels_good: [], listed: ['traffic_trams', 'shade'],
  reason: 'r', model: 'google/gemini-3.1-flash-lite', latency_ms: 1, cost_usd: 0, cached: false, personal: false, commit: 'ed963d2', prompt: '2' }

/** The rating API, mocked; hold() keeps the answer back until release(). */
function mockRatings(page) {
  const ctl = { held: false, release: null }
  markRatingMocked(page)
  return page.route('**/api/senses/rate', async (route) => {
    const { photos } = route.request().postDataJSON()
    if (ctl.held) await new Promise((r) => { ctl.release = r })
    const lines = [{ type: 'start', model: result.model, cached: 0, to_rate: photos.length, remaining: 0 },
      ...photos.map((p) => ({ type: 'photo', ...p, status: 'ok', cached: false, cost_usd: 0, result })),
      { type: 'done', seconds: 1, failed: 0, remaining: 0, estimate_usd: 0 }]
    await route.fulfill({ contentType: 'application/x-ndjson', body: lines.map((l) => JSON.stringify(l)).join('\n') + '\n' })
  }).then(() => ctl)
}
const mine = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('sencity-my-ratings') ?? '[]'))
/** Every request body the page sent, to check that no rating ever left the browser. */
function bodies(page) {
  const sent = []
  page.on('request', (r) => { if (r.postData()) sent.push(r.postData()) })
  return sent
}

test.describe('Rate this place', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('on the map card: the prediction shown is kept with your rating; rating again appends; nothing is sent', async ({ page }) => {
    const sent = bodies(page)
    await mockArea(page)
    await mockRatings(page)
    await openMap(page, 'dark', { layer: null })
    await analyseCentre(page)
    await expect(page.getByTestId('senses-status')).toBeVisible({ timeout: 20_000 })
    await openSegment(page, WITH_3.properties.id)
    const rate = page.locator('[data-panel="place-card"]').getByTestId('rate-this-place')
    await rate.getByRole('button', { name: 'Rate 2 of 5' }).click()
    await expect(rate.getByTestId('rate-compare')).toHaveText(/You:\s*2\s*·\s*SenCity:\s*3/)
    let list = await mine(page)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ rating: { B1: 2 }, from: 'map',
      prediction: { level: 'mixed', B1: 3, version: 'V0', profileHash: null, elements: ['traffic_trams', 'shade'], prompt: '2', model: result.model, commit: 'ed963d2' } })
    expect(Object.keys(list[0].photo)).toEqual(['id', 'heading', 'source']) // the photo's ID, never the image
    await page.screenshot({ path: 'e2e/screens/rate-map-dark.png' })

    await rate.getByRole('button', { name: 'Rate 4 of 5' }).click()
    list = await mine(page)
    expect(list.map((e) => e.rating.B1)).toEqual([2, 4]) // the history is kept
    await expect(rate.getByTestId('rate-compare')).toHaveText(/You:\s*4\s*·\s*SenCity:\s*3/)
    expect(sent.some((b) => b.includes('"from":"map"') || b.includes('sencity-my-ratings') || b.includes('"B1"'))).toBe(false)
  })

  test('the prediction is the one on screen before you rate: none shown, none kept, even if it arrives after', async ({ page }) => {
    await mockArea(page)
    const ctl = await mockRatings(page)
    ctl.held = true // the model has not answered yet
    await openMap(page, 'dark', { layer: null })
    await analyseCentre(page)
    await openSegment(page, WITH_3.properties.id)
    const rate = page.locator('[data-panel="place-card"]').getByTestId('rate-this-place')
    await rate.getByRole('button', { name: 'Rate 5 of 5' }).click()
    await expect(rate.getByTestId('rate-compare')).toContainText('no prediction was shown')
    await expect.poll(() => ctl.release != null).toBe(true)
    ctl.release() // the prediction arrives after the rating
    await expect(page.locator('[data-panel="place-card"]').getByTestId('senses-result')).toBeVisible({ timeout: 10_000 })
    expect((await mine(page))[0].prediction).toBe(null) // never filled in afterwards, never asked again
  })

  test('in the walk: rating pauses it and is kept as from the walk', async ({ page }) => {
    await mockRoutes(page)
    await mockRatings(page)
    await openRoutes(page, 'dark', { layer: 'senses' })
    const { a, b } = routeClicks(page.viewportSize())
    await page.mouse.click(a.x, a.y)
    await page.mouse.click(b.x, b.y)
    await page.getByRole('button', { name: 'Analyse the routes' }).click()
    await page.getByRole('button', { name: /^Walk route [AB]$/ }).click()
    const v = page.locator('[data-panel="walk-view"]')
    await expect(v.getByRole('button', { name: 'Pause' })).toBeVisible() // it opens playing
    await v.getByTestId('rate-this-place').getByRole('button', { name: 'Rate 3 of 5' }).click()
    await expect(v.getByRole('button', { name: 'Play' })).toBeVisible() // rating paused it
    const list = await mine(page)
    expect(list.at(-1)).toMatchObject({ rating: { B1: 3 }, from: 'walk' })
  })

  test('download, delete and import carry your ratings', async ({ page }) => {
    const DEV = TEST_PROFILES[0]
    await withSavedProfile(page, { language: 'en', answers: DEV.answers, text: DEV.expected, version: '386e888b8867', saved: '2026-11-15T10:00:00Z', weather: {}, thermal: null })
    await page.addInitScript(() => {
      if (localStorage.getItem('sencity-my-ratings')) return
      localStorage.setItem('sencity-my-ratings', JSON.stringify([{ photo: { id: 'sv:a', heading: 90, source: 'streetview' }, rating: { B1: 2, marked: null },
        prediction: { level: 'mixed', B1: 3, version: 'V2', profileHash: '386e888b8867', elements: [], prompt: '2', model: 'm', commit: 'c' },
        at: '2026-11-16T09:00:00Z', from: 'walk' }]))
    })
    await mockSurvey(page)
    await openMap(page, 'dark', { layer: null })
    await page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: 'Profile' }).click()
    const summary = page.locator('[data-panel="profile-summary"]')
    const [download] = await Promise.all([page.waitForEvent('download'), summary.getByRole('button', { name: 'Download my data' }).click()])
    const file = JSON.parse(await (await import('node:fs/promises')).readFile(await download.path(), 'utf-8'))
    expect(file.myRatings).toHaveLength(1)
    await summary.getByRole('button', { name: 'Delete my profile' }).click()
    await expect(page.getByRole('alertdialog')).toContainText('your own ratings of places')
    await page.getByRole('button', { name: 'Delete everything' }).click()
    expect(await mine(page)).toEqual([])
    await page.locator('input[type="file"]').setInputFiles({ name: 'p.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) })
    await expect(summary).toBeVisible()
    expect((await mine(page)).map((e) => e.rating.B1)).toEqual([2])
  })
})

test.describe('How close SenCity is to you', () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  const DEV = TEST_PROFILES[0]
  const at = (i) => `2026-11-16T10:${String(i).padStart(2, '0')}:00Z`
  const r = (i, you, pred, version) => ({ photo: { id: `p${i}`, heading: 0, source: 'streetview' }, rating: { B1: you, marked: null }, from: 'map', at: at(i),
    prediction: pred == null ? null : { level: 'mixed', B1: pred, version, profileHash: version === 'V2' ? 'x' : null, elements: [], prompt: '2', model: 'm', commit: 'c' } })
  // The unit test's fixture (lib/myRatings.test.js): 12 with a prediction, gaps 1,0,3,1, 0,0,2,0 (V2), 2,2,0,1 (V0).
  const FIXTURE = [
    r(1, 2, 3, 'V2'), r(2, 4, 4, 'V2'), r(3, 1, 4, 'V2'), r(4, 5, 4, 'V2'),
    r(5, 3, 3, 'V2'), r(6, 2, 2, 'V2'), r(7, 4, 2, 'V2'), r(8, 3, 3, 'V2'),
    r(9, 4, 2, 'V0'), r(10, 5, 3, 'V0'), r(11, 1, 1, 'V0'), r(12, 3, 4, 'V0'), r(13, 3, null),
  ]
  async function open(page, ratings) {
    await withSavedProfile(page, { language: 'en', answers: DEV.answers, text: DEV.expected, version: '386e888b8867', saved: '2026-11-15T10:00:00Z', weather: {}, thermal: null })
    await page.addInitScript((list) => localStorage.setItem('sencity-my-ratings', JSON.stringify(list)), ratings)
    await mockSurvey(page)
    await openMap(page, 'dark', { layer: null })
    await page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: 'Profile' }).click()
    return page.getByTestId('how-close')
  }

  test('the numbers on a fixture, and a line each for personal and general predictions', async ({ page }) => {
    const hc = await open(page, FIXTURE)
    await expect(hc.getByTestId('how-close-n')).toHaveText('12') // the one without a prediction is left out
    await expect(hc.getByTestId('how-close-gap')).toHaveText('1.0')
    await expect(hc.getByTestId('how-close-within')).toHaveText('67%')
    await expect(hc.locator('path.line')).toHaveCount(2)
    await expect(hc.locator('circle.dot.v2')).toHaveCount(2) // groups 1–4 and 5–8
    await expect(hc.locator('circle.dot.v0')).toHaveCount(1)
    await expect(hc.locator('table')).toContainText('1.3') // 1.25, the first personal group
    await hc.scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'e2e/screens/profile-how-close-dark.png' })
  })

  test('under 4 ratings with a prediction it asks for more', async ({ page }) => {
    const hc = await open(page, FIXTURE.slice(0, 3))
    await expect(hc.getByTestId('how-close-empty')).toHaveText('Rate a few places to see how close SenCity is to you.')
  })
})
