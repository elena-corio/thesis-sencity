// Walk along a route (boards Routes 5, P6), with the API mocked: no Overpass, Street View, Infrared.city or model
// calls. The buildings are boxes either side of the walked line.
import { expect, test } from '@playwright/test'
import { layoutProblems, mapIdle, mockRoutes, openRoutes, routeClicks } from './helpers.js'

/** Mock POST /api/buildings: a box 20 m to each side of every point of the line, 12 to 40 m high. fail: 503. */
async function mockBuildings(page, { fail = false } = {}) {
  const mock = { requests: [] }
  await page.route('**/api/buildings', async (route) => {
    const { line } = route.request().postDataJSON()
    mock.requests.push(line)
    if (fail) {
      await route.fulfill({ status: 503, json: { detail: 'Buildings could not be loaded here.' } })
      return
    }
    const box = ([lon, lat], dx, dy, h) => {
      const m = 1 / 111320
      const k = 1 / Math.cos((lat * Math.PI) / 180)
      const w = 14 * m * k
      const d = 14 * m
      const x = lon + dx * m * k
      const y = lat + dy * m
      return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[x, y], [x + w, y], [x + w, y + d], [x, y + d], [x, y]]] }, properties: { h, b: 0 } }
    }
    const features = line.flatMap((p, i) => [box(p, -34, 20, 12 + (i % 4) * 7), box(p, 20, -34, 40 - (i % 3) * 9)])
    await route.fulfill({ json: { type: 'FeatureCollection', features, source: 'Stadt Wien – data.wien.gv.at' } })
  })
  return mock
}

async function toRoutes(page, theme = 'dark', phone = false) {
  await openRoutes(page, theme)
  const { a, b } = routeClicks(page.viewportSize(), phone)
  await page.mouse.click(a.x, a.y)
  await page.mouse.click(b.x, b.y)
  if (phone) await page.getByRole('tab', { name: /Settings/ }).click()
  await page.getByRole('button', { name: 'Analyse the routes' }).click()
  await expect(page.getByRole('button', { name: 'Walk route B' })).toBeVisible()
}

const pitch = (page) => page.evaluate(() => window.__sencityMap.getPitch())
const settle = (page) => page.waitForFunction(() => !window.__sencityMap.isMoving(), null, { timeout: 10_000 })

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })

  test('walk the easiest route, stretch by stretch, and go back to the comparison', async ({ page }) => {
    await mockRoutes(page)
    const buildings = await mockBuildings(page)
    await toRoutes(page)
    // Board Routes 3: the main button walks the easiest way by its letter, the other is the second choice.
    await expect(page.getByRole('button', { name: 'Walk A' })).toBeVisible()
    await page.screenshot({ path: 'e2e/screens/walk/0-route-card.png' })

    await page.getByRole('button', { name: 'Walk route B' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Walking route B' })).toContainText('easiest, summer 15:00')
    await settle(page)
    expect(await pitch(page)).toBeGreaterThan(50)
    expect(buildings.requests).toHaveLength(1)
    const card = page.locator('[data-panel="walk-card"]')
    await expect(card).toContainText('Kuehlgasse')
    await expect(card).toContainText('Rate this place')
    await expect(card.getByRole('button', { name: 'Rate 1 of 5' })).toHaveAttribute('aria-disabled', 'true')
    await expect(page.locator('[data-panel="walk-controls"]')).toContainText(/0\.09 of 0\.6 km, 1 of 7 min/)
    await expect(card).toContainText('© Google')
    // Street level: looking along the street, past the map's usual maximum zoom.
    expect(await pitch(page)).toBeGreaterThan(80)
    expect(await page.evaluate(() => window.__sencityMap.getZoom())).toBeGreaterThan(22)
    await expect(page.locator('[data-panel="attribution"]')).toContainText('buildings: Stadt Wien – data.wien.gv.at via Infrared.city')
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible() // it opens paused
    await mapIdle(page)
    await page.screenshot({ path: 'e2e/screens/walk/1-walk-dark.png' })
    expect(await layoutProblems(page)).toEqual([])

    // Keys: the arrows go along the route, space plays and pauses.
    await page.keyboard.press('ArrowRight')
    await expect(card).toContainText('Marktgasse')
    await page.keyboard.press('ArrowLeft')
    await expect(card).toContainText('Kuehlgasse')
    await page.locator('body').press('Space')
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
    await page.locator('body').press('Space')
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()

    // The strip: a stretch is a button.
    await page.locator('[data-panel="walk-controls"] [data-stretch="B-2"]').click()
    await expect(card).toContainText('Kuehlgasse')
    await expect(page.getByRole('button', { name: 'Next stretch' })).toHaveAttribute('aria-disabled', 'true')

    // Layer recolours the walked route only: no new search.
    await page.locator('[data-panel="layers"]').getByRole('radio', { name: 'Senses' }).click()
    await expect(page.getByTestId('walk-state')).toContainText(/Not rated yet|No photo|Hard|Mixed|Easy/)

    // Back to comparison, as on a selected stretch, does the same as Exit walk.
    await card.getByRole('button', { name: 'Back to comparison' }).click()
    await expect(page.locator('[data-panel="route-card"]')).toContainText('Which way feels better?')
    await settle(page)
    expect(await pitch(page)).toBe(0)
    await expect(page.locator('[data-panel="attribution"]')).not.toContainText('buildings')
  })

  test('without buildings the walk goes on flat, with a notice and Retry', async ({ page }) => {
    await mockRoutes(page)
    await mockBuildings(page, { fail: true })
    await toRoutes(page)
    await page.getByRole('button', { name: 'Walk A' }).click()
    const notice = page.getByRole('status').filter({ hasText: 'without buildings' })
    await expect(notice).toContainText('Buildings could not be loaded here.')
    await expect(notice.getByRole('button', { name: 'Retry' })).toBeVisible()
    await expect(page.locator('[data-panel="walk-card"]')).toContainText('Mittelgasse')
    await settle(page)
    await page.screenshot({ path: 'e2e/screens/walk/2-no-buildings.png' })
  })

  test('Esc leaves the walk, and focus goes back to its button', async ({ page }) => {
    await mockRoutes(page)
    await mockBuildings(page)
    await toRoutes(page)
    await page.getByRole('button', { name: 'Walk route B' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-panel="walk-card"]')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Walk route B' })).toBeFocused()
  })
})

