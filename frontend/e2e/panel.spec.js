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
})

for (const [name, viewport, phone] of [['phone', { width: 390, height: 844 }, true], ['tablet', { width: 1024, height: 768 }, false]]) {
  test.describe(name, () => {
    test.use({ viewport, colorScheme: 'light', hasTouch: phone, isMobile: phone })

    test('the area sheet carries the layer choice and, under it, season and time', async ({ page }) => {
      await mockArea(page, { thermal: true })
      await openMap(page, 'light')
      await analyseCentre(page)
      const card = page.locator('[data-panel="area-card"]')
      await expect(card.getByRole('button', { name: 'Thermal', exact: true })).toHaveAttribute('aria-pressed', 'true')
      const block = card.getByTestId('season-time')
      await expect(block).toBeVisible()
      expect(await inOrder(page, ['[data-panel="area-card"] [aria-label="Layer"]', '[data-panel="area-card"] [data-testid="season-time"]'])).toBe(true)
      await expect(page.locator('[data-panel="season"], [data-panel="season-chip"]')).toHaveCount(0)
      await mapIdle(page)
      expect(await layoutProblems(page)).toEqual([])
      await page.screenshot({ path: `e2e/screens/panel-light-${name}-sheet.png` })
    })
  })
}
