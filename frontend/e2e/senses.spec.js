import { expect, test } from '@playwright/test'
import { AREA, WITH_3, analyseCentre, chooseLayer, layoutProblems, mapIdle, markRatingMocked, mockArea, openMap, openRoutes, openSegment, mockRoutes, routeClicks } from './helpers.js'

// The model is mocked: these checks never call OpenRouter or Mapillary.
const anchors = ['not at all, too much for my senses', 'very much']
const el = (code, n, en, icon_key) => ({ code, n, en, it: en, icon_key, also: [] })
const TRAFFIC = el('traffic_trams', 5, 'Traffic, trams', 'hearing')
const SHADE = el('shade', 11, 'Shade from trees or buildings', 'thermal')
const result = (comfort) => ({
  comfort, anchors, bothers: [TRAFFIC], feels_good: [SHADE],
  reason: 'The trees give shade and the facades are pleasant, but the road carries steady traffic.',
  model: 'google/gemini-3.1-flash-lite', latency_ms: 1400, cost_usd: 0.0005, cached: false,
})

/** Comfort per photo: the first places easy, the rest hard, so both lists fill up. */
function mockSenses(page, { comfort = (i) => (i < 12 ? 5 : 2), failId = null, remaining = 0, cached = false } = {}) {
  const mock = { requests: [], remaining, cached, hold: false, release: null, error: null }
  markRatingMocked(page)
  return page.route('**/api/senses/rate', async (route) => {
    const { photos } = route.request().postDataJSON()
    mock.requests.push(photos)
    if (mock.hold) await new Promise((resolve) => { mock.release = resolve })
    const lines = [{ type: 'start', model: 'google/gemini-3.1-flash-lite', cached: 0, to_rate: photos.length, remaining: mock.remaining }]
    if (mock.error) lines.push({ type: 'error', message: mock.error })
    else {
      photos.forEach((p, i) => {
        if (p.id === failId && !mock.requests[1]) {
          lines.push({ type: 'photo', ...p, status: 'failed', cached: false, error: 'The model\'s answer was not valid, twice, so nothing is shown. It said: "oops"', cost_usd: 0.0002 })
        } else {
          lines.push({ type: 'photo', ...p, status: 'ok', cached: mock.cached, result: result(comfort(i)), cost_usd: mock.cached ? null : 0.0005 })
        }
      })
      const left = mock.remaining
      lines.push({ type: 'done', seconds: 3.2, failed: 0, remaining: left, estimate_usd: left * 0.001 })
    }
    await route.fulfill({ contentType: 'application/x-ndjson', body: lines.map((l) => JSON.stringify(l)).join('\n') + '\n' })
  }).then(() => mock)
}

async function openSenses(page, options = {}, theme = 'dark') {
  const photos = await mockArea(page)
  const mock = await mockSenses(page, options)
  await openMap(page, theme, { layer: null })
  await analyseCentre(page)
  return { mock, photos }
}

const streetStates = (page) => page.evaluate(() => window.__sencityMap.getSource('sc-seg').serialize().data.features.map((f) => f.properties.senses_state).filter(Boolean))

