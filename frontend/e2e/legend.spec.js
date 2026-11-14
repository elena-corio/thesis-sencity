// The legend in the right card (Elena, 2026-11-11), with the API mocked: never in the left panel; straight after the
// bar(s), or at the top where there is none (the walk); "Sensory comfort" on Senses, "<Layer> · <season>, <time>" else;
// on Thermal the full thermal legend instead of the key; no key on a detail card; on a phone the key floats on the map.
// Screenshots of Area (Senses and Thermal), Routes, a place card and the walk, desktop and phone, dark and light, go to
// e2e/screens/legend/. At 1440 x 900 no right card runs past the bottom of the screen.
import { expect, test } from '@playwright/test'
import { WITH_3, analyseCentre, chooseLayer, mapIdle, markRatingMocked, mockArea, mockRoutes, openMap, openRoutes, openSegment, routeClicks } from './helpers.js'

const el = (code, n, en, icon_key) => ({ code, n, en, it: en, icon_key, also: [] })
/** Ratings for every photo: easy, mixed and hard in turn. */
async function mockRatings(page) {
  markRatingMocked(page)
  await page.route('**/api/senses/rate', async (route) => {
    const { photos } = route.request().postDataJSON()
    const lines = [{ type: 'start', model: 'test', cached: photos.length, to_rate: 0, remaining: 0 },
      ...photos.map((p, i) => ({ type: 'photo', ...p, status: 'ok', cached: true, result: {
        comfort: [5, 3, 2][i % 3], anchors: ['not at all', 'very much'], bothers: [el('traffic_trams', 5, 'Traffic, trams', 'hearing')],
        feels_good: [el('shade', 11, 'Shade from trees or buildings', 'thermal')], reason: 'Test.', model: 'test', latency_ms: 1, cost_usd: null, cached: true } })),
      { type: 'done', seconds: 0, failed: 0, remaining: 0, estimate_usd: 0 }]
    await route.fulfill({ contentType: 'application/x-ndjson', body: lines.map((l) => JSON.stringify(l)).join('\n') + '\n' })
  })
}
const settle = (page) => page.waitForFunction(() => !window.__sencityMap.isMoving(), null, { timeout: 15_000 })
/** The right card's bottom is on the screen. */
async function fitsOnScreen(page, selector) {
  const box = await page.locator(selector).boundingBox()
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize().height)
}
const shot = (page, name) => page.screenshot({ path: `e2e/screens/legend/${name}.png` })

for (const [device, viewport, phone] of [['desktop', { width: 1440, height: 900 }, false], ['phone', { width: 390, height: 844 }, true]]) {
  for (const theme of ['dark', 'light']) {
    test.describe(`${device}, ${theme}`, () => {
      test.use({ viewport, colorScheme: theme, hasTouch: phone })
      const at = `${device}-${theme}`

      test('Area on Senses and on Thermal, and a place card', async ({ page }) => {
        await mockArea(page, { thermal: true })
        await mockRatings(page)
        await openMap(page, theme, { layer: 'senses' })
        await analyseCentre(page)
        const card = page.locator('[data-panel="area-card"]')
        const key = phone ? page.locator('[data-panel="legend"]') : card.getByTestId('comfort-key')
        await expect(key).toContainText('Sensory comfort')
        await expect(key).not.toContainText('summer')
        await expect(page.locator('[data-panel="layers"] [data-testid="legend-rows"]')).toHaveCount(0)
        // On a phone the key floats on the map only, not again in the sheet.
        if (phone) await expect(page.locator('[data-panel="area-card"] [data-testid="comfort-key"]')).toHaveCount(0)
        if (!phone) {
          // Straight after the bar.
          expect(await card.evaluate((c) => c.querySelector('[data-testid="area-bar"]').nextElementSibling.dataset.testid)).toBe('comfort-key')
          await expect(card.locator('.stack-head')).toContainText(/street stretches.*hard \d+%/)
          await fitsOnScreen(page, '[data-panel="area-card"]')
        }
        await settle(page)
        await mapIdle(page)
        await shot(page, `area-senses-${at}`)

        await chooseLayer(page, 'thermal')
        if (!phone) {
          const block = card.getByRole('group', { name: 'Legend' })
          await expect(block).toContainText('Thermal comfort °C · summer, 15:00')
          await expect(card.getByTestId('comfort-key')).toHaveCount(0)
          expect(await card.evaluate((c) => c.querySelector('[data-testid="area-bar"]').nextElementSibling.getAttribute('aria-label'))).toBe('Legend')
          await fitsOnScreen(page, '[data-panel="area-card"]')
        } else {
          await expect(page.locator('[data-panel="legend"]')).toContainText('Thermal · summer, 15:00')
        }
        await settle(page)
        await mapIdle(page)
        await shot(page, `area-thermal-${at}`)

        // A detail card: its own label and bars, no key (and on a phone no floating key either).
        await openSegment(page, WITH_3.properties.id)
        const place = phone ? page.locator('[data-panel="sheet"]') : page.locator('[data-panel="place-card"]')
        await expect(place.getByTestId('comfort-key')).toHaveCount(0)
        await expect(place.getByTestId('thermal-legend')).toHaveCount(0)
        if (phone) await expect(page.locator('[data-panel="legend"]')).toHaveCount(0)
        else await fitsOnScreen(page, '[data-panel="place-card"]')
        await settle(page)
        await mapIdle(page)
        await shot(page, `place-${at}`)
      })

      test('Routes on Thermal, then the walk', async ({ page }) => {
        await mockRoutes(page)
        // The walk's photos: none (never the running API).
        await page.route('**/api/mapillary/along', (route) => route.fulfill({ json: { photos: {} } }))
        await openRoutes(page, theme)
        const { a, b } = routeClicks(page.viewportSize(), phone)
        await page.mouse.click(a.x, a.y)
        await page.mouse.click(b.x, b.y)
        if (phone) await page.getByRole('tab', { name: /Settings/ }).click()
        await page.getByRole('button', { name: 'Analyse the routes' }).click()
        await expect(page.getByRole('button', { name: 'Walk route B' })).toBeVisible()
        if (!phone) {
          const card = page.locator('[data-panel="route-card"]')
          await expect(card.getByRole('group', { name: 'Legend' })).toContainText('Thermal comfort °C · summer, 15:00')
          await expect(page.locator('[data-panel="layers"]').getByTestId('layer-note')).toBeVisible()
          await fitsOnScreen(page, '[data-panel="route-card"]')
        } else {
          await expect(page.locator('[data-panel="legend"]')).toContainText('Thermal · summer, 15:00')
        }
        await settle(page)
        await mapIdle(page)
        await shot(page, `routes-${at}`)

        await page.getByRole('button', { name: 'Walk route B' }).click()
        await expect(page.getByRole('button', { name: 'Pause' }).first()).toBeVisible()
        await page.getByRole('button', { name: 'Pause' }).first().click()
        if (!phone) {
          await expect(page.locator('[data-panel="layers"]')).toHaveCount(0) // no left panel in the walk
          const side = page.locator('[data-panel="walk-view"]')
          await expect(side.getByTestId('comfort-key')).toContainText('summer, 15:00')
          await fitsOnScreen(page, '[data-panel="walk-view"]')
        }
        await settle(page)
        await mapIdle(page)
        await shot(page, `walk-${at}`)
      })
    })
  }
}
