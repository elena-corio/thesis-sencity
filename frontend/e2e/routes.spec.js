// Routes (brief §3, boards Routes 1–4, phone P3), with the API mocked: no Overpass, Street View or
// Infrared.city calls. Also the fit check for every view of Routes at every size.
import { expect, test } from '@playwright/test'
import { layoutProblems, mapIdle, mockRoutes, openRoutes, routeClicks } from './helpers.js'

const analyse = (page) => page.getByRole('button', { name: 'Analyse this walk' }).click()

const card = (page) => page.locator('[data-panel="route-card"]')
const stretch = (page) => page.locator('[data-panel="place-card"]')

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })

  test('choose start and end, see two ways, open a stretch', async ({ page }) => {
    const mock = await mockRoutes(page)
    await openRoutes(page, 'dark')
    await expect(page.getByRole('link', { name: 'Routes' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByText('Click where you start')).toBeVisible()
    await page.screenshot({ path: 'e2e/screens/routes/0-start.png' })

    const { a, b } = routeClicks(page.viewportSize())
    await page.mouse.click(a.x, a.y)
    await expect(page.getByText('Now click where you want to go')).toBeVisible()
    // The inputs are one closed row in the left panel: the clicked point's coordinates, then "…".
    await expect(page.getByTestId('inputs')).toContainText(/\d+\.\d+° N, \d+\.\d+° E → …/)
    await expect(page.locator('body')).not.toContainText('Clicked point')
    await expect(page.getByTestId('route-start')).toBeVisible()
    await page.screenshot({ path: 'e2e/screens/routes/1-start-set.png' })
    expect(mock.requests).toHaveLength(0) // nothing is asked for one point

    await page.mouse.click(b.x, b.y)

    // Both points set: a preview, and nothing is asked for until Analyse.
    await expect(card(page)).toContainText('This walk')
    await expect(card(page)).toContainText('in a straight line')
    await expect(card(page)).toContainText('Thermal for summer, 15:00')
    await expect(page.getByTestId('route-end')).toBeVisible()
    await expect(page.getByText('Walk set.')).toBeVisible()
    await mapIdle(page)
    await page.screenshot({ path: 'e2e/screens/routes/1b-preview.png' })
    expect(mock.requests).toHaveLength(0)
    // No legend before the routes are ready; then it is the last block of the panel.
    await expect(page.locator('[data-panel="layers"] [aria-label="Legend"]')).toHaveCount(0)
    await analyse(page)

    await expect(card(page)).toContainText('Which way feels better?')
    await expect(card(page)).toContainText('hard 40%')
    await expect(page.locator('[data-panel="layers"] [aria-label="Legend"]')).toContainText('Thermal comfort °C')
    await expect(card(page)).toContainText('hard 0%')
    await expect(card(page)).toContainText('avoids the hot stretch on Heissgasse')
    await expect(card(page)).toContainText('Predictions, not reasons')
    await expect(card(page)).not.toContainText('persona')
    await expect(page.getByRole('button', { name: /Route A, shortest/ })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('[data-route="A"] .section')).toHaveCount(5)
    await expect(page.locator('[data-route="B"] .section')).toHaveCount(3)
    await mapIdle(page)
    await page.screenshot({ path: 'e2e/screens/routes/3-result.png' })

    // The points and the limits travel in the body; the URL has nothing in it.
    expect(mock.requests).toHaveLength(1)
    expect(mock.requests[0].limits).toEqual({ heat: [26, 32], cold: [9, -13] })
    expect(mock.urls[0]).toMatch(/\/api\/routes$/)

    // A section of a bar opens the stretch.
    await page.locator('[data-stretch="A-1"]').click()
    await expect(stretch(page)).toContainText('Route A · stretch 2 of 5')
    await expect(stretch(page)).toContainText('Back to comparison')
    await expect(stretch(page)).toContainText('Hard')
    await expect(page.locator('[data-stretch="A-1"]')).toHaveAttribute('aria-pressed', 'true')
    await mapIdle(page)
    await page.screenshot({ path: 'e2e/screens/routes/4-stretch.png' })

    // Arrow keys and the buttons step along the same route.
    await page.keyboard.press('ArrowRight')
    await expect(stretch(page)).toContainText('stretch 3 of 5')
    await page.getByRole('button', { name: 'Previous stretch' }).click()
    await expect(stretch(page)).toContainText('stretch 2 of 5')
    await page.keyboard.press('Escape')
    await expect(card(page)).toContainText('Which way feels better?')
  })

  test('clicking a stretch on the map selects it', async ({ page }) => {
    await mockRoutes(page)
    await openRoutes(page, 'dark')
    const { a, b } = routeClicks(page.viewportSize())
    await page.mouse.click(a.x, a.y)
    await page.mouse.click(b.x, b.y)
    await analyse(page)
    await expect(card(page)).toContainText('Which way feels better?')
    await page.waitForTimeout(600)
    await mapIdle(page)
    const px = await page.evaluate(() => {
      const m = window.__sencityMap
      const f = m.queryRenderedFeatures({ layers: ['sc-route-a'] }).find((x) => x.properties.key === 'A-2')
      const c = f.geometry.coordinates
      const q = m.project([(c[0][0] + c[1][0]) / 2, (c[0][1] + c[1][1]) / 2])
      return { x: q.x, y: q.y }
    })
    await page.mouse.click(px.x, px.y)
    await expect(stretch(page)).toContainText('stretch 3 of 5')
    await expect(page.locator('.ring')).toBeVisible()
  })

  test('every street of a route can be selected, also next to one in the same state', async ({ page }) => {
    await mockRoutes(page, { sameState: true })
    await openRoutes(page, 'dark')
    const { a, b } = routeClicks(page.viewportSize())
    await page.mouse.click(a.x, a.y)
    await page.mouse.click(b.x, b.y)
    await analyse(page)
    await expect(page.locator('[data-route="B"] .section')).toHaveCount(4)
    await expect(page.locator('[data-route="B"] .section.change')).toHaveCount(1) // one gap, where the state changes
    await page.locator('[data-stretch="B-1"]').click()
    await expect(stretch(page)).toContainText('Route B · stretch 2 of 4')
    await expect(stretch(page)).toContainText('Kuehlgasse')
    await page.keyboard.press('ArrowRight')
    await expect(stretch(page)).toContainText('stretch 3 of 4')
    await expect(stretch(page)).toContainText('Marktgasse')
  })

  for (const name of ['Stephansplatz', 'Schwarzenbergstraße', 'Dr.-Karl-Lueger-Platz', 'Donaudampfschifffahrtsgesellschaftsstraße']) {
    test(`a long name is never cut: ${name}`, async ({ page }) => {
      await mockRoutes(page, { longName: name })
      await openRoutes(page, 'dark')
      const { a, b } = routeClicks(page.viewportSize())
      await page.mouse.click(a.x, a.y)
      await page.mouse.click(b.x, b.y)
      await analyse(page)
      await page.locator('[data-stretch="A-0"]').click()
      const title = stretch(page).locator('h2')
      await expect(title).toHaveText(name)
      const box = await title.evaluate((el) => {
        const card = el.closest('.name').getBoundingClientRect()
        const r = document.createRange()
        r.selectNodeContents(el)
        const text = r.getBoundingClientRect()
        return { over: el.scrollWidth - el.clientWidth, right: text.right - card.right, height: text.height, overflow: getComputedStyle(el).overflow }
      })
      expect(box.over).toBeLessThanOrEqual(0)
      expect(box.right).toBeLessThanOrEqual(1)
      expect(box.overflow).toBe('visible')
      await stretch(page).screenshot({ path: `e2e/screens/routes/name-${name.slice(0, 8)}.png` })
    })
  }

  test('a route can be hidden and shown', async ({ page }) => {
    await mockRoutes(page)
    await openRoutes(page, 'dark')
    const { a, b } = routeClicks(page.viewportSize())
    await page.mouse.click(a.x, a.y)
    await page.mouse.click(b.x, b.y)
    await analyse(page)
    const btn = page.getByRole('button', { name: /Route B, easiest/ })
    await btn.click()
    await expect(btn).toHaveAttribute('aria-pressed', 'false')
    const filter = await page.evaluate(() => window.__sencityMap.getFilter('sc-route-b'))
    expect(JSON.stringify(filter)).not.toContain('"B"]]],')
    await btn.click()
    await expect(btn).toHaveAttribute('aria-pressed', 'true')
  })

  test('a point too far away is refused before anything is asked', async ({ page }) => {
    const mock = await mockRoutes(page)
    await openRoutes(page, 'dark')
    await page.evaluate(() => window.__sencityMap.jumpTo({ zoom: 11 }))
    await mapIdle(page)
    const { a, b } = routeClicks(page.viewportSize())
    await page.mouse.click(a.x, a.y)
    await page.mouse.click(b.x, b.y)
    await expect(page.locator('[data-panel="hint"]')).toContainText('Routes go up to 1.5 km for now')
    await expect(page.getByTestId('inputs')).toContainText(/\d+\.\d+° N, \d+\.\d+° E → …/)
    await expect(page.getByTestId('route-end')).toHaveCount(0)
    expect(mock.requests).toHaveLength(0)
  })

  test('loading shows the steps and no routes; Cancel goes back to the preview', async ({ page }) => {
    await mockRoutes(page, { hold: true })
    await openRoutes(page, 'dark')
    const { a, b } = routeClicks(page.viewportSize())
    await page.mouse.click(a.x, a.y)
    await page.mouse.click(b.x, b.y)
    await analyse(page)
    await expect(card(page)).toContainText('Comparing two ways')
    await expect(card(page)).toContainText('Rating for your profile')
    await expect(card(page)).not.toContainText('Finding the two ways')
    await expect(page.getByRole('radio', { name: 'Spring' })).toBeDisabled()
    await mapIdle(page)
    await page.screenshot({ path: 'e2e/screens/routes/2-loading.png' })
    const count = await page.evaluate(() => window.__sencityMap.querySourceFeatures('sc-route').length)
    expect(count).toBe(0)
    await card(page).getByRole('button', { name: 'Cancel', exact: true }).last().click()
    await expect(card(page)).toContainText('This walk')
    await expect(page.getByTestId('inputs')).toContainText(/\d+\.\d+° N, \d+\.\d+° E → \d+\.\d+° N, \d+\.\d+° E/)
    // Change clears both points at once and goes back to clicking, with the first hint.
    await page.getByRole('button', { name: /^Change walk/ }).click()
    await expect(page.getByText('Click where you start')).toBeVisible()
    await expect(card(page)).toHaveCount(0)
    await expect(page.getByTestId('inputs')).toHaveCount(0)
    await expect(page.getByTestId('route-start')).toHaveCount(0)
  })

  test('thermal failing says why and offers Try again', async ({ page }) => {
    const mock = await mockRoutes(page, { thermal: 'error' })
    await openRoutes(page, 'dark')
    const { a, b } = routeClicks(page.viewportSize())
    await page.mouse.click(a.x, a.y)
    await page.mouse.click(b.x, b.y)
    await analyse(page)
    await expect(card(page)).toContainText('No weather station near this area')
    await page.screenshot({ path: 'e2e/screens/routes/2b-error.png' })
    mock.thermal = true
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(card(page)).toContainText('Which way feels better?')
  })

  test('no way found at the last step: the message, and no finished row marked as failed', async ({ page }) => {
    await mockRoutes(page, { thermal: 'route-error' })
    await openRoutes(page, 'dark')
    const { a, b } = routeClicks(page.viewportSize())
    await page.mouse.click(a.x, a.y)
    await page.mouse.click(b.x, b.y)
    await analyse(page)
    await expect(card(page)).toContainText('No walking way was found')
    await expect(card(page).locator('.steps li.failed')).toHaveCount(0)
    await expect(card(page).locator('.steps li.done')).toHaveCount(3)
  })

  test('a new season asks again; if it fails the old ways stay', async ({ page }) => {
    const mock = await mockRoutes(page)
    await openRoutes(page, 'dark')
    const { a, b } = routeClicks(page.viewportSize())
    await page.mouse.click(a.x, a.y)
    await page.mouse.click(b.x, b.y)
    // The window can still change in the preview, and that asks for nothing.
    await page.getByRole('radio', { name: 'Autumn' }).click()
    await page.getByRole('radio', { name: 'Summer' }).click()
    expect(mock.requests).toHaveLength(0)
    await analyse(page)
    await expect(card(page)).toContainText('hard 40%')
    await page.getByRole('radio', { name: 'Winter' }).click()
    await expect.poll(() => mock.requests.at(-1).season).toBe('winter')
    await expect(page.getByRole('radio', { name: 'Winter' })).toHaveAttribute('aria-checked', 'true')

    mock.thermal = 'error'
    await page.getByRole('radio', { name: 'Spring' }).click()
    await expect(card(page)).toContainText('No weather station')
    await expect(card(page)).toContainText('Which way feels better?')
    await expect(page.getByRole('radio', { name: 'Winter' })).toHaveAttribute('aria-checked', 'true')
  })

  test('a request the API cannot read shows a plain message, not its field errors', async ({ page }) => {
    // What an API older than the app answers: 422 with a list of field errors (as FastAPI sends them).
    await mockRoutes(page)
    await page.route('**/api/routes', (route) => route.fulfill({
      status: 422, contentType: 'application/json',
      body: JSON.stringify({ detail: [{ type: 'too_short', loc: ['body', 'limits', 'heat'], msg: 'List should have at least 3 items' },
        { type: 'too_short', loc: ['body', 'limits', 'cold'], msg: 'List should have at least 4 items' }] }),
    }))
    await openRoutes(page, 'dark')
    const { a, b } = routeClicks(page.viewportSize())
    await page.mouse.click(a.x, a.y)
    await page.mouse.click(b.x, b.y)
    await analyse(page)
    await expect(card(page)).toContainText('Could not find the two ways. Check that the API is running, then try again.')
    await expect(card(page)).not.toContainText('[object Object]')
  })

  test('a message from the API is shown as it is', async ({ page }) => {
    await mockRoutes(page)
    await page.route('**/api/routes', (route) => route.fulfill({
      status: 422, contentType: 'application/json',
      body: JSON.stringify({ detail: 'Start and end are too close together. Choose points further apart.' }),
    }))
    await openRoutes(page, 'dark')
    const { a, b } = routeClicks(page.viewportSize())
    await page.mouse.click(a.x, a.y)
    await page.mouse.click(b.x, b.y)
    await analyse(page)
    await expect(card(page)).toContainText('Start and end are too close together.')
  })

  test('Area and Routes keep their own state on the one map', async ({ page }) => {
    await mockRoutes(page)
    await openRoutes(page, 'dark')
    const { a } = routeClicks(page.viewportSize())
    await page.mouse.click(a.x, a.y)
    await page.getByRole('link', { name: 'Area' }).click()
    await expect(page.getByText('to place the centre')).toBeVisible()
    await expect(page.getByTestId('route-start')).toHaveCount(0)
    await page.mouse.click(a.x, a.y)
    await expect(page.getByText('Move to set the radius')).toBeVisible()
    await page.getByRole('link', { name: 'Routes' }).click()
    await expect(page.getByTestId('route-start')).toBeVisible()
    await expect(page.locator('.handle')).toHaveCount(0)
    await page.getByRole('link', { name: 'Area' }).click()
    await expect(page.getByText('Move to set the radius')).toBeVisible()
  })

  test('search sets the point', async ({ page }) => {
    await mockRoutes(page)
    await page.route('**/api/search', (route) => route.fulfill({ json: { results: [
      { name: 'Graben', detail: 'Innere Stadt, Wien', lat: 48.2086, lon: 16.3695, kind: 'pedestrian' },
    ] } }))
    await openRoutes(page, 'dark')
    // The fields open from the hint's "type an address", which focuses Start.
    await page.getByRole('button', { name: 'type an address' }).click()
    const start = page.getByRole('combobox', { name: 'Start' })
    await expect(start).toBeFocused()
    await start.fill('Graben')
    await page.getByRole('option', { name: /Graben/ }).click()
    await expect(start).toHaveValue('Graben')
    await expect(page.getByTestId('route-start')).toBeVisible()
    await expect(page.getByText('Now click where you want to go')).toBeVisible()
    const end = page.getByRole('combobox', { name: 'End' })
    await end.fill('Graben')
    await page.getByRole('option', { name: /Graben/ }).click()
    await expect(page.getByText('Start and end are only')).toBeVisible() // the same point twice
  })

  test('keyboard: Enter sets both points, sections and arrows work without a pointer', async ({ page }) => {
    await mockRoutes(page)
    await openRoutes(page, 'dark')
    await page.locator('canvas').focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('inputs')).toContainText(/\d+\.\d+° N, \d+\.\d+° E/)
    await page.evaluate(() => window.__sencityMap.jumpTo({ center: [16.376, 48.2085] }))
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'Analyse this walk' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(card(page)).toContainText('Which way feels better?')
    // The bar is one Tab stop, and the arrow keys go along it.
    await expect(page.locator('[data-route="A"] .section[tabindex="0"]')).toHaveCount(1)
    await page.locator('[data-stretch="A-0"]').focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('[data-stretch="A-1"]')).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(page.locator('[data-stretch="A-0"]')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'Back to comparison' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-stretch="A-0"]')).toBeFocused()
  })
})

