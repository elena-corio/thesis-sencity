import { expect, test } from '@playwright/test'
import { AREA, THERMAL, WITHOUT, analyseCentre, chooseLayer, markRatingMocked, mockArea, mockRoutes, openMap, openRoutes, openSegment, routeClicks, withSavedProfile, TEST_PROFILES } from './helpers.js'

// Overall (Elena, 2026-11-15; boards 1, 2b): the worse of Senses and Thermal per street, worked out in the browser. The
// API is mocked: thermal 22 / 29 / 36 °C by street (easy / mixed / hard), photo ratings by order.
const RANK = { easy: 0, mixed: 1, hard: 2 }
const level = (n) => (n >= 4 ? 'easy' : n === 3 ? 'mixed' : 'hard')
const thermalLevel = (t) => (t > 32 ? 'hard' : t > 26 ? 'mixed' : t < 0 ? 'hard' : t < 9 ? 'mixed' : 'easy')
const el = (code, n, en, icon_key) => ({ code, n, en, it: en, icon_key, also: [] })
const COMFORT = (i) => [5, 3, 2][i % 3]

function mockRatings(page, { delay = 0 } = {}) {
  const asked = []
  markRatingMocked(page)
  return page.route('**/api/senses/rate', async (route) => {
    const body = route.request().postDataJSON()
    asked.push(body)
    if (delay) await new Promise((r) => setTimeout(r, delay))
    const lines = [{ type: 'start', model: 'test', cached: 0, to_rate: body.photos.length, remaining: 0 },
      ...body.photos.map((p, i) => ({ type: 'photo', ...p, status: 'ok', cached: false, cost_usd: 0,
        result: { comfort: COMFORT(i), anchors: ['not at all', 'very much'], bothers: [el('traffic_trams', 5, 'Traffic, trams', 'hearing')],
          feels_good: [], listed: ['traffic_trams'], reason: 'r', model: 'test', latency_ms: 1, cost_usd: 0, cached: false, personal: false } })),
      { type: 'done', seconds: 1, failed: 0, remaining: 0, estimate_usd: 0 }]
    await route.fulfill({ contentType: 'application/x-ndjson', body: lines.map((l) => JSON.stringify(l)).join('\n') + '\n' })
  }).then(() => asked)
}

const states = (page) => page.evaluate(() => window.__sencityMap.getSource('sc-seg').serialize().data.features
  .map((f) => ({ id: f.properties.id, s: f.properties.senses_state, t: f.properties.thermal_state, o: f.properties.overall_state, p: f.properties.overall_partial })))

