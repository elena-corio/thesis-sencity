// The walk along a route (Elena, 2026-11-14: a slideshow of photos, no 3D street, no turning camera), with the API
// mocked: no Overpass, Street View, Infrared.city or model calls. The Mapillary photos are placeholders. The app ships with
// Mapillary in the walk (lib/photos.js); one check runs with no photos.
import { expect, test } from '@playwright/test'
import { PHOTO, layoutProblems, mockRoutes, openRoutes, routeClicks } from './helpers.js'

/** Mock POST /api/mapillary/along: a photo at the start of every stretch, facing along it, except for the keys in `missing`. */
async function mockMapillary(page, { missing = [], panos = [] } = {}) {
  const mock = { requests: 0 }
  await page.route('**/mly-thumb/**', (route) => route.fulfill({ contentType: 'image/png', body: PHOTO }))
  // A test panorama: equirectangular, its middle looking north (pano_heading 0), so E is at 75 % and W at 25 %.
  const letters = [['S', 0], ['W', 512], ['N', 1024], ['E', 1536], ['S', 2048]]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="1024"><rect width="2048" height="1024" fill="#7a96a0"/>` +
    letters.map(([t, x]) => `<text x="${x}" y="560" font-size="160" font-family="Arial" font-weight="700" text-anchor="middle" fill="#13232a">${t}</text>`).join('') + '</svg>'
  await page.route('**/mly-pano/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: svg }))
  await page.route('**/api/mapillary/along', async (route) => {
    mock.requests++
    const { stretches } = route.request().postDataJSON()
    const toRad = (d) => (d * Math.PI) / 180
    const bearing = ([lo1, la1], [lo2, la2]) => {
      const y = Math.sin(toRad(lo2 - lo1)) * Math.cos(toRad(la2))
      const x = Math.cos(toRad(la1)) * Math.sin(toRad(la2)) - Math.sin(toRad(la1)) * Math.cos(toRad(la2)) * Math.cos(toRad(lo2 - lo1))
      return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
    }
    const photos = Object.fromEntries(stretches.map((s, i) => {
      if (missing.includes(s.key)) return [s.key, null]
      const [lon, lat] = s.coordinates[0]
      if (panos.includes(s.key)) {
        return [s.key, { id: `pano${i}`, lon, lat, heading: bearing(s.coordinates[0], s.coordinates.at(-1)), pano: true, pano_heading: 0,
          turn: 0, year: 2023, date: '2023-05-01', creator: 'bea', thumb_url: `/mly-pano/${s.key}.svg`, link: `https://www.mapillary.com/app/?pKey=pano${i}` }]
      }
      return [s.key, { id: `img${i}`, lon, lat, heading: bearing(s.coordinates[0], s.coordinates.at(-1)), year: 2024, date: '2024-06-01',
        creator: 'anna', thumb_url: `/mly-thumb/${s.key}.png`, link: `https://www.mapillary.com/app/?pKey=img${i}` }]
    }))
    await route.fulfill({ json: { photos } })
  })
  return mock
}

/** Street View images asked for (the app has none any more), and with thumbs also the Mapillary thumbnails. */
function watchPhotos(page, { thumbs = false } = {}) {
  const urls = []
  page.on('request', (r) => { if ((thumbs && r.url().includes('/mly-thumb/')) || r.url().includes('/api/photo/')) urls.push(r.url()) })
  return urls
}

/** To the comparison of two routes. photos: the provider ('mapillary' is what ships). */
async function toRoutes(page, { theme = 'dark', phone = false, photos = 'mapillary' } = {}) {
  await openRoutes(page, theme, { photos })
  const { a, b } = routeClicks(page.viewportSize(), phone)
  await page.mouse.click(a.x, a.y)
  await page.mouse.click(b.x, b.y)
  if (phone) await page.getByRole('tab', { name: /Settings/ }).click()
  await page.getByRole('button', { name: 'Analyse the routes' }).click()
  await expect(page.getByRole('button', { name: 'Walk route B' })).toBeVisible()
}

