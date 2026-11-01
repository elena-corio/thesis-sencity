// Fit every screen (brief §3): screenshots of /map at every size, both orientations, dark and light,
// before and after an area is set. Fails if the page scrolls, a panel is clipped or outside the
// viewport, two panels overlap, or a panel not marked data-scrollable overflows.
import { expect, test } from '@playwright/test'
import { WITH_3, layoutProblems, mapIdle, mockArea, openMap, openSegment } from './helpers.js'

const SIZES = [[360, 640], [390, 844], [768, 1024], [1280, 720], [1366, 768], [1440, 900], [1920, 1080]]
const VIEWPORTS = []
for (const [w, h] of SIZES) {
  VIEWPORTS.push({ name: `${w}x${h}`, width: w, height: h })
  VIEWPORTS.push({ name: `${h}x${w}`, width: h, height: w })
}
// 200% browser zoom: half the CSS pixels at twice the density (desktop sizes).
for (const [w, h] of SIZES.filter(([w]) => w >= 1280)) {
  VIEWPORTS.push({ name: `${w}x${h}@200%`, width: w / 2, height: h / 2, scale: 2 })
}

async function setArea(page, vp) {
  const r = Math.round(Math.min(vp.width, vp.height) * 0.1)
  const cx = Math.round(vp.width * 0.5)
  const cy = Math.round(vp.height * 0.58)
  await page.mouse.click(cx, cy)
  await page.mouse.move(cx + r, cy - r / 2, { steps: 4 })
  await page.mouse.click(cx + r, cy - r / 2)
  await expect(page.getByRole('button', { name: 'Analyse this area' })).toBeVisible()
}

for (const theme of ['dark', 'light']) {
  for (const vp of VIEWPORTS) {
    test.describe(`${vp.name} ${theme}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.scale ?? 1, colorScheme: theme })

      test('fits', async ({ page }) => {
        await mockArea(page)
        await openMap(page, theme)
        expect(await layoutProblems(page), 'start').toEqual([])
        await page.screenshot({ path: `e2e/screens/fit/${vp.name}-${theme}-start.png` })

        await setArea(page, vp)
        await mapIdle(page)
        expect(await layoutProblems(page), 'area set').toEqual([])
        await page.screenshot({ path: `e2e/screens/fit/${vp.name}-${theme}-set.png` })

        // Place card open (board 2f; phone P2).
        await page.getByRole('button', { name: 'Analyse this area' }).click()
        await expect(page.getByText('street stretches')).toBeVisible()
        await openSegment(page, WITH_3.properties.id)
        await expect(page.locator('[data-panel="place-card"]')).toContainText('Photo 1 of 3')
        await mapIdle(page)
        expect(await layoutProblems(page), 'place card').toEqual([])
        await page.screenshot({ path: `e2e/screens/fit/${vp.name}-${theme}-place.png` })

        // Enlarged photo (board 2f+; phone P2+): the page never scrolls; on a desktop or tablet
        // the whole view fits without scrolling inside it either.
        await page.locator('[data-panel="place-card"]').getByRole('button', { name: 'Enlarge photo', exact: true }).click()
        const viewer = page.locator('[data-viewer]')
        await expect(viewer).toContainText('Photo 1 of 3')
        const v = await viewer.evaluate((el) => ({
          over: el.scrollHeight - el.clientHeight,
          pageScrolls: document.documentElement.scrollHeight > innerHeight + 1,
        }))
        expect(v.pageScrolls, 'page scrolls under the photo').toBe(false)
        if (vp.width >= 768 && vp.height >= 600) expect(v.over, 'enlarged photo overflows').toBeLessThanOrEqual(1)
        await page.screenshot({ path: `e2e/screens/fit/${vp.name}-${theme}-photo.png` })
      })
    })
  }
}

// Larger system font size (125%) on a laptop and a phone.
for (const vp of [{ name: '1280x720', width: 1280, height: 720 }, { name: '390x844', width: 390, height: 844 }]) {
  test.describe(`${vp.name} large text`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, colorScheme: 'dark' })
    test('fits', async ({ page }) => {
      await page.addInitScript(() => {
        document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = '125%' })
      })
      await openMap(page, 'dark')
      expect(await layoutProblems(page), 'start').toEqual([])
      await setArea(page, vp)
      expect(await layoutProblems(page), 'area set').toEqual([])
      await page.screenshot({ path: `e2e/screens/fit/${vp.name}-large-text-set.png` })
    })
  })
}
