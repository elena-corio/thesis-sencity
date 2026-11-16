// The markers with the photo's direction (boards Flow 4, 4b, P2, Routes 5) and the centred route and area, with the API
// mocked (Mapillary photos too, each looking a different way). Screenshots of Flow 4, Flow 4b, a route after start and
// end, and the walk, on desktop and phone, dark and light, go to e2e/screens/markers/.
import { expect, test } from '@playwright/test'
import { PHOTO, analyseCentre, mapIdle, mockArea, mockRoutes, openMap, openRoutes, routeClicks } from './helpers.js'

/** The photos' thumbnails (each street's photo comes with the mocked area or routes). */
async function mockPhotos(page) {
  await page.route('**/mly-thumb/**', (route) => route.fulfill({ contentType: 'image/png', body: PHOTO }))
}
const settle = (page) => page.waitForFunction(() => !window.__sencityMap.isMoving(), null, { timeout: 15_000 })

for (const [device, viewport, phone] of [['desktop', { width: 1440, height: 900 }, false], ['phone', { width: 390, height: 844 }, true]]) {
  for (const theme of ['dark', 'light']) {
    test.describe(`${device}, ${theme}`, () => {
      test.use({ viewport, colorScheme: theme, hasTouch: phone })

      test('Flow 4 and 4b: suggestions with arcs; selecting one hides the others', async ({ page }) => {
        await mockArea(page, { thermal: true })
        await mockPhotos(page)
        await openMap(page, theme, { photos: 'mapillary' })
        await analyseCentre(page)
        const pins = page.locator('[data-marker]')
        await expect(pins.first()).toBeVisible()
        await expect(pins.first().locator('.marker-arc')).toBeVisible() // the direction, once its photo has come
        const pin = (await pins.first().boundingBox())
        expect(Math.round(pin.width)).toBeGreaterThanOrEqual(36)
        await settle(page)
        await mapIdle(page)
        await page.screenshot({ path: `e2e/screens/markers/flow4-${device}-${theme}.png` })

        const n = await pins.count()
        await pins.first().click()
        await expect(pins).toHaveCount(0) // the others hide until Back to area
        await expect(page.locator('.point .marker-arc')).toBeVisible()
        await settle(page)
        await mapIdle(page)
        await page.screenshot({ path: `e2e/screens/markers/flow4b-${device}-${theme}.png` })
        await page.getByRole('button', { name: 'Back to area' }).click()
        await expect(pins).toHaveCount(n)
      })

      test('a route after start and end is centred on the map', async ({ page }) => {
        await mockRoutes(page)
        await mockPhotos(page)
        await openRoutes(page, theme, { photos: 'mapillary' })
        const { a, b } = routeClicks(page.viewportSize(), phone)
        await page.mouse.click(a.x, a.y)
        await page.mouse.click(b.x, b.y)
        if (phone) await page.getByRole('tab', { name: /Settings/ }).click()
        await page.getByRole('button', { name: 'Analyse the routes' }).click()
        await expect(page.getByRole('button', { name: 'Walk route B' })).toBeVisible()
        await settle(page)
        await mapIdle(page)
        // The routes' box, centred left to right on the full map (on a phone, in the map above the sheet too).
        const box = await page.evaluate(() => {
          const m = window.__sencityMap
          const pts = m.getSource('sc-route').serialize().data.features.flatMap((f) => f.geometry.coordinates).map((c) => m.project(c))
          const xs = pts.map((p) => p.x)
          return { left: Math.min(...xs), right: Math.max(...xs), width: m.getCanvas().clientWidth }
        })
        const centre = (box.left + box.right) / 2
        expect(Math.abs(centre - box.width / 2)).toBeLessThan(box.width * 0.03)
        await page.screenshot({ path: `e2e/screens/markers/route-${device}-${theme}.png` })

        await page.getByRole('button', { name: 'Walk route B' }).click()
        await expect(page.getByRole('button', { name: 'Pause' }).first()).toBeVisible() // it opens playing
        await page.getByRole('button', { name: 'Pause' }).first().click()
        await settle(page)
        await mapIdle(page)
        await page.screenshot({ path: `e2e/screens/markers/walk-${device}-${theme}.png` })
      })
    })
  }
}