const view = (page) => page.locator('[data-panel="walk-view"]')
const card = (page) => page.locator('[data-panel="walk-card"]')

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })

  test('walk the easiest route as photos, stretch by stretch, then back to the comparison', async ({ page }) => {
    await mockRoutes(page)
    let buildings = 0
    await page.route('**/api/buildings', (route) => { buildings++; return route.abort() })
    await mockMapillary(page)
    await toRoutes(page)
    const photoUrls = watchPhotos(page)
    await page.screenshot({ path: 'e2e/screens/walk/0-route-card.png' })

    await page.getByRole('button', { name: 'Walk route B' }).click()
    const v = view(page)
    await expect(v.getByRole('status').filter({ hasText: 'Walking route B' })).toContainText('easiest thermal, summer 15:00')
    await expect(v.getByTestId('walk-count')).toHaveText('Stretch 1 of 3')
    // No 3D street: the map stays flat and no buildings are asked for.
    expect(await page.evaluate(() => window.__sencityMap.getPitch())).toBe(0)
    expect(buildings).toBe(0)

    // No left panel or route card: the walk is its own view; the key is in its right column, read only.
    await expect(page.locator('[data-panel="layers"]')).toHaveCount(0)
    await expect(page.locator('[data-panel="route-card"]')).toHaveCount(0)
    await expect(v.getByTestId('comfort-key')).toContainText('Thermal · summer, 15:00')
    await expect(v).toContainText('To change the layer, season or time, exit the walk.')
    await expect(v.getByRole('radio')).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: 'Views' })).toBeVisible()

    // The photo the stretch is rated from, credited inside its frame; the stretch's card on the right.
    const photo = page.getByTestId('walk-photo')
    await expect(photo).toBeVisible()
    await expect(photo.getByRole('link', { name: 'anna · 2024 · CC BY-SA 4.0' })).toHaveAttribute('href', 'https://www.mapillary.com/app/?pKey=img0')
    await expect(page.locator('[data-panel="attribution"]')).toContainText('photo: Mapillary')
    await expect(page.locator('[data-panel="attribution"]')).not.toContainText('buildings')
    await expect(card(page)).toContainText('Kuehlgasse')
    await expect(card(page)).toContainText('180 m · about 2 min')
    const details = page.locator('#walk-details')
    await expect(details).toContainText('Might bother you')
    await expect(details.getByRole('button', { name: 'Rate 1 of 5' })).toHaveAttribute('aria-disabled', 'true')
    await expect(v).toContainText('Where you are')
    await expect(v).toContainText(/0\.09 of 0\.6 km, 1 of 7 min/)
    await expect(v.getByRole('button', { name: 'Pause' })).toBeVisible() // it opens playing (Elena, 2026-11-11)
    await page.screenshot({ path: 'e2e/screens/walk/1-walk-dark.png' })
    expect(await layoutProblems(page)).toEqual([])

    // Keys: space pauses and plays; the arrows go along the route.
    await page.locator('body').press('Space')
    await expect(v.getByRole('button', { name: 'Play' })).toBeVisible()
    await page.locator('body').press('ArrowRight')
    await expect(card(page)).toContainText('Marktgasse')
    await expect(v.getByTestId('walk-count')).toHaveText('Stretch 2 of 3')
    await page.locator('body').press('ArrowLeft')
    await expect(card(page)).toContainText('Kuehlgasse')
    await expect(v.getByRole('button', { name: 'Previous stretch' })).toHaveAttribute('aria-disabled', 'true')

    // The mouse: the arrows beside the photo, and the route bar.
    await v.getByRole('button', { name: 'Next stretch' }).click()
    await expect(card(page)).toContainText('Marktgasse')
    const bar = v.getByRole('group', { name: /Route B, 3 stretches/ })
    await bar.locator('[data-stretch="B-2"]').click()
    await expect(v.getByTestId('walk-count')).toHaveText('Stretch 3 of 3')
    await expect(bar.locator('[data-stretch="B-2"]')).toHaveAttribute('aria-current', 'step')
    await expect(v.getByRole('button', { name: 'Next stretch' })).toHaveAttribute('aria-disabled', 'true')

    // Where you are: each stretch can be jumped to (a button for the keyboard too).
    const first = v.locator('.mini').getByRole('button', { name: /stretch 1 of 3/ })
    await first.focus()
    await first.press('Enter')
    await expect(v.getByTestId('walk-count')).toHaveText('Stretch 1 of 3')

    // No Street View image was asked for.
    expect(photoUrls).toHaveLength(0)

    await v.getByRole('button', { name: 'Exit walk, back to comparison' }).click()
    await expect(page.locator('[data-panel="route-card"]')).toContainText('Which way feels better?')
    await expect(view(page)).toHaveCount(0)
  })

  test("a stretch with no photo of its own shows its street's photo, and says so", async ({ page }) => {
    await mockRoutes(page)
    await mockMapillary(page, { missing: ['B-1'] })
    await toRoutes(page)
    await page.getByRole('button', { name: 'Walk route B' }).click()
    await expect(page.getByTestId('walk-photo')).toBeVisible()
    await expect(page.getByTestId('walk-street-photo')).toHaveCount(0)
    await page.locator('body').press('ArrowRight')
    // The photo it is rated from is shown: never a rating without its photo (Elena, 2026-11-14).
    await expect(page.getByTestId('walk-photo')).toBeVisible()
    await expect(page.getByTestId('walk-street-photo')).toHaveText("The street's photo: none along this stretch faces this way.")
    await expect(page.getByTestId('walk-no-photo')).toHaveCount(0)
  })

  test('a stretch with no photo at all says so, and has no rating', async ({ page }) => {
    await mockRoutes(page, { bare: ['b2'] })
    await mockMapillary(page, { missing: ['B-1'] })
    await toRoutes(page)
    await page.getByRole('button', { name: 'Walk route B' }).click()
    await expect(page.getByTestId('walk-photo')).toBeVisible()
    await page.locator('body').press('ArrowRight')
    await expect(page.getByTestId('walk-no-photo')).toHaveText('No photo for this stretch, so no rating.')
    await expect(page.getByTestId('walk-photo')).toHaveCount(0)
    await page.screenshot({ path: 'e2e/screens/walk/2-no-photo.png' })
  })

  test('a panorama is shown at the walk bearing', async ({ page }) => {
    await mockRoutes(page)
    await mockMapillary(page, { panos: ['A-1'] })
    await toRoutes(page)
    await page.getByRole('button', { name: 'Walk A' }).click()
    await page.locator('body').press('ArrowRight') // A-1, Heissgasse, runs east
    const pano = page.getByTestId('walk-pano')
    await expect(pano).toBeVisible()
    await expect(page.getByTestId('walk-photo').getByRole('link', { name: 'bea · 2023 · CC BY-SA 4.0' })).toBeVisible()
    // The walk runs east: E (75 % across the image) is in the middle of the frame.
    const { shift, width } = await pano.evaluate((el) => ({ shift: parseFloat(getComputedStyle(el).backgroundPositionX), width: el.clientWidth }))
    const eAt = shift + 0.75 * 4 * width
    expect(Math.abs(eAt - width / 2)).toBeLessThan(width * 0.05)
    await page.screenshot({ path: 'e2e/screens/walk/7-pano.png' })
  })

  test('with photos off, no image is loaded and the square says so', async ({ page }) => {
    await mockRoutes(page)
    const mly = await mockMapillary(page)
    await toRoutes(page, { photos: 'none' })
    const photoUrls = watchPhotos(page, { thumbs: true })
    await page.getByRole('button', { name: 'Walk route B' }).click()
    await expect(card(page)).toContainText('Kuehlgasse')
    await expect(page.getByTestId('walk-photo')).toHaveCount(0)
    await expect(page.getByTestId('walk-no-photo')).toHaveText('Photos are not shown.')
    expect(photoUrls).toHaveLength(0)
    // The stretches' photos are still found (not shown): in Senses they are the ones rated.
    await expect.poll(() => mly.requests).toBe(1)
  })

  test('Esc and Area leave the walk; focus goes back to its button', async ({ page }) => {
    await mockRoutes(page)
    await mockMapillary(page)
    await toRoutes(page)
    await page.getByRole('button', { name: 'Walk route B' }).focus()
    await page.keyboard.press('Enter')
    await expect(card(page)).toBeVisible()
    await expect(view(page).getByRole('button', { name: 'Exit walk, back to comparison' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Walk route B' })).toBeFocused()
    await page.getByRole('button', { name: 'Walk route B' }).click()
    await page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: 'Area' }).click()
    await expect(card(page)).toHaveCount(0)
  })
})

