// Mapillary photos on the place and stretch cards (Elena, 2026-11-11), with the API mocked: one photo per street, asked
// for in the background once the area has loaded (or when its card opens first); no Street View image is fetched; the
// credit links to the image page.
import { expect, test } from '@playwright/test'
import { AREA, PHOTO, WITH_3, WITHOUT, analyseCentre, mapIdle, mockArea, mockRoutes, openMap, openRoutes, openSegment, routeClicks } from './helpers.js'

/** Mock POST /api/mapillary/along: a photo for every key, except those in `missing`. */
async function mockCardPhotos(page, { missing = [] } = {}) {
  const asked = []
  await page.route('**/mly-thumb/**', (route) => route.fulfill({ contentType: 'image/png', body: PHOTO }))
  await page.route('**/api/mapillary/along', async (route) => {
    const { stretches } = route.request().postDataJSON()
    asked.push(...stretches.map((s) => `${s.key}:${s.kind}`))
    const photos = Object.fromEntries(stretches.map((s) => [s.key, missing.includes(s.key) ? null : {
      id: `m-${s.key}`, lon: s.coordinates[0][0], lat: s.coordinates[0][1], heading: 40, pano: false, pano_heading: null, turn: 3,
      year: 2022, date: '2022-05', creator: 'carla', thumb_url: `/mly-thumb/${s.key}.png`, link: `https://www.mapillary.com/app/?pKey=m-${s.key}`,
    }]))
    await route.fulfill({ json: { photos } })
  })
  return asked
}

function watchStreetView(page) {
  const urls = []
  page.on('request', (r) => { if (r.url().includes('/api/photo/')) urls.push(r.url()) })
  return urls
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })

  test('the photos of an area come in the background; a card then opens with its photo, credited and linked', async ({ page }) => {
    await mockArea(page)
    const asked = await mockCardPhotos(page)
    await openMap(page, 'dark', { photos: 'mapillary' })
    const streetView = watchStreetView(page)
    await analyseCentre(page)
    await mapIdle(page)
    // Every street of the area, once, in batches: streets either way along them, parks and squares in any direction.
    await expect.poll(() => new Set(asked).size).toBe(AREA.features.length)
    expect(asked).toContain(`${WITH_3.properties.id}:street`)
    const before = asked.length

    await openSegment(page, WITH_3.properties.id)
    const card = page.locator('[data-panel="place-card"]')
    const credit = card.getByRole('link', { name: 'carla · 2022 · CC BY-SA 4.0' })
    await expect(credit).toHaveAttribute('href', `https://www.mapillary.com/app/?pKey=m-${WITH_3.properties.id}`)
    await expect(card.locator('.photo img')).toHaveJSProperty('complete', true)
    expect(asked).toHaveLength(before) // the card had its photo already
    await mapIdle(page)
    await page.screenshot({ path: 'e2e/screens/cards-mapillary/1-place-card.png' })

    await card.getByRole('button', { name: 'Enlarge photo', exact: true }).click()
    const viewer = page.locator('[data-viewer]')
    await expect(viewer.getByRole('link', { name: 'carla · 2022 · CC BY-SA 4.0' })).toBeVisible()
    await page.screenshot({ path: 'e2e/screens/cards-mapillary/2-enlarged.png' })
    await page.keyboard.press('Escape')

    // The same street again: no new request.
    await openSegment(page, WITH_3.properties.id)
    expect(asked).toHaveLength(before)
    expect(streetView).toHaveLength(0) // no Street View image next to the map
  })

  test('a street with no Mapillary photo says No photo', async ({ page }) => {
    await mockArea(page)
    await mockCardPhotos(page, { missing: [WITH_3.properties.id] })
    await openMap(page, 'dark', { photos: 'mapillary' })
    await analyseCentre(page)
    await openSegment(page, WITH_3.properties.id)
    const card = page.locator('[data-panel="place-card"]')
    await expect(card.locator('.photo.empty')).toContainText('No photo')
    // It still has Street View photos, so it is not "no street photo here yet".
    await expect(card).not.toContainText('No street photo here yet')
  })

  test('a street without any photo still says so', async ({ page }) => {
    await mockArea(page)
    await mockCardPhotos(page, { missing: [WITHOUT.properties.id] })
    await openMap(page, 'dark', { photos: 'mapillary' })
    await analyseCentre(page)
    await openSegment(page, WITHOUT.properties.id)
    await expect(page.locator('[data-panel="place-card"]')).toContainText('No street photo here yet')
  })

  test('a stretch card on Routes shows the stretch’s Mapillary photo', async ({ page }) => {
    await mockRoutes(page)
    await mockCardPhotos(page)
    await openRoutes(page, 'dark', { photos: 'mapillary' })
    const { a, b } = routeClicks(page.viewportSize())
    await page.mouse.click(a.x, a.y)
    await page.mouse.click(b.x, b.y)
    await page.getByRole('button', { name: 'Analyse the routes' }).click()
    await page.locator('[data-stretch="B-1"]').first().click()
    const card = page.locator('[data-panel="place-card"]')
    await expect(card.getByRole('link', { name: 'carla · 2022 · CC BY-SA 4.0' })).toBeVisible()
    await mapIdle(page)
    await page.screenshot({ path: 'e2e/screens/cards-mapillary/3-stretch-card.png' })
  })
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', hasTouch: true })

  test('the place sheet shows the Mapillary photo with the whole credit', async ({ page }) => {
    await mockArea(page)
    await mockCardPhotos(page)
    await openMap(page, 'dark', { photos: 'mapillary' })
    await analyseCentre(page)
    await openSegment(page, WITH_3.properties.id)
    const credit = page.locator('[data-panel="sheet"]').getByRole('link', { name: 'carla · 2022 · CC BY-SA 4.0' })
    await expect(credit).toBeVisible()
    await mapIdle(page)
    await page.screenshot({ path: 'e2e/screens/cards-mapillary/4-phone-place.png' })
  })
})