// When A is already the easiest, B is an alternative. Its button stays on one line, even at the narrowest.
for (const [width, height] of [[360, 640], [768, 1024], [1440, 900]]) {
  test.describe(`alternative ${width}x${height}`, () => {
    test.use({ viewport: { width, height }, colorScheme: 'dark' })

    test('the label fits on one line', async ({ page }) => {
      await mockRoutes(page, { second: true })
      await openRoutes(page, 'dark')
      await page.locator('canvas').focus()
      await page.keyboard.press('Enter')
      await page.evaluate(() => window.__sencityMap.jumpTo({ center: [16.376, 48.2085] }))
      await page.keyboard.press('Enter')
      await analyse(page)
      const a = page.getByRole('button', { name: /Route A, shortest/ })
      const b = page.getByRole('button', { name: /Route B, alternative/ })
      await expect(b).toContainText('B · alternative')
      const [ha, hb] = [await a.evaluate((el) => el.offsetHeight), await b.evaluate((el) => el.offsetHeight)]
      expect(hb).toBe(ha)
      const lines = await b.evaluate((el) => {
        // Only the text: the line sample beside it sits at another height.
        const text = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim())
        const r = document.createRange()
        r.selectNodeContents(text)
        return new Set([...r.getClientRects()].filter((c) => c.width > 1).map((c) => Math.round(c.top))).size
      })
      expect(lines).toBe(1)
      await page.locator('[data-panel="route-card"]').screenshot({ path: `e2e/screens/routes/alternative-${width}.png` })
    })
  })
}

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', hasTouch: true })

  test('fields and swap at the top, the comparison in the sheet (board P3)', async ({ page }) => {
    const mock = await mockRoutes(page)
    await openRoutes(page, 'dark')
    const { a, b } = routeClicks(page.viewportSize(), true)
    await page.mouse.click(a.x, a.y)
    await page.mouse.click(b.x, b.y)
    await expect(card(page)).toContainText('This walk')
    await mapIdle(page)
    await page.screenshot({ path: 'e2e/screens/routes/P3-preview.png' })
    await analyse(page)
    await expect(card(page)).toContainText('Which way feels better?')
    await expect(card(page)).toContainText('Layer')
    await expect(card(page).getByRole('group', { name: 'Layer' })).toBeVisible()
    await expect(card(page)).toContainText('Tap a stretch')
    await mapIdle(page)
    await page.screenshot({ path: 'e2e/screens/routes/P3-result.png' })
    await page.getByRole('button', { name: 'Swap start and end' }).click()
    await expect.poll(() => mock.requests.length).toBe(2)
    expect(mock.requests[1].start).toEqual(mock.requests[0].end)
  })
})

