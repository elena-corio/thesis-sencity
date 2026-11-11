// Walk along a route at eye level (boards Routes 5, P6), with the API mocked: no Overpass, Street View, Infrared.city or
// model calls. The buildings are boxes either side of the walked line. The app ships with no photo shown
// (lib/photos.js, 'none'); some checks run with Street View to see the photo window.
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
      const x = lon + dx * m * k
      const y = lat + dy * m
      const w = 14 * m * k
      const d = 14 * m
      return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[x, y], [x + w, y], [x + w, y + d], [x, y + d], [x, y]]] }, properties: { h, b: 0 } }
    }
    const features = line.flatMap((p, i) => [box(p, -34, 20, 12 + (i % 4) * 7), box(p, 20, -34, 40 - (i % 3) * 9)])
    await route.fulfill({ json: { type: 'FeatureCollection', features, source: 'Stadt Wien – data.wien.gv.at' } })
  })
  return mock
}

/** Every image asked for. */
function watchPhotos(page) {
  const urls = []
  page.on('request', (r) => { if (r.url().includes('/api/photo/')) urls.push(r.url()) })
  return urls
}

/** To the comparison of two routes. photos: the provider ('none' is what ships). */
async function toRoutes(page, { theme = 'dark', phone = false, photos = 'none' } = {}) {
  await openRoutes(page, theme, { photos })
  const { a, b } = routeClicks(page.viewportSize(), phone)
  await page.mouse.click(a.x, a.y)
  await page.mouse.click(b.x, b.y)
  if (phone) await page.getByRole('tab', { name: /Settings/ }).click()
  await page.getByRole('button', { name: 'Analyse the routes' }).click()
  await expect(page.getByRole('button', { name: 'Walk route B' })).toBeVisible()
}

/** Take the photos off one street of the routes (the app's state), so a stretch has none. */
const noPhotosOn = (page, id) => page.evaluate((segment) => {
  const routes = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('routes')
  const next = new Map(routes.segments)
  const f = next.get(segment)
  next.set(segment, { ...f, properties: { ...f.properties, photos: [] } })
  routes.segments = next
}, id)

const camera = (page) => page.evaluate(() => {
  const m = window.__sencityMap
  return { pitch: m.getPitch(), zoom: m.getZoom(), bearing: m.getBearing() }
})
const settle = (page) => page.waitForFunction(() => !window.__sencityMap.isMoving(), null, { timeout: 10_000 })

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })

  test('walk the easiest route at eye level, stretch by stretch, then back to the comparison', async ({ page }) => {
    await mockRoutes(page)
    const buildings = await mockBuildings(page)
    await toRoutes(page)
    const photoUrls = watchPhotos(page)
    await expect(page.getByRole('button', { name: 'Walk A' })).toBeVisible()
    await page.screenshot({ path: 'e2e/screens/walk/0-route-card.png' })

    await page.getByRole('button', { name: 'Walk route B' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Walking route B' })).toContainText('easiest thermal, summer 15:00')
    await settle(page)
    const eye = await camera(page)
    expect(eye.pitch).toBeGreaterThan(80) // eye level, looking along the street
    expect(eye.zoom).toBeGreaterThan(22)
    expect(buildings.requests).toHaveLength(1)

    // Left: the legend only, read only; the settings are fixed for the walk.
    const legend = page.locator('[data-panel="layers"]')
    await expect(legend).toContainText('Summer, 15:00. To change the layer, season or time, exit the walk.')
    await expect(legend.getByRole('radio')).toHaveCount(0)
    // Navigation stays.
    await expect(page.getByRole('navigation', { name: 'Views' })).toBeVisible()

    // Centre: no photo is shown (what ships); the card under it.
    await expect(page.getByTestId('walk-photo')).toHaveCount(0)
    const card = page.locator('[data-panel="walk-card"]')
    await expect(card).toContainText('Kuehlgasse')
    await expect(card).toContainText('180 m · about 2 min')
    const details = page.locator('#walk-details')
    await expect(details).toContainText('Might bother you')
    await expect(details).toContainText('Might feel good')
    await expect(details.getByRole('button', { name: 'Rate 1 of 5' })).toHaveAttribute('aria-disabled', 'true')

    // Right: exit, where you are, the progress, previous / play / next; no segment bar.
    const side = page.locator('[data-panel="walk-side"]')
    await expect(side.getByRole('button', { name: 'Exit walk, back to comparison' })).toBeVisible()
    await expect(side).toContainText('Where you are')
    await expect(side).toContainText(/0\.09 of 0\.6 km, 1 of 7 min/)
    await expect(side.getByRole('button', { name: 'Play' })).toBeVisible() // it opens paused
    await expect(page.locator('[data-panel="attribution"]')).toContainText('buildings: Stadt Wien – data.wien.gv.at via Infrared.city')
    await mapIdle(page)
    await page.screenshot({ path: 'e2e/screens/walk/1-walk-dark.png' })
    expect(await layoutProblems(page)).toEqual([])

    // Keys: the arrows go along the route, space plays and pauses.
    await page.locator('body').press('ArrowRight')
    await expect(card).toContainText('Marktgasse')
    await page.locator('body').press('ArrowLeft')
    await expect(card).toContainText('Kuehlgasse')
    await page.locator('body').press('Space')
    await expect(side.getByRole('button', { name: 'Pause' })).toBeVisible()
    await page.locator('body').press('Space')
    await expect(side.getByRole('button', { name: 'Play' })).toBeVisible()

    // Where you are: each stretch can be jumped to (a button for the keyboard too).
    const third = side.getByRole('button', { name: /stretch 3 of 3/ })
    await third.focus()
    await third.press('Enter')
    await expect(card).toContainText('Kuehlgasse')
    await expect(side.getByRole('button', { name: 'Next stretch' })).toHaveAttribute('aria-disabled', 'true')

    // No Street View image was asked for: nothing next to a map.
    expect(photoUrls).toHaveLength(0)

    await side.getByRole('button', { name: 'Exit walk, back to comparison' }).click()
    await expect(page.locator('[data-panel="route-card"]')).toContainText('Which way feels better?')
    await settle(page)
    expect((await camera(page)).pitch).toBe(0)
  })

  test('a stretch with no photo shows the 3D street and says so', async ({ page }) => {
    await mockRoutes(page)
    await mockBuildings(page)
    await toRoutes(page)
    await noPhotosOn(page, 'b2')
    await page.getByRole('button', { name: 'Walk route B' }).click()
    await page.locator('body').press('ArrowRight')
    await expect(page.getByTestId('walk-no-photo')).toHaveText('No photo for this stretch, rated from the map.')
    await settle(page)
    await mapIdle(page)
    await page.screenshot({ path: 'e2e/screens/walk/2-no-photo.png' })
  })

  test('with Street View the photo faces along the route and the camera looks the same way', async ({ page }) => {
    await mockRoutes(page)
    await mockBuildings(page)
    await toRoutes(page, { photos: 'streetview' })
    await page.getByRole('button', { name: 'Walk route B' }).click()
    const photo = page.getByTestId('walk-photo')
    await expect(photo).toBeVisible()
    await expect(photo).toContainText('© Google')
    await expect(photo.getByRole('button')).toHaveCount(0) // no enlarge, no arrows
    await settle(page)
    const heading = await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('walk').photo.heading)
    const { bearing } = await camera(page)
    expect(Math.abs(((((bearing - heading) % 360) + 540) % 360) - 180)).toBeLessThan(1)
    await mapIdle(page)
    await page.screenshot({ path: 'e2e/screens/walk/3-walk-streetview.png' })
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
  })

  test('Esc and Area leave the walk; focus goes back to its button', async ({ page }) => {
    await mockRoutes(page)
    await mockBuildings(page)
    await toRoutes(page)
    await page.getByRole('button', { name: 'Walk route B' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-panel="walk-card"]')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Walk route B' })).toBeFocused()
    await page.getByRole('button', { name: 'Walk route B' }).click()
    await page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: 'Area' }).click()
    await expect(page.locator('[data-panel="walk-card"]')).toHaveCount(0)
  })
})

