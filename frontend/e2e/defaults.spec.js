// Defaults and the message when something does not work (Elena, 2026-11-23).
import { expect, test } from '@playwright/test'
import { openMap } from './helpers.js'

const store = (page, name, key) => page.evaluate(([n, k]) => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get(n)[k], [name, key])

test.use({ viewport: { width: 1440, height: 900 } })

test('Area and Routes open on Overall, with no profile on this device', async ({ page }) => {
  await openMap(page, 'light', { layer: null })
  expect(await store(page, 'area', 'layer')).toBe('overall')
  expect(await store(page, 'routes', 'layer')).toBe('overall')
})

test('a click that fails shows a message instead of doing nothing; it closes', async ({ page }) => {
  await openMap(page, 'light', { layer: null })
  // The report breaks before it opens (as some real data might).
  await page.evaluate(() => {
    const s = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('report')
    s.openReport = () => { throw new Error('test: broken report') }
  })
  await page.getByRole('button', { name: 'Print report' }).click()
  const notice = page.getByTestId('app-notice')
  await expect(notice).toHaveText('Something did not work. Try again; if it keeps happening, reload the page.')
  await expect(notice).toHaveAttribute('role', 'alert')
  await notice.getByRole('button', { name: 'Close the message' }).click()
  await expect(notice).toHaveCount(0)
})