test.describe('Overall', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('each street shows the worse of its two levels, partial when one is missing; the card says what decides', async ({ page }) => {
    await mockArea(page, { thermal: true })
    await mockRatings(page)
    await openMap(page, 'dark', { layer: null })
    await chooseLayer(page, 'overall')
    await analyseCentre(page)
    const card = page.locator('[data-panel="area-card"]')
    await expect(card.getByTestId('area-bar')).toBeVisible({ timeout: 20_000 })
    await expect.poll(async () => (await states(page)).filter((f) => f.s).length, { timeout: 20_000 }).toBeGreaterThan(5)

    // The rule on every street the map draws: the worse of the two, partial with one only, nothing with neither.
    const all = await states(page)
    for (const f of all) {
      const s = ['easy', 'mixed', 'hard'].includes(f.s) ? f.s : null
      const t = f.t ?? null
      if (s && t) expect({ id: f.id, o: f.o, p: f.p }).toEqual({ id: f.id, o: RANK[s] >= RANK[t] ? s : t, p: false })
      else if (s || t) expect({ id: f.id, o: f.o, p: f.p }).toEqual({ id: f.id, o: s ?? t, p: true })
      else expect(f.o).toBeUndefined()
    }
    expect(all.some((f) => f.p)).toBe(true) // a street without a photo: thermal only, drawn faded
    // Partial is the comfort colour at half opacity, no dashes (dashes are route B's).
    expect(await page.evaluate(() => !!window.__sencityMap.getLayer('sc-seg-core-partial'))).toBe(false)
    expect(JSON.stringify(await page.evaluate(() => window.__sencityMap.getPaintProperty('sc-seg-core', 'line-color')))).toContain(', 0.5)')
    // "No photo" on Overall (and Senses) is a neutral grey; Thermal keeps its own grey for "No value".
    const noneLine = () => page.evaluate(() => window.__sencityMap.getPaintProperty('sc-seg-none', 'line-color'))
    const css = (n) => page.evaluate((name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(), n)
    expect(await noneLine()).toBe(await css('--map-seg-no-photo'))
    await chooseLayer(page, 'thermal')
    await expect.poll(noneLine).toBe(await css('--map-seg-none'))
    await chooseLayer(page, 'overall')

    // The legend: "Overall comfort", the partial style and "No data"; the note says senses is from the photo's moment.
    await expect(card).toContainText('Overall comfort')
    await expect(card).toContainText('Partial (one layer only)')
    await expect(card).toContainText('No data')
    await expect(page.locator('[data-panel="layers"]')).toContainText('season and time change only the thermal part')
    await page.screenshot({ path: 'e2e/screens/overall-area-dark.png' })

    // A street with both parts: the level, the deciding layer in plain words, both rows.
    const both = all.find((f) => f.s && f.t && f.s !== f.t)
    await openSegment(page, both.id)
    const place = page.locator('[data-panel="place-card"]')
    const overall = place.getByTestId('overall')
    const decider = RANK[both.s] > RANK[both.t] ? 'senses' : 'thermal'
    await expect(overall).toContainText(`${{ easy: 'Easy', mixed: 'Mixed', hard: 'Hard' }[both.o]}`)
    if (decider === 'thermal') await expect(overall.getByTestId('overall-reason')).toHaveText(new RegExp(`because of (heat|cold): feels like ${THERMAL[both.id]} °C`))
    else await expect(overall.getByTestId('overall-reason')).toContainText('because of the senses: traffic, trams')
    await expect(overall.getByTestId('overall-senses')).toContainText('not personalised yet') // no profile on this device
    await expect(overall.getByTestId('overall-thermal')).toContainText(`feels like ${THERMAL[both.id]} °C`)
    await page.screenshot({ path: 'e2e/screens/overall-place-dark.png' })

    // A street without a photo: thermal only, said so.
    await page.getByRole('button', { name: /Back to area/ }).click()
    await openSegment(page, WITHOUT.properties.id)
    await expect(place.getByTestId('overall-reason')).toContainText('based on thermal only')
    await expect(place.getByTestId('overall-senses')).toContainText('No photo')
  })

  test('once the rating ends, the most comfortable places are recommended, as on Senses', async ({ page }) => {
    await mockArea(page, { thermal: true })
    await mockRatings(page)
    await openMap(page, 'dark', { layer: null })
    await chooseLayer(page, 'overall')
    await analyseCentre(page)
    const card = page.locator('[data-panel="area-card"]')
    const best = card.getByTestId('senses-best')
    await expect(best).toBeVisible({ timeout: 20_000 })
    await expect(best.locator('h3')).toHaveText('Most comfortable nearby')
    const rows = best.locator('li')
    await expect(rows.first()).toBeVisible()
    const n = await rows.count()
    expect(n).toBeGreaterThan(0)
    expect(n).toBeLessThanOrEqual(3)
    await expect(rows.first()).toContainText(/photo \d · feels like/)
    // Pins on the map with the same numbers; only easy or mixed overall, both layers known (never partial or hard).
    const markers = await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('area').markers
      .map((m) => ({ n: m.n, level: m.level, o: m.f.properties.overall_state, p: m.f.properties.overall_partial })))
    expect(markers.map((m) => m.n)).toEqual([...Array(n)].map((_, i) => i + 1))
    for (const m of markers) {
      expect(['easy', 'mixed']).toContain(m.level)
      expect(m.o).toBe(m.level)
      expect(m.p).toBe(false)
    }
    await rows.first().getByRole('button').click()
    await expect(page.locator('[data-panel="place-card"]')).toBeVisible()
    await page.screenshot({ path: 'e2e/screens/overall-recommended-dark.png' })
  })

  test('while the photos are rated, the loading card shows the Overall key, not the thermal °C bands', async ({ page }) => {
    await mockArea(page, { thermal: true })
    await mockRatings(page, { delay: 8000 }) // the rating stays in progress
    await openMap(page, 'dark', { layer: null })
    await chooseLayer(page, 'overall')
    await analyseCentre(page)
    const loading = page.locator('[data-panel="loading-card"]')
    await expect(loading.getByTestId('rating-step')).toBeVisible({ timeout: 20_000 })
    await expect(loading.getByTestId('comfort-key')).toBeVisible({ timeout: 20_000 }) // once thermal is ready
    await expect(loading.getByTestId('comfort-key')).toContainText('Partial (one layer only)')
    await expect(loading).not.toContainText('°C')
    await page.screenshot({ path: 'e2e/screens/overall-loading-key-dark.png' })
  })

  test('changing the season updates only the thermal part; no new rating is asked', async ({ page }) => {
    await mockArea(page, { thermal: true })
    const asked = await mockRatings(page)
    await openMap(page, 'dark', { layer: null })
    await chooseLayer(page, 'overall')
    await analyseCentre(page)
    await expect.poll(async () => (await states(page)).filter((f) => f.s).length, { timeout: 20_000 }).toBeGreaterThan(5)
    const before = await states(page)
    const n = asked.length
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('area').setThermalWindow({ season: 'winter', time: '15:00' }))
    await expect.poll(async () => (await states(page)).find((f) => f.t)?.t, { timeout: 20_000 }).not.toBe(before.find((f) => f.t)?.t)
    const after = await states(page)
    for (const f of after) {
      const b = before.find((x) => x.id === f.id)
      expect(f.s).toBe(b.s) // senses unchanged
      if (f.t) expect(f.t).toBe(thermalLevel(THERMAL[f.id] - 30)) // winter: 30 °C colder in the mock
    }
    expect(asked.length).toBe(n) // nothing new rated
  })

  test('with a profile on this device, Overall is the default layer', async ({ page }) => {
    const DEV = TEST_PROFILES[0]
    await withSavedProfile(page, { language: 'en', answers: DEV.answers, text: DEV.expected, version: 'x', saved: '2026-11-15T10:00:00Z', weather: {}, thermal: null })
    await openMap(page, 'dark', { layer: null })
    expect(await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('area').layer)).toBe('overall')
  })
})

