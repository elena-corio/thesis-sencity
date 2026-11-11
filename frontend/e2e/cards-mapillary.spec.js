// Mapillary photos on the place and stretch cards (Elena, 2026-11-11), with the API mocked: each street comes with its one
// Mapillary photo from /api/area or /api/routes (no lookup from the browser), the card shows that photo, the photo the
// model rates; no Street View image is fetched; the credit links to the image page.
import { expect, test } from '@playwright/test'
import { WITH_3, WITHOUT, analyseCentre, mapIdle, mockArea, mockRoutes, openMap, openRoutes, openSegment, routeClicks } from './helpers.js'

/** Requests the cards must no longer make: a Mapillary lookup from the browser, or a Street View image. */
function watchOld(page) {
  const urls = []
  page.on('request', (r) => { if (r.url().includes('/api/photo/') || r.url().includes('/api/mapillary/along')) urls.push(r.url()) })
  return urls
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })

  test('a card opens with its street’s photo, credited and linked, with no lookup from the browser', async ({ page }) => {
    await mockArea(page)
    await openMap(page, 'dark')
    const old = watchOld(page)
    await analyseCentre(page)
    await mapIdle(page)

    await openSegment(page, WITH_3.properties.id)
    const card = page.locator('[data-panel="place-card"]')
    const first = WITH_3.properties.photos[0]
    const credit = card.getByRole('link', { name: `carla · ${first.year} · CC BY-SA 4.0` })
    await expect(credit).toHaveAttribute('href', first.link)
    await expect(card.locator('.photo img')).toHaveJSProperty('complete', true)
    await expect(card.locator('.photo img')).toHaveAttribute('src', first.thumb_url)
    await mapIdle(page)
    await page.screenshot({ path: 'e2e/screens/cards-mapillary/1-place-card.png' })

    await card.getByRole('button', { name: 'Enlarge photo', exact: true }).click()
    const viewer = page.locator('[data-viewer]')
    await expect(viewer.getByRole('link', { name: `carla · ${first.year} · CC BY-SA 4.0` })).toBeVisible()
    await page.screenshot({ path: 'e2e/screens/cards-mapillary/2-enlarged.png' })
    await page.keyboard.press('Escape')
    expect(old).toHaveLength(0)
  })

  test('a street with no Mapillary photo says so', async ({ page }) => {
    await mockArea(page)
    await openMap(page, 'dark')
    await analyseCentre(page)
    await openSegment(page, WITHOUT.properties.id)
    await expect(page.locator('[data-panel="place-card"]')).toContainText('No street photo here yet')
  })

  test('a stretch card on Routes shows its street’s photo', async ({ page }) => {
    await mockRoutes(page)
    await openRoutes(page, 'dark')
    const old = watchOld(page)
    const { a, b } = routeClicks(page.viewportSize())
    await page.mouse.click(a.x, a.y)
    await page.mouse.click(b.x, b.y)
    await page.getByRole('button', { name: 'Analyse the routes' }).click()
    await page.locator('[data-stretch="B-1"]').first().click()
    const card = page.locator('[data-panel="place-card"]')
    await expect(card.getByRole('link', { name: /carla · \d{4} · CC BY-SA 4\.0/ })).toBeVisible()
    await mapIdle(page)
    await page.screenshot({ path: 'e2e/screens/cards-mapillary/3-stretch-card.png' })
    expect(old).toHaveLength(0)
  })
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', hasTouch: true })

  test('the place sheet shows the Mapillary photo with the whole credit', async ({ page }) => {
    await mockArea(page)
    await openMap(page, 'dark')
    await analyseCentre(page)
    await openSegment(page, WITH_3.properties.id)
    const credit = page.locator('[data-panel="sheet"]').getByRole('link', { name: `carla · ${WITH_3.properties.photos[0].year} · CC BY-SA 4.0` })
    await expect(credit).toBeVisible()
    await mapIdle(page)
    await page.screenshot({ path: 'e2e/screens/cards-mapillary/4-phone-place.png' })
  })
})
