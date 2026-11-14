// The walk along a route (Elena, 2026-11-14: a slideshow of photos, no 3D street, no turning camera), with the API
// mocked: no Overpass, Street View, Infrared.city or model calls. The Mapillary photos are placeholders. Each stretch shows
// its street's photo and rating, the same as the Routes view and the stretch card. One check runs with no photos.
import { expect, test } from '@playwright/test'
import { layoutProblems, mockRoutes, openRoutes, routeClicks } from './helpers.js'

/** The walk looks nothing up (Elena, 2026-11-14: it shows the routes' own photos): count any call to the old lookup. */
async function noLookup(page) {
  const calls = { along: 0, rate: 0 }
  await page.route('**/api/mapillary/along', (route) => { calls.along++; return route.abort() })
  return calls
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
    const lookups = await noLookup(page)
    await toRoutes(page)
    const photoUrls = watchPhotos(page)
    await page.screenshot({ path: 'e2e/screens/walk/0-route-card.png' })
    // The preview: each stretch's colour on route B's bar, and the photo its stretch card shows.
    const barStates = (root) => root.locator('[data-stretch^="B-"] .fill').evaluateAll((els) => els.map((e) => e.className))
    const preview = await barStates(page.locator('[data-panel="route-card"]'))
    await page.locator('[data-stretch="B-0"]').click()
    const cardPhoto = await page.locator('[data-panel="place-card"] .photo img').getAttribute('src')
    const cardCredit = await page.locator('[data-panel="place-card"] .credit').textContent()
    await page.getByRole('button', { name: 'Back to comparison' }).click()

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
    // The same photo as the stretch card, and the same colours as the preview: nothing is looked up or rated again.
    await expect(photo.locator('img')).toHaveAttribute('src', cardPhoto)
    await expect(photo.locator('.credit')).toHaveText(cardCredit)
    expect(await barStates(v)).toEqual(preview)
    expect(lookups.along).toBe(0)
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

  test('a stretch with no photo at all says so, and has no rating', async ({ page }) => {
    await mockRoutes(page, { bare: ['b2'] })
    await noLookup(page)
    await toRoutes(page)
    await page.getByRole('button', { name: 'Walk route B' }).click()
    await expect(page.getByTestId('walk-photo')).toBeVisible()
    await page.locator('body').press('ArrowRight')
    await expect(page.getByTestId('walk-no-photo')).toHaveText('No photo for this stretch, so no rating.')
    await expect(page.getByTestId('walk-photo')).toHaveCount(0)
    await page.screenshot({ path: 'e2e/screens/walk/2-no-photo.png' })
  })

  test('with photos off, no image is loaded and the square says so', async ({ page }) => {
    await mockRoutes(page)
    const lookups = await noLookup(page)
    await toRoutes(page, { photos: 'none' })
    const photoUrls = watchPhotos(page, { thumbs: true })
    await page.getByRole('button', { name: 'Walk route B' }).click()
    await expect(card(page)).toContainText('Kuehlgasse')
    await expect(page.getByTestId('walk-photo')).toHaveCount(0)
    await expect(page.getByTestId('walk-no-photo')).toHaveText('Photos are not shown.')
    expect(photoUrls).toHaveLength(0)
    expect(lookups.along).toBe(0)
  })

  test('Esc and Area leave the walk; focus goes back to its button', async ({ page }) => {
    await mockRoutes(page)
    await noLookup(page)
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
    await noLookup(page)
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
    await noLookup(page)
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
      await noLookup(page)
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