test.describe('Overall on the routes', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('the stretches take the overall level and each route shows its share of easy, mixed and hard', async ({ page }) => {
    await mockRoutes(page)
    const asked = await mockRatings(page, { delay: 1500 })
    await openRoutes(page, 'dark', { layer: 'overall' })
    const { a, b } = routeClicks(page.viewportSize())
    await page.mouse.click(a.x, a.y)
    await page.mouse.click(b.x, b.y)
    await page.getByRole('button', { name: 'Analyse the routes' }).click()
    const card = page.locator('[data-panel="route-card"]')
    // While the two ways' photos are rated, the card says so (it showed nothing on Overall at first).
    await expect(card.getByTestId('rating-step')).toBeVisible({ timeout: 20_000 })
    await expect(card.getByTestId('shares-A')).toBeVisible({ timeout: 20_000 })
    await expect.poll(() => asked.length, { timeout: 20_000 }).toBeGreaterThan(0) // the two ways' streets are rated
    // Each stretch: the worse of its senses and thermal levels.
    const check = await page.evaluate(() => {
      const r = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('routes')
      return r.shown.flatMap((w) => w.stretches.map((s) => {
        const f = r.segments.get(s.segmentId)?.properties ?? {}
        return { state: s.state, senses: f.senses_state, thermal: f.thermal_state }
      }))
    })
    const R = { easy: 0, mixed: 1, hard: 2 }
    await expect.poll(async () => (await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('routes').shown[0].stretches.some((s) => s.state !== 'none')))).toBe(true)
    for (const c of check) {
      const s = R[c.senses] != null ? c.senses : null
      const t = R[c.thermal] != null ? c.thermal : null
      if (s && t) expect(c.state).toBe(R[s] >= R[t] ? s : t)
      else if (s || t) expect(c.state).toBe(s ?? t)
    }
    await expect(card.getByTestId('shares-A')).toHaveText(/^easy \d+% · mixed \d+% · hard \d+%$/)
    await expect(card).toContainText('overall')
    await expect(card).toContainText('Overall comfort')
    await expect(card).toContainText('Partial (one layer only)') // one look everywhere; dashes stay route B's
    await page.screenshot({ path: 'e2e/screens/overall-routes-dark.png' })
  })
})

for (const theme of ['dark', 'light']) {
  test(`partial streets stay apart from No photo (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await mockArea(page, { thermal: true })
    await mockRatings(page)
    await openMap(page, theme, { layer: null })
    await chooseLayer(page, 'overall')
    await analyseCentre(page)
    await expect.poll(async () => (await states(page)).filter((f) => f.s).length, { timeout: 20_000 }).toBeGreaterThan(5)
    await page.evaluate(() => window.__sencityMap.zoomTo(17.6, { duration: 0 }))
    await page.waitForTimeout(800)
    await page.screenshot({ path: `e2e/screens/overall-partial-${theme}.png`, clip: { x: 380, y: 160, width: 680, height: 600 } })
  })
}

test('thermal level helper matches the default bands', () => {
  expect([level(5), level(3), level(1)]).toEqual(['easy', 'mixed', 'hard'])
  expect(AREA.features.length).toBeGreaterThan(5)
})
