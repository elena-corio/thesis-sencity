// The two-click area selection, step by step, with screenshots (boards Flow 1, 1b, 1c, Flow 2 circle).
import { expect, test } from '@playwright/test'
import { layoutProblems, mapIdle, mockArea, openMap, placeCentre, points } from './helpers.js'

const SHOTS = 'e2e/screens'

for (const theme of ['dark', 'light']) {
  test.describe(`desktop ${theme}`, () => {
    test.use({ viewport: { width: 1440, height: 900 }, colorScheme: theme })

    test('step 1 → 1b → 1c → analysed', async ({ page }) => {
      await mockArea(page)
      await openMap(page, theme)
      const p = points(page.viewportSize())

      // Step 1: hint and crosshair, no circle.
      await page.mouse.move(p.centre.x, p.centre.y)
      await expect(page.getByText('Click to place the centre')).toBeVisible()
      await page.screenshot({ path: `${SHOTS}/desktop-${theme}-1-start.png` })

      // Step 1b: centre placed, circle follows the pointer, radius chip.
      await placeCentre(page, p)
      await expect(page.getByText('Move to set the radius,')).toBeVisible()
      await expect(page.locator('.radius-chip')).toContainText('max 500 m')
      await mapIdle(page)
      await page.screenshot({ path: `${SHOTS}/desktop-${theme}-1b-radius.png` })

      // Step 1c: second click fixes the circle; Analyse in the left panel.
      await page.mouse.click(p.edge.x, p.edge.y)
      await expect(page.getByText('Area set.')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Analyse this area' })).toBeVisible()
      await page.mouse.move(p.centre.x - 200, p.centre.y + 150)
      await mapIdle(page)
      await page.screenshot({ path: `${SHOTS}/desktop-${theme}-1c-set.png` })
      expect(await layoutProblems(page)).toEqual([])

      // Analysed: header card with Change area, lit circle, dimmed outside.
      await page.getByRole('button', { name: 'Analyse this area' }).click()
      await expect(page.getByRole('button', { name: 'Change area' })).toBeVisible()
      await mapIdle(page)
      await page.screenshot({ path: `${SHOTS}/desktop-${theme}-2-analysed.png` })
      expect(await layoutProblems(page)).toEqual([])
    })
  })

  test.describe(`phone ${theme}`, () => {
    test.use({ viewport: { width: 390, height: 844 }, colorScheme: theme, hasTouch: true, isMobile: true })

    test('tap centre, tap radius, analyse', async ({ page }) => {
      await mockArea(page)
      await openMap(page, theme)
      const p = points(page.viewportSize(), 110, true)
      await expect(page.getByText('Tap to place the centre')).toBeVisible()
      await page.screenshot({ path: `${SHOTS}/phone-${theme}-1-start.png` })

      await page.touchscreen.tap(p.centre.x, p.centre.y)
      await expect(page.locator('.radius-chip')).toBeVisible()
      await mapIdle(page)
      await page.screenshot({ path: `${SHOTS}/phone-${theme}-1b-radius.png` })

      await page.touchscreen.tap(p.edge.x, p.edge.y)
      await expect(page.getByRole('button', { name: 'Analyse this area' })).toBeVisible()
      await mapIdle(page)
      await page.screenshot({ path: `${SHOTS}/phone-${theme}-1c-set.png` })
      expect(await layoutProblems(page)).toEqual([])

      await page.getByRole('button', { name: 'Analyse this area' }).tap()
      await expect(page.locator('[data-panel="area-card"]')).toContainText('street stretches')
      await mapIdle(page)
      await page.screenshot({ path: `${SHOTS}/phone-${theme}-2-analysed.png` })

      // P5: the account button opens the menu with the Appearance switch.
      await page.getByRole('button', { name: 'Your account' }).tap()
      await expect(page.getByRole('radiogroup', { name: 'Appearance' })).toBeVisible()
      await page.screenshot({ path: `${SHOTS}/phone-${theme}-menu.png` })
    })
  })
}