test.describe('reduced motion', () => {
  test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', reducedMotion: 'reduce' })

  test('opens paused, and steps only when asked', async ({ page }) => {
    await mockRoutes(page)
    await mockMapillary(page)
    await toRoutes(page)
    await page.getByRole('button', { name: 'Walk route B' }).click()
    await expect(card(page)).toContainText('Kuehlgasse')
    await expect(view(page).getByRole('button', { name: 'Play' })).toBeVisible()
    await view(page).getByRole('button', { name: 'Next stretch' }).click()
    await expect(card(page)).toContainText('Marktgasse')
  })
})

test.describe('light', () => {
  test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })

  test('the walk in light mode', async ({ page }) => {
    await mockRoutes(page)
    await mockMapillary(page)
    await toRoutes(page, { theme: 'light' })
    await page.getByRole('button', { name: 'Walk route B' }).click()
    await expect(page.getByTestId('walk-photo')).toBeVisible()
    await page.screenshot({ path: 'e2e/screens/walk/4-walk-light.png' })
    expect(await layoutProblems(page)).toEqual([])
  })
})

for (const theme of ['dark', 'light']) {
  test.describe(`phone, ${theme}`, () => {
    test.use({ viewport: { width: 390, height: 844 }, colorScheme: theme, hasTouch: true })

    test('the walk as one column, with the tab bar', async ({ page }) => {
      await mockRoutes(page, { bare: ['b2'] })
      await mockMapillary(page, { missing: ['B-1'] })
      await toRoutes(page, { theme, phone: true })
      await page.getByRole('button', { name: 'Walk route B' }).click()
      const v = view(page)
      await expect(v.getByRole('button', { name: 'Exit walk, back to comparison' })).toBeInViewport()
      await expect(page.getByTestId('walk-photo')).toBeInViewport()
      await expect(v.getByRole('group', { name: 'Walk controls' })).toBeVisible()
      await expect(v).toContainText('Might feel good')
      await expect(page.getByRole('navigation', { name: 'Views' })).toBeVisible() // the tab bar stays
      await expect(page.locator('[data-panel="sheet"]')).toBeHidden()
      await page.screenshot({ path: `e2e/screens/walk/5-phone-${theme}.png` })
      expect(await layoutProblems(page)).toEqual([])
      // A stretch with no photo: the square says so.
      await v.getByRole('button', { name: 'Next stretch' }).tap()
      await expect(page.getByTestId('walk-no-photo')).toHaveText('No photo for this stretch, so no rating.')
      await page.screenshot({ path: `e2e/screens/walk/6-phone-no-photo-${theme}.png` })
      await v.getByRole('button', { name: 'Exit walk, back to comparison' }).tap()
      await expect(page.getByRole('button', { name: 'Walk route B' })).toBeVisible()
    })
  })
}