test.describe('Senses mode', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('an area is rated without a click, nearest first, with the panel and the markers filling in', async ({ page }) => {
    const { mock, photos } = await openSenses(page)
    await expect(page.getByTestId('senses-foot')).toContainText('General prediction: not yet personal')
    // At the bottom of the card, after the recommendations.
    expect(await page.locator('[data-panel="area-card"]').evaluate((card) => card.querySelector('[data-testid="senses-best"]')
      .compareDocumentPosition(card.querySelector('[data-testid="senses-foot"]')) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy()
    await expect(page.getByTestId('senses-status')).toContainText('google/gemini-3.1-flash-lite')
    await expect(page.getByTestId('senses-status')).toContainText('cached')
    await expect(page.getByTestId('senses-status')).toContainText('model')
    expect(mock.requests).toHaveLength(1)

    const sent = mock.requests[0]
    const every = AREA.features.flatMap((f) => f.properties.photos)
    expect(sent.length).toBe(new Set(every.map((p) => `${p.id}|${p.heading}`)).size)
    // The photos the app shows, by Mapillary image and heading (the API fetches them): the browser loads no picture for it.
    expect(sent.every((p) => /^[0-9]+$/.test(p.id) && Object.keys(p).sort().join() === 'heading,id')).toBe(true)
    expect(photos).toHaveLength(0)

    await expect(page.getByTestId('senses-best').locator('button').first()).toBeVisible()
    await expect(page.getByTestId('senses-avoid')).toHaveCount(0) // only positive recommendations
    await expect.poll(() => streetStates(page).then((d) => d.length)).toBeGreaterThan(0)
    expect(new Set(await streetStates(page))).toEqual(new Set(['easy', 'hard']))
    // As on Thermal: numbered pins for what is recommended, with the same numbers in the list. No marker on every street.
    await expect(page.locator('[data-marker="1"]')).toBeVisible()
    await expect(page.getByTestId('senses-best').locator('.marker-pin').first()).toHaveText('1')
    expect(await page.locator('[data-marker]').count()).toBeLessThanOrEqual(3)
    expect(await page.evaluate(() => !!window.__sencityMap.getSource('sc-senses'))).toBe(false)
    await expect(page.locator('body')).not.toContainText(/persona\b/i) // "personal" is the required label
    expect(await layoutProblems(page)).toEqual([])
    await mapIdle(page)
    await page.screenshot({ path: 'e2e/screens/senses-area.png' })
  })

  test('progress and a running cost show while it rates', async ({ page }) => {
    const photos = await mockArea(page)
    const mock = await mockSenses(page)
    mock.hold = true
    await openMap(page, 'dark', { layer: null })
    await analyseCentre(page)
    const loading = page.locator('[data-panel="loading-card"]')
    await expect(loading.getByTestId('rating-step')).toContainText(/Rating 0 of \d+ places…/)
    await expect(loading).toContainText('Street photos')
    await expect(loading.getByTestId('senses-cost')).toContainText('so far')
    await expect(loading).toContainText('General prediction: not yet personal')
    await expect(page.getByTestId('senses-best')).toHaveCount(0) // recommendations wait for the end
    // Streets with photos but no rating yet are drawn at full width, in grey, until their rating arrives.
    const grey = await page.evaluate(() => {
      const m = window.__sencityMap
      const colour = m.getPaintProperty('sc-seg-core', 'line-color')
      return { last: colour[colour.length - 1], token: getComputedStyle(document.documentElement).getPropertyValue('--map-seg-pending').trim(), halo: m.getFilter('sc-seg-halo') }
    })
    expect(grey.last).toBe(grey.token)
    expect(JSON.stringify(grey.halo)).toContain('photos')
    await expect(page.locator('[data-marker]')).toHaveCount(0)
    await mapIdle(page)
    expect(await layoutProblems(page)).toEqual([])
    await page.screenshot({ path: 'e2e/screens/senses-loading.png' })
    await expect.poll(() => mock.release !== null).toBe(true)
    mock.release()
    await expect(loading).toHaveCount(0) // the area card takes over when the rating ends
    await expect(page.getByTestId('senses-best')).toBeVisible()
    await expect(page.locator('[data-marker="1"]')).toBeVisible()
    await expect(page.getByTestId('senses-status')).toBeVisible()
    expect(photos).toHaveLength(0)
  })

  test('Cancel while rating stops the rating and keeps the area', async ({ page }) => {
    await mockArea(page)
    const mock = await mockSenses(page)
    mock.hold = true
    await openMap(page, 'dark', { layer: null })
    await analyseCentre(page)
    const loading = page.locator('[data-panel="loading-card"]')
    await expect(loading.getByTestId('rating-step')).toBeVisible()
    await loading.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByTestId('senses-stopped')).toContainText('Rating stopped')
    await expect(page.locator('[data-panel="area-card"]')).toContainText('street stretches')
  })

  test('clicking a place opens its detail with no new call', async ({ page }) => {
    const { mock } = await openSenses(page, { comfort: () => 4 })
    await expect(page.getByTestId('senses-status')).toBeVisible()
    await openSegment(page, WITH_3.properties.id)
    const card = page.locator('[data-panel="place-card"]')
    await expect(card).toContainText('Easy · 4 · fairly comfortable')
    await expect(card).toContainText('Traffic, trams')
    await expect(card.locator('.sense-item[data-sense="hearing"] [role="img"]')).toHaveAttribute('aria-label', 'hearing') // the sense is the icon
    await expect(card.getByRole('img', { name: 'hearing' })).toBeVisible()
    await expect(card).toContainText('The trees give shade')
    await expect(card).toContainText('Based on 3 photos')
    await expect(card).toContainText('General prediction: not yet personal')
    await expect(card).toContainText('A prediction, not a reason.')
    expect(mock.requests).toHaveLength(1)

    await page.getByRole('button', { name: 'Enlarge photo' }).first().click()
    await expect(page.locator('[data-viewer]')).toContainText('4 · fairly comfortable, this photo')
    await expect(page.locator('[data-viewer]')).toContainText('General prediction: not yet personal')
    expect(await layoutProblems(page)).toEqual([])
    await page.screenshot({ path: 'e2e/screens/senses-place.png' })
  })

  test('above the cap it asks, with the cost of the rest, before going on', async ({ page }) => {
    const { mock } = await openSenses(page, { remaining: 182 })
    const ask = page.getByTestId('senses-ask')
    await expect(ask).toContainText('182 more photos to rate')
    await expect(ask).toContainText('$0.18 for the model')
    await expect(ask).toContainText('the photos are free')
    await expect(ask).not.toContainText('Street View')
    expect(mock.requests).toHaveLength(1)
    mock.remaining = 0
    await ask.getByRole('button', { name: 'Continue' }).click()
    await expect(ask).toHaveCount(0)
    await expect(page.getByTestId('senses-status')).toBeVisible()
    expect(mock.requests).toHaveLength(2)
  })

  test('reopened, everything comes from the cache', async ({ page }) => {
    await openSenses(page, { cached: true })
    await expect(page.getByTestId('senses-status')).toContainText(/\d+ cached, 0 new/)
    await expect(page.getByTestId('senses-status')).toContainText('$0.0000 model')
  })

  test('a photo that fails is marked and can be retried', async ({ page }) => {
    const failing = WITH_3.properties.photos
    const only = { ...WITH_3, properties: { ...WITH_3.properties, photos: [failing[0]] } }
    const mock = await (async () => {
      await page.route('**/api/area', async (route) => {
        await route.fulfill({ contentType: 'application/x-ndjson', body: `${JSON.stringify({ type: 'done', area: { type: 'FeatureCollection', features: [only] } })}\n` })
      })
      await page.route('**/mly-thumb/**', (r) => r.fulfill({ status: 404 }))
      return mockSenses(page, { failId: failing[0].id, comfort: () => 4 })
    })()
    await openMap(page, 'light', { layer: null })
    await analyseCentre(page)
    const failed = page.getByTestId('senses-failed')
    await expect(failed).toContainText('1 place could not be rated')
    await expect.poll(() => streetStates(page)).toEqual(['failed'])
    await openSegment(page, WITH_3.properties.id)
    const error = page.getByTestId('senses-error')
    await expect(error).toContainText('It said: "oops"')
    await error.getByRole('button', { name: 'Retry' }).click()
    await expect(page.locator('[data-panel="place-card"]')).toContainText('Easy · 4')
    expect(mock.requests).toHaveLength(2)
  })

  test('a refused run says why, and Thermal does not start one', async ({ page }) => {
    await mockArea(page, { thermal: true })
    const mock = await mockSenses(page)
    await openMap(page, 'dark') // Thermal
    await analyseCentre(page)
    await expect(page.locator('[data-panel="area-card"]')).toContainText('Thermal')
    expect(mock.requests).toHaveLength(0)

    mock.error = 'OpenRouter refused the request (401).'
    await chooseLayer(page, 'senses')
    await expect(page.getByTestId('senses-run-error')).toContainText('OpenRouter refused the request (401).')
  })

  test('the card and panel fit a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openSenses(page, { comfort: () => 4 })
    await expect(page.locator('[data-panel="sheet"]')).toContainText('General prediction: not yet personal')
    await mapIdle(page)
    expect(await layoutProblems(page)).toEqual([])
    await page.screenshot({ path: 'e2e/screens/senses-phone.png' })
  })

  async function analyseRoute(page, chooseSenses) {
    await openRoutes(page, 'dark', { layer: null })
    // Routes open on Senses, as Area does.
    await expect(page.getByRole('radio', { name: 'Senses', exact: true }).first()).toHaveAttribute('aria-checked', 'true')
    if (!chooseSenses) await page.getByRole('radio', { name: 'Thermal', exact: true }).first().click()
    const { a, b } = routeClicks({ width: 1440, height: 900 })
    await page.mouse.click(a.x, a.y)
    await page.mouse.click(b.x, b.y)
    await page.getByRole('button', { name: 'Analyse the routes' }).click()
  }

  test('a Senses route loads streets, photos and ratings, and speaks only of photos', async ({ page }) => {
    const rate = await mockSenses(page, { comfort: (i) => (i === 0 ? 2 : 4) })
    rate.hold = true
    const routes = await mockRoutes(page)
    await analyseRoute(page, true)
    const card = page.locator('[data-panel="route-card"]')
    await expect(card.getByTestId('rating-step')).toContainText(/Rating 0 of \d+ places…/)
    await expect(card).not.toContainText('Thermal')
    expect(routes.requests[0].layer).toBe('senses')
    await expect.poll(() => rate.release !== null).toBe(true)
    rate.release()
    // As on the board: the routes' own rows and one sentence, no detail per route.
    await expect(card).toContainText('General prediction: not yet personal')
    await expect(card).toContainText('Based on photos along')
    await expect(card.locator('.hard').first()).toContainText('hard')
    await expect(card.locator('.verdict')).toContainText('easiest way') // every street here has the same photos
    await expect(page.getByTestId('senses-route-A')).toHaveCount(0)
    await expect(card).not.toContainText('Hardest stretch')
    await expect(card).not.toContainText('Thermal along')
    await expect(card).toContainText('B · alternative')
    expect(rate.requests).toHaveLength(1)
    await page.screenshot({ path: 'e2e/screens/senses-route.png' })
  })

  test('walking a Senses route shows the same photos and ratings as the preview, and rates nothing again', async ({ page }) => {
    const rate = await mockSenses(page, { comfort: (i) => [2, 3, 5][i % 3] })
    await mockRoutes(page)
    let lookups = 0
    await page.route('**/api/mapillary/along', (route) => { lookups++; return route.abort() })
    await analyseRoute(page, true)
    const card = page.locator('[data-panel="route-card"]')
    await expect(card).toContainText('General prediction: not yet personal')
    const walkBtn = card.locator('[data-walk]').first()
    const id = await walkBtn.getAttribute('data-walk')
    const fills = (bar) => bar.locator('[data-stretch] .fill').evaluateAll((els) => els.map((e) => e.className))
    const preview = await fills(card.locator(`[data-route="${id}"]`))
    expect(preview.some((c) => /easy|mixed|hard/.test(c))).toBe(true)
    // The photo and rating of the first stretch, on its card.
    await card.locator(`[data-stretch="${id}-0"]`).click()
    const stretchCard = page.locator('[data-panel="place-card"]')
    const photo = await stretchCard.locator('.photo img').getAttribute('src')
    const rating = (await stretchCard.getByTestId('senses-result').locator('.scale-head strong').textContent()).trim()
    await page.getByRole('button', { name: 'Back to comparison' }).click()

    // Walk it (Elena, 2026-11-14): stable and the same as the preview, the same photos.
    await page.locator(`[data-walk="${id}"]`).first().click()
    const view = page.locator('[data-panel="walk-view"]')
    await view.getByRole('button', { name: 'Pause' }).click()
    await expect(page.getByTestId('walk-photo').locator('img')).toHaveAttribute('src', photo)
    expect(await fills(view)).toEqual(preview)
    await expect(view.getByTestId('walk-state')).toContainText(rating.split(' · ')[0])
    await view.getByRole('button', { name: 'Next stretch' }).click()
    expect(await fills(view)).toEqual(preview) // nothing changes colour while walking
    expect(rate.requests).toHaveLength(1) // no new rating run
    expect(lookups).toBe(0) // no photos of its own
  })

  test('a Thermal route rates nothing and speaks only of thermal comfort', async ({ page }) => {
    const rate = await mockSenses(page)
    const routes = await mockRoutes(page)
    await analyseRoute(page, false)
    const card = page.locator('[data-panel="route-card"]')
    await expect(card).toContainText('Thermal along')
    await expect(card).not.toContainText('hotos along')
    await expect(page.getByTestId('senses-panel')).toHaveCount(0)
    await expect(card).not.toContainText('Hardest stretch')
    expect(rate.requests).toHaveLength(0)

    // Choosing Senses afterwards finds its own candidates and rates them.
    await page.getByRole('radio', { name: 'Senses', exact: true }).first().click()
    await expect(page.getByTestId('senses-status')).toBeVisible()
    expect(rate.requests).toHaveLength(1)
    expect(routes.requests.map((r) => r.layer)).toEqual(['thermal', 'senses'])
  })
})
