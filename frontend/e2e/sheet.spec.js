// The phone layout (boards P1, P1b, P1c, P2, P3): one row on top, and one bottom sheet with the tabs
// Settings and Results at three heights, with the legend floating just above it. The API is mocked.
import { expect, test } from '@playwright/test'
import { analyseCentre, layoutProblems, mapIdle, mockArea, mockRoutes, openMap, openRoutes, routeClicks } from './helpers.js'

const sheet = (page) => page.locator('[data-panel="sheet"]')
const tab = (page, name) => sheet(page).getByRole('tab', { name: new RegExp(`^${name}`) })
const minimise = (page) => sheet(page).getByRole('button', { name: 'Minimise' })
const openBtn = (page) => sheet(page).getByRole('button', { name: 'Open the sheet' })
const legend = (page) => page.locator('[data-panel="legend"]')
const height = (page) => sheet(page).evaluate((el) => el.offsetHeight)
const settled = (page) => page.waitForTimeout(350)

for (const theme of ['dark', 'light']) {
  test.describe(`phone ${theme}`, () => {
    test.use({ viewport: { width: 390, height: 844 }, colorScheme: theme, hasTouch: true })

    test('one top row, a sheet with two tabs, and no floating controls', async ({ page }) => {
      await mockArea(page, { thermal: true })
      await openMap(page, theme)
      const bar = page.locator('[data-panel="search"]')
      await expect(bar.getByRole('link', { name: 'SenCity, home' })).toBeVisible()
      await expect(bar.getByRole('combobox', { name: 'Search a street or place' })).toBeVisible()
      const ask = bar.getByRole('button', { name: 'Ask' })
      expect(await ask.evaluate((el) => [el.offsetWidth, el.offsetHeight])).toEqual([40, 40])
      await expect(bar.getByRole('button', { name: 'Your account' })).toBeVisible()
      await expect(page.locator('[data-panel="ask"]')).toHaveCount(0)
      await expect(page.locator('[data-panel="controls"], [data-panel="layers"]')).toHaveCount(0)

      await expect(sheet(page).getByRole('tablist')).toBeVisible()
      await expect(tab(page, 'Settings')).toHaveAttribute('aria-selected', 'true')
      await expect(openBtn(page)).toHaveAttribute('aria-expanded', 'false')
      expect(await height(page)).toBe(76)
      expect(await layoutProblems(page)).toEqual([])
      await page.screenshot({ path: `e2e/screens/sheet-${theme}-start.png` })

      // After Analyse: Results at half height, with the legend just above the sheet.
      await analyseCentre(page)
      await expect(tab(page, 'Results')).toHaveAttribute('aria-selected', 'true')
      await expect(page.locator('[data-panel="area-card"]')).toContainText('Likely easiest for you')
      await settled(page)
      await mapIdle(page)
      expect(await layoutProblems(page), 'half').toEqual([])
      await page.screenshot({ path: `e2e/screens/sheet-${theme}-results.png` })

      await tab(page, 'Settings').click()
      for (const name of ['Layer', 'Season and time', 'Show places']) {
        await expect(sheet(page).getByRole('radiogroup', { name })).toBeVisible()
      }
      await page.screenshot({ path: `e2e/screens/sheet-${theme}-settings.png` })

      await minimise(page).click()
      await settled(page)
      await mapIdle(page)
      expect(await height(page)).toBe(76)
      expect(await layoutProblems(page), 'minimised').toEqual([])
      await page.screenshot({ path: `e2e/screens/sheet-${theme}-minimised.png` })
    })
  })
}

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', hasTouch: true })

  test('minimised shows a line per tab; a tab or the chevron opens the sheet', async ({ page }) => {
    await mockArea(page, { thermal: true })
    await openMap(page, 'dark')
    await analyseCentre(page)
    await expect(page.locator('[data-panel="area-card"]')).toContainText('Likely easiest for you')
    await minimise(page).click()
    await expect(tab(page, 'Settings')).toContainText('Thermal · summer 15:00')
    await expect(tab(page, 'Results')).toContainText(/\d+ suggestions?/)
    await expect(tab(page, 'Results')).toHaveAttribute('aria-selected', 'true') // the last one used

    // The line fits; nothing is cut with an ellipsis at this width.
    expect(await tab(page, 'Settings').locator('.tab-line').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    const [one, two] = await Promise.all([tab(page, 'Settings').boundingBox(), tab(page, 'Results').boundingBox()])
    expect(two.x - (one.x + one.width)).toBeGreaterThanOrEqual(8)

    await tab(page, 'Settings').click()
    await expect(minimise(page)).toHaveAttribute('aria-expanded', 'true')
    await expect(tab(page, 'Settings')).toHaveAttribute('aria-selected', 'true')
    await expect(sheet(page).getByRole('radiogroup', { name: 'Layer' })).toBeVisible()

    await minimise(page).click()
    await openBtn(page).click()
    await expect(tab(page, 'Settings')).toHaveAttribute('aria-selected', 'true')
  })

  test('the legend floats just above the sheet and moves with it, also when minimised', async ({ page }) => {
    await mockArea(page, { thermal: true })
    await openMap(page, 'dark')
    await expect(legend(page)).toHaveCount(0) // nothing to read before the analysis
    await analyseCentre(page)
    await expect(legend(page)).toContainText('Thermal comfort °C')
    for (const label of ['Easy', 'Mixed', 'Hard', 'No value']) await expect(legend(page)).toContainText(label)
    const gap = async () => {
      const [l, s] = await Promise.all([legend(page).boundingBox(), sheet(page).boundingBox()])
      return { above: s.y - (l.y + l.height), top: s.y }
    }
    await settled(page)
    const half = await gap()
    await minimise(page).click()
    await settled(page)
    const min = await gap()
    expect(min.top).toBeGreaterThan(half.top)
    expect(min.above).toBeGreaterThan(0)
    expect(min.above).toBeLessThan(40)
    expect(half.above).toBeLessThan(40)
  })

  test('the Results card is whole, and the circle sits in the free space above the legend', async ({ page }) => {
    await mockArea(page, { thermal: true })
    await openMap(page, 'dark')
    await analyseCentre(page)
    const card = page.locator('[data-panel="area-card"]')
    await expect(card).toContainText('Likely easiest for you')
    expect((await card.getByRole('img', { name: /^Thermal: / }).boundingBox()).height).toBeGreaterThan(4)
    // The circle's lowest point, once the map has moved, is above the legend.
    await expect.poll(async () => page.evaluate(() => {
      const m = window.__sencityMap
      const ring = m.getSource('sc-circle').serialize().data.coordinates[0]
      const bottom = Math.max(...ring.map((c) => m.project(c).y))
      return bottom - document.querySelector('[data-panel="legend"]').getBoundingClientRect().top
    }), { timeout: 5000 }).toBeLessThan(0)
  })

  test('tapping a street or suggestion goes to Results with its card; Change goes to Settings with the fields open', async ({ page }) => {
    await mockArea(page, { thermal: true })
    await openMap(page, 'dark')
    await analyseCentre(page)
    await expect(page.locator('[data-panel="area-card"]')).toContainText('Likely easiest for you')
    await settled(page)
    const open = await height(page)

    await tab(page, 'Settings').click()
    await expect(tab(page, 'Settings')).toHaveAttribute('aria-selected', 'true')
    await tab(page, 'Results').click()
    await page.getByTestId('suggestions').getByRole('button').first().click()
    await expect(page.locator('[data-panel="place-card"]').getByRole('button', { name: 'Back to area' })).toBeVisible()
    await settled(page)
    expect(await height(page), 'the place card does not change the height').toBe(open)
    await mapIdle(page)
    expect(await layoutProblems(page)).toEqual([])
    await page.screenshot({ path: 'e2e/screens/sheet-dark-place.png' })
    await page.getByRole('button', { name: 'Back to area' }).click()
    await expect(page.locator('[data-panel="area-card"]')).toBeVisible()
    await settled(page)
    expect(await height(page)).toBe(open)

    await tab(page, 'Settings').click()
    await sheet(page).getByRole('button', { name: /^Change area/ }).click()
    await expect(tab(page, 'Settings')).toHaveAttribute('aria-selected', 'true')
    await expect(sheet(page).getByRole('combobox', { name: 'Centre' })).toBeVisible()
    await settled(page)
    expect(await height(page), 'nor do the open fields').toBe(open)
  })

  test('the chosen tab stays when nothing leads elsewhere, as for a new season', async ({ page }) => {
    await mockArea(page, { thermal: true })
    await openMap(page, 'dark')
    await analyseCentre(page)
    await expect(page.locator('[data-panel="area-card"]')).toContainText('Likely easiest for you')
    await tab(page, 'Settings').click()
    await sheet(page).getByRole('radio', { name: 'Winter' }).click()
    await expect(sheet(page).getByRole('radio', { name: 'Winter' })).toHaveAttribute('aria-checked', 'true')
    await page.waitForTimeout(900)
    await expect(tab(page, 'Settings')).toHaveAttribute('aria-selected', 'true')
  })

  test('dragging the top of the sheet minimises and opens it, never taller, and the map works above it', async ({ page }) => {
    await mockArea(page, { thermal: true })
    await openMap(page, 'dark')
    await analyseCentre(page)
    await expect(page.locator('[data-panel="area-card"]')).toContainText('Likely easiest for you')
    await settled(page)
    const open = await height(page)
    const box = await sheet(page).boundingBox()
    const x = box.x + box.width / 2
    const dragTopBy = async (dy) => {
      const top = (await sheet(page).boundingBox()).y
      await page.mouse.move(x, top + 8)
      await page.mouse.down()
      await page.mouse.move(x, top + 8 + dy, { steps: 5 })
      await page.mouse.up()
      await settled(page)
    }
    await dragTopBy(-200) // up, when already open: it stays
    expect(await height(page)).toBe(open)
    await dragTopBy(200)
    expect(await height(page)).toBe(76)
    await dragTopBy(-200)
    expect(await height(page)).toBe(open)
    await dragTopBy(200)

    const zoom = () => page.evaluate(() => window.__sencityMap.getCenter().lng)
    const before = await zoom()
    await page.mouse.move(195, 300)
    await page.mouse.down()
    await page.mouse.move(120, 300, { steps: 5 })
    await page.mouse.up()
    await expect.poll(zoom).not.toBeCloseTo(before, 6)
  })

  test('the routes: Walk buttons in Results, and the easiest way in the minimised line', async ({ page }) => {
    await mockRoutes(page)
    await openRoutes(page, 'dark')
    const { a, b } = routeClicks(page.viewportSize(), true)
    await page.mouse.click(a.x, a.y)
    await page.mouse.click(b.x, b.y)
    await expect(tab(page, 'Settings')).toHaveAttribute('aria-selected', 'true')
    await sheet(page).getByRole('button', { name: 'Analyse the routes' }).click()
    await expect(tab(page, 'Results')).toHaveAttribute('aria-selected', 'true')
    await expect(sheet(page).getByRole('button', { name: 'Walk route B' })).toBeVisible()
    await expect(sheet(page).getByRole('button', { name: 'Walk A' })).toBeVisible()
    await expect(legend(page)).toContainText('Thermal comfort °C')
    await settled(page)
    await mapIdle(page)
    await page.screenshot({ path: 'e2e/screens/sheet-dark-routes.png' })
    await minimise(page).click()
    await expect(tab(page, 'Results')).toContainText('Route B easiest')
  })

  test('keyboard: arrows move between tabs, and focus goes into the sheet when it opens', async ({ page }) => {
    await mockArea(page, { thermal: true })
    await openMap(page, 'dark')
    await analyseCentre(page)
    await expect(page.locator('[data-panel="area-card"]')).toContainText('Likely easiest for you')
    await tab(page, 'Results').focus()
    await page.keyboard.press('ArrowLeft')
    await expect(tab(page, 'Settings')).toBeFocused()
    await expect(tab(page, 'Settings')).toHaveAttribute('aria-selected', 'true')
    await expect(tab(page, 'Results')).toHaveAttribute('tabindex', '-1')
    const panel = await tab(page, 'Settings').getAttribute('aria-controls')
    await expect(page.locator(`[id="${panel}"]`)).toBeVisible()

    await minimise(page).focus()
    await page.keyboard.press('Enter')
    await expect(openBtn(page)).toBeFocused()
    await page.keyboard.press('Enter')
    expect(await sheet(page).evaluate((el) => el.contains(document.activeElement))).toBe(true)
  })

  test('every control in the sheet is at least 44 px high', async ({ page }) => {
    await mockArea(page, { thermal: true })
    await openMap(page, 'dark')
    await analyseCentre(page)
    await expect(page.locator('[data-panel="area-card"]')).toContainText('Likely easiest for you')
    const small = () => sheet(page).evaluate((el) => [...el.querySelectorAll('button, [role="tab"], [role="radio"]')]
      .filter((b) => b.getClientRects().length && b.offsetHeight < 44)
      .map((b) => `${b.textContent.trim() || b.getAttribute('aria-label')}: ${b.offsetHeight}`))
    expect(await small(), 'Results').toEqual([])
    await tab(page, 'Settings').click()
    await sheet(page).getByTestId('inputs').getByRole('button').first().click()
    expect(await small(), 'Settings').toEqual([])
  })
})

test.describe('small phone', () => {
  test.use({ viewport: { width: 360, height: 640 }, colorScheme: 'dark', hasTouch: true })

  test('a long place card scrolls inside the sheet, and nothing is cut off', async ({ page }) => {
    await mockArea(page, { thermal: true })
    await openMap(page, 'dark')
    await analyseCentre(page)
    await expect(page.locator('[data-panel="area-card"]')).toContainText('Likely easiest for you')
    await page.getByTestId('suggestions').getByRole('button').first().click()
    await settled(page)
    expect(await layoutProblems(page)).toEqual([])
    const last = page.locator('[data-panel="place-card"] .foot')
    await last.scrollIntoViewIfNeeded()
    await expect(last).toBeInViewport()
  })
})
