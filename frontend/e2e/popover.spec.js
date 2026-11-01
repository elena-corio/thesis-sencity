// The account menu opens under the top-right bar, aligned with its right edge.
import { expect, test } from '@playwright/test'
import { openMap } from './helpers.js'

test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })

test('account menu lines up with the top-right bar', async ({ page }) => {
  await openMap(page, 'light')
  const bar = await page.locator('[data-panel="actions"]').boundingBox()
  for (const name of ['Your account']) {
    await page.getByRole('button', { name }).click()
    const menu = await page.locator('[data-popover]').boundingBox()
    expect(Math.abs(menu.x + menu.width - (bar.x + bar.width)), `${name}: right edges`).toBeLessThan(2)
    expect(menu.y).toBeGreaterThan(bar.y + bar.height)
    await page.screenshot({ path: `e2e/screens/menu-account.png`,
      clip: { x: bar.x - 200, y: 0, width: bar.width + 224, height: menu.y + menu.height + 24 } })
    await page.keyboard.press('Escape')
  }
})