test.describe('reduced motion', () => {
  test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', reducedMotion: 'reduce' })

  test('jumps between stretches instead of flying', async ({ page }) => {
    await mockRoutes(page)
    await mockBuildings(page)
    await toRoutes(page)
    await page.getByRole('button', { name: 'Walk route B' }).click()
    await expect(page.locator('[data-panel="walk-card"]')).toContainText('Kuehlgasse')
    expect(await page.evaluate(() => window.__sencityMap.isMoving())).toBe(false)
    await page.getByRole('button', { name: 'Next stretch' }).click()
    expect(await page.evaluate(() => window.__sencityMap.isMoving())).toBe(false)
    expect(await pitch(page)).toBeGreaterThan(50)
  })
})

test.describe('light', () => {
  test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })

  test('the walk in light mode', async ({ page }) => {
    await mockRoutes(page)
    await mockBuildings(page)
    await toRoutes(page, 'light')
    await page.getByRole('button', { name: 'Walk route B' }).click()
    await settle(page)
    await mapIdle(page)
    await page.screenshot({ path: 'e2e/screens/walk/3-walk-light.png' })
    expect(await layoutProblems(page)).toEqual([])
  })
})

for (const theme of ['dark', 'light']) {
  test.describe(`phone, ${theme}`, () => {
    test.use({ viewport: { width: 390, height: 844 }, colorScheme: theme, hasTouch: true })

    test('the walk in the sheet, and Layer opens Settings', async ({ page }) => {
      await mockRoutes(page)
      await mockBuildings(page)
      await toRoutes(page, theme, true)
      await page.getByRole('button', { name: 'Walk route B' }).click()
      const sheet = page.locator('[data-panel="sheet"]')
      await expect(sheet.getByRole('region', { name: 'Walk controls' })).toBeVisible()
      await expect(sheet.getByText(/of 0\.6 km/)).toBeInViewport()
      await expect(sheet).toContainText('Stretch ahead')
      await expect(page.getByRole('navigation', { name: 'Views' })).toHaveCount(0) // no tab bar during the walk
      await settle(page)
      await mapIdle(page)
      await page.screenshot({ path: `e2e/screens/walk/4-phone-${theme}.png` })
      expect(await layoutProblems(page)).toEqual([])

      await page.getByRole('button', { name: 'Layer, season and time' }).click()
      await expect(sheet.getByRole('button', { name: 'Back to the walk' })).toBeVisible()
      await page.screenshot({ path: `e2e/screens/walk/5-phone-settings-${theme}.png` })
      await sheet.getByRole('button', { name: 'Back to the walk' }).click()
      await sheet.getByRole('button', { name: 'Exit walk' }).click()
      await expect(page.getByRole('button', { name: 'Walk route B' })).toBeVisible()
    })
  })
}
