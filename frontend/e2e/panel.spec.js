// Left panel layout: controls first, legend last; season and time inside the layer controls (no
// floating bar), and in the area sheet when the left panel gives way (phone, below 1200 px).
import { expect, test } from '@playwright/test'
import { analyseCentre, layoutProblems, mapIdle, mockArea, openMap } from './helpers.js'

/** True when every element of the list comes after the one before it in the page. */
const inOrder = (page, selectors) => page.evaluate((sels) => {
  const els = sels.map((s) => document.querySelector(s))
  if (els.some((e) => !e)) return `missing: ${sels[els.findIndex((e) => !e)]}`
  return els.every((e, i) => i === 0 || (els[i - 1].compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING)) || 'out of order'
}, selectors)

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })

  test('Layer, then season and time, then Places, then the legend last; no floating bar', async ({ page }) => {
    await mockArea(page, { thermal: true })
    await openMap(page, 'dark')
    // No legend before the area is loaded.
    await expect(page.locator('[data-panel="layers"] [aria-label="Legend"]')).toHaveCount(0)
    await analyseCentre(page)
    const panel = page.locator('[data-panel="layers"]')
    await expect(panel.getByTestId('thermal-legend')).toBeVisible()
    expect(await inOrder(page, ['[data-panel="layers"] [aria-label="Layer"]', '[data-panel="layers"] [data-testid="season-time"]',
      '[data-panel="layers"] [aria-label="Show places"]', '[data-panel="layers"] [data-testid="thermal-legend"]'])).toBe(true)
    await expect(page.locator('[data-panel="season"]')).toHaveCount(0)
    // Season and time sit about evenly between Layer and Places, with a little more room above.
    const gaps = await panel.evaluate((el) => {
      const box = (s) => el.querySelector(s).getBoundingClientRect()
      return { above: box('[data-testid="season-time"]').top - box('[aria-label="Layer"]').bottom,
        below: box('.places-title').top - box('[data-testid="season-time"] output').bottom }
    })
    expect(gaps.above).toBeGreaterThanOrEqual(gaps.below)
    expect(gaps.above - gaps.below).toBeLessThanOrEqual(4)
    const block = panel.getByTestId('season-time')
    await expect(block).toContainText('Season and time')
    await expect(block).toContainText('Changes heat and cold')
    // No side note and no source line: the source is in the info tooltip and the map credits.
    await expect(panel).not.toContainText('side shown')
    await expect(panel).not.toContainText('Simulated by Infrared.city')
    // The slider runs from 9:00 to 21:00.
    const slider = block.getByRole('slider', { name: 'Time of day' })
    await expect(slider).toHaveAttribute('min', '9')
    await expect(slider).toHaveAttribute('max', '21')
    // A radiogroup: arrows move and choose, one Tab stop.
    const summer = block.getByRole('radio', { name: 'Summer' })
    await summer.focus()
    await page.keyboard.press('ArrowRight')
    const autumn = block.getByRole('radio', { name: 'Autumn' })
    await expect(autumn).toHaveAttribute('aria-checked', 'true')
    await expect(autumn).toBeFocused()
    await expect(summer).toHaveAttribute('tabindex', '-1')
    await mapIdle(page)
    expect(await layoutProblems(page)).toEqual([])
    await page.screenshot({ path: 'e2e/screens/panel-dark-left.png' })
  })

  test('Area opens on Thermal, Senses and Overall are inactive, and the loading skips only the rating', async ({ page }) => {
    await mockArea(page, { hold: true })
    await openMap(page, 'dark')
    const panel = page.locator('[data-panel="layers"]')
    const radio = (name) => panel.getByRole('radio', { name, exact: true })
    await expect(radio('Thermal')).toHaveAttribute('aria-checked', 'true')
    await expect(radio('Senses')).toBeDisabled()
    await expect(radio('Overall')).toBeDisabled()
    await expect(panel.locator('[aria-label="Legend"]')).toHaveCount(0)

    const asked = page.waitForRequest('**/api/area')
    await analyseCentre(page)
    expect((await asked).postDataJSON().layer).toBe('thermal')
    const loading = page.locator('[data-panel="loading-card"]')
    await expect(loading).toContainText('Street photos')
    await expect(loading).toContainText('Thermal')
    await expect(loading).not.toContainText('Rating for your profile')
  })

  test('dark mode recolours the light base map, and light mode leaves it as it comes', async ({ page }) => {
    await openMap(page, 'dark')
    const road = () => page.evaluate(() => {
      const m = window.__sencityMap
      return m.isStyleLoaded() ? m.getPaintProperty('highway_minor', 'line-color') : null
    })
    await expect.poll(road).toBe('#4b5156')
    await page.getByRole('button', { name: 'Switch to light mode' }).click()
    await expect.poll(road).toBe('hsl(0,0%,88%)')
    await page.getByRole('button', { name: 'Switch to dark mode' }).click()
    await expect.poll(road).toBe('#4b5156') // again after the style swap
  })

  test('Layer, Places, Radius and Season are the same kind of button, in two weights', async ({ page }) => {
    await openMap(page, 'dark')
    await page.getByRole('button', { name: 'type an address' }).click()
    const panel = page.locator('[data-panel="layers"]')
    for (const name of ['Layer', 'Radius', 'Show places', 'Season and time']) {
      await expect(panel.getByRole('radiogroup', { name })).toBeVisible()
    }
    const size = (name) => panel.getByRole('radiogroup', { name }).getByRole('radio').first().evaluate((el) => ({
      height: el.offsetHeight, font: getComputedStyle(el).fontSize,
    }))
    expect(await size('Radius')).toEqual({ height: 30, font: '12px' })
    expect(await size('Show places')).toEqual({ height: 30, font: '12px' })
    expect(await size('Season and time')).toEqual({ height: 30, font: '12px' })
    expect((await size('Layer')).height).toBe(40)
  })
})

for (const [name, viewport, phone] of [['phone', { width: 390, height: 844 }, true], ['tablet', { width: 1024, height: 768 }, false]]) {
  test.describe(name, () => {
    test.use({ viewport, colorScheme: 'light', hasTouch: phone, isMobile: phone })

    test('the area sheet carries the layer choice and, under it, season and time', async ({ page }) => {
      await mockArea(page, { thermal: true })
      await openMap(page, 'light')
      await analyseCentre(page)
      const holder = phone ? '[data-panel="sheet"]' : '[data-panel="area-card"]'
      const card = page.locator(holder)
      await expect(page.locator('[data-panel="area-card"]')).toContainText('street stretches')
      if (phone) await card.getByRole('tab', { name: /^Settings/ }).tap()
      await expect(card.getByRole('radio', { name: 'Thermal', exact: true })).toHaveAttribute('aria-checked', 'true')
      const block = card.getByTestId('season-time')
      await expect(block).toBeVisible()
      expect(await inOrder(page, [`${holder} [aria-label="Layer"]`, `${holder} [data-testid="season-time"]`])).toBe(true)
      await expect(page.locator('[data-panel="season"], [data-panel="season-chip"]')).toHaveCount(0)
      await mapIdle(page)
      expect(await layoutProblems(page)).toEqual([])
      await page.screenshot({ path: `e2e/screens/panel-light-${name}-sheet.png` })
    })
  })
}
