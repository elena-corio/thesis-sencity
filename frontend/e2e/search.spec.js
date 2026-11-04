// Search: suggestions while typing, keyboard and pointer picking, messages. /api/search is mocked.
import { expect, test } from '@playwright/test'
import { layoutProblems, openMap, placeCentre, points } from './helpers.js'

const RESULTS = [
  { name: 'Graben', detail: 'Innere Stadt, Wien, Österreich', lat: 48.2083656, lon: 16.3702037, kind: 'pedestrian',
    bbox: [[16.3691736, 48.2080464], [16.3713521, 48.2089836]] },
  { name: 'Karlsplatz', detail: 'Wieden, Wien, Österreich', lat: 48.2004, lon: 16.3698, kind: 'square' },
]

async function mockSearch(page, { results = RESULTS, status = 200 } = {}) {
  const requests = []
  await page.route('**/api/search', async (route) => {
    requests.push({ url: route.request().url(), body: route.request().postDataJSON() })
    if (status !== 200) return route.fulfill({ status, json: { detail: 'down' } })
    return route.fulfill({ json: { results } })
  })
  return requests
}

async function mapCentre(page) {
  return page.evaluate(() => {
    const c = window.__sencityMap.getCenter()
    return { lat: c.lat, lon: c.lng }
  })
}

async function waitForCentreNear(page, lat, lon) {
  await page.waitForFunction(([la, lo]) => {
    const m = window.__sencityMap
    const c = m.getCenter()
    return !m.isMoving() && Math.abs(c.lat - la) < 0.0015 && Math.abs(c.lng - lo) < 0.0025
  }, [lat, lon], { timeout: 15_000 })
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })

  test('suggestions while typing; keyboard pick moves the map', async ({ page }) => {
    const requests = await mockSearch(page)
    await openMap(page, 'dark')
    const box = page.getByRole('combobox', { name: 'Search a street or place' })

    await box.fill('Gr')
    await page.waitForTimeout(500)
    expect(requests).toHaveLength(0) // under 3 letters: no request

    await box.fill('Graben')
    await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(2)
    await expect(page.getByRole('listbox').getByRole('option').first()).toContainText('Pedestrian · Innere Stadt, Wien')
    expect(requests).toHaveLength(1) // typed fast: one request after the pause
    // The text travels in the body, never in the URL; the map centre ranks nearby places first.
    expect(requests[0].url).not.toContain('Graben')
    expect(requests[0].body.q).toBe('Graben')
    expect(requests[0].body.lat).toBeCloseTo(48.2085, 2)
    await page.screenshot({ path: 'e2e/screens/search-desktop-dark.png' })

    await box.press('ArrowDown')
    await box.press('ArrowDown')
    await expect(page.getByRole('listbox').getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true')
    await box.press('Enter')
    await expect(page.getByRole('listbox')).toBeHidden()
    await expect(box).toHaveValue('Karlsplatz')
    await waitForCentreNear(page, 48.2004, 16.3698)

    // The area is still chosen with two clicks.
    await expect(page.getByText('Click to place the centre')).toBeVisible()
  })

  test('pointer pick of a street fits its extent', async ({ page }) => {
    await mockSearch(page)
    await openMap(page, 'light')
    await page.getByRole('combobox', { name: /search/i }).fill('Graben')
    await page.getByRole('option', { name: /Graben/ }).click()
    await waitForCentreNear(page, 48.2085, 16.3703)
    const c = await mapCentre(page)
    expect(c.lat).toBeGreaterThan(48.2075)
  })

  test('Esc closes the list, then clears the text; it never resets the area', async ({ page }) => {
    await mockSearch(page)
    await openMap(page, 'dark')
    const p = points(page.viewportSize())
    await placeCentre(page, p)
    await page.mouse.click(p.edge.x, p.edge.y)
    await expect(page.getByRole('button', { name: 'Analyse this area' })).toBeVisible()

    const box = page.getByRole('combobox', { name: /search/i })
    await box.fill('Graben')
    await expect(page.getByRole('listbox')).toBeVisible()
    await box.press('Escape')
    await expect(page.getByRole('listbox')).toBeHidden()
    await expect(box).toHaveValue('Graben')
    await box.press('Escape')
    await expect(box).toHaveValue('')
    await expect(page.getByRole('button', { name: 'Analyse this area' })).toBeVisible()
  })

  test('no results and errors say what to do', async ({ page }) => {
    await mockSearch(page, { results: [] })
    await openMap(page, 'dark')
    await page.getByRole('combobox', { name: /search/i }).fill('Xyzzyplatz')
    await expect(page.getByRole('status').filter({ hasText: 'No places found' })).toContainText('Xyzzyplatz')

    await page.unroute('**/api/search')
    await mockSearch(page, { status: 502 })
    await page.getByRole('combobox', { name: /search/i }).fill('Graben')
    await expect(page.getByText('Search is not available right now.')).toBeVisible()
  })
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, colorScheme: 'light', hasTouch: true, isMobile: true })

  test('tap a suggestion; the list fits the screen', async ({ page }) => {
    await mockSearch(page)
    await openMap(page, 'light')
    await page.getByRole('combobox', { name: /search/i }).tap()
    await page.getByRole('combobox', { name: /search/i }).fill('Graben')
    await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(2)
    expect(await layoutProblems(page)).toEqual([])
    await page.screenshot({ path: 'e2e/screens/search-phone-light.png' })
    await page.getByRole('option', { name: /Karlsplatz/ }).tap()
    await waitForCentreNear(page, 48.2004, 16.3698)
  })
})