test.describe('reduced motion', () => {
  test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', reducedMotion: 'reduce' })

  test('jumps between stretches instead of gliding', async ({ page }) => {
    await mockRoutes(page)
    await mockBuildings(page)
    await toRoutes(page)
    await page.getByRole('button', { name: 'Walk route B' }).click()
    await expect(page.locator('[data-panel="walk-card"]')).toContainText('Kuehlgasse')
    expect(await page.evaluate(() => window.__sencityMap.isMoving())).toBe(false)
    await page.getByRole('button', { name: 'Next stretch' }).click()
    expect(await page.evaluate(() => window.__sencityMap.isMoving())).toBe(false)
    expect((await camera(page)).pitch).toBeGreaterThan(80)
  })
})

test.describe('light', () => {
  test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })

  test('the walk in light mode', async ({ page }) => {
    await mockRoutes(page)
    await mockBuildings(page)
    await toRoutes(page, { theme: 'light' })
    await page.getByRole('button', { name: 'Walk route B' }).click()
    await settle(page)
    await mapIdle(page)
    await page.screenshot({ path: 'e2e/screens/walk/4-walk-light.png' })
    expect(await layoutProblems(page)).toEqual([])
  })
})

for (const theme of ['dark', 'light']) {
  test.describe(`phone, ${theme}`, () => {
    test.use({ viewport: { width: 390, height: 844 }, colorScheme: theme, hasTouch: true })

    test('the walk in the sheet, with the tab bar', async ({ page }) => {
      await mockRoutes(page)
      await mockBuildings(page)
      await toRoutes(page, { theme, phone: true, photos: 'streetview' })
      await page.getByRole('button', { name: 'Walk route B' }).click()
      const sheet = page.locator('[data-panel="sheet"]')
      await expect(sheet.getByRole('button', { name: 'Exit walk, back to comparison' })).toBeInViewport()
      await expect(sheet.getByRole('group', { name: 'Walk controls' })).toBeVisible()
      await expect(sheet).toContainText('Might feel good')
      await expect(page.getByRole('navigation', { name: 'Views' })).toBeVisible() // the tab bar stays
      await expect(page.getByRole('button', { name: 'Layer, season and time' })).toHaveCount(0) // no layer button
      await expect(page.getByTestId('walk-photo')).toBeVisible()
      await settle(page)
      await mapIdle(page)
      await page.screenshot({ path: `e2e/screens/walk/5-phone-${theme}.png` })
      expect(await layoutProblems(page)).toEqual([])
      await sheet.getByRole('button', { name: 'Exit walk, back to comparison' }).click()
      await expect(page.getByRole('button', { name: 'Walk route B' })).toBeVisible()
    })
  })
}
