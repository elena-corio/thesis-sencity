// Area and walk inputs: clicking on the map is the default; "type an address" in the hint opens the
// inputs in the left panel (or the sheet) and focuses the first empty field. Closed, the inputs are one
// row with the values and a chevron; Change clears everything and goes back to clicking.
import { expect, test } from '@playwright/test'
import { layoutProblems, mapIdle, mockArea, mockRoutes, openMap, openRoutes, placeCentre, points, routeClicks } from './helpers.js'

const PLACES = [
  { name: 'Graben', detail: 'Innere Stadt, Wien', lat: 48.2086, lon: 16.3695, kind: 'pedestrian' },
  { name: 'Linz', detail: 'Oberösterreich', lat: 48.3064, lon: 14.2861, kind: 'city' },
]
const mockSearch = (page) => page.route('**/api/search', (route) => {
  const q = route.request().postDataJSON().q
  return route.fulfill({ json: { results: PLACES.filter((p) => p.name.startsWith(q.slice(0, 3))) } })
})
const inputs = (page) => page.getByTestId('inputs')
const mapCentre = (page) => page.evaluate(() => window.__sencityMap.getCenter())

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })

  test('area: type an address sets the centre; a city only moves the map; Change clears it', async ({ page }) => {
    await mockArea(page)
    await mockSearch(page)
    await openMap(page, 'dark')
    // Nothing set: no inputs, only the hint with the link.
    await expect(inputs(page)).toHaveCount(0)
    await expect(page.getByText('Click to place the centre of your area,')).toBeVisible()
    await page.getByRole('button', { name: 'type an address' }).click()
    const centre = page.getByRole('combobox', { name: 'Centre' })
    await expect(centre).toBeFocused()
    await expect(inputs(page).getByRole('button', { name: 'Choose an area' })).toHaveAttribute('aria-expanded', 'true')

    // A city only moves the map: no centre is set.
    const before = await mapCentre(page)
    await centre.fill('Linz')
    await page.getByRole('option', { name: /Linz/ }).click()
    await expect.poll(async () => (await mapCentre(page)).lng).not.toBeCloseTo(before.lng, 1)
    await expect(page.getByText('Click to place the centre of your area,')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Analyse this area' })).toBeDisabled()

    // An address or a named place sets the centre, with the radius chosen (200 m by default).
    await centre.fill('Graben')
    await page.getByRole('option', { name: /Graben/ }).click()
    await expect(page.getByRole('button', { name: 'Analyse this area' })).toBeEnabled()
    await expect(inputs(page)).toContainText('Graben · 200 m')
    await inputs(page).getByRole('radio', { name: '500 m' }).click()
    await expect(inputs(page)).toContainText('Graben · 500 m')
    // The estimate follows the current values.
    await expect(inputs(page)).toContainText('About 1460 street photos, thermal for summer, 15:00. Ready in about a minute.')
    await mapIdle(page)
    expect(await layoutProblems(page)).toEqual([])
    await page.screenshot({ path: 'e2e/screens/inputs-dark-area-typed.png' })

    // Before analysis the right side is empty, and Start again is gone (Change does the same).
    const card = page.locator('[data-panel="area-card"]')
    await expect(card).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Start again' })).toHaveCount(0)

    // Change clears the centre and radius at once and goes back to clicking, with the first hint.
    await page.getByRole('button', { name: 'Change area: clear the centre and radius' }).click()
    await expect(page.getByText('Click to place the centre of your area,')).toBeVisible()
    await expect(inputs(page)).toHaveCount(0)
    await expect(card).toHaveCount(0)
  })

  test('area: Enter in Centre picks the suggestion, then starts the analysis', async ({ page }) => {
    await mockArea(page, { hold: true })
    await mockSearch(page)
    await openMap(page, 'dark')
    await page.getByRole('button', { name: 'type an address' }).click()
    const centre = page.getByRole('combobox', { name: 'Centre' })
    await centre.press('Enter') // nothing set: nothing happens
    await expect(page.locator('[data-panel="loading-card"]')).toHaveCount(0)
    await centre.fill('Graben')
    await expect(page.getByRole('option', { name: /Graben/ })).toBeVisible()
    await centre.press('Enter') // picks the suggestion
    await expect(page.getByRole('button', { name: 'Analyse this area' })).toBeEnabled()
    await expect(page.locator('[data-panel="loading-card"]')).toHaveCount(0)
    await centre.press('Enter') // starts
    await expect(page.locator('[data-panel="loading-card"]')).toContainText('Loading this area')
  })

  test('area: after clicking on the map the inputs are one closed row that opens', async ({ page }) => {
    await mockArea(page)
    await openMap(page, 'dark')
    const p = points(page.viewportSize())
    await placeCentre(page, p)
    await page.mouse.click(p.edge.x, p.edge.y)
    await expect(page.getByText('Area set.')).toBeVisible()
    const row = inputs(page).getByRole('button', { name: /° N, .* · \d+ m$/ })
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    // One line, however long the value (board G3); the whole value stays readable in the tooltip.
    const text = row.locator('.text')
    await expect(text).toHaveAttribute('title', /° N, .* · \d+ m$/)
    const { height, line } = await text.evaluate((el) => {
      const r = document.createRange()
      r.selectNodeContents(el)
      return { height: r.getBoundingClientRect().height, line: parseFloat(getComputedStyle(el).lineHeight) || 24 }
    })
    expect(height).toBeLessThan(line * 1.5)
    await expect(page.getByRole('combobox', { name: 'Centre' })).toBeHidden()
    await row.click()
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('combobox', { name: 'Centre' })).toBeVisible()
    // The radius set by the mouse is offered next to 100, 200 and 500 m, and chosen.
    const radii = inputs(page).getByRole('radiogroup', { name: 'Radius' }).getByRole('radio')
    await expect(radii).toHaveCount(4)
    await expect(radii.first()).toHaveText('100 m')
    await expect(inputs(page).locator('[aria-checked="true"]')).toHaveCount(1)
  })

  test('routes: no step card or extra sentence while choosing; a focused field takes the next click', async ({ page }) => {
    await mockRoutes(page)
    await openRoutes(page, 'dark')
    await expect(page.locator('[data-panel="route-card"]')).toHaveCount(0)
    await expect(page.getByText('SenCity finds two ways')).toHaveCount(0)
    await expect(page.getByText('Click where you start,')).toBeVisible()
    const { a, b } = routeClicks(page.viewportSize())
    await page.mouse.click(a.x, a.y)
    await expect(page.getByText('Now click where you want to go,')).toBeVisible()
    await expect(inputs(page)).toContainText(/\d+\.\d+° N, \d+\.\d+° E → …/)
    await page.mouse.click(b.x, b.y)
    await expect(page.getByRole('button', { name: 'Analyse the routes' })).toBeEnabled()
    await expect(page.locator('[data-panel="route-card"]')).toHaveCount(0)

    // Open the row, focus Start: the next map click moves the start, not a new point.
    await inputs(page).getByRole('button', { name: /^\d+\.\d+° N, \d+\.\d+° E → \d+\.\d+° N, \d+\.\d+° E$/ }).click()
    const startPin = page.getByTestId('route-start')
    const was = await startPin.boundingBox()
    await page.getByRole('combobox', { name: 'Start' }).focus()
    await page.mouse.click(a.x, a.y + 120)
    await expect.poll(async () => Math.round((await startPin.boundingBox()).y - was.y)).toBeGreaterThan(100)
    await expect(page.getByTestId('route-end')).toBeVisible()

    // Change clears both points at once.
    await page.getByRole('button', { name: 'Change walk: clear the start and end' }).click()
    await expect(startPin).toHaveCount(0)
    await expect(page.getByText('Click where you start,')).toBeVisible()
  })
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, colorScheme: 'light', hasTouch: true, isMobile: true })

  test('"type an address" opens the inputs in the sheet, open, with Centre focused', async ({ page }) => {
    await mockArea(page)
    await mockSearch(page)
    await openMap(page, 'light')
    await page.getByRole('button', { name: 'type an address' }).tap()
    const sheet = page.locator('[data-panel="area-card"]')
    await expect(sheet).toContainText('Choose an area')
    await expect(sheet.getByRole('combobox', { name: 'Centre' })).toBeFocused()
    await sheet.getByRole('combobox', { name: 'Centre' }).fill('Graben')
    await page.getByRole('option', { name: /Graben/ }).tap()
    await expect(sheet.getByRole('button', { name: 'Analyse this area' })).toBeVisible()
    await expect(sheet.getByRole('combobox', { name: 'Centre' })).toBeVisible() // still open in the sheet
    await mapIdle(page)
    expect(await layoutProblems(page)).toEqual([])
    await page.screenshot({ path: 'e2e/screens/inputs-light-phone-sheet.png' })
  })

  test('routes: the hint says what to do while choosing (no card)', async ({ page }) => {
    await mockRoutes(page)
    await openRoutes(page, 'light')
    await expect(page.getByText('Tap where you start,')).toBeVisible()
    await expect(page.getByText('to place the centre')).toHaveCount(0)
    await expect(page.locator('[data-panel="route-card"]')).toHaveCount(0)
  })

  test('routes work like the area: search bar on top, "type an address" opens the sheet with the inputs', async ({ page }) => {
    await mockRoutes(page)
    await mockSearch(page)
    await openRoutes(page, 'light')
    // The same top bar as in Area: the search only moves the map; no Start and End up there.
    await expect(page.getByRole('combobox', { name: 'Search a street or place' })).toBeVisible()
    await expect(page.locator('#route-start-phone-input')).toHaveCount(0)
    await page.getByRole('button', { name: 'type an address' }).tap()
    const sheet = page.locator('[data-panel="route-card"]')
    await expect(sheet).toContainText('Choose a walk')
    const start = sheet.getByRole('combobox', { name: 'Start' })
    await expect(start).toBeFocused()
    await start.fill('Graben')
    await page.getByRole('option', { name: /Graben/ }).tap()
    await expect(sheet.getByTestId('inputs')).toContainText('Graben → …')
    // The end by tapping the map: the sheet becomes "This walk", with the inputs row and Change on top.
    const { b } = routeClicks(page.viewportSize(), true)
    await page.mouse.click(b.x, 120 + b.y / 2)
    await expect(sheet).toContainText('This walk')
    await expect(sheet.getByTestId('inputs')).toContainText(/Graben → \d+\.\d+° N, \d+\.\d+° E/)
    await expect(sheet.getByRole('button', { name: 'Change walk: clear the start and end' })).toBeVisible()
    await mapIdle(page)
    expect(await layoutProblems(page)).toEqual([])
    await page.screenshot({ path: 'e2e/screens/inputs-light-phone-route-sheet.png' })
    await sheet.getByRole('button', { name: 'Change walk: clear the start and end' }).tap()
    await expect(page.getByText('Tap where you start,')).toBeVisible()
  })
})
