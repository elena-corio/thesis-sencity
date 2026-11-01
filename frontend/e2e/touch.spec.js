// Phone: after the first tap, dragging a finger grows the circle live; lifting it fixes the radius.
import { expect, test } from '@playwright/test'
import { openMap } from './helpers.js'


async function touch(cdp, type, x, y) {
  await cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }],
  })
}

// A real phone, and a desktop browser's phone preview (touch input, but the pointer counts as "fine").
for (const [name, isMobile] of [['phone', true], ['desktop phone preview', false]]) {
test.describe(name, () => {
test.use({ viewport: { width: 390, height: 844 }, colorScheme: 'light', hasTouch: true, isMobile })

test('drag after the first tap sets the radius live', async ({ page }) => {
  await openMap(page, 'light')
  const cdp = await page.context().newCDPSession(page)
  const cx = 195
  const cy = 430

  await page.touchscreen.tap(cx, cy)
  await expect(page.locator('.radius-chip')).toBeVisible()
  const centreBefore = await page.evaluate(() => window.__sencityMap.getCenter())

  await touch(cdp, 'touchStart', cx + 20, cy)
  const chip = page.locator('.radius-chip')
  const values = []
  for (let dx = 40; dx <= 140; dx += 20) {
    await touch(cdp, 'touchMove', cx + dx, cy - dx / 3)
    values.push(Number((await chip.innerText()).match(/\d+/)[0]))
  }
  // The radius grows while the finger moves, before it is lifted.
  expect(values[values.length - 1]).toBeGreaterThan(values[0])
  await expect(page.getByRole('button', { name: 'Analyse this area' })).toBeHidden()
  // The map did not pan under the finger.
  const centreAfter = await page.evaluate(() => window.__sencityMap.getCenter())
  expect(Math.abs(centreAfter.lng - centreBefore.lng)).toBeLessThan(1e-9)

  await touch(cdp, 'touchEnd', cx + 140, cy - 47)
  await expect(page.getByRole('button', { name: 'Analyse this area' })).toBeVisible()
  await page.screenshot({ path: `e2e/screens/touch-drag-set-${isMobile ? 'phone' : 'preview'}.png` })
})
})
}

test.describe('mouse in a phone-sized window', () => {
  test.use({ viewport: { width: 390, height: 844 }, colorScheme: 'light' })

  test('press and drag after the first click sets the radius live', async ({ page }) => {
    await openMap(page, 'light')
    await page.mouse.click(195, 430)
    await page.mouse.move(215, 430)
    await page.mouse.down()
    await page.mouse.move(300, 400, { steps: 5 })
    const mid = Number((await page.locator('.radius-chip').innerText()).match(/\d+/)[0])
    await page.mouse.move(330, 390, { steps: 5 })
    const later = Number((await page.locator('.radius-chip').innerText()).match(/\d+/)[0])
    expect(later).toBeGreaterThan(mid)
    await page.mouse.up()
    await expect(page.getByRole('button', { name: 'Analyse this area' })).toBeVisible()
  })
})