// Fit every screen (brief §3).
const SIZES = [[360, 640], [390, 844], [768, 1024], [1024, 768], [1280, 720], [1366, 768], [1440, 900], [1920, 1080], [844, 390], [640, 360], [640, 720]]
for (const theme of ['dark', 'light']) {
  for (const [width, height] of SIZES) {
    test.describe(`fit ${width}x${height} ${theme}`, () => {
      test.use({ viewport: { width, height }, colorScheme: theme })

      test('fits', async ({ page }) => {
        await mockRoutes(page)
        await openRoutes(page, theme)
        const phone = width < 768
        expect(await layoutProblems(page), 'start').toEqual([])
        await page.screenshot({ path: `e2e/screens/routes/fit/${width}x${height}-${theme}-start.png` })
        // Set the points without clicking through panels: the map centre and a point beside it.
        await page.locator('canvas').focus()
        await page.keyboard.press('Enter')
        expect(await layoutProblems(page), 'start set').toEqual([])
        await page.evaluate(() => window.__sencityMap.jumpTo({ center: [16.376, 48.2085] }))
        await page.keyboard.press('Enter')
        await expect(card(page)).toContainText('This walk')
        await mapIdle(page)
        expect(await layoutProblems(page), 'preview').toEqual([])
        await page.screenshot({ path: `e2e/screens/routes/fit/${width}x${height}-${theme}-preview.png` })
        await analyse(page)
        await expect(card(page)).toContainText('Which way feels better?')
        await page.waitForTimeout(500)
        await mapIdle(page)
        expect(await layoutProblems(page), 'result').toEqual([])
        await page.screenshot({ path: `e2e/screens/routes/fit/${width}x${height}-${theme}-result.png` })
        await page.locator('[data-stretch="A-1"]').click()
        await expect(stretch(page)).toContainText('stretch 2 of 5')
        await page.waitForTimeout(phone ? 500 : 300)
        await mapIdle(page)
        expect(await layoutProblems(page), 'stretch').toEqual([])
        await page.screenshot({ path: `e2e/screens/routes/fit/${width}x${height}-${theme}-stretch.png` })
      })
    })
  }
}
