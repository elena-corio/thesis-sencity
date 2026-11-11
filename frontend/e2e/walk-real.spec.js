// The walk with real Mapillary photos and real buildings, for a visual check: only the routes are mocked (no billed
// thermal run or model call); /api/mapillary/along and /api/buildings go to the running API, which calls Mapillary and
// reads the city's building model (both free). It needs MAPILLARY_ACCESS_TOKEN in .env, so it runs only on request:
//   REAL_PHOTOS=1 npx playwright test e2e/walk-real.spec.js
// REAL_API=http://127.0.0.1:8001 sends those two to another API (one started with the current code).
// Screenshots go to e2e/screens/walk-real/ (not committed). Nothing else is saved.
import { expect, test } from '@playwright/test'
import { mapIdle, mockRoutes, openRoutes, routeClicks } from './helpers.js'

test.skip(!process.env.REAL_PHOTOS, 'Set REAL_PHOTOS=1 to call the real Mapillary and buildings lookups.')

const settle = (page) => page.waitForFunction(() => !window.__sencityMap.isMoving(), null, { timeout: 15_000 })
const walkStore = (page, expr) => page.evaluate((e) => {
  const w = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('walk')
  return new Function('w', `return ${e}`)(w)
}, expr)

/** Go to the first stretch with (or without) a photo; false if there is none. */
async function goTo(page, withPhoto) {
  const keys = await walkStore(page, 'w.stretches.map((s) => s.key)')
  const photos = await walkStore(page, 'Object.fromEntries(Object.entries(w.mapillary ?? {}))')
  const i = keys.findIndex((k) => Boolean(photos?.[k]) === withPhoto)
  if (i < 0) return false
  await walkStore(page, `w.go(${i})`)
  return true
}

for (const [name, viewport, phone] of [['desktop', { width: 1440, height: 900 }, false], ['phone', { width: 390, height: 844 }, true]]) {
  test.describe(name, () => {
    test.use({ viewport, colorScheme: 'dark', hasTouch: phone })

    test(`${name}: a real Mapillary photo, and a stretch without one`, async ({ page }) => {
      test.setTimeout(120_000)
      await mockRoutes(page)
      // With REAL_API set (e.g. http://127.0.0.1:8001), the two real lookups go to that API, not the dev proxy's.
      if (process.env.REAL_API) {
        for (const path of ['/api/mapillary/along', '/api/buildings']) {
          await page.route(`**${path}`, async (route) => route.fulfill({ response: await route.fetch({ url: process.env.REAL_API + path }) }))
        }
      }
      await openRoutes(page, 'dark', { photos: 'mapillary' })
      const { a, b } = routeClicks(page.viewportSize(), phone)
      await page.mouse.click(a.x, a.y)
      await page.mouse.click(b.x, b.y)
      if (phone) await page.getByRole('tab', { name: /Settings/ }).click()
      await page.getByRole('button', { name: 'Analyse the routes' }).click()
      await page.getByRole('button', { name: 'Walk route B' }).click()
      await page.waitForFunction(() => {
        const w = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('walk')
        return w.photoState !== 'loading' && w.buildingsState !== 'loading'
      }, null, { timeout: 60_000 })
      const state = await walkStore(page, '({ photos: w.photoState, buildings: w.buildingsState, n: w.stretches.length })')
      console.log(name, JSON.stringify(state))

      if (await goTo(page, true)) {
        await expect(page.getByTestId('walk-photo')).toBeVisible()
        await page.waitForFunction(() => document.querySelector('[data-testid="walk-photo"] img')?.complete, null, { timeout: 30_000 })
        await settle(page)
        await mapIdle(page)
        const credit = await page.getByTestId('walk-photo').locator('.credit').textContent()
        console.log(name, 'credit', credit)
        await page.screenshot({ path: `e2e/screens/walk-real/${name}-photo.png` })
      } else console.log(name, 'no stretch has a Mapillary photo')

      // A panorama turned to the walk, if the route has one.
      const keys = await walkStore(page, 'w.stretches.map((s) => s.key)')
      const panos = await walkStore(page, 'Object.keys(w.mapillary).filter((k) => w.mapillary[k]?.pano)')
      console.log(name, 'stretches', keys.length, 'panoramas', panos.length)
      if (panos.length) {
        await walkStore(page, `w.go(${keys.indexOf(panos[0])})`)
        await expect(page.getByTestId('walk-pano')).toBeVisible()
        await page.waitForTimeout(3000) // the panorama is a background image: give it time to arrive
        await settle(page)
        await mapIdle(page)
        await page.screenshot({ path: `e2e/screens/walk-real/${name}-pano.png` })
      }

      // A stretch without a Mapillary photo, if the route has one (e2e/walk.spec.js shows the state with mocks).
      if (await goTo(page, false)) {
        await expect(page.getByTestId('walk-no-photo')).toBeVisible()
        await settle(page)
        await mapIdle(page)
        await page.screenshot({ path: `e2e/screens/walk-real/${name}-no-photo.png` })
      } else console.log(name, 'every stretch has a Mapillary photo')
    })
  })
}
