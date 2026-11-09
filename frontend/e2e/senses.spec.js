import { expect, test } from '@playwright/test'
import { AREA, WITH_3, analyseCentre, chooseLayer, layoutProblems, mapIdle, markRatingMocked, mockArea, openMap, openRoutes, openSegment, mockRoutes, routeClicks } from './helpers.js'

// The model is mocked: these checks never call OpenRouter or Street View.
const anchors = ['not at all, too much for my senses', 'very much']
const el = (code, en, sense) => ({ code, en, it: en, sense, kind: null })
const TRAFFIC = el('traffic_trams_crowds', 'Traffic, trams, crowds (hearing)', 'hearing')
const SHADE = el('shade', 'Shade from trees, pergolas or buildings (thermal)', 'thermal')
const result = (comfort) => ({
  comfort, anchors, bothers: [TRAFFIC], feels_good: [SHADE],
  reason: 'The trees give shade and the facades are pleasant, but the road carries steady traffic.',
  model: 'google/gemini-3.1-flash-lite', latency_ms: 1400, cost_usd: 0.0005, cached: false,
})

/** Comfort per photo: the first places easy, the rest hard, so both lists fill up. */
function mockSenses(page, { comfort = (i) => (i < 12 ? 5 : 2), failPano = null, remaining = 0, cached = false } = {}) {
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
        if (p.pano_id === failPano && !mock.requests[1]) {
          lines.push({ type: 'photo', ...p, status: 'failed', cached: false, error: 'The model\'s answer was not valid, twice, so nothing is shown. It said: "oops"', cost_usd: 0.0002, streetview_usd: 0.007 })
        } else {
          lines.push({ type: 'photo', ...p, status: 'ok', cached: mock.cached, result: result(comfort(i)), cost_usd: mock.cached ? null : 0.0005, streetview_usd: mock.cached ? undefined : 0.007 })
        }
      })
      const left = mock.remaining
      lines.push({ type: 'done', seconds: 3.2, failed: 0, remaining: left, estimate_usd: left * 0.001, estimate_streetview_usd: left * 0.007 })
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

const dots = (page) => page.evaluate(() => window.__sencityMap.getSource('sc-senses').serialize().data.features.map((f) => f.properties.level))

test.describe('Senses mode', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('an area is rated without a click, nearest first, with the panel and the markers filling in', async ({ page }) => {
    const { mock, photos } = await openSenses(page)
    const panel = page.getByTestId('senses-panel')
    await expect(panel).toContainText('General prediction: not yet personal')
    await expect(page.getByTestId('senses-status')).toContainText('google/gemini-3.1-flash-lite')
    await expect(page.getByTestId('senses-status')).toContainText('cached')
    await expect(page.getByTestId('senses-status')).toContainText('model')
    expect(mock.requests).toHaveLength(1)

    const sent = mock.requests[0]
    const every = AREA.features.flatMap((f) => f.properties.photos)
    expect(sent.length).toBe(new Set(every.map((p) => `${p.pano_id}|${p.heading}`)).size)
    expect(photos).toHaveLength(0) // the browser fetched no picture: the rating needs none

    await expect(page.getByTestId('senses-best').locator('button').first()).toBeVisible()
    await expect(page.getByTestId('senses-avoid')).toContainText('Traffic, trams, crowds')
    await expect.poll(() => dots(page).then((d) => d.length)).toBeGreaterThan(0)
    expect(new Set(await dots(page))).toEqual(new Set(['easy', 'hard']))
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
    await expect(page.getByTestId('senses-panel')).toContainText(/Rating 0 of \d+ places…/)
    await expect(page.getByTestId('senses-cost')).toContainText('so far')
    await expect.poll(() => mock.release !== null).toBe(true)
    mock.release()
    await expect(page.getByTestId('senses-status')).toBeVisible()
    expect(photos).toHaveLength(0)
  })

  test('clicking a place opens its detail with no new call', async ({ page }) => {
    const { mock } = await openSenses(page, { comfort: () => 4 })
    await expect(page.getByTestId('senses-status')).toBeVisible()
    await openSegment(page, WITH_3.properties.id)
    const card = page.locator('[data-panel="place-card"]')
    await expect(card).toContainText('Easy · 4 · fairly comfortable')
    await expect(card).toContainText('Traffic, trams, crowds')
    await expect(card).not.toContainText('(hearing)') // the sense is the icon
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
    await expect(ask).toContainText('$1.27 for the')
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
      await page.route('**/api/photo/**', (r) => r.fulfill({ status: 404 }))
      return mockSenses(page, { failPano: failing[0].pano_id, comfort: () => 4 })
    })()
    await openMap(page, 'light', { layer: null })
    await analyseCentre(page)
    const failed = page.getByTestId('senses-failed')
    await expect(failed).toContainText('1 place could not be rated')
    await expect.poll(() => dots(page)).toEqual(['failed'])
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

  test('a route is rated for its two ways only, with its overall comfort and hardest stretch', async ({ page }) => {
    const mock = await mockSenses(page, { comfort: (i) => (i === 0 ? 2 : 4) })
    await mockRoutes(page)
    await openRoutes(page, 'dark')
    const { a, b } = routeClicks({ width: 1440, height: 900 })
    await page.mouse.click(a.x, a.y)
    await page.mouse.click(b.x, b.y)
    await page.getByRole('button', { name: 'Analyse the routes' }).click()
    const route = page.getByTestId('senses-route-A')
    await expect(route).toContainText('Overall')
    await expect(route).toContainText('Hardest stretch')
    await expect(page.locator('[data-panel="route-card"]')).toContainText('General prediction: not yet personal')
    expect(mock.requests).toHaveLength(1)
    await page.getByRole('radio', { name: 'Senses', exact: true }).first().click()
    await expect(page.getByTestId('senses-route-A')).toBeVisible()
    await page.screenshot({ path: 'e2e/screens/senses-route.png' })
  })
})
